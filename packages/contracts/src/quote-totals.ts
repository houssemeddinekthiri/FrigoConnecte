export interface ItemInput {
  quantity: number;
  unitPriceCents: number; // HT
  vatRateBps: number;
}

export interface Totals {
  lineSubtotals: number[];
  vatByRate: { rateBps: number; baseCents: number; vatCents: number }[];
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
}

/**
 * Les montants sont TOUJOURS recalculés côté serveur (jamais ceux envoyés par le client).
 * Entiers uniquement : quantité en centièmes, arrondi à chaque ligne, TVA calculée par taux sur la base HT cumulée
 * (méthode de facturation française : un arrondi par taux, pas par ligne).
 */
export function computeTotals(items: ItemInput[]): Totals {
  const lineSubtotals = items.map((i) => Math.round((Math.round(i.quantity * 100) * i.unitPriceCents) / 100));

  const bases = new Map<number, number>();
  items.forEach((i, idx) => bases.set(i.vatRateBps, (bases.get(i.vatRateBps) ?? 0) + lineSubtotals[idx]));

  const vatByRate = [...bases.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rateBps, baseCents]) => ({ rateBps, baseCents, vatCents: Math.round((baseCents * rateBps) / 10_000) }));

  const subtotalCents = lineSubtotals.reduce((a, b) => a + b, 0);
  const vatCents = vatByRate.reduce((a, r) => a + r.vatCents, 0);
  return { lineSubtotals, vatByRate, subtotalCents, vatCents, totalCents: subtotalCents + vatCents };
}

/** Acompte arrondi au centime, sur le TTC. */
export const depositCents = (totalCents: number, percent: number) => Math.round((totalCents * percent) / 100);
