import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import type { AdminStats, ProviderApplication, Trade } from '@frigoconnect/contracts';
import { AuthUser } from '../../shared/auth/auth';
import { writeAudit } from '../../shared/audit';
import { Database } from '../../shared/infrastructure/database/database.service';
import { writeOutbox } from '../../shared/infrastructure/outbox/outbox';
import { ForbiddenError, InvalidStateError, NotFoundError } from '../../shared/kernel/errors';
import { IDENTITY_PROVIDER, IdentityProvider } from '../identity/domain/ports';
import { approvalBlockers, CertView, ProviderStatus } from '../providers/provider-rules';
import { recomputeProviderRating } from '../reviews/reviews.module';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const PAID = ['held', 'authorized', 'released', 'partially_refunded'];

/**
 * Toute action d'administration est une transaction qui contient : le changement, sa trace d'audit, et l'événement
 * de notification. Pas de trace sans action, pas d'action sans trace.
 */
@Injectable()
export class AdminService {
  constructor(private readonly db: Database, @Inject(IDENTITY_PROVIDER) private readonly idp: IdentityProvider) {}

  // =============== Prestataires ===============
  async providers(status?: string): Promise<ProviderApplication[]> {
    const rows = await this.db.query(
      `SELECT p.user_id, p.company_name, p.siret, u.email, p.city, p.trades::text[] AS trades, p.services::text[] AS services, p.status, p.rejection_reason, p.updated_at
         FROM providers p JOIN users u ON u.id = p.user_id
        WHERE ($1::provider_status IS NULL OR p.status = $1)
        ORDER BY (p.status = 'pending_review') DESC, p.updated_at ASC LIMIT 50`,
      [status ?? null],
    );
    return this.withCerts(rows);
  }

  async provider(id: string): Promise<ProviderApplication> {
    const rows = await this.db.query(
      `SELECT p.user_id, p.company_name, p.siret, u.email, p.city, p.trades::text[] AS trades, p.services::text[] AS services, p.status, p.rejection_reason, p.updated_at
         FROM providers p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1`,
      [id],
    );
    if (!rows.length) throw new NotFoundError('Prestataire');
    return (await this.withCerts(rows))[0];
  }

  private async withCerts(rows: QueryResultRow[]): Promise<ProviderApplication[]> {
    if (!rows.length) return [];
    const certs = await this.db.query('SELECT * FROM provider_certifications WHERE provider_id = ANY($1) ORDER BY created_at', [rows.map((r) => r.user_id)]);
    return rows.map((p) => {
      const mine = certs.filter((c) => c.provider_id === p.user_id);
      const views: CertView[] = mine.map((c) => ({ type: c.type, reviewStatus: c.review_status, expiresOn: iso(c.expires_on) }));
      return {
        providerId: p.user_id, companyName: p.company_name, siret: p.siret, email: p.email, city: p.city, trades: p.trades, services: p.services,
        status: p.status, rejectionReason: p.rejection_reason, submittedAt: p.status === 'pending_review' ? p.updated_at.toISOString() : null,
        certifications: mine.map((c) => ({
          id: c.id, type: c.type, label: c.label, number: c.number, issuer: c.issuer, issuedOn: iso(c.issued_on), expiresOn: iso(c.expires_on),
          reviewStatus: c.review_status, rejectionReason: c.rejection_reason, fileId: c.file_id,
        })),
        blockers: p.status === 'pending_review' ? approvalBlockers({ status: p.status, trades: p.trades }, views) : [],
      };
    });
  }

