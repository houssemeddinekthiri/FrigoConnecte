import { computeTotals, depositCents } from './totals';

describe('computeTotals', () => {
  it('cas simple : 2 × 150,00 € HT à 20 %', () => {
    const t = computeTotals([{ quantity: 2, unitPriceCents: 15000, vatRateBps: 2000 }]);
    expect(t).toMatchObject({ subtotalCents: 30000, vatCents: 6000, totalCents: 36000 });
  });

  it('TVA calculée par taux sur la base cumulée (pas par ligne)', () => {
    // 3 lignes à 0,33 € HT, TVA 20 % : par ligne = 3 × round(6,6) = 21 ; par taux = round(19,8) = 20
    const t = computeTotals(Array(3).fill({ quantity: 1, unitPriceCents: 33, vatRateBps: 2000 }));
    expect(t.subtotalCents).toBe(99);
    expect(t.vatCents).toBe(20);
  });

  it('plusieurs taux, triés, et total = HT + TVA', () => {
    const t = computeTotals([
      { quantity: 1, unitPriceCents: 100000, vatRateBps: 2000 },
      { quantity: 1, unitPriceCents: 50000, vatRateBps: 1000 },
      { quantity: 1, unitPriceCents: 20000, vatRateBps: 550 },
    ]);
    expect(t.vatByRate.map((r) => r.rateBps)).toEqual([550, 1000, 2000]);
    expect(t.vatCents).toBe(1100 + 5000 + 20000);
    expect(t.totalCents).toBe(t.subtotalCents + t.vatCents);
  });

  it('quantités décimales sans flottant parasite (0,1 + 0,2)', () => {
    const t = computeTotals([{ quantity: 0.1, unitPriceCents: 1000, vatRateBps: 0 }, { quantity: 0.2, unitPriceCents: 1000, vatRateBps: 0 }]);
    expect(t.subtotalCents).toBe(300);
  });

  it('acompte arrondi au centime', () => {
    expect(depositCents(36000, 30)).toBe(10800);
    expect(depositCents(10001, 30)).toBe(3000);
  });
});
