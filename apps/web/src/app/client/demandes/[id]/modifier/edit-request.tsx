'use client';

import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { NewRequestForm } from '../../nouvelle/new-request-form';

export function EditRequest({ id }: { id: string }) {
  const { data, isPending, isError } = useQuery({ queryKey: ['request', id], queryFn: () => api<Record<string, any>>(`service-requests/${id}`) });
  if (isPending) return <Skeleton className="h-64" />;
  if (isError) return <p role="alert" className="text-destructive">Demande introuvable.</p>;
  if (data.quotesCount > 0 || !['draft', 'open'].includes(data.status)) return <p role="alert">Cette demande ne peut plus être modifiée.</p>;
  const { serviceType, trade, title, description, urgency, address, postalCode, city } = data;
  return <NewRequestForm edit={{ id, status: data.status, values: { serviceType, trade, title, description, urgency, address, postalCode, city, equipment: data.equipment ?? undefined, budgetMaxCents: data.budgetMaxCents ?? undefined } }} />;
}
