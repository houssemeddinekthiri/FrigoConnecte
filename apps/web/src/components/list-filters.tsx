'use client';

import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FilterTab { id: string; label: string; count?: number }

/** Barre commune des listes : onglets de statut (avec compteur) + recherche. Même présentation que « Mes demandes » côté client. */
export function ListFilters({ tabs, tab, onTab, q, onQ, label }: { tabs: FilterTab[]; tab: string; onTab: (id: string) => void; q: string; onQ: (q: string) => void; label: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label={`Filtrer ${label}`} className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => onTab(t.id)}
            className={cn('shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', tab === t.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {t.label}{t.count !== undefined && <span className="ml-1.5 text-xs opacity-70">{t.count}</span>}
          </button>
        ))}
      </div>
      <label className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input value={q} onChange={(e) => onQ(e.target.value)} placeholder="Rechercher…" aria-label={`Rechercher dans ${label}`}
          className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </label>
    </div>
  );
}
