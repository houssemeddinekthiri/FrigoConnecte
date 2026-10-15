import { Body, Controller, Get, HttpCode, Injectable, Logger, Module, Put } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { providerInvoicingSchema, type ProviderInvoicingDto, type ProviderInvoicingInput } from '@frigoconnect/contracts';
import { ZodValidationPipe } from '../../shared/presentation/zod-validation.pipe';
import { computeTotals } from '../quotes/domain/totals';
import { AuthUser, CurrentUser, Roles } from '../../shared/auth/auth';
import { Database } from '../../shared/infrastructure/database/database.service';
import { IntegrationEvent } from '../../shared/infrastructure/outbox/outbox';
import { FilesModule, FilesService } from '../files/files.module';
import { TemplatesModule, TemplatesService } from '../templates/templates.module';
import { renderInvoicePdf } from './invoice-pdf';

@Injectable()
export class InvoicesService {
  private readonly log = new Logger(InvoicesService.name);
  constructor(private readonly db: Database, private readonly files: FilesService, private readonly templates: TemplatesService) {}

  /**
   * Une facture par contrat (UNIQUE contract_id) : rejouable sans doublon. Le numéro est consommé dans la même transaction que la
   * ligne (suite continue, sans trou, par prestataire et par année).
   */
  async issueFor(contractId: string): Promise<void> {
    await this.db.tx(async (c) => {
      const { rows: [k] } = await c.query(
        `SELECT c.id, c.client_id, c.provider_id, q.subtotal_cents, q.vat_cents, q.total_cents
           FROM contracts c JOIN quotes q ON q.id = c.quote_id WHERE c.id = $1 AND c.status = 'completed' FOR UPDATE OF c`,
        [contractId],
      );
      if (!k) return;
      const { rows: [exists] } = await c.query('SELECT 1 FROM invoices WHERE contract_id = $1', [contractId]);
      if (exists) return;
      const year = new Date().getFullYear();
      const { rows: [n] } = await c.query(
        `INSERT INTO invoice_counters (provider_id, year, last_number) VALUES ($1,$2,1)
         ON CONFLICT (provider_id, year) DO UPDATE SET last_number = invoice_counters.last_number + 1 RETURNING last_number`,
        [k.provider_id, year],
      );
      await c.query(
        `INSERT INTO invoices (number, contract_id, client_id, provider_id, subtotal_cents, vat_cents, total_cents) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [`FA-${year}-${String(n.last_number).padStart(6, '0')}`, contractId, k.client_id, k.provider_id, k.subtotal_cents, k.vat_cents, k.total_cents],
      );
    });
    await this.ensurePdf(contractId);
    // Facture au format du modèle Word du prestataire, s'il en a un (une seule fois par contrat)
    const [k] = await this.db.query('SELECT provider_id FROM contracts WHERE id = $1', [contractId]);
    await this.templates.generate(k.provider_id, 'invoice', contractId, true).catch((err) => this.log.error(`facture Word non générée (contrat ${contractId})`, err as Error));
  }

  /** Génère le PDF s'il manque (échec précédent) : appelé après l'émission et à chaque consultation de la liste. */
  async ensurePdf(contractId: string): Promise<void> {
    try {
      const [i] = await this.db.query('SELECT id, number, issued_on, provider_id FROM invoices WHERE contract_id = $1 AND pdf_file_id IS NULL', [contractId]);
      if (!i) return;
      const [x] = await this.db.query(
        `SELECT q.number AS quote_number, c.work_done_at, r.title, r.address, r.postal_code, r.city, q.id AS quote_id,
                pr.vat_number AS p_vat, pr.legal_form AS p_form, pr.share_capital_cents AS p_capital, pr.registration AS p_reg, cl.client_type AS c_type,
                pr.company_name AS p_name, pr.siret AS p_siret, pr.address AS p_address, pr.postal_code AS p_pc, pr.city AS p_city,
                u.first_name || ' ' || u.last_name AS c_name, cl.company_name AS c_company, cl.siret AS c_siret, cl.vat_number AS c_vat,
                cl.billing_address AS c_address, cl.billing_postal_code AS c_pc, cl.billing_city AS c_city,
                (SELECT max(paid_at) FROM payments p WHERE p.contract_id = c.id AND p.kind IN ('deposit','balance') AND p.paid_at IS NOT NULL) AS paid_on
           FROM contracts c JOIN quotes q ON q.id = c.quote_id JOIN service_requests r ON r.id = c.request_id
           JOIN providers pr ON pr.user_id = c.provider_id JOIN users u ON u.id = c.client_id JOIN clients cl ON cl.user_id = c.client_id
          WHERE c.id = $1`,
        [contractId],
      );
      const items = await this.db.query(
        `SELECT label, quantity::float AS quantity, unit, unit_price_cents AS "unitPriceCents", vat_rate_bps AS "vatRateBps" FROM quote_items WHERE quote_id = $1 ORDER BY position`,
        [x.quote_id],
      );
      const totals = computeTotals(items as never);
      const buffer = await renderInvoicePdf({
        number: i.number, issuedOn: i.issued_on, serviceDate: x.work_done_at, quoteNumber: x.quote_number,
        provider: { name: x.p_name, siret: x.p_siret, address: x.p_address, postalCode: x.p_pc, city: x.p_city, vatNumber: x.p_vat, legalForm: x.p_form, shareCapitalCents: x.p_capital, registration: x.p_reg },
        businessClient: x.c_type !== 'individual',
        client: { name: x.c_name, company: x.c_company, siret: x.c_siret, vatNumber: x.c_vat, address: x.c_address, postalCode: x.c_pc, city: x.c_city },
        intervention: { title: x.title, address: x.address, postalCode: x.postal_code, city: x.city },
        items: (items as never[]).map((it: any, k) => ({ ...it, lineSubtotalCents: totals.lineSubtotals[k] })), totals, paidOn: x.paid_on,
      });
      const { fileId } = await this.files.storeBuffer({ ownerId: i.provider_id, fileName: `${i.number}.pdf`, mimeType: 'application/pdf', buffer, entity: { type: 'invoice', id: i.id } });
      await this.db.query('UPDATE invoices SET pdf_file_id = $2 WHERE id = $1 AND pdf_file_id IS NULL', [i.id, fileId]);
    } catch (err) {
      this.log.error(`PDF de facture non généré (contrat ${contractId})`, err as Error);
    }
  }
}

/** Contrat validé (par le client, d'office à J+7 ou par l'administration) -> facture. */
@EventsHandler(IntegrationEvent)
export class IssueInvoiceOnValidation implements IEventHandler<IntegrationEvent> {
  private readonly log = new Logger(IssueInvoiceOnValidation.name);
  constructor(private readonly invoices: InvoicesService) {}
  async handle(e: IntegrationEvent) {
    if (e.type !== 'contract.validated') return;
    try {
      await this.invoices.issueFor(e.payload.contractId as string);
    } catch (err) {
      this.log.error(`facture non émise (contrat ${String(e.payload.contractId)})`, err as Error);
    }
  }
}

@Controller('invoices')
@Roles('client', 'provider')
class InvoicesController {
  constructor(private readonly db: Database, private readonly invoices: InvoicesService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const mine = user.roles.includes('provider') ? 'i.provider_id' : 'i.client_id';
    const select = () => this.db.query(
      `SELECT i.id, i.number, i.issued_on AS "issuedOn", i.total_cents AS "totalCents", COALESCE((SELECT d.file_id FROM contract_documents d WHERE d.contract_id = i.contract_id AND d.kind = 'invoice' AND d.uploaded_by = i.provider_id ORDER BY d.created_at DESC LIMIT 1), i.pdf_file_id) AS "fileId", i.contract_id AS "contractId",
              r.title AS "requestTitle", pr.company_name AS "providerName", COALESCE(cl.company_name, u.first_name || ' ' || u.last_name) AS "clientName"
         FROM invoices i JOIN clients cl ON cl.user_id = i.client_id JOIN users u ON u.id = i.client_id JOIN contracts c ON c.id = i.contract_id JOIN service_requests r ON r.id = c.request_id JOIN providers pr ON pr.user_id = i.provider_id
        WHERE ${mine} = $1 ORDER BY i.issued_on DESC, i.number DESC LIMIT 200`,
      [user.id],
    );
    let rows = await select();
    const missing = rows.filter((r) => !r.fileId);
    if (missing.length) { // PDF manquant (échec précédent) : on le génère maintenant
      await Promise.all(missing.map((r) => this.invoices.ensurePdf(r.contractId)));
      rows = await select();
    }
    return rows;
  }
}

/** Mentions légales du prestataire, reportées sur chacune de ses factures. */
@Controller('providers/me/invoicing')
@Roles('provider')
class InvoicingSettingsController {
  constructor(private readonly db: Database) {}

  @Get()
  async get(@CurrentUser() user: AuthUser): Promise<ProviderInvoicingDto | null> {
    const [r] = await this.db.query(
      `SELECT vat_number AS "vatNumber", legal_form AS "legalForm", (share_capital_cents / 100.0)::float AS "shareCapitalEuros", registration FROM providers WHERE user_id = $1`,
      [user.id],
    );
    return (r as ProviderInvoicingDto) ?? null;
  }

  @Put()
  @HttpCode(204)
  async put(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(providerInvoicingSchema)) b: ProviderInvoicingInput) {
    await this.db.query(
      'UPDATE providers SET vat_number = $2, legal_form = $3, share_capital_cents = $4, registration = $5 WHERE user_id = $1',
      [user.id, b.vatNumber, b.legalForm, b.shareCapitalEuros === null ? null : Math.round(b.shareCapitalEuros * 100), b.registration],
    );
  }
}

@Module({ imports: [FilesModule, TemplatesModule], controllers: [InvoicesController, InvoicingSettingsController], providers: [InvoicesService, IssueInvoiceOnValidation] })
export class InvoicesModule {}
