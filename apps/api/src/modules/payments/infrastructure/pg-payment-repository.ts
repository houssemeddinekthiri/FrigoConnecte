import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { Database } from '../../../shared/infrastructure/database/database.service';
import { writeAudit } from '../../../shared/audit';
import { writeOutbox } from '../../../shared/infrastructure/outbox/outbox';
import { DomainEvent } from '../../../shared/kernel/aggregate-root';
import { InvalidStateError, NotFoundError } from '../../../shared/kernel/errors';
import { NewPayment, PaymentRepository, PaymentRow, RefundablePayment, ReleasablePayment } from '../domain/ports';

const DEFAULT_RATE_BPS = Number(process.env.DEFAULT_COMMISSION_BPS ?? 1000);
const UNIQUE_VIOLATION = '23505';

const toRow = (r: QueryResultRow): PaymentRow => ({
  id: r.id, kind: r.kind, status: r.status, amountCents: r.amount_cents, feeCents: r.platform_fee_cents, providerCents: r.provider_amount_cents,
  commissionRateBps: r.commission_rate_bps, stripePaymentIntentId: r.stripe_payment_intent_id, stripeChargeId: r.stripe_charge_id, stripeTransferId: r.stripe_transfer_id,
});

// Part prestataire d'un paiement après déduction des remboursements déjà faits ou en cours
const NET_PROVIDER = `p.provider_amount_cents - COALESCE((SELECT sum(r.provider_amount_cents) FROM payments r WHERE r.refund_of = p.id AND r.status IN ('pending','refunded')), 0)`;

@Injectable()
export class PgPaymentRepository implements PaymentRepository {
  constructor(private readonly db: Database) {}

  async findPayable(contractId: string) {
    const [c] = await this.db.query(
      `SELECT c.id, c.client_id, c.provider_id, c.status, c.total_cents, c.subtotal_cents, c.deposit_cents, c.work_done_at,
              pr.stripe_transfers_enabled, u.email, u.first_name, u.last_name, cl.stripe_customer_id
         FROM contracts c
         JOIN providers pr ON pr.user_id = c.provider_id
         JOIN users u ON u.id = c.client_id
         JOIN clients cl ON cl.user_id = c.client_id
        WHERE c.id = $1`,
      [contractId],
    );
    if (!c) return null;
    const payments = await this.db.query(`SELECT * FROM payments WHERE contract_id = $1 AND kind IN ('deposit','balance') ORDER BY created_at`, [contractId]);
    return {
      id: c.id, clientId: c.client_id, providerId: c.provider_id, status: c.status, totalCents: c.total_cents, subtotalCents: c.subtotal_cents,
      depositCents: c.deposit_cents, workDoneAt: c.work_done_at, providerTransfersReady: c.stripe_transfers_enabled,
      clientEmail: c.email, clientName: `${c.first_name} ${c.last_name}`, stripeCustomerId: c.stripe_customer_id, payments: payments.map(toRow),
    };
  }

  async commissionRateBps(providerId: string): Promise<number> {
    // règle propre au prestataire en vigueur, sinon règle globale, sinon valeur par défaut de l'environnement
    const [r] = await this.db.query(
      `SELECT rate_bps FROM commission_rules WHERE (provider_id = $1 OR provider_id IS NULL) AND valid_from <= now()
        ORDER BY (provider_id IS NULL), valid_from DESC LIMIT 1`,
      [providerId],
    );
    return r?.rate_bps ?? DEFAULT_RATE_BPS;
  }

  async saveCustomerId(clientId: string, customerId: string) {
    await this.db.query('UPDATE clients SET stripe_customer_id = $2 WHERE user_id = $1 AND stripe_customer_id IS NULL', [clientId, customerId]);
  }

  async insertPayment(p: NewPayment) {
    try {
      await this.db.query(
        `INSERT INTO payments (id, contract_id, payer_id, provider_id, kind, status, amount_cents, platform_fee_cents, provider_amount_cents, commission_rate_bps, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10)`,
        [p.id, p.contractId, p.payerId, p.providerId, p.kind, p.amountCents, p.feeCents, p.providerCents, p.rateBps, p.idempotencyKey],
      );
    } catch (e) {
      if ((e as { code?: string }).code === UNIQUE_VIOLATION) throw new InvalidStateError('Ce paiement existe déjà');
      throw e;
    }
  }

  async attachIntent(paymentId: string, intentId: string) {
    await this.db.query('UPDATE payments SET stripe_payment_intent_id = $2 WHERE id = $1', [paymentId, intentId]);
  }

  async markFailed(paymentId: string, reason: string) {
    await this.db.query(`UPDATE payments SET status = 'failed', failure_reason = $2 WHERE id = $1 AND status = 'pending'`, [paymentId, reason.slice(0, 500)]);
  }

