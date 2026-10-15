import { Injectable } from '@nestjs/common';
import type { ListServiceRequestsInput } from '@frigoconnect/contracts';
import { Database } from '../../../shared/infrastructure/database/database.service';
import { writeOutbox } from '../../../shared/infrastructure/outbox/outbox';
import {
  ServiceRequestDetails,
  ServiceRequestReadModel,
  ServiceRequestRepository,
  ServiceRequestSummary,
} from '../domain/ports';
import { ServiceRequest } from '../domain/service-request';

const COORDS = 'ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng';

@Injectable()
export class PgServiceRequestRepository implements ServiceRequestRepository {
  constructor(private readonly db: Database) {}

  async save(request: ServiceRequest): Promise<void> {
    const s = request.toSnapshot();
    await this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO service_requests
           (id, client_id, service_type, trade, title, description, equipment, urgency, status,
            address, postal_code, city, location, desired_from, desired_to,
            budget_min_cents, budget_max_cents, quotes_count, accepted_quote_id, expires_at, client_equipment_id, preferred_provider_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                 ST_SetSRID(ST_MakePoint($13,$14),4326)::geography,
                 $15,$16,$17,$18,$19,$20,$21,
                 (SELECT id FROM client_equipment WHERE id = $22 AND client_id = $2),
                 (SELECT user_id FROM providers WHERE user_id = $23 AND status = 'approved'))
         ON CONFLICT (id) DO UPDATE SET
           service_type = EXCLUDED.service_type, trade = EXCLUDED.trade, title = EXCLUDED.title, description = EXCLUDED.description,
           equipment = EXCLUDED.equipment, urgency = EXCLUDED.urgency, address = EXCLUDED.address, postal_code = EXCLUDED.postal_code,
           city = EXCLUDED.city, location = EXCLUDED.location, expires_at = EXCLUDED.expires_at, updated_at = now(),
           budget_min_cents = EXCLUDED.budget_min_cents, budget_max_cents = EXCLUDED.budget_max_cents,
           status = EXCLUDED.status, quotes_count = EXCLUDED.quotes_count, accepted_quote_id = EXCLUDED.accepted_quote_id`,
        [
          s.id, s.clientId, s.serviceType, s.trade, s.title, s.description, s.equipment ?? null, s.urgency, s.status,
          s.address, s.postalCode, s.city, s.location.lng, s.location.lat, s.desiredFrom ?? null, s.desiredTo ?? null,
          s.budgetMinCents ?? null, s.budgetMaxCents ?? null, s.quotesCount, s.acceptedQuoteId, s.expiresAt, s.equipmentId ?? null, s.preferredProviderId ?? null,
        ],
      );
      await writeOutbox(c, 'service_request', s.id, request.pullEvents());
    });
  }

  async attachFiles(requestId: string, clientId: string, fileIds: string[]): Promise<void> {
    if (!fileIds.length) return;
    await this.db.query(
      `UPDATE files SET entity_type = 'service_request', entity_id = $1
        WHERE id = ANY($2::uuid[]) AND uploaded_by = $3 AND entity_id IS NULL AND status = 'uploaded'`,
      [requestId, fileIds, clientId],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.query(`DELETE FROM service_requests WHERE id = $1 AND status = 'draft'`, [id]);
  }

  async findById(id: string): Promise<ServiceRequest | null> {
    const [r] = await this.db.query(`SELECT *, ${COORDS} FROM service_requests WHERE id = $1`, [id]);
    if (!r) return null;
    return ServiceRequest.rehydrate({
      id: r.id, clientId: r.client_id, serviceType: r.service_type, trade: r.trade, title: r.title,
      description: r.description, equipment: r.equipment, equipmentId: r.client_equipment_id, preferredProviderId: r.preferred_provider_id, urgency: r.urgency, status: r.status,
      address: r.address, postalCode: r.postal_code, city: r.city, location: { lat: r.lat, lng: r.lng },
      desiredFrom: r.desired_from, desiredTo: r.desired_to, budgetMinCents: r.budget_min_cents,
      budgetMaxCents: r.budget_max_cents, quotesCount: r.quotes_count, acceptedQuoteId: r.accepted_quote_id,
      expiresAt: r.expires_at,
    });
  }
}

@Injectable()
export class PgServiceRequestReadModel implements ServiceRequestReadModel {
  constructor(private readonly db: Database) {}

  async listByClient(clientId: string, q: ListServiceRequestsInput): Promise<ServiceRequestSummary[]> {
    // pagination par curseur sur created_at (index requests_client_idx)
    const rows = await this.db.query(
      `SELECT id, title, service_type, urgency, status, city, quotes_count, created_at
         FROM service_requests
        WHERE client_id = $1 AND ($2::timestamptz IS NULL OR created_at < $2)
        ORDER BY created_at DESC LIMIT $3`,
      [clientId, q.cursor ?? null, q.limit],
    );
    return rows.map((r) => ({
      id: r.id, title: r.title, serviceType: r.service_type, urgency: r.urgency, status: r.status,
      city: r.city, quotesCount: r.quotes_count, createdAt: r.created_at,
    }));
  }

  async getDetails(id: string): Promise<ServiceRequestDetails | null> {
    const [r] = await this.db.query(`SELECT *, ${COORDS} FROM service_requests WHERE id = $1`, [id]);
    if (!r) return null;
    return {
      id: r.id, clientId: r.client_id, title: r.title, serviceType: r.service_type, trade: r.trade,
      urgency: r.urgency, status: r.status, description: r.description, equipment: r.equipment,
      address: r.address, postalCode: r.postal_code, city: r.city, location: { lat: r.lat, lng: r.lng },
      desiredFrom: r.desired_from, desiredTo: r.desired_to, budgetMinCents: r.budget_min_cents,
      budgetMaxCents: r.budget_max_cents, quotesCount: r.quotes_count, expiresAt: r.expires_at, createdAt: r.created_at,
    };
  }
}
