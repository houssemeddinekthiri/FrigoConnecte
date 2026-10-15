import { cn } from '@/lib/utils';

export const Skeleton = ({ className, ...p }: React.ComponentProps<'div'>) => (
  <div aria-hidden className={cn('animate-pulse rounded-md bg-muted', className)} {...p} />
);