  async reviewCertification(admin: AuthUser, providerId: string, certId: string, decision: 'approve' | 'reject', reason: string | undefined, ip: string) {
    await this.db.tx(async (c) => {
      const { rows } = await c.query(
        `UPDATE provider_certifications SET review_status = $3, reviewed_by = $4, reviewed_at = now(), rejection_reason = $5
          WHERE id = $1 AND provider_id = $2 AND review_status = 'pending' RETURNING type`,
        [certId, providerId, decision === 'approve' ? 'approved' : 'rejected', admin.id, decision === 'reject' ? reason : null],
      );
      if (!rows.length) throw new InvalidStateError('Document introuvable ou déjà examiné');
      await writeAudit(c, { actorId: admin.id, action: `certification.${decision === 'approve' ? 'approved' : 'rejected'}`, entityType: 'certification', entityId: certId, diff: { providerId, type: rows[0].type, reason }, ip });
      if (decision === 'reject') await writeOutbox(c, 'provider', providerId, [{ type: 'certification.rejected', payload: { providerId, certificationId: certId, certType: rows[0].type, reason } }]);
    });
  }

  async approve(admin: AuthUser, providerId: string, ip: string) {
    await this.db.tx(async (c) => {
      const p = await this.lockProvider(c, providerId);
      const blockers = approvalBlockers({ status: p.status, trades: p.trades }, await this.certViews(c, providerId));
      if (blockers.length) throw new InvalidStateError(blockers.join(' · '));
      await c.query(`UPDATE providers SET status = 'approved', validated_at = now(), validated_by = $2, rejection_reason = NULL WHERE user_id = $1`, [providerId, admin.id]);
      await writeAudit(c, { actorId: admin.id, action: 'provider.approved', entityType: 'provider', entityId: providerId, ip });
      await writeOutbox(c, 'provider', providerId, [{ type: 'provider.approved', payload: { providerId } }]);
    });
  }

  async reject(admin: AuthUser, providerId: string, reason: string, ip: string) {
    await this.db.tx(async (c) => {
      const p = await this.lockProvider(c, providerId);
      if (p.status !== 'pending_review') throw new InvalidStateError('Seul un dossier en attente peut être refusé');
      await c.query(`UPDATE providers SET status = 'rejected', rejection_reason = $2 WHERE user_id = $1`, [providerId, reason]);
      await writeAudit(c, { actorId: admin.id, action: 'provider.rejected', entityType: 'provider', entityId: providerId, diff: { reason }, ip });
      await writeOutbox(c, 'provider', providerId, [{ type: 'provider.rejected', payload: { providerId, reason } }]);
    });
  }

  /** Suspension du PROFIL (plus de nouvelles demandes). Les contrats en cours se poursuivent ; la connexion reste possible. */
  async suspendProvider(admin: AuthUser, providerId: string, reason: string, ip: string) {
    await this.db.tx(async (c) => {
      const p = await this.lockProvider(c, providerId);
      if (p.status !== 'approved') throw new InvalidStateError('Seul un prestataire actif peut être suspendu');
      await c.query(`UPDATE providers SET status = 'suspended' WHERE user_id = $1`, [providerId]);
      await writeAudit(c, { actorId: admin.id, action: 'provider.suspended', entityType: 'provider', entityId: providerId, diff: { reason }, ip });
      await writeOutbox(c, 'provider', providerId, [{ type: 'provider.suspended', payload: { providerId, reason } }]);
    });
  }

  async reinstateProvider(admin: AuthUser, providerId: string, ip: string) {
    await this.db.tx(async (c) => {
      const p = await this.lockProvider(c, providerId);
      if (p.status !== 'suspended') throw new InvalidStateError('Ce prestataire n\'est pas suspendu');
      const blockers = approvalBlockers({ status: 'pending_review', trades: p.trades }, await this.certViews(c, providerId)).filter((b) => !b.includes('restent à examiner'));
      if (blockers.length) throw new InvalidStateError(blockers.join(' · '));
      await c.query(`UPDATE providers SET status = 'approved' WHERE user_id = $1`, [providerId]);
      await writeAudit(c, { actorId: admin.id, action: 'provider.reinstated', entityType: 'provider', entityId: providerId, ip });
      await writeOutbox(c, 'provider', providerId, [{ type: 'provider.approved', payload: { providerId, reinstated: true } }]);
    });
  }

