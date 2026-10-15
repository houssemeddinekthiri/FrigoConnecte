import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

export const providerInvoicingSchema = z.object({
  vatNumber: z.preprocess((v) => (typeof v === 'string' ? v.replace(/\s/g, '').toUpperCase() || null : v), z.string().regex(/^[A-Z]{2}[A-Z0-9]{2,12}$/, 'N° de TVA invalide (ex : FR12345678901)').nullable()),
  legalForm: text(60),                       // SAS, SARL, EI, auto-entrepreneur…
  shareCapitalEuros: z.preprocess((v) => (v === '' || v === undefined ? null : typeof v === 'string' ? Number(v.replace(',', '.')) : v), z.number().min(0).max(1_000_000_000).nullable()),
  registration: text(120),
});
export type ProviderInvoicingInput = z.output<typeof providerInvoicingSchema>;

export interface ProviderInvoicingDto {
  vatNumber: string | null;
  legalForm: string | null;
  shareCapitalEuros: number | null;
  registration: string | null;
}
