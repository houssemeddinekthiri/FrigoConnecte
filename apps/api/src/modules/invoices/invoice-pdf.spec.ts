import { providerInvoicingSchema } from '@frigoconnect/contracts';
import { computeTotals } from '../quotes/domain/totals';
import { renderInvoicePdf } from './invoice-pdf';

const items = [
  { label: 'Remplacement compresseur frigorifique (fourniture et pose)', quantity: 1, unit: 'u', unitPriceCents: 85000, vatRateBps: 2000 },
  { label: 'Main d\'œuvre', quantity: 3, unit: 'h', unitPriceCents: 7000, vatRateBps: 1000 },
];

describe('renderInvoicePdf', () => {
  it('produit un PDF d\'une page, acquitté ou non', async () => {
    const totals = computeTotals(items);
    const data = {
      number: 'FA-2026-000001', issuedOn: '2026-02-10', serviceDate: '2026-02-05', quoteNumber: 'DV-2026-000123',
      provider: { name: 'Froid Express Lyon', siret: '12345678901234', address: '12 rue du Froid', postalCode: '69003', city: 'Lyon', vatNumber: 'FR12345678901', legalForm: 'SAS', shareCapitalCents: 1_000_000, registration: 'RCS Lyon 123 456 789' }, businessClient: true,
      client: { name: 'Karim Benali', company: 'Chez Karim', siret: '98765432109876', vatNumber: 'FR12345678901', address: '5 place Bellecour', postalCode: '69002', city: 'Lyon' },
      intervention: { title: 'Chambre froide en panne', address: '5 place Bellecour', postalCode: '69002', city: 'Lyon' },
      items: items.map((i, k) => ({ ...i, lineSubtotalCents: totals.lineSubtotals[k] })), totals, paidOn: '2026-02-08',
    };
    for (const pdf of [await renderInvoicePdf(data), await renderInvoicePdf({ ...data, paidOn: null })]) {
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(Number(/\/Count (\d+)/.exec(pdf.toString('latin1'))?.[1])).toBe(1);
    }
  });

  it('valide et normalise les mentions légales du prestataire', () => {
    expect(providerInvoicingSchema.parse({ vatNumber: 'fr 123 456 789 01', legalForm: 'SAS', shareCapitalEuros: '10 000'.replace(' ', ''), registration: '' })).toMatchObject({ vatNumber: 'FR12345678901', shareCapitalEuros: 10000, registration: null });
    expect(providerInvoicingSchema.safeParse({ vatNumber: '12', legalForm: '', shareCapitalEuros: '', registration: '' }).success).toBe(false);
  });
});