  private async lockProvider(c: PoolClient, id: string): Promise<{ status: ProviderStatus; trades: Trade[] }> {
    const { rows: [p] } = await c.query('SELECT status, trades::text[] AS trades FROM providers WHERE user_id = $1 FOR UPDATE', [id]);
    if (!p) throw new NotFoundError('Prestataire');
    return p;
  }
  private async certViews(c: PoolClient, id: string): Promise<CertView[]> {
    const { rows } = await c.query('SELECT type, review_status, expires_on FROM provider_certifications WHERE provider_id = $1', [id]);
    return rows.map((r) => ({ type: r.type, reviewStatus: r.review_status, expiresOn: iso(r.expires_on) }));
  }

  // =============== Utilisateurs ===============
  async users(f: { role?: string; status?: string; q?: string; limit: number; offset: number }) {
    return this.db.query(
      `SELECT id, email, first_name AS "firstName", last_name AS "lastName", role_code AS role, status, created_at AS "createdAt", last_login_at AS "lastLoginAt"
         FROM users
        WHERE deleted_at IS NULL AND ($1::text IS NULL OR role_code = $1) AND ($2::user_status IS NULL OR status = $2)
          AND ($3::text IS NULL OR email ILIKE '%' || $3 || '%' OR last_name ILIKE '%' || $3 || '%')
        ORDER BY created_at DESC LIMIT $4 OFFSET $5`,
      [f.role ?? null, f.status ?? null, f.q ?? null, f.limit, f.offset],
    );
  }

