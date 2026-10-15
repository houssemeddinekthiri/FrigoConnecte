import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { z } from 'zod';
import { computeTotals, CONTRACT_DOC_KINDS, DOCX_MIME } from '@frigoconnect/contracts';
import { AuthUser, CurrentUser, Roles } from '../../shared/auth/auth';
import { Database } from '../../shared/infrastructure/database/database.service';
import { InvalidStateError, NotFoundError } from '../../shared/kernel/errors';
import { ZodValidationPipe } from '../../shared/presentation/zod-validation.pipe';
import { FilesModule, FilesService } from '../files/files.module';

type Kind = (typeof CONTRACT_DOC_KINDS)[number];
const kindPipe = new ZodValidationPipe(z.enum(CONTRACT_DOC_KINDS));
const eur = (c: number) => (c / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ') + ' €';
const dateFr = (d: Date | string) => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long' });

/** Remplit un .docx dont les repères s'écrivent {{champ}} ; une boucle {{#lignes}}…{{/lignes}} répète un paragraphe ou une ligne de tableau. */
export function fillDocx(template: Buffer, data: Record<string, unknown>): Buffer {
  try {
    const doc = new Docxtemplater(new PizZip(template), { delimiters: { start: '{{', end: '}}' }, paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
    doc.render(data);
    return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch (e) {
    const errs = (e as { properties?: { errors?: { properties?: { explanation?: string } }[] } }).properties?.errors;
    const detail = errs?.map((x) => x.properties?.explanation).filter(Boolean).join(' ; ');
    throw new InvalidStateError(`Modèle Word illisible : ${detail || 'fichier invalide ou champ {{...}} mal fermé'}. Écrivez chaque champ d'une seule traite, sans changer de style au milieu.`);
  }
}

/** Champs disponibles pour les modèles (affichés à l'utilisateur et utilisés pour tester un modèle à l'import). */
export const TEMPLATE_FIELDS: Record<string, string> = {
  date_jour: 'Date du jour', numero_devis: 'N° du devis', numero_facture: 'N° de la facture (vide avant émission)', date_facture: 'Date de la facture',
  client_nom: 'Nom du client', client_societe: 'Société du client', client_email: 'Email du client', client_siret: 'SIRET du client', client_adresse: 'Adresse de facturation du client',
  prestataire_nom: 'Société du prestataire', prestataire_siret: 'SIRET du prestataire', prestataire_tva: 'N° de TVA du prestataire', prestataire_adresse: 'Adresse du prestataire',
  intitule: 'Intitulé de la demande', adresse_intervention: "Lieu de l'intervention", total_ht: 'Total HT', total_tva: 'Total TVA', total_ttc: 'Total TTC', acompte: 'Acompte', solde: 'Solde',
};
export const LINE_FIELDS = ['libelle', 'quantite', 'unite', 'prix_unitaire', 'tva', 'total_ligne'];
const SAMPLE = {
  ...Object.fromEntries(Object.keys(TEMPLATE_FIELDS).map((k) => [k, 'exemple'])),
  lignes: [Object.fromEntries(LINE_FIELDS.map((k) => [k, 'exemple']))],
};

@Injectable()
export class TemplatesService {
  constructor(private readonly db: Database, private readonly files: FilesService) {}

  async mine(userId: string) {
    const rows = await this.db.query('SELECT t.kind, f.original_name FROM user_templates t JOIN files f ON f.id = t.file_id WHERE t.user_id = $1', [userId]);
    return { contract: rows.find((r) => r.kind === 'contract')?.original_name ?? null, invoice: rows.find((r) => r.kind === 'invoice')?.original_name ?? null };
  }

  /** Le modèle est essayé avec des données d'exemple avant d'être enregistré : une erreur de champ se voit tout de suite. */
  async set(userId: string, kind: Kind, fileId: string) {
    fillDocx(await this.files.readOwn(userId, fileId, DOCX_MIME), SAMPLE);
    await this.db.query(
      `INSERT INTO user_templates (user_id, kind, file_id) VALUES ($1,$2,$3) ON CONFLICT (user_id, kind) DO UPDATE SET file_id = EXCLUDED.file_id, updated_at = now()`,
      [userId, kind, fileId],
    );
  }

  async remove(userId: string, kind: Kind) {
    await this.db.query('DELETE FROM user_templates WHERE user_id = $1 AND kind = $2', [userId, kind]);
  }

  private async data(contractId: string, userId: string): Promise<Record<string, unknown>> {
    const [x] = await this.db.query(
      `SELECT q.id AS quote_id, q.number AS quote_number, c.total_cents, c.deposit_cents, r.title, r.address, r.postal_code, r.city,
              pr.company_name AS p_name, pr.siret AS p_siret, pr.vat_number AS p_vat, pr.address AS p_address, pr.postal_code AS p_pc, pr.city AS p_city,
              u.first_name || ' ' || u.last_name AS c_name, u.email AS c_email, cl.company_name AS c_company, cl.siret AS c_siret,
              cl.billing_address AS c_address, cl.billing_postal_code AS c_pc, cl.billing_city AS c_city, i.number AS invoice_number, i.issued_on
         FROM contracts c JOIN quotes q ON q.id = c.quote_id JOIN service_requests r ON r.id = c.request_id
         JOIN providers pr ON pr.user_id = c.provider_id JOIN users u ON u.id = c.client_id JOIN clients cl ON cl.user_id = c.client_id
         LEFT JOIN invoices i ON i.contract_id = c.id
        WHERE c.id = $1 AND $2 IN (c.client_id, c.provider_id)`,
      [contractId, userId],
    );
    if (!x) throw new NotFoundError('Contrat');
    const items = await this.db.query(
      `SELECT label, quantity::float AS quantity, unit, unit_price_cents AS "unitPriceCents", vat_rate_bps AS "vatRateBps" FROM quote_items WHERE quote_id = $1 ORDER BY position`,
      [x.quote_id],
    );
    const t = computeTotals(items as never);
    const addr = (a?: string | null, pc?: string | null, city?: string | null) => [a, [pc, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return {
      date_jour: dateFr(new Date()), numero_devis: x.quote_number, numero_facture: x.invoice_number ?? '', date_facture: x.issued_on ? dateFr(x.issued_on) : '',
      client_nom: x.c_name, client_societe: x.c_company ?? '', client_email: x.c_email, client_siret: x.c_siret ?? '', client_adresse: addr(x.c_address, x.c_pc, x.c_city),
      prestataire_nom: x.p_name, prestataire_siret: x.p_siret, prestataire_tva: x.p_vat ?? '', prestataire_adresse: addr(x.p_address, x.p_pc, x.p_city),
      intitule: x.title, adresse_intervention: addr(x.address, x.postal_code, x.city),
      total_ht: eur(t.subtotalCents), total_tva: eur(t.vatCents), total_ttc: eur(t.totalCents), acompte: eur(x.deposit_cents), solde: eur(x.total_cents - x.deposit_cents),
      lignes: (items as { label: string; quantity: number; unit: string; unitPriceCents: number; vatRateBps: number }[]).map((it, k) => ({
        libelle: it.label, quantite: String(it.quantity).replace('.', ','), unite: it.unit, prix_unitaire: eur(it.unitPriceCents),
        tva: `${(it.vatRateBps / 100).toString().replace('.', ',')} %`, total_ligne: eur(t.lineSubtotals[k]),
      })),
    };
  }

  /** Produit le document depuis le modèle de l'utilisateur et le range dans les documents du contrat. false = pas de modèle (ou déjà généré si `once`). */
  async generate(userId: string, kind: Kind, contractId: string, once = false): Promise<boolean> {
    const [t] = await this.db.query('SELECT file_id FROM user_templates WHERE user_id = $1 AND kind = $2', [userId, kind]);
    if (!t) return false;
    if (once && (await this.db.query('SELECT 1 FROM contract_documents WHERE contract_id = $1 AND kind = $2 AND uploaded_by = $3', [contractId, kind, userId])).length) return false;
    const data = await this.data(contractId, userId);
    const out = fillDocx(await this.files.readOwn(userId, t.file_id, DOCX_MIME), data);
    const name = `${kind === 'invoice' ? 'facture' : 'contrat'}-${String(data.numero_facture || data.numero_devis).replace(/[^\w-]+/g, '_')}.docx`;
    const { fileId } = await this.files.storeBuffer({ ownerId: userId, fileName: name, mimeType: DOCX_MIME, buffer: out, entity: { type: 'contract_doc', id: contractId } });
    await this.db.query('INSERT INTO contract_documents (contract_id, file_id, kind, uploaded_by) VALUES ($1,$2,$3,$4)', [contractId, fileId, kind, userId]);
    return true;
  }
}

@Controller('templates')
@Roles('client', 'provider')
class TemplatesController {
  constructor(private readonly svc: TemplatesService) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    return { ...(await this.svc.mine(user.id)), fields: TEMPLATE_FIELDS, lineFields: LINE_FIELDS };
  }

  @Put(':kind')
  @HttpCode(204)
  async put(@CurrentUser() user: AuthUser, @Param('kind', kindPipe) kind: Kind, @Body(new ZodValidationPipe(z.object({ fileId: z.string().uuid() }))) b: { fileId: string }) {
    await this.svc.set(user.id, kind, b.fileId);
  }

  @Delete(':kind')
  @HttpCode(204)
  async del(@CurrentUser() user: AuthUser, @Param('kind', kindPipe) kind: Kind) {
    await this.svc.remove(user.id, kind);
  }

  @Post(':kind/generate/:contractId')
  @HttpCode(204)
  async generate(@CurrentUser() user: AuthUser, @Param('kind', kindPipe) kind: Kind, @Param('contractId', ParseUUIDPipe) contractId: string) {
    if (!(await this.svc.generate(user.id, kind, contractId))) throw new InvalidStateError("Importez d'abord votre modèle dans Mon compte");
  }
}

@Module({ imports: [FilesModule], controllers: [TemplatesController], providers: [TemplatesService], exports: [TemplatesService] })
export class TemplatesModule {}
