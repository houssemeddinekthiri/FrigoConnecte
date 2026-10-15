'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { compactEur, eur } from '@/lib/format';

interface Point { day: string; cents: number }

const H = 220, LEFT = 52, RIGHT = 8, TOP = 12, BOTTOM = 26;
const IH = H - TOP - BOTTOM;

/** Plafond « rond » de l'axe (1, 2, 5 × 10^k euros) : des graduations lisibles plutôt que des valeurs exotiques. */
function niceMax(cents: number) {
  const e = Math.max(cents / 100, 1);
  const p = 10 ** Math.floor(Math.log10(e));
  const m = [1, 2, 5, 10].find((k) => k * p >= e)!;
  return m * p * 100;
}
const shortDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const longDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' });

/**
 * Colonnes du volume d'affaires par jour. Série unique : pas de légende (le titre nomme la série).
 * Marques fines, extrémité de données arrondie (4 px) et ancrée sur la ligne de base, grille en filets discrets.
 * Chaque colonne a une zone de survol sur toute la hauteur (plus grande que la marque) ; une vue tableau remplace le graphique.
 */
export function GmvChart({ data }: { data: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  // Le SVG est dessiné à la largeur RÉELLE (échelle 1:1) : les libellés gardent 11 px sur mobile au lieu de rétrécir avec la figure.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);
  const IW = W - LEFT - RIGHT;
  const total = data.reduce((s, d) => s + d.cents, 0);
  const max = niceMax(Math.max(...data.map((d) => d.cents), 0));
  const band = IW / Math.max(data.length, 1);
  const bw = Math.max(2, Math.min(band * 0.6, 14));
  const y = (c: number) => TOP + IH - (c / max) * IH;
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const hi = hover === null ? null : data[hover];

  if (total === 0) return <p className="py-10 text-center text-sm text-muted-foreground">Aucun paiement sur la période : le graphique apparaîtra dès le premier encaissement.</p>;

  return (
    <figure className="grid gap-2" style={{ color: 'var(--foreground)' }}>
      <div className="flex items-center justify-between gap-2">
        <figcaption className="text-sm font-medium">Volume d&apos;affaires par jour (TTC)</figcaption>
        <Button variant="ghost" size="sm" aria-pressed={table} onClick={() => setTable((t) => !t)}>{table ? 'Voir le graphique' : 'Voir en tableau'}</Button>
      </div>

      {table ? (
        <div className="max-h-64 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background text-left text-muted-foreground"><tr><th className="p-2 font-medium">Jour</th><th className="p-2 text-right font-medium">Montant</th></tr></thead>
            <tbody>{data.map((d) => <tr key={d.day} className="border-t"><td className="p-2">{longDay(d.day)}</td><td className="p-2 text-right tabular-nums">{eur(d.cents)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div ref={box} className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-labelledby={id} onPointerLeave={() => setHover(null)}>
            <title id={id}>{`Volume d'affaires sur ${data.length} jours : ${eur(total)} au total, maximum ${eur(Math.max(...data.map((d) => d.cents)))} en une journée.`}</title>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={LEFT} x2={W - RIGHT} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} />
                <text x={LEFT - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--viz-muted)">{compactEur(t)}</text>
              </g>
            ))}
            {[0, Math.floor((data.length - 1) / 2), data.length - 1].map((i) => (
              <text key={i} x={LEFT + band * i + band / 2} y={H - 8} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} fontSize={11} fill="var(--viz-muted)">{shortDay(data[i].day)}</text>
            ))}
            {data.map((d, i) => {
              const h = (d.cents / max) * IH;
              const x = LEFT + band * i + (band - bw) / 2;
              const r = Math.min(4, bw / 2, h);
              return (
                <g key={d.day}>
                  {h > 0 && (
                    // coins arrondis en haut seulement ; le bas reste droit sur la ligne de base
                    <path d={`M${x},${TOP + IH} V${y(d.cents) + r} Q${x},${y(d.cents)} ${x + r},${y(d.cents)} H${x + bw - r} Q${x + bw},${y(d.cents)} ${x + bw},${y(d.cents) + r} V${TOP + IH} Z`} fill={hover === i ? 'var(--viz-series-1-strong)' : 'var(--viz-series-1)'} />
                  )}
                  <rect x={LEFT + band * i} y={TOP} width={band} height={IH} fill="transparent" onPointerEnter={() => setHover(i)} onPointerMove={() => setHover(i)} />
                </g>
              );
            })}
          </svg>
          {hi && hover !== null && (
            <div
              role="status"
              className="pointer-events-none absolute -translate-x-1/2 rounded-md border bg-card px-2.5 py-1.5 text-xs shadow-md"
              style={{ left: `${((LEFT + band * hover + band / 2) / W) * 100}%`, top: `${(Math.max(y(hi.cents) - 52, 0) / H) * 100}%` }}
            >
              <p className="text-muted-foreground">{longDay(hi.day)}</p>
              <p className="font-semibold tabular-nums">{eur(hi.cents)}</p>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