  // ---------- Connect ----------
  async getProviderStripe(providerId: string) {
    const [r] = await this.db.query('SELECT p.stripe_account_id, p.stripe_transfers_enabled, u.email FROM providers p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1', [providerId]);
    return r ? { accountId: r.stripe_account_id, email: r.email, ready: r.stripe_transfers_enabled } : null;
  }
  async saveAccountId(providerId: string, accountId: string) {
    await this.db.query('UPDATE providers SET stripe_account_id = $2 WHERE user_id = $1 AND stripe_account_id IS NULL', [providerId, accountId]);
  }
  async setTransfersReadyByAccount(accountId: string, ready: boolean) {
    await this.db.query('UPDATE providers SET stripe_transfers_enabled = $2 WHERE stripe_account_id = $1', [accountId, ready]);
  }
  async setTransfersReady(providerId: string, ready: boolean) {
    await this.db.query('UPDATE providers SET stripe_transfers_enabled = $2 WHERE user_id = $1', [providerId, ready]);
  }

  // ---------- Webhooks ----------
  async isEventProcessed(eventId: string) {
    const [r] = await this.db.query('SELECT 1 FROM stripe_webhook_events WHERE event_id = $1', [eventId]);
    return !!r;
  }
  async markEventProcessed(eventId: string, type: string) {
    await this.db.query('INSERT INTO stripe_webhook_events (event_id, type) VALUES ($1,$2) ON CONFLICT DO NOTHING', [eventId, type]);
  }

  async markPaid(intentId: string, chargeId: string): Promise<boolean> {
    return this.db.tx(async (c) => {
      // WHERE status = 'pending' : un rejeu du webhook ne change rien et n'émet aucun événement
      const { rows } = await c.query(
        `UPDATE payments SET status = 'held', paid_at = now(), stripe_charge_id = $2
          WHERE stripe_payment_intent_id = $1 AND status IN ('pending','failed')
          RETURNING id, contract_id, payer_id, provider_id, kind, amount_cents`,
        [intentId, chargeId],
      );
      if (!rows.length) return false;
      const p = rows[0];
      await writeOutbox(c, 'payment', p.id, [{ type: 'payment.paid', payload: { paymentId: p.id, contractId: p.contract_id, clientId: p.payer_id, providerId: p.provider_id, kind: p.kind, amountCents: p.amount_cents } }]);
      return true;
    });
  }

  async markPaymentFailed(intentId: string, reason: string) {
    await this.db.query(`UPDATE payments SET status = 'failed', failure_reason = $2 WHERE stripe_payment_intent_id = $1 AND status = 'pending'`, [intentId, reason.slice(0, 500)]);
  }

  async flagDispute(chargeId: string) {
    await this.db.tx(async (c) => {
      const { rows } = await c.query(
        `UPDATE contracts SET status = 'disputed' WHERE id = (SELECT contract_id FROM payments WHERE stripe_charge_id = $1 LIMIT 1) AND status <> 'disputed' RETURNING id, client_id, provider_id`,
        [chargeId],
      );
      if (rows.length) await writeOutbox(c, 'contract', rows[0].id, [{ type: 'contract.disputed', payload: { contractId: rows[0].id, clientId: rows[0].client_id, providerId: rows[0].provider_id, source: 'stripe_dispute' } }]);
    });
  }

  // ---------- Libération des fonds ----------
  async claimForRelease(contractId: string): Promise<ReleasablePayment[]> {
    // held -> authorized en UNE requête : plus aucun remboursement ne peut démarrer, et un second worker ne reprend pas les mêmes lignes
    const rows = await this.db.query(
      `UPDATE payments p SET status = 'authorized'
        WHERE p.contract_id = $1 AND p.kind IN ('deposit','balance') AND p.stripe_transfer_id IS NULL AND p.status IN ('held','partially_refunded')
          AND NOT EXISTS (SELECT 1 FROM payments r WHERE r.refund_of = p.id AND r.status = 'pending')
          -- on ne verrouille que ce qui est réellement versable : sinon un paiement resterait bloqué « en cours » sans jamais partir
          AND p.stripe_charge_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM providers pr WHERE pr.user_id = p.provider_id AND pr.stripe_account_id IS NOT NULL)
          AND (${NET_PROVIDER}) > 0
        RETURNING p.id, p.contract_id, p.provider_id, p.stripe_charge_id, ${NET_PROVIDER} AS net,
                  (SELECT stripe_account_id FROM providers WHERE user_id = p.provider_id) AS account`,
      [contractId],
    );
    return rows.filter((r) => r.net > 0 && r.account && r.stripe_charge_id).map(toReleasable);
  }

  async staleClaims(): Promise<ReleasablePayment[]> {
    const rows = await this.db.query(
      `SELECT p.id, p.contract_id, p.provider_id, p.stripe_charge_id, ${NET_PROVIDER} AS net,
              (SELECT stripe_account_id FROM providers WHERE user_id = p.provider_id) AS account
         FROM payments p WHERE p.status = 'authorized' AND p.stripe_transfer_id IS NULL AND p.updated_at < now() - interval '10 minutes'`,
    );
    return rows.filter((r) => r.net > 0 && r.account && r.stripe_charge_id).map(toReleasable);
  }

