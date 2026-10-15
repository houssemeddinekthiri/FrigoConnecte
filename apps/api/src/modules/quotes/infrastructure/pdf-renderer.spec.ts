import { writeFileSync } from 'node:fs';
import { computeTotals, depositCents } from '../domain/totals';
import { QuotePdfData, renderQuotePdf } from './pdf-renderer';

const items = [
  { label: 'Remplacement compresseur frigorifique (fourniture et pose)', quantity: 1, unit: 'u', unitPriceCents: 85000, vatRateBps: 2000 },
  { label: 'Recharge fluide R404A', quantity: 2.5, unit: 'kg', unitPriceCents: 6500, vatRateBps: 2000 },
  { label: 'Main d\'œuvre', quantity: 3, unit: 'h', unitPriceCents: 7000, vatRateBps: 1000 },
];
const totals = computeTotals(items);
const data: QuotePdfData = {
  number: 'DV-2026-000123', issuedAt: new Date('2026-02-01T10:00:00Z'), validUntil: '2026-02-28',
  provider: { name: 'Froid Express Lyon', siret: '12345678901234', address: '12 rue du Froid', postalCode: '69003', city: 'Lyon' },
  client: { name: 'Karim B.', company: 'Restaurant Chez Karim' },
  intervention: { title: 'Chambre froide en panne', address: '5 place Bellecour', postalCode: '69002', city: 'Lyon' },
  items: items.map((i, k) => ({ ...i, lineSubtotalCents: totals.lineSubtotals[k] })),
  totals, depositPercent: 30, depositCents: depositCents(totals.totalCents, 30),
  estimatedStart: '2026-02-05', estimatedDurationHours: 4, notes: 'Pièces garanties 12 mois.',
};

const pageCount = (pdf: Buffer) => Number(/\/Count (\d+)/.exec(pdf.toString('latin1'))?.[1]);

describe('renderQuotePdf', () => {
  it('produit un PDF valide d\'une seule page, signé ou non', async () => {
    const plain = await renderQuotePdf(data);
    const signed = await renderQuotePdf({ ...data, signature: { signedAt: new Date('2026-02-02T09:00:00Z'), signerName: 'Karim B.', signerEmail: 'k@exemple.fr', ip: '203.0.113.7', pdfSha256: 'a'.repeat(64) } });
    for (const pdf of [plain, signed]) {
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(1500);
      expect(pageCount(pdf)).toBe(1); // le pied de page ne doit pas créer de page blanche
    }
    expect(signed.length).toBeGreaterThan(plain.length);
    if (process.env.PDF_SAMPLE_DIR) { // inspection visuelle : PDF_SAMPLE_DIR=/chemin npm test
      writeFileSync(`${process.env.PDF_SAMPLE_DIR}/devis.pdf`, plain);
      writeFileSync(`${process.env.PDF_SAMPLE_DIR}/devis-signe.pdf`, signed);
    }
  });

  it('un long devis passe sur plusieurs pages', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...data.items[0], label: `Ligne ${i + 1}` }));
    expect(pageCount(await renderQuotePdf({ ...data, items: many }))).toBeGreaterThan(1);
  });
});
