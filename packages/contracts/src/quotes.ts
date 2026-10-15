import { z } from 'zod';

export const VAT_RATES_BPS = [0, 550, 1000, 2000] as const; // 0 %, 5,5 %, 10 %, 20 % (CHECK en base)

export const quoteItemSchema = z.object({
  label: z.string().trim().min(1).max(300),
  quantity: z.number().positive().max(100_000),
  unit: z.string().trim().min(1).max(10).default('u'),
  unitPriceCents: z.number().int().nonnegative().max(100_000_000), // HT, en centimes
  vatRateBps: z.union([z.literal(0), z.literal(550), z.literal(1000), z.literal(2000)]).default(2000),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ');

export const quoteContentSchema = z.object({
  items: z.array(quoteItemSchema).min(1).max(50),
  depositPercent: z.number().int().min(0).max(100).default(30),
  validUntil: isoDate,
  estimatedStart: isoDate.optional(),
  estimatedDurationHours: z.number().positive().max(10_000).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type QuoteContentInput = z.output<typeof quoteContentSchema>;

export const createQuoteSchema = quoteContentSchema.extend({ requestId: z.string().uuid() });
export type CreateQuoteInput = z.output<typeof createQuoteSchema>;

export const rejectQuoteSchema = z.object({ reason: z.string().trim().max(500).optional() });
export const acceptQuoteSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Code à 6 chiffres') });
export const listQuotesSchema = z.object({ requestId: z.string().uuid() });

export interface QuoteDto {
  id: string;
  number: string;
  requestId: string;
  providerId: string;
  providerName: string;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'withdrawn';
  items: (z.output<typeof quoteItemSchema> & { position: number; lineSubtotalCents: number })[];
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
  depositPercent: number;
  depositCents: number;
  validUntil: string;
  estimatedStart: string | null;
  estimatedDurationHours: number | null;
  notes: string | null;
  pdfFileId: string | null;
  signedPdfFileId: string | null;
  sentAt: string | null;
  decidedAt: string | null;
}