  async userDetail(id: string) {
    const [u] = await this.db.query(
      `SELECT id, email, first_name AS "firstName", last_name AS "lastName", role_code AS role, status, created_at AS "createdAt", last_login_at AS "lastLoginAt"
         FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!u) throw new NotFoundError('Utilisateur');
    const [n] = await this.db.query(
      `SELECT (SELECT count(*) FROM service_requests WHERE client_id = $1)::int AS requests,
              (SELECT count(*) FROM contracts WHERE client_id = $1 OR provider_id = $1)::int AS contracts,
              (SELECT COALESCE(sum(amount_cents),0) FROM payments WHERE payer_id = $1 AND status = ANY($2::payment_status[]))::bigint AS paid,
              (SELECT count(*) FROM reviews WHERE target_id = $1 AND status = 'published')::int AS reviews`, [id, PAID]);
    const contracts = await this.db.query(
      `SELECT c.id, r.title, c.status, c.total_cents AS "totalCents", c.created_at AS "createdAt"
         FROM contracts c JOIN service_requests r ON r.id = c.request_id
        WHERE c.client_id = $1 OR c.provider_id = $1 ORDER BY c.created_at DESC LIMIT 10`, [id]);
    const audit = await this.db.query(
      `SELECT a.id, a.action, a.diff, a.created_at AS "createdAt", ad.email AS actor
         FROM audit_logs a LEFT JOIN users ad ON ad.id = a.actor_id
        WHERE a.entity_type = 'user' AND a.entity_id = $1::uuid ORDER BY a.id DESC LIMIT 10`, [id]);
    return { ...u, stats: { requests: n.requests, contracts: n.contracts, paidCents: Number(n.paid), reviews: n.reviews }, contracts, audit };
  }

  /** Idempotent : rejouer la suspension complète la désactivation Keycloak si elle avait échoué. */
  async setUserSuspended(admin: AuthUser, userId: string, suspended: boolean, reason: string | undefined, ip: string) {
    if (userId === admin.id) throw new ForbiddenError('Vous ne pouvez pas suspendre votre propre compte');
    await this.db.tx(async (c) => {
      const { rows: [u] } = await c.query('SELECT role_code, status FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [userId]);
      if (!u) throw new NotFoundError('Utilisateur');
      if (u.role_code === 'super_admin') throw new ForbiddenError('Un administrateur ne peut pas suspendre un autre administrateur');
      const next = suspended ? 'suspended' : 'active';
      if (u.status === next) return;
      await c.query('UPDATE users SET status = $2 WHERE id = $1', [userId, next]);
      await writeAudit(c, { actorId: admin.id, action: suspended ? 'user.suspended' : 'user.reactivated', entityType: 'user', entityId: userId, diff: { reason }, ip });
    });
    // Keycloak : plus de nouvelle connexion, et les sessions ouvertes sont coupées (le jeton en cours est refusé sous 30 s par le garde de l'API)
    await this.idp.setEnabled(userId, !suspended);
    if (suspended) await this.idp.logout(userId);
  }

  // =============== Avis : modération ===============
  async reviews(status = 'pending_moderation') {
    return this.db.query(
      `SELECT r.id, r.rating, r.comment, r.status, r.created_at AS "createdAt",
              a.first_name || ' ' || left(a.last_name, 1) || '.' AS author, COALESCE(p.company_name, t.first_name || ' ' || left(t.last_name, 1) || '.') AS target
         FROM reviews r JOIN users a ON a.id = r.author_id JOIN users t ON t.id = r.target_id LEFT JOIN providers p ON p.user_id = r.target_id
        WHERE r.status = $1::review_status ORDER BY r.created_at ASC LIMIT 50`,
      [status],
    );
  }

  async moderateReview(admin: AuthUser, reviewId: string, decision: 'publish' | 'hide', ip: string) {
    await this.db.tx(async (c) => {
      const { rows } = await c.query(
        `UPDATE reviews SET status = $2::review_status WHERE id = $1 AND status <> $2::review_status RETURNING target_id, rating`,
        [reviewId, decision === 'publish' ? 'published' : 'hidden'],
      );
      if (!rows.length) throw new InvalidStateError('Avis introuvable ou déjà dans cet état');
      await recomputeProviderRating(c, rows[0].target_id);
      await writeAudit(c, { actorId: admin.id, action: `review.${decision === 'publish' ? 'published' : 'hidden'}`, entityType: 'review', entityId: reviewId, ip });
      if (decision === 'publish') await writeOutbox(c, 'review', reviewId, [{ type: 'review.received', payload: { reviewId, targetId: rows[0].target_id, rating: rows[0].rating } }]);
    });
  }

  // =============== Litiges ===============
  async disputes() {
    const rows = await this.db.query(
      `SELECT c.id, c.total_cents AS "totalCents", c.work_done_at AS "workDoneAt", r.title, pr.company_name AS provider,
              u.first_name || ' ' || u.last_name AS client, c.created_at AS "createdAt",
              c.dispute_reason AS reason, c.disputed_at AS "disputedAt", (c.disputed_by = c.client_id) AS "byClient"
         FROM contracts c JOIN service_requests r ON r.id = c.request_id JOIN providers pr ON pr.user_id = c.provider_id JOIN users u ON u.id = c.client_id
        WHERE c.status = 'disputed' ORDER BY c.created_at`,
    );
    if (!rows.length) return [];
    const pays = await this.db.query(`SELECT id, contract_id, kind, status, amount_cents AS "amountCents" FROM payments WHERE contract_id = ANY($1) AND kind IN ('deposit','balance') ORDER BY created_at`, [rows.map((r) => r.id)]);
    return rows.map((r) => ({ ...r, payments: pays.filter((p) => p.contract_id === r.id) }));
  }

  /**
   * 'complete' : le travail est fait -> validation d'office, les fonds conservés partent au prestataire (même chemin que la validation client).
   * 'cancel'   : contrat annulé ; les paiements restent conservés pour être remboursés via l'écran de remboursement.
   */
  async resolveDispute(admin: AuthUser, contractId: string, resolution: 'complete' | 'cancel', note: string, ip: string) {
    await this.db.tx(async (c) => {
      const { rows: [k] } = await c.query(`SELECT request_id, provider_id, client_id, work_done_at FROM contracts WHERE id = $1 AND status = 'disputed' FOR UPDATE`, [contractId]);
      if (!k) throw new InvalidStateError('Ce contrat n\'est pas en litige');
      if (resolution === 'complete') {
        if (!k.work_done_at) throw new InvalidStateError('Le prestataire n\'a jamais déclaré l\'intervention terminée');
        await c.query(`UPDATE contracts SET status = 'completed', client_validated_at = now() WHERE id = $1`, [contractId]);
        await c.query(`UPDATE service_requests SET status = 'completed' WHERE id = $1 AND status IN ('awarded','in_progress')`, [k.request_id]);
        await c.query('UPDATE providers SET completed_missions = completed_missions + 1 WHERE user_id = $1', [k.provider_id]);
        await writeOutbox(c, 'contract', contractId, [{ type: 'contract.validated', payload: { contractId, providerId: k.provider_id, clientId: k.client_id, auto: false, resolvedByAdmin: true } }]);
      } else {
        await c.query(`UPDATE contracts SET status = 'cancelled' WHERE id = $1`, [contractId]);
        await c.query(`UPDATE service_requests SET status = 'cancelled' WHERE id = $1 AND status IN ('awarded','in_progress')`, [k.request_id]);
        await writeOutbox(c, 'contract', contractId, [{ type: 'contract.cancelled', payload: { contractId, providerId: k.provider_id, clientId: k.client_id } }]);
      }
      await writeAudit(c, { actorId: admin.id, action: `dispute.resolved.${resolution}`, entityType: 'contract', entityId: contractId, diff: { note }, ip });
    });
  }

  // =============== Commissions ===============
  commissions() {
    return this.db.query(
      `SELECT cr.id, cr.provider_id AS "providerId", p.company_name AS provider, cr.rate_bps AS "rateBps", cr.valid_from AS "validFrom", u.email AS "createdBy"
         FROM commission_rules cr LEFT JOIN providers p ON p.user_id = cr.provider_id JOIN users u ON u.id = cr.created_by
        ORDER BY cr.valid_from DESC LIMIT 100`,
    );
  }

  /** Ne s'applique qu'aux NOUVEAUX contrats : le taux est figé au premier paiement de chaque contrat. */
  async setCommission(admin: AuthUser, v: { providerId?: string; rateBps: number; validFrom?: string; reason: string }, ip: string) {
    await this.db.tx(async (c) => {
      if (v.providerId) {
        const { rows } = await c.query('SELECT 1 FROM providers WHERE user_id = $1', [v.providerId]);
        if (!rows.length) throw new NotFoundError('Prestataire');
      }
      const { rows: [r] } = await c.query(
        `INSERT INTO commission_rules (provider_id, rate_bps, valid_from, created_by) VALUES ($1,$2,COALESCE($3::timestamptz, now()),$4) RETURNING id`,
        [v.providerId ?? null, v.rateBps, v.validFrom ?? null, admin.id],
      );
      await writeAudit(c, { actorId: admin.id, action: 'commission.changed', entityType: 'commission_rule', entityId: r.id, diff: { providerId: v.providerId ?? 'default', rateBps: v.rateBps, reason: v.reason }, ip });
    });
  }

  // =============== Statistiques ===============
  async stats(days: number): Promise<AdminStats> {
    const period = `now() - make_interval(days => $1)`;
    const [pay] = await this.db.query(
      `SELECT COALESCE(sum(amount_cents),0)::bigint AS gmv, COALESCE(sum(platform_fee_cents),0)::bigint AS fee
         FROM payments WHERE kind IN ('deposit','balance') AND status = ANY($2::payment_status[]) AND paid_at >= ${period}`,
      [days, PAID],
    );
    const [escrow] = await this.db.query(`SELECT COALESCE(sum(amount_cents),0)::bigint AS n FROM payments WHERE kind IN ('deposit','balance') AND status IN ('held','authorized')`);
    const [req] = await this.db.query(
      `WITH r AS (SELECT id, created_at FROM service_requests WHERE created_at >= ${period}),
            fq AS (SELECT q.request_id, min(q.sent_at) AS first_sent FROM quotes q WHERE q.sent_at IS NOT NULL GROUP BY q.request_id)
       SELECT (SELECT count(*) FROM r) AS requests,
              (SELECT count(*) FROM r JOIN fq ON fq.request_id = r.id) AS quoted,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM fq.first_sent - r.created_at) / 60) FROM r JOIN fq ON fq.request_id = r.id) AS median_min`,
      [days],
    );
    const [q] = await this.db.query(
      `SELECT count(*) FILTER (WHERE sent_at IS NOT NULL) AS sent, count(*) FILTER (WHERE status = 'accepted') AS accepted FROM quotes WHERE sent_at >= ${period}`,
      [days],
    );
    const [o] = await this.db.query(
      `SELECT (SELECT count(*) FROM contracts WHERE status = 'completed' AND client_validated_at >= ${period}) AS completed,
              (SELECT count(*) FROM contracts WHERE status = 'disputed') AS disputes,
              (SELECT count(*) FROM users WHERE created_at >= ${period} AND role_code <> 'super_admin') AS new_users,
              (SELECT count(*) FROM providers WHERE status = 'approved') AS active_providers,
              (SELECT count(*) FROM providers WHERE status = 'pending_review') AS pending,
              (SELECT round(avg(rating)::numeric, 2) FROM reviews WHERE status = 'published' AND created_at >= ${period}) AS rating`,
      [days],
    );
    const byDay = await this.db.query(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS day, COALESCE(sum(p.amount_cents),0)::bigint AS cents
         FROM generate_series((now() AT TIME ZONE 'Europe/Paris')::date - ($1::int - 1), (now() AT TIME ZONE 'Europe/Paris')::date, interval '1 day') d
         LEFT JOIN payments p ON p.kind IN ('deposit','balance') AND p.status = ANY($2::payment_status[]) AND (p.paid_at AT TIME ZONE 'Europe/Paris')::date = d::date
        GROUP BY d ORDER BY d`,
      [days, PAID],
    );
    const gmv = Number(pay.gmv);
    return {
      days,
      kpis: {
        gmvCents: gmv, commissionCents: Number(pay.fee), takeRateBps: gmv ? Math.round((Number(pay.fee) / gmv) * 10_000) : 0, escrowCents: Number(escrow.n),
        requests: req.requests, quotedRate: req.requests ? req.quoted / req.requests : null, acceptanceRate: q.sent ? q.accepted / q.sent : null,
        medianFirstQuoteMinutes: req.median_min === null ? null : Math.round(Number(req.median_min)),
        contractsCompleted: o.completed, disputes: o.disputes, newUsers: o.new_users, activeProviders: o.active_providers, pendingValidations: o.pending,
        avgRating: o.rating === null ? null : Number(o.rating),
      },
      gmvByDay: byDay.map((r) => ({ day: r.day, cents: Number(r.cents) })),
    };
  }

  // =============== Journal d'audit (lecture seule) ===============
  audit(f: { entityType?: string; actorId?: string; before?: number; limit: number }) {
    return this.db.query(
      `SELECT a.id, a.action, a.entity_type AS "entityType", a.entity_id AS "entityId", a.diff, host(a.ip) AS ip, a.created_at AS "createdAt", u.email AS actor
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
        WHERE ($1::text IS NULL OR a.entity_type = $1) AND ($2::uuid IS NULL OR a.actor_id = $2) AND ($3::bigint IS NULL OR a.id < $3)
        ORDER BY a.id DESC LIMIT $4`,
      [f.entityType ?? null, f.actorId ?? null, f.before ?? null, f.limit],
    );
  }
}
