import PDFDocument from 'pdfkit';
import type { Totals } from '../quotes/domain/totals';
import { dateFr, money, pct } from '../quotes/infrastructure/pdf-renderer';

export interface InvoicePdfData {
  number: string;
  issuedOn: Date | string;
  serviceDate: Date | string | null;
  quoteNumber: string;
  provider: { name: string; siret: string; address: string | null; postalCode: string | null; city: string | null; vatNumber?: string | null; legalForm?: string | null; shareCapitalCents?: number | null; registration?: string | null };
  client: { name: string; company: string | null; siret: string | null; vatNumber: string | null; address: string | null; postalCode: string | null; city: string | null };
  intervention: { title: string; address: string; postalCode: string; city: string };
  items: { label: string; quantity: number; unit: string; unitPriceCents: number; vatRateBps: number; lineSubtotalCents: number }[];
  totals: Totals;
  paidOn: Date | string | null;
  /** Client professionnel : mentions de retard de paiement obligatoires (pénalités, indemnité de 40 €, escompte). */
  businessClient?: boolean;
}

const COLS = { label: 50, qty: 300, unit: 350, vat: 430, total: 480 };
const MUTED = '#64748b';
const line = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(', ');

/** Facture acquittée : émise au nom du prestataire, une fois l'intervention validée et réglée via la plateforme. */
export function renderInvoicePdf(d: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Facture ${d.number}`, Author: d.provider.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const ensureSpace = (h: number) => { if (doc.y + h > 770) doc.addPage(); };

    doc.fontSize(22).fillColor('#0369a1').text('FACTURE', 50, 50).fontSize(11).fillColor('#000').text(`N° ${d.number}`);
    doc.fontSize(9).fillColor(MUTED).text(`Date d'émission : ${dateFr(d.issuedOn)}${d.serviceDate ? ` · Date de la prestation : ${dateFr(d.serviceDate)}` : ''} · Réf. devis ${d.quoteNumber}`);

    const top = 120;
    doc.fontSize(9).fillColor(MUTED).text('PRESTATAIRE', 50, top).fillColor('#000').fontSize(10)
      .text(d.provider.name, 50, top + 12).text(`SIRET ${d.provider.siret}`);
    if (d.provider.vatNumber) doc.text(`TVA intracommunautaire ${d.provider.vatNumber}`, 50, undefined, { width: 240 });
    const status = line(d.provider.legalForm, d.provider.shareCapitalCents != null ? `capital ${money(d.provider.shareCapitalCents)}` : null, d.provider.registration);
    if (status) doc.fontSize(9).text(status, 50, undefined, { width: 240 }).fontSize(10);
    doc.text(line(d.provider.address, [d.provider.postalCode, d.provider.city].filter(Boolean).join(' ')), { width: 240 });
    doc.fontSize(9).fillColor(MUTED).text('CLIENT', 320, top).fillColor('#000').fontSize(10)
      .text(d.client.company ?? d.client.name, 320, top + 12, { width: 225 });
    if (d.client.company) doc.text(d.client.name, 320, undefined, { width: 225 });
    if (d.client.siret) doc.text(`SIRET ${d.client.siret}`, 320, undefined, { width: 225 });
    if (d.client.vatNumber) doc.text(`TVA ${d.client.vatNumber}`, 320, undefined, { width: 225 });
    const billing = line(d.client.address, [d.client.postalCode, d.client.city].filter(Boolean).join(' '));
    if (billing) doc.text(billing, 320, undefined, { width: 225 });

    doc.fontSize(10).font('Helvetica-Bold').text(`Objet : ${d.intervention.title}`, 50, Math.max(doc.y + 14, 215), { width: 495 }).font('Helvetica')
      .fontSize(9).fillColor(MUTED).text(`Lieu : ${d.intervention.address}, ${d.intervention.postalCode} ${d.intervention.city}`, { width: 495 });

    doc.moveDown();
    const head = doc.y;
    doc.rect(50, head - 3, 495, 16).fill('#e0f2fe').fillColor('#000').fontSize(9).font('Helvetica-Bold');
    doc.text('Désignation', COLS.label + 4, head).text('Qté', COLS.qty, head).text('PU HT', COLS.unit, head).text('TVA', COLS.vat, head).text('Total HT', COLS.total, head);
    doc.font('Helvetica');
    doc.y = head + 18;
    for (const it of d.items) {
      ensureSpace(30);
      const y = doc.y;
      doc.fontSize(9).text(it.label, COLS.label + 4, y, { width: 240 });
      const h = doc.y;
      doc.text(`${it.quantity.toString().replace('.', ',')} ${it.unit}`, COLS.qty, y).text(money(it.unitPriceCents), COLS.unit, y).text(pct(it.vatRateBps), COLS.vat, y).text(money(it.lineSubtotalCents), COLS.total, y);
      doc.y = Math.max(h, y + 12) + 4;
      doc.moveTo(50, doc.y - 2).lineTo(545, doc.y - 2).strokeColor('#e2e8f0').stroke();
    }

    ensureSpace(130);
    doc.moveDown(0.5);
    const row = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor('#000').text(label, 330, y, { width: 140 }).text(value, 470, y, { width: 75, align: 'right' });
      doc.y = y + (bold ? 16 : 13);
    };
    row('Total HT', money(d.totals.subtotalCents));
    for (const v of d.totals.vatByRate) row(`TVA ${pct(v.rateBps)} (base ${money(v.baseCents)})`, money(v.vatCents));
    row('Total TTC', money(d.totals.totalCents), true);
    doc.font('Helvetica');

    ensureSpace(60);
    doc.moveDown().fontSize(10).fillColor('#15803d').font('Helvetica-Bold')
      .text(d.paidOn ? `FACTURE ACQUITTÉE — réglée le ${dateFr(d.paidOn)}` : 'Facture à régler', 50, doc.y, { width: 495 })
      .font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('Paiement effectué via FrigoConnect (acompte et solde). Aucun montant restant dû.', { width: 495 });

    if (d.businessClient) {
      doc.moveDown(0.5).fontSize(7).fillColor(MUTED).text('En cas de retard de paiement : pénalités au taux de 3 fois le taux d\'intérêt légal et indemnité forfaitaire de recouvrement de 40 € (art. L.441-10 du Code de commerce). Pas d\'escompte pour paiement anticipé.', 50, doc.y, { width: 495 });
    }
    doc.page.margins.bottom = 0;
    doc.fontSize(7).fillColor(MUTED).text(`${d.provider.name} · SIRET ${d.provider.siret} · Facture ${d.number} · Document généré par FrigoConnect au nom du prestataire`, 50, 800, { width: 495, align: 'center' });
    doc.end();
  });
}
