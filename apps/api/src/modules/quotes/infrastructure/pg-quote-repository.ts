import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import type { QuoteDto } from '@frigoconnect/contracts';
import { Database } from '../../../shared/infrastructure/database/database.service';
import { writeOutbox } from '../../../shared/infrastructure/outbox/outbox';
import { DomainEvent } from '../../../shared/kernel/aggregate-root';
import { InvalidStateError } from '../../../shared/kernel/errors';
import { Quote, QuoteStatus } from '../domain/quote';
import { QuoteContext, QuoteRepository, RequestForQuote, SignatureEvidence } from '../domain/ports';
import { computeTotals, depositCents } from '../domain/totals';

const UNIQUE_VIOLATION = '23505';

const mapItems = (rows: QueryResultRow[]) =>
  rows.map((i) => ({ position: i.position, label: i.label, quantity: Number(i.quantity), unit: i.unit, unitPriceCents: i.unit_price_cents, vatRateBps: i.vat_rate_bps, lineSubtotalCents: 0 }));

/** Lignes + totaux recalculés (même fonction que partout : un seul calcul fait foi). */
function toDto(q: QueryResultRow, itemRows: QueryResultRow[]): QuoteDto {
  const items = mapItems(itemRows);
  const t = computeTotals(items);
  items.forEach((it, i) => (it.lineSubtotalCents = t.lineSubtotals[i]));
  return {
    id: q.id, number: q.number, requestId: q.request_id, providerId: q.provider_id, providerName: q.company_name, status: q.status, items,
    subtotalCents: t.subtotalCents, vatCents: t.vatCents, totalCents: t.totalCents,
    depositPercent: q.deposit_percent, depositCents: depositCents(t.totalCents, q.deposit_percent),
    validUntil: q.valid_until, estimatedStart: q.estimated_start, estimatedDurationHours: q.estimated_duration_hours === null ? null : Number(q.estimated_duration_hours),
    notes: q.notes, pdfFileId: q.pdf_file_id, signedPdfFileId: q.signed_pdf_file_id,
    sentAt: q.sent_at?.toISOString() ?? null, decidedAt: q.decided_at?.toISOString() ?? null,
  };
}

const DTO_SELECT = `SELECT q.id, q.number, q.request_id, q.provider_id, q.status, q.deposit_percent, q.valid_until::text, q.estimated_start::text,
       q.estimated_duration_hours, q.notes, q.pdf_file_id, q.sent_at, q.decided_at, p.company_name, s.signed_pdf_file_id
  FROM quotes q JOIN providers p ON p.user_id = q.provider_id LEFT JOIN quote_signatures s ON s.quote_id = q.id`;

@Injectable()
export class PgQuoteRepository implements QuoteRepository {
  constructor(private readonly db: Database) {}

  async getRequestForQuote(requestId: string, providerId: string): Promise<RequestForQuote | null> {
    const [r] = await this.db.query(
      `SELECT client_id, status, EXISTS (SELECT 1 FROM request_matches WHERE request_id = $1 AND provider_id = $2) AS matched FROM service_requests WHERE id = $1`,
      [requestId, providerId],
    );
    return r && { clientId: r.client_id, status: r.status, matched: r.matched };
  }

  async getRequestClientId(requestId: string): Promise<string | null> {
    const [r] = await this.db.query('SELECT client_id FROM service_requests WHERE id = $1', [requestId]);
    return r?.client_id ?? null;
  }

  async save(quote: Quote, events: DomainEvent[], withItems = true): Promise<void> {
    const s = quote.toSnapshot();
    const t = quote.totals();
    try {
      await this.db.tx(async (c) => {
        await c.query(
          `INSERT INTO quotes (id, number, request_id, provider_id, status, subtotal_cents, vat_cents, total_cents, deposit_percent, valid_until, estimated_start, estimated_duration_hours, notes)
           VALUES ($1, 'DV-' || to_char(now() AT TIME ZONE 'Europe/Paris','YYYY') || '-' || lpad(nextval('quote_number_seq')::text, 6, '0'), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, subtotal_cents = EXCLUDED.subtotal_cents, vat_cents = EXCLUDED.vat_cents,
             total_cents = EXCLUDED.total_cents, deposit_percent = EXCLUDED.deposit_percent, valid_until = EXCLUDED.valid_until,
             estimated_start = EXCLUDED.estimated_start, estimated_duration_hours = EXCLUDED.estimated_duration_hours, notes = EXCLUDED.notes,
             decided_at = CASE WHEN EXCLUDED.status IN ('rejected','withdrawn') THEN now() ELSE quotes.decided_at END`,
          [s.id, s.requestId, s.providerId, s.status, t.subtotalCents, t.vatCents, t.totalCents, s.depositPercent, s.validUntil, s.estimatedStart ?? null, s.estimatedDurationHours ?? null, s.notes ?? null],
        );
        if (withItems) await this.writeItems(c, s.id, s.items);
        await writeOutbox(c, 'quote', s.id, events);
      });
    } catch (e) {
      if ((e as { code?: string }).code === UNIQUE_VIOLATION) throw new InvalidStateError('Vous avez déjà un devis en cours sur cette demande');
      throw e;
    }
  }

