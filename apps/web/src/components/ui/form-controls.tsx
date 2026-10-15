import * as React from 'react';
import { cn } from '@/lib/utils';

// 16 px sur mobile : évite le zoom automatique d'iOS au focus. 14 px dès md.
const control =
  'w-full rounded-md border border-input bg-background px-3 text-base md:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-[invalid=true]:border-destructive';

export const Input = ({ className, ...p }: React.ComponentProps<'input'>) => <input className={cn(control, 'h-11 md:h-10', className)} {...p} />;

export const Textarea = ({ className, ...p }: React.ComponentProps<'textarea'>) => (
  <textarea className={cn(control, 'min-h-24 py-2', className)} {...p} />
);

/** <select> natif : meilleur sélecteur sur mobile (roue iOS / dialogue Android) qu'un composant custom. */
export const Select = ({ className, ...p }: React.ComponentProps<'select'>) => <select className={cn(control, 'h-11 md:h-10', className)} {...p} />;

/** Label + contrôle + message d'erreur. Le <label> englobant associe le contrôle sans id. */
export function Field({ label, error, hint, className, children }: { label: string; error?: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn('grid gap-1.5 text-sm font-medium', className)}>
      {label}
      {children}
      {hint && !error && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
      {error && <span role="alert" className="text-xs font-normal text-destructive">{error}</span>}
    </label>
  );
}
