import { AlertTriangle, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** En-tête commun à toutes les pages d'administration : même titre, même rythme, actions alignées à droite. */
export function PageHeader({ title, description, children }: { title: string; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </header>
  );
}

/** Choix exclusif (période, statut…) : boutons natifs dans un groupe, `aria-pressed` pour les lecteurs d'écran. */
export function Segmented<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { value: T; label: string; count?: number }[]; onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap gap-1 rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn('inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            o.value === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
        >
          {o.label}
          {!!o.count && <span className="rounded-full bg-destructive px-1.5 text-[11px] font-semibold leading-4 text-destructive-foreground" aria-label={`${o.count} à traiter`}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon?: LucideIcon; title: string; children?: React.ReactNode }) {
  return (
    <div className="grid justify-items-center gap-1 rounded-lg border border-dashed p-8 text-center">
      {Icon && <Icon className="mb-1 size-8 text-muted-foreground/60" aria-hidden />}
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-md text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}

export function ErrorNote({ children, onRetry }: { children: React.ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Réessayer</Button>}
    </div>
  );
}

/** Message d'une erreur d'API lisible (jamais de JSON brut à l'écran). */
export const apiMessage = (err: unknown, fallback = 'Action impossible') => {
  const m = (err as { body?: { message?: unknown } } | null)?.body?.message;
  return typeof m === 'string' ? m : Array.isArray(m) ? m.join(' · ') : fallback;
};

export const ListSkeleton = ({ rows = 3, className = 'h-20' }: { rows?: number; className?: string }) => (
  <div className="grid gap-2" role="status" aria-label="Chargement">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className={className} />)}</div>
);
