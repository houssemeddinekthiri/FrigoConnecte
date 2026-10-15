import { InvalidStateError } from '../../../shared/kernel/errors';

/**
 * Règles financières (fonction pure, entiers en centimes). Hypothèses validées avec le porteur du projet :
 *  - commission = taux × montant HT du contrat (la TVA n'est pas un revenu de la plateforme) ;
 *  - les frais Stripe sont supportés par la plateforme (ils doivent donc rester inférieurs à la commission) ;
 *  - l'acompte est un pourcentage du TTC fixé dans le devis, le solde est le reste.
 */
export interface ContractMoney {
  totalCents: number; // TTC
  subtotalCents: number; // HT
  depositCents: number;
}

export type PlannedKind = 'deposit' | 'balance';
export interface PlannedPayment {
  kind: PlannedKind;
  amountCents: number; // ce que paie le client
  feeCents: number; // commission de la plateforme
  providerCents: number; // ce qui sera versé au prestataire
}

/** Stripe refuse les paiements inférieurs à 0,50 €. */
export const MIN_CHARGE_CENTS = 50;

/**
 * Répartition exacte : la commission totale est arrondie UNE fois, puis répartie entre acompte et solde,
 * le solde récupérant le reliquat. Somme des commissions = commission totale, au centime près.
 */
export function planPayments(c: ContractMoney, rateBps: number): PlannedPayment[] {
  const commission = Math.round((c.subtotalCents * rateBps) / 10_000);
  const balanceAmount = c.totalCents - c.depositCents;
  const plan: PlannedPayment[] = [];

  const depositFee = c.depositCents > 0 ? (balanceAmount > 0 ? Math.round((commission * c.depositCents) / c.totalCents) : commission) : 0;
  if (c.depositCents > 0) plan.push(line('deposit', c.depositCents, depositFee));
  if (balanceAmount > 0) plan.push(line('balance', balanceAmount, commission - depositFee));
  return plan;
}

function line(kind: PlannedKind, amountCents: number, fee: number): PlannedPayment {
  const feeCents = Math.min(fee, amountCents); // la commission ne peut jamais dépasser le paiement
  return { kind, amountCents, feeCents, providerCents: amountCents - feeCents };
}

export function assertChargeable(amountCents: number) {
  if (amountCents < MIN_CHARGE_CENTS) throw new InvalidStateError('Montant inférieur au minimum de paiement (0,50 €)');
}

/** Part du remboursement qui revient (en moins) au prestataire, proportionnelle à son poids dans le paiement. */
export function refundSplit(p: { amountCents: number; providerCents: number }, refundCents: number) {
  const providerShare = Math.round((refundCents * p.providerCents) / p.amountCents);
  return { providerShare, feeShare: refundCents - providerShare };
}
