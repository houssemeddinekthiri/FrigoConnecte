import * as React from 'react';
import { cn } from '@/lib/utils';

export const Card = ({ className, ...p }: React.ComponentProps<'div'>) => (
  <div className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...p} />
);
export const CardHeader = ({ className, ...p }: React.ComponentProps<'div'>) => <div className={cn('grid gap-1 p-4 md:p-6', className)} {...p} />;
export const CardTitle = ({ className, ...p }: React.ComponentProps<'h3'>) => <h3 className={cn('font-semibold leading-tight', className)} {...p} />;
export const CardDescription = ({ className, ...p }: React.ComponentProps<'p'>) => <p className={cn('text-sm text-muted-foreground', className)} {...p} />;
export const CardContent = ({ className, ...p }: React.ComponentProps<'div'>) => <div className={cn('p-4 pt-0 md:p-6 md:pt-0', className)} {...p} />;
