import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { Database } from '../../../shared/infrastructure/database/database.service';
import { writeOutbox } from '../../../shared/infrastructure/outbox/outbox';
import { MatchingRepository, ProviderCandidate, RequestForMatching } from '../domain/ports';
import { Scored } from '../domain/scoring';

const POINT = 'ST_SetSRID(ST_MakePoint($1,$2),4326)::geography';
const WIDE_BOX_M = 500_000; // borne fixe pour que l'index GiST serve ; le rayon propre de chaque prestataire est filtré ensuite

@Injectable()
export class PgMatchingRepository implements MatchingRepository {
  constructor(private readonly db: Database) {}

  async inbox(providerId: string) {
    const rows = await this.db.query(
      `SELECT r.id, r.title, r.service_type, r.urgency, r.city, r.status, m.score, COALESCE(m.notified_at, r.created_at) AS received_at,
              q.id AS quote_id, q.status AS quote_status
         FROM request_matches m
         JOIN service_requests r ON r.id = m.request_id
         LEFT JOIN LATERAL (SELECT id, status FROM quotes WHERE request_id = r.id AND provider_id = m.provider_id AND status NOT IN ('withdrawn') ORDER BY created_at DESC LIMIT 1) q ON true
        WHERE m.provider_id = $1 AND m.declined_at IS NULL
        ORDER BY r.created_at DESC LIMIT 50`,
      [providerId],
    );
    return rows.map((r) => ({
      requestId: r.id, title: r.title, serviceType: r.service_type, urgency: r.urgency, city: r.city, requestStatus: r.status,
      score: Number(r.score), receivedAt: r.received_at.toISOString(), quote: r.quote_id ? { id: r.quote_id, status: r.quote_status } : null,
    }));
  }

  async getRequest(id: string): Promise<RequestForMatching | null> {
    const [r] = await this.db.query(
      `SELECT id, status, service_type, trade, urgency, desired_from,
              ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
         FROM service_requests WHERE id = $1`,
      [id],
    );
    return r && { id: r.id, status: r.status, serviceType: r.service_type, trade: r.trade, urgency: r.urgency, desiredFrom: r.desired_from, location: { lat: r.lat, lng: r.lng } };
  }

  // ponytail: plafonné à 200 candidats les plus proches avant scoring. Passer à un pré-score SQL si une zone en a plus.
  async findCandidates(loc: { lat: number; lng: number }, filter: { serviceType?: string; trade?: string }, at: Date, limit: number): Promise<ProviderCandidate[]> {
    const rows = await this.db.query(
      `SELECT * FROM (
         SELECT p.user_id, p.slug, p.company_name, p.headline, p.city, p.services::text[] AS services, p.trades::text[] AS trades,
                p.service_radius_km, p.emergency_available, p.avg_rating, p.reviews_count,
                p.avg_response_minutes, p.years_experience, p.completed_missions,
                ST_Distance(p.base_location, ${POINT}) / 1000 AS distance_km,
                u.avatar_file_id, (p.available_until IS NOT NULL AND p.available_until > $6::timestamptz) AS available_now
           FROM providers p
           JOIN users u ON u.id = p.user_id AND u.status = 'active' AND u.deleted_at IS NULL
          WHERE p.status = 'approved'
            AND ($3::service_type IS NULL OR p.services @> ARRAY[$3::service_type])
            AND ($4::trade_type IS NULL OR p.trades @> ARRAY[$4::trade_type])
            AND ST_DWithin(p.base_location, ${POINT}, ${WIDE_BOX_M})
       ) c
       WHERE c.distance_km <= c.service_radius_km
       ORDER BY c.distance_km LIMIT $5`,
      [loc.lng, loc.lat, filter.serviceType ?? null, filter.trade ?? null, limit, at],
    );
    if (!rows.length) return [];
    const ids = rows.map((r) => r.user_id);

    const [certs, slots, off] = await Promise.all([
      this.db.query(
        `SELECT provider_id, type FROM provider_certifications
          WHERE provider_id = ANY($1) AND review_status = 'approved' AND (expires_on IS NULL OR expires_on > $2::date)`,
        [ids, at],
      ),
      this.db.query(
        `SELECT provider_id, weekday, to_char(start_time,'HH24:MI') AS start, to_char(end_time,'HH24:MI') AS "end"
           FROM provider_availability_rules WHERE provider_id = ANY($1)`,
        [ids],
      ),
      this.db.query('SELECT DISTINCT provider_id FROM provider_time_off WHERE provider_id = ANY($1) AND period @> $2::timestamptz', [ids, at]),
    ]);
    const group = (list: QueryResultRow[]) => {
      const m = new Map<string, QueryResultRow[]>();
      for (const x of list) m.set(x.provider_id, [...(m.get(x.provider_id) ?? []), x]);
      return m;
    };
    const certBy = group(certs), slotBy = group(slots), offSet = new Set(off.map((o) => o.provider_id));

    return rows.map((r) => ({
      providerId: r.user_id, slug: r.slug, companyName: r.company_name, headline: r.headline, city: r.city,
      services: r.services, trades: r.trades, distanceKm: r.distance_km, radiusKm: r.service_radius_km,
      emergencyAvailable: r.emergency_available, avgRating: Number(r.avg_rating), reviewsCount: r.reviews_count,
      avgResponseMinutes: r.avg_response_minutes, yearsExperience: r.years_experience, completedMissions: r.completed_missions,
      certifications: (certBy.get(r.user_id) ?? []).map((c) => c.type),
      slots: (slotBy.get(r.user_id) ?? []).map((s) => ({ weekday: s.weekday, start: s.start, end: s.end })),
      onTimeOff: offSet.has(r.user_id), availableNow: r.available_now, logoFileId: r.avatar_file_id,
    }));
  }

  async addPreferredMatch(requestId: string, providerId: string): Promise<void> {
    await this.db.tx(async (c) => {
      const { rowCount } = await c.query(
        `INSERT INTO request_matches (request_id, provider_id, score, score_details)
         SELECT $1, user_id, 100, '{"preferred":true}'::jsonb FROM providers WHERE user_id = $2 AND status = 'approved'
         ON CONFLICT (request_id, provider_id) DO NOTHING`,
        [requestId, providerId],
      );
      if (rowCount) await writeOutbox(c, 'service_request', requestId, [{ type: 'matching.provider_matched', payload: { requestId, providerId, score: 100 } }]);
    });
  }

  async saveMatches(requestId: string, matches: Scored<ProviderCandidate>[]): Promise<void> {
    if (!matches.length) return;
    await this.db.tx(async (c) => {
      const events = [];
      for (const m of matches) {
        const { rowCount } = await c.query(
          `INSERT INTO request_matches (request_id, provider_id, score, score_details) VALUES ($1,$2,$3,$4)
           ON CONFLICT (request_id, provider_id) DO NOTHING`,
          [requestId, m.candidate.providerId, m.score, JSON.stringify(m.details)],
        );
        if (rowCount) events.push({ type: 'matching.provider_matched', payload: { requestId, providerId: m.candidate.providerId, score: m.score } });
      }
      await writeOutbox(c, 'service_request', requestId, events);
    });
  }
}
