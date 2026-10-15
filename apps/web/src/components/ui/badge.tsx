import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'border-transparent bg-accent text-accent-foreground',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      outline: 'text-foreground',
      success: 'border-success/30 bg-success/10 text-success',
      warning: 'border-warning/30 bg-warning/10 text-warning',
      destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
    },
  },
  defaultVariants: { variant: 'default' },
});

export const Badge = ({ className, variant, ...p }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) => (
  <span className={cn(badgeVariants({ variant }), className)} {...p} />
);

type Variant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;
const REQUEST_STATUS: Record<string, [string, Variant]> = {
  draft: ['Brouillon', 'secondary'],
  open: ['Ouverte', 'default'],
  quoted: ['Devis reçus', 'default'],
  awarded: ['Attribuée', 'success'],
  in_progress: ['En cours', 'warning'],
  completed: ['Terminée', 'success'],
  cancelled: ['Annulée', 'secondary'],
  expired: ['Expirée', 'secondary'],
};

export function RequestStatusBadge({ status }: { status: string }) {
  const [label, variant] = REQUEST_STATUS[status] ?? [status, 'secondary'];
  return <Badge variant={variant}>{label}</Badge>;
}
