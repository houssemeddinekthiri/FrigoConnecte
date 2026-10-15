import { InvalidStateError } from '../../../shared/kernel/errors';
import { assertChargeable, planPayments, refundSplit } from './payment-plan';

// Devis type : 1 222,50 € HT, TVA 223,50 € => 1 446,00 € TTC ; acompte 30 % = 433,80 €
const contract = { subtotalCents: 122_250, totalCents: 144_600, depositCents: 43_380 };

describe('planPayments', () => {
  it('commission de 10 % sur le HT, répartie sans perdre un centime', () => {
    const [deposit, balance] = planPayments(contract, 1000);
    const commission = Math.round(122_250 * 0.1); // 12 225
    expect(deposit.feeCents + balance.feeCents).toBe(commission);
    expect(deposit.amountCents + balance.amountCents).toBe(contract.totalCents);
    for (const p of [deposit, balance]) expect(p.feeCents + p.providerCents).toBe(p.amountCents);
    expect(deposit.kind).toBe('deposit');
    expect(balance.kind).toBe('balance');
  });

  it('la commission est sur le HT, pas sur le TTC', () => {
    const total = planPayments(contract, 1000).reduce((s, p) => s + p.feeCents, 0);
    expect(total).toBe(12_225);
    expect(total).not.toBe(Math.round(contract.totalCents * 0.1));
  });

  it('acompte 100 % : un seul paiement porte toute la commission', () => {
    const plan = planPayments({ ...contract, depositCents: contract.totalCents }, 1000);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ kind: 'deposit', amountCents: 144_600, feeCents: 12_225 });
  });

  it('acompte 0 % : uniquement un solde', () => {
    const plan = planPayments({ ...contract, depositCents: 0 }, 1000);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ kind: 'balance', amountCents: 144_600, feeCents: 12_225 });
  });

  it('arrondis étranges : la somme reste exacte pour de nombreux montants', () => {
    for (let total = 51; total < 5000; total += 37) {
      const subtotal = Math.round(total / 1.2);
      const plan = planPayments({ totalCents: total, subtotalCents: subtotal, depositCents: Math.round(total * 0.3) }, 1000);
      expect(plan.reduce((s, p) => s + p.feeCents, 0)).toBe(Math.round(subtotal * 0.1));
      expect(plan.reduce((s, p) => s + p.amountCents, 0)).toBe(total);
      expect(plan.every((p) => p.providerCents >= 0 && p.feeCents >= 0)).toBe(true);
    }
  });

  it('la commission ne dépasse jamais le paiement', () => {
    const [p] = planPayments({ totalCents: 100, subtotalCents: 100, depositCents: 100 }, 3000);
    expect(p.feeCents).toBeLessThanOrEqual(p.amountCents);
    expect(p.providerCents).toBeGreaterThanOrEqual(0);
  });

  it('minimum Stripe : refuse moins de 0,50 €', () => {
    expect(() => assertChargeable(49)).toThrow(InvalidStateError);
    expect(() => assertChargeable(50)).not.toThrow();
  });
});

describe('refundSplit', () => {
  it('répartit le remboursement au prorata, sans reste', () => {
    const p = { amountCents: 43_380, providerCents: 39_000 };
    const half = refundSplit(p, 21_690);
    expect(half.providerShare + half.feeShare).toBe(21_690);
    expect(half.providerShare).toBe(Math.round((21_690 * 39_000) / 43_380));
    expect(refundSplit(p, 43_380)).toEqual({ providerShare: 39_000, feeShare: 4_380 });
  });
});
