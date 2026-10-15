import type { PaymentStatus } from '@frigoconnect/contracts';
import { DomainEvent } from '../../../shared/kernel/aggregate-root';

export interface PaymentRow {
  id: string;
  kind: 'deposit' | 'balance' | 'refund';
  status: PaymentStatus;
  amountCents: number;
  feeCents: number;
  providerCents: number;
  commissionRateBps: number | null;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeTransferId: string | null;
}

export interface PayableContract {
  id: string;
  clientId: string;
  providerId: string;
  status: string;
  totalCents: number;
  subtotalCents: number;
  depositCents: number;
  workDoneAt: Date | null;
  providerTransfersReady: boolean;
  clientEmail: string;
  clientName: string;
  stripeCustomerId: string | null;
  payments: PaymentRow[]; // hors remboursements
}

export interface NewPayment {
  id: string;
  contractId: string;
  payerId: string;
  providerId: string;
  kind: 'deposit' | 'balance';
  amountCents: number;
  feeCents: number;
  providerCents: number;
  rateBps: number;
  idempotencyKey: string;
}

/** Paiement prêt à être versé : montant net = part prestataire − part prestataire des remboursements déjà faits. */
export interface ReleasablePayment {
  id: string;
  contractId: string;
  providerId: string;
  stripeAccountId: string;
  stripeChargeId: string;
  netProviderCents: number;
}

export interface RefundablePayment extends PaymentRow {
  contractId: string;
  providerId: string;
  payerId: string;
  refundedCents: number; // somme des remboursements (en cours ou terminés)
}

export interface PaymentRepository {
  // --- paiement ---
  findPayable(contractId: string): Promise<PayableContract | null>;
  commissionRateBps(providerId: string): Promise<number>;
  saveCustomerId(clientId: string, customerId: string): Promise<void>;
  /** Lève InvalidStateError si ce paiement existe déjà (index unique). */
  insertPayment(p: NewPayment): Promise<void>;
  attachIntent(paymentId: string, intentId: string): Promise<void>;
  markFailed(paymentId: string, reason: string): Promise<void>;

  // --- Stripe Connect (prestataires) ---
  getProviderStripe(providerId: string): Promise<{ accountId: string | null; email: string; ready: boolean } | null>;
  saveAccountId(providerId: string, accountId: string): Promise<void>;
  setTransfersReadyByAccount(accountId: string, ready: boolean): Promise<void>;
  setTransfersReady(providerId: string, ready: boolean): Promise<void>;

  // --- webhooks (idempotents : rejouables sans effet double) ---
  isEventProcessed(eventId: string): Promise<boolean>;
  markEventProcessed(eventId: string, type: string): Promise<void>;
  /** pending -> held. Retourne false si déjà traité (aucun événement émis dans ce cas). */
  markPaid(intentId: string, chargeId: string): Promise<boolean>;
  markPaymentFailed(intentId: string, reason: string): Promise<void>;
  flagDispute(chargeId: string): Promise<void>;

  // --- libération des fonds ---
  /** Prend le verrou de versement (held -> authorized). Retourne null si déjà pris, remboursé ou remboursement en cours. */
  claimForRelease(contractId: string): Promise<ReleasablePayment[]>;
  /** 'authorized' laissés en plan (crash) depuis plus de 10 min : à rejouer (la clé d'idempotence Stripe protège). */
  staleClaims(): Promise<ReleasablePayment[]>;
  markReleased(paymentId: string, transferId: string, providerId: string, amountCents: number): Promise<void>;
  unclaim(paymentId: string): Promise<void>;
  completedContractsWithHeldFunds(): Promise<string[]>;

  // --- remboursements (avant versement uniquement) ---
  /** Verrouille la ligne, vérifie le montant et crée la ligne de remboursement 'pending'. */
  beginRefund(paymentId: string, amountCents: number | undefined, rowId: string, idempotencyKey: string, split: (p: RefundablePayment, amount: number) => { providerShare: number; feeShare: number }): Promise<{ payment: RefundablePayment; amountCents: number; providerShare: number; feeShare: number }>;
  completeRefund(rowId: string, paymentId: string, stripeRefundId: string, events: DomainEvent[]): Promise<void>;
  failRefund(rowId: string, reason: string): Promise<void>;
}
export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');

export interface StripeGateway {
  publishableKey(): string;
  ensureCustomer(clientId: string, email: string, name: string): Promise<string>;
  createPaymentIntent(a: { amountCents: number; customerId: string; transferGroup: string; metadata: Record<string, string>; idempotencyKey: string }): Promise<{ id: string; clientSecret: string }>;
  retrievePaymentIntent(id: string): Promise<{ status: string; clientSecret: string | null }>;
  createExpressAccount(providerId: string, email: string): Promise<string>;
  accountLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string>;
  accountReady(accountId: string): Promise<boolean>;
  createTransfer(a: { amountCents: number; destination: string; transferGroup: string; sourceCharge: string; metadata: Record<string, string>; idempotencyKey: string }): Promise<string>;
  refund(a: { paymentIntentId: string; amountCents: number; idempotencyKey: string }): Promise<string>;
  verifyWebhook(rawBody: Buffer, signature: string): StripeEvent;
}
export const STRIPE_GATEWAY = Symbol('STRIPE_GATEWAY');

/** Sous-ensemble des événements Stripe utilisés (évite de propager les types du SDK dans le métier). */
export type StripeEvent =
  | { id: string; type: 'payment_intent.succeeded'; intentId: string; chargeId: string }
  | { id: string; type: 'payment_intent.payment_failed' | 'payment_intent.canceled'; intentId: string; reason: string }
  | { id: string; type: 'account.updated'; accountId: string; ready: boolean }
  | { id: string; type: 'charge.dispute.created'; chargeId: string }
  | { id: string; type: 'ignored' };