  private async writeItems(c: PoolClient, quoteId: string, items: { label: string; quantity: number; unit: string; unitPriceCents: number; vatRateBps: number }[]) {
    await c.query('DELETE FROM quote_items WHERE quote_id = $1', [quoteId]);
    for (const [i, it] of items.entries()) {
      await c.query(
        'INSERT INTO quote_items (quote_id, position, label, quantity, unit, unit_price_cents, vat_rate_bps) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [quoteId, i + 1, it.label, it.quantity, it.unit, it.unitPriceCents, it.vatRateBps],
      );
    }
  }

  async findContext(id: string): Promise<QuoteContext | null> {
    const [q] = await this.db.query(
      `SELECT q.*, q.valid_until::text AS valid_until_t, q.estimated_start::text AS estimated_start_t,
              p.company_name, p.siret, p.address, p.postal_code, p.city, p.stripe_transfers_enabled,
              r.title, r.address AS r_address, r.postal_code AS r_postal, r.city AS r_city, r.service_type, r.client_id,
              u.email AS client_email, u.first_name, u.last_name, cl.company_name AS client_company,
              f.checksum_sha256
         FROM quotes q
         JOIN providers p ON p.user_id = q.provider_id
         JOIN service_requests r ON r.id = q.request_id
         JOIN users u ON u.id = r.client_id
         LEFT JOIN clients cl ON cl.user_id = r.client_id
         LEFT JOIN files f ON f.id = q.pdf_file_id
        WHERE q.id = $1`,
      [id],
    );
    if (!q) return null;
    const items = await this.db.query('SELECT label, quantity, unit, unit_price_cents, vat_rate_bps FROM quote_items WHERE quote_id = $1 ORDER BY position', [id]);
    const quote = Quote.rehydrate({
      id: q.id, number: q.number, requestId: q.request_id, providerId: q.provider_id, status: q.status as QuoteStatus,
      items: items.map((i) => ({ label: i.label, quantity: Number(i.quantity), unit: i.unit, unitPriceCents: i.unit_price_cents, vatRateBps: i.vat_rate_bps })),
      depositPercent: q.deposit_percent, validUntil: q.valid_until_t, estimatedStart: q.estimated_start_t ?? undefined,
      estimatedDurationHours: q.estimated_duration_hours === null ? undefined : Number(q.estimated_duration_hours), notes: q.notes ?? undefined, sentAt: q.sent_at,
    });
    return {
      quote, clientId: q.client_id, clientName: `${q.first_name} ${q.last_name[0]}.`, clientFullName: `${q.first_name} ${q.last_name}`,
      clientEmail: q.client_email, clientCompany: q.client_company, providerName: q.company_name,
      provider: { siret: q.siret, address: q.address, postalCode: q.postal_code, city: q.city },
      request: { title: q.title, address: q.r_address, postalCode: q.r_postal, city: q.r_city, serviceType: q.service_type },
      pdfFileId: q.pdf_file_id, pdfSha256: q.checksum_sha256, pdfImported: q.pdf_imported, providerPayoutsReady: q.stripe_transfers_enabled,
    };
  }

  async commitSend(quote: Quote, pdfFileId: string, events: DomainEvent[]): Promise<void> {
    const s = quote.toSnapshot();
    await this.db.tx(async (c) => {
      await c.query(`UPDATE quotes SET status = 'sent', sent_at = $2, pdf_file_id = $3 WHERE id = $1 AND status = 'draft'`, [s.id, s.sentAt, pdfFileId]);
      // ponytail: transition de la demande en SQL (miroir de ServiceRequest.registerQuote). À remplacer par l'agrégat quand un module "requests" exposera un port.
      const { rowCount } = await c.query(
        `UPDATE service_requests SET quotes_count = quotes_count + 1, status = CASE WHEN status = 'open' THEN 'quoted'::request_status ELSE status END
          WHERE id = $1 AND status IN ('open','quoted')`,
        [s.requestId],
      );
      if (!rowCount) throw new InvalidStateError('Cette demande n\'accepte plus de devis');
      await writeOutbox(c, 'quote', s.id, events);
    });
  }

  async setImportedPdf(quoteId: string, fileId: string): Promise<void> {
    const rows = await this.db.query(`UPDATE quotes SET pdf_file_id = $2, pdf_imported = true WHERE id = $1 AND status = 'draft' RETURNING id`, [quoteId, fileId]);
    if (!rows.length) throw new InvalidStateError('Seul un brouillon peut recevoir un PDF');
  }

  async issueCode(quoteId: string, codeHash: string, expiresAt: Date): Promise<boolean> {
    const { length } = await this.db.query(
      `INSERT INTO quote_signatures (quote_id, code_hash, code_expires_at, code_requested_at, attempts) VALUES ($1,$2,$3,now(),0)
       ON CONFLICT (quote_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, code_expires_at = EXCLUDED.code_expires_at, code_requested_at = now(), attempts = 0
         WHERE quote_signatures.signed_at IS NULL AND (quote_signatures.code_requested_at IS NULL OR quote_signatures.code_requested_at < now() - interval '60 seconds')
       RETURNING quote_id`,
      [quoteId, codeHash, expiresAt],
    );
    return length > 0;
  }

