import PDFDocument from 'pdfkit';
import type { Totals } from '../domain/totals';

export interface QuotePdfData {
  number: string;
  issuedAt: Date;
  validUntil: string;
  provider: { name: string; siret: string; address: string | null; postalCode: string | null; city: string | null };
  client: { name: string; company: string | null };
  intervention: { title: string; address: string; postalCode: string; city: string };
  items: { label: string; quantity: number; unit: string; unitPriceCents: number; vatRateBps: number; lineSubtotalCents: number }[];
  totals: Totals;
  depositPercent: number;
  depositCents: number;
  estimatedStart: string | null;
  estimatedDurationHours: number | null;
  notes: string | null;
  /** Présent uniquement sur la version signée */
  signature?: { signedAt: Date; signerName: string; signerEmail: string; ip: string; pdfSha256: string };
}

// Les espaces insécables de Intl ne sont pas dans l'encodage des polices PDF standard
export const money = (c: number) => `${(c / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ')} €`;
export const pct = (bps: number) => `${(bps / 100).toString().replace('.', ',')} %`;
export const dateFr = (d: Date | string) => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long' });
const dateTimeFr = (d: Date) => d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' });

const COLS = { label: 50, qty: 300, unit: 350, vat: 430, total: 480 }; // abscisses des colonnes
const MUTED = '#64748b';

/** Page de preuve d'un devis dont le PDF a été fourni par le prestataire : le document signé reste celui-là, identifié par son empreinte. */
export function renderSignatureCertificate(d: { number: string; providerName: string; signature: NonNullable<QuotePdfData['signature']> }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Certificat de signature ${d.number}`, Author: 'FrigoConnect' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const s = d.signature;
    doc.fontSize(20).fillColor('#15803d').text('Certificat de signature électronique', 50, 50)
      .fontSize(11).fillColor('#000').moveDown().text(`Devis N° ${d.number} — ${d.providerName}`)
      .moveDown().fontSize(10)
      .text(`Signataire : ${s.signerName} (${s.signerEmail})`)
      .text(`Date : ${dateTimeFr(s.signedAt)} (heure de Paris) · Adresse IP : ${s.ip}`)
      .text(`Empreinte SHA-256 du devis PDF présenté et accepté : ${s.pdfSha256}`, { width: 495 })
      .moveDown().fontSize(8).fillColor(MUTED)
      .text('Le devis accepté est le PDF fourni par le prestataire, conservé à l\'identique : son empreinte ci-dessus permet de vérifier qu\'il n\'a pas été modifié. Signature électronique simple (règlement eIDAS) : authentification par compte et code à usage unique envoyé par email.', { width: 495 });
    doc.end();
  });
}

export function renderQuotePdf(d: QuotePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Devis ${d.number}`, Author: d.provider.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const ensureSpace = (h: number) => { if (doc.y + h > 770) doc.addPage(); };

    // En-tête
    doc.fontSize(22).fillColor('#0369a1').text('DEVIS', 50, 50).fontSize(11).fillColor('#000').text(`N° ${d.number}`);
    doc.fontSize(9).fillColor(MUTED).text(`Émis le ${dateFr(d.issuedAt)} · Valable jusqu'au ${dateFr(d.validUntil)}`);

    // Parties
    const top = 120;
    doc.fontSize(9).fillColor(MUTED).text('PRESTATAIRE', 50, top).fillColor('#000').fontSize(10)
      .text(d.provider.name, 50, top + 12).text(`SIRET ${d.provider.siret}`)
      .text([d.provider.address, [d.provider.postalCode, d.provider.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '');
    doc.fontSize(9).fillColor(MUTED).text('CLIENT', 320, top).fillColor('#000').fontSize(10)
      .text(d.client.company ?? d.client.name, 320, top + 12, { width: 225 });
    if (d.client.company) doc.text(d.client.name, 320, undefined, { width: 225 });
    doc.fillColor(MUTED).fontSize(9).text('Lieu d\'intervention', 320, undefined, { width: 225 }).fillColor('#000').fontSize(10)
      .text(`${d.intervention.address}, ${d.intervention.postalCode} ${d.intervention.city}`, 320, undefined, { width: 225 });

    doc.moveDown(2).fontSize(10).font('Helvetica-Bold').text(`Objet : ${d.intervention.title}`, 50, Math.max(doc.y, 215), { width: 495 }).font('Helvetica');

    // Tableau
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

    // Totaux
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
    if (d.depositPercent > 0) row(`Acompte à la signature (${d.depositPercent} %)`, money(d.depositCents));
    doc.font('Helvetica');

    // Conditions
    doc.moveDown().fontSize(9).fillColor('#000');
    const cond: string[] = [];
    if (d.estimatedStart) cond.push(`Début d'intervention estimé : ${dateFr(d.estimatedStart)}`);
    if (d.estimatedDurationHours) cond.push(`Durée estimée : ${d.estimatedDurationHours.toString().replace('.', ',')} h`);
    cond.push(`Offre valable jusqu'au ${dateFr(d.validUntil)}.`);
    doc.text(cond.join('\n'), 50, doc.y, { width: 495 });
    if (d.notes) doc.moveDown(0.5).fillColor(MUTED).text('Remarques', { continued: false }).fillColor('#000').text(d.notes, { width: 495 });

    // Signature
    ensureSpace(110);
    doc.moveDown();
    const y = doc.y;
    doc.rect(50, y, 495, 90).strokeColor('#94a3b8').stroke();
    if (d.signature) {
      const s = d.signature;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#15803d').text('Bon pour accord — signé électroniquement', 60, y + 8).font('Helvetica').fontSize(8).fillColor('#000')
        .text(`Signataire : ${s.signerName} (${s.signerEmail})`, 60, y + 24)
        .text(`Date : ${dateTimeFr(s.signedAt)} (heure de Paris) · Adresse IP : ${s.ip}`, 60, y + 36)
        .text(`Empreinte SHA-256 du devis présenté : ${s.pdfSha256}`, 60, y + 48, { width: 475 })
        .fillColor(MUTED).text('Signature électronique simple (règlement eIDAS) : authentification par compte et code à usage unique envoyé par email.', 60, y + 68, { width: 475 });
    } else {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Devis non signé. L\'acceptation et la signature s\'effectuent en ligne sur FrigoConnect (code de confirmation par email).', 60, y + 30, { width: 475 });
    }

    doc.page.margins.bottom = 0; // sinon écrire dans la marge basse ajoute une page blanche
    doc.fontSize(7).fillColor(MUTED).text(`${d.provider.name} · SIRET ${d.provider.siret} · Devis ${d.number} · Document généré par FrigoConnect`, 50, 800, { width: 495, align: 'center' });
    doc.end();
  });
}
