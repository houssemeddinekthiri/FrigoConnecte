import { z } from 'zod';

export const createPaymentSchema = z.object({ kind: z.enum(['deposit', 'balance']) });
export type CreatePaymentInput = z.output<typeof createPaymentSchema>;

export const refundPaymentSchema = z.object({
  amountCents: z.number().int().positive().optional(), // absent = remboursement du reste
  reason: z.string().trim().max(500).optional(),
});
export type RefundPaymentInput = z.output<typeof refundPaymentSchema>;

export const listContractsSchema = z.object({ requestId: z.string().uuid().optional() });

export interface PaymentIntentResult {
  paymentId: string;
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
}

export type PaymentStatus = 'pending' | 'authorized' | 'held' | 'released' | 'failed' | 'refunded' | 'partially_refunded';

export interface ContractDto {
  id: string;
  requestId: string;
  quoteId: string;
  requestTitle: string;
  counterpartName: string;
  status: 'pending_signature' | 'active' | 'completed' | 'cancelled' | 'disputed';
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  workDoneAt: string | null;
  autoValidateAt: string | null;
  clientValidatedAt: string | null;
  payments: { id: string; kind: 'deposit' | 'balance'; status: PaymentStatus; amountCents: number; providerCents: number | null; feeCents: number | null }[];
  /** Ce que l'utilisateur connecté peut faire maintenant (calculé côté serveur : l'UI n'a aucune règle à recopier). */
  actions: { payDeposit: boolean; payBalance: boolean; declareDone: boolean; validate: boolean; review: boolean; dispute: boolean };
}

export interface ConnectStatus {
  ready: boolean;
  hasAccount: boolean;
}

export const CONTRACT_DOC_KINDS = ['contract', 'invoice'] as const;
export const addContractDocumentSchema = z.object({ fileId: z.string().uuid(), kind: z.enum(CONTRACT_DOC_KINDS) });
export interface ContractDocumentDto { id: string; fileId: string; kind: (typeof CONTRACT_DOC_KINDS)[number]; name: string; mine: boolean; createdAt: string }
export const openDisputeSchema = z.object({ reason: z.string().trim().min(10, 'Décrivez le problème en quelques mots').max(1000) });