  async markReleased(paymentId: string, transferId: string, providerId: string, amountCents: number) {
    await this.db.tx(async (c) => {
      await c.query(`UPDATE payments SET status = 'released', stripe_transfer_id = $2, released_at = now() WHERE id = $1`, [paymentId, transferId]);
      await writeOutbox(c, 'payment', paymentId, [{ type: 'payment.released', payload: { paymentId, providerId, amountCents } }]);
    });
  }

  async unclaim(paymentId: string) {
    await this.db.query(`UPDATE payments SET status = 'held' WHERE id = $1 AND status = 'authorized' AND stripe_transfer_id IS NULL`, [paymentId]);
  }

  async completedContractsWithHeldFunds() {
    const rows = await this.db.query(
      `SELECT DISTINCT c.id FROM contracts c JOIN payments p ON p.contract_id = c.id
        WHERE c.status = 'completed' AND p.stripe_transfer_id IS NULL AND p.status IN ('held','partially_refunded') AND p.kind IN ('deposit','balance')`,
    );
    return rows.map((r) => r.id as string);
  }

  // ---------- Remboursements ----------
  async beginRefund(paymentId: string, amountCents: number | undefined, rowId: string, idempotencyKey: string, split: (p: RefundablePayment, amount: number) => { providerShare: number; feeShare: number }) {
    return this.db.tx(async (c: PoolClient) => {
      const { rows: [p] } = await c.query(`SELECT * FROM payments WHERE id = $1 AND kind IN ('deposit','balance') FOR UPDATE`, [paymentId]);
      if (!p) throw new NotFoundError('Paiement');
      if (!['held', 'partially_refunded'].includes(p.status) || p.stripe_transfer_id) {
        throw new InvalidStateError('Remboursement impossible : fonds déjà versés au prestataire ou paiement non encaissé. Ouvrez un litige.');
      }
      const { rows: [{ done }] } = await c.query(`SELECT COALESCE(sum(amount_cents),0)::bigint AS done FROM payments WHERE refund_of = $1 AND status IN ('pending','refunded')`, [paymentId]);
      const payment: RefundablePayment = { ...toRow(p), contractId: p.contract_id, providerId: p.provider_id, payerId: p.payer_id, refundedCents: Number(done) };
      const refundable = payment.amountCents - payment.refundedCents;
      const amount = amountCents ?? refundable;
      if (amount < 1 || amount > refundable) throw new InvalidStateError(`Montant remboursable : ${refundable / 100} € au maximum`);
      const s = split(payment, amount);
      await c.query(
        `INSERT INTO payments (id, contract_id, payer_id, provider_id, kind, status, amount_cents, platform_fee_cents, provider_amount_cents, refund_of, idempotency_key)
         VALUES ($1,$2,$3,$4,'refund','pending',$5,$6,$7,$8,$9)`,
        [rowId, p.contract_id, p.payer_id, p.provider_id, amount, s.feeShare, s.providerShare, paymentId, idempotencyKey],
      );
      return { payment, amountCents: amount, ...s };
    });
  }

  async completeRefund(rowId: string, paymentId: string, stripeRefundId: string, events: DomainEvent[]) {
    await this.db.tx(async (c) => {
      await c.query(`UPDATE payments SET status = 'refunded', stripe_refund_id = $2 WHERE id = $1`, [rowId, stripeRefundId]);
      await c.query(
        `UPDATE payments p SET status = CASE WHEN p.amount_cents <= (SELECT sum(amount_cents) FROM payments WHERE refund_of = p.id AND status = 'refunded') THEN 'refunded'::payment_status ELSE 'partially_refunded'::payment_status END
          WHERE p.id = $1`,
        [paymentId],
      );
      await writeOutbox(c, 'payment', paymentId, events);
      const ev = events[0]?.payload as { byAdmin?: string; amountCents?: number; reason?: string | null } | undefined;
      if (ev?.byAdmin) await writeAudit(c, { actorId: ev.byAdmin, action: 'payment.refunded', entityType: 'payment', entityId: paymentId, diff: { amountCents: ev.amountCents, reason: ev.reason } });
    });
  }

  async failRefund(rowId: string, reason: string) {
    await this.db.query(`UPDATE payments SET status = 'failed', failure_reason = $2 WHERE id = $1 AND status = 'pending'`, [rowId, reason.slice(0, 500)]);
  }
}

const toReleasable = (r: QueryResultRow): ReleasablePayment => ({
  id: r.id, contractId: r.contract_id, providerId: r.provider_id, stripeAccountId: r.account, stripeChargeId: r.stripe_charge_id, netProviderCents: Number(r.net),
});