  async consumeAttempt(quoteId: string): Promise<string | null> {
    const [r] = await this.db.query(
      `UPDATE quote_signatures SET attempts = attempts + 1
        WHERE quote_id = $1 AND signed_at IS NULL AND code_hash IS NOT NULL AND code_expires_at > now() AND attempts < 5
        RETURNING code_hash`,
      [quoteId],
    );
    return r?.code_hash ?? null;
  }

  async commitAcceptance(quote: Quote, ev: SignatureEvidence, clientId: string, providerSignedAt: Date | null, events: (otherRejected: string[]) => DomainEvent[]): Promise<void> {
    const s = quote.toSnapshot();
    const total = quote.totals().totalCents;
    try {
      await this.db.tx(async (c) => {
        const { rows: [cur] } = await c.query(`SELECT status, valid_until::text AS valid_until FROM quotes WHERE id = $1 FOR UPDATE`, [s.id]);
        if (cur?.status !== 'sent') throw new InvalidStateError('Ce devis ne peut plus être accepté');

        await c.query(`UPDATE quotes SET status = 'accepted', decided_at = now(), signature_hash = $2 WHERE id = $1`, [s.id, ev.pdfSha256]);
        await c.query(
          `UPDATE quote_signatures SET signed_at = now(), signer_user_id = $2, signer_ip = $3::inet, signer_user_agent = $4, signer_email = $5,
                  pdf_sha256 = $6, signed_pdf_file_id = $7, code_hash = NULL, code_expires_at = NULL WHERE quote_id = $1`,
          [s.id, ev.signerId, ev.ip, ev.userAgent.slice(0, 500), ev.signerEmail, ev.pdfSha256, ev.signedPdfFileId],
        );
        const { rows: others } = await c.query(
          `UPDATE quotes SET status = 'rejected', decided_at = now() WHERE request_id = $1 AND id <> $2 AND status = 'sent' RETURNING id`,
          [s.requestId, s.id],
        );
        const { rowCount } = await c.query(
          `UPDATE service_requests SET status = 'awarded', accepted_quote_id = $2 WHERE id = $1 AND status IN ('open','quoted')`,
          [s.requestId, s.id],
        );
        if (!rowCount) throw new InvalidStateError('Cette demande est déjà clôturée');
        // ponytail: création du contrat ici faute de module `contracts` ; il en reprendra la responsabilité (Phase 11).
        const [req] = (await c.query('SELECT service_type FROM service_requests WHERE id = $1', [s.requestId])).rows;
        await c.query(
          `INSERT INTO contracts (quote_id, request_id, client_id, provider_id, type, status, total_cents, subtotal_cents, deposit_cents, client_signed_at, provider_signed_at, pdf_file_id)
           VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8, now(), $9, $10)`,
          [s.id, s.requestId, clientId, s.providerId, req.service_type === 'annual_contract' ? 'annual' : 'one_off', total, quote.totals().subtotalCents, quote.totals().depositCents, providerSignedAt, ev.signedPdfFileId],
        );
        await writeOutbox(c, 'quote', s.id, events(others.map((o) => o.id)));
      });
    } catch (e) {
      if ((e as { code?: string }).code === UNIQUE_VIOLATION) throw new InvalidStateError('Un devis a déjà été accepté pour cette demande');
      throw e;
    }
  }

  async getDto(id: string): Promise<QuoteDto | null> {
    const [q] = await this.db.query(`${DTO_SELECT} WHERE q.id = $1`, [id]);
    if (!q) return null;
    return toDto(q, await this.db.query('SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY position', [id]));
  }

  private async dtos(where: string, params: unknown[]): Promise<QuoteDto[]> {
    const rows = await this.db.query(`${DTO_SELECT} WHERE ${where} ORDER BY q.created_at DESC LIMIT 100`, params);
    if (!rows.length) return [];
    const items = await this.db.query('SELECT * FROM quote_items WHERE quote_id = ANY($1) ORDER BY position', [rows.map((r) => r.id)]);
    return rows.map((q) => toDto(q, items.filter((i) => i.quote_id === q.id)));
  }

  listForRequest(requestId: string, f: { providerId?: string; excludeDraft?: boolean }) {
    return this.dtos(`q.request_id = $1 AND ($2::uuid IS NULL OR q.provider_id = $2) AND ($3::boolean IS NOT TRUE OR q.status <> 'draft')`, [requestId, f.providerId ?? null, f.excludeDraft ?? null]);
  }

  listForProvider(providerId: string) {
    return this.dtos('q.provider_id = $1', [providerId]);
  }

  async expireOverdue(): Promise<number> {
    const { length } = await this.db.query(
      `UPDATE quotes SET status = 'expired', decided_at = now() WHERE status = 'sent' AND valid_until < (now() AT TIME ZONE 'Europe/Paris')::date RETURNING id`,
    );
    return length;
  }
}
