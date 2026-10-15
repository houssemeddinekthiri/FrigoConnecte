'use client';

import { useQuery } from '@tanstack/react-query';
import { FileText, MessageCircle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { SERVICE_TYPES, type EquipmentDto } from '@frigoconnect/contracts';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useFavorites } from '@/lib/favorites';
import { NewRequestChat } from './new-request-chat';
import { NewRequestForm } from './new-request-form';

type Prefill = Parameters<typeof NewRequestForm>[0]['prefill'];
interface Previous { serviceType: string; trade: string; title: string; description: string; urgency: string; equipment: string | null; address: string; postalCode: string; city: string }

/** `?from=<id>` : on repart d'une demande existante ; `?equipment=<id>` : d'un de mes équipements. */
function usePrefill(): { loading: boolean; prefill?: Prefill } {
  const params = useSearchParams();
  const from = params.get('from');
  const eq = params.get('equipment');
  const previous = useQuery({ queryKey: ['request', from], queryFn: () => api<Previous>(`service-requests/${from}`), enabled: !!from });
  const equipment = useQuery({ queryKey: ['equipment'], queryFn: () => api<EquipmentDto[]>('client-equipment'), enabled: !!eq });
  if (from) {
    const p = previous.data;
    return { loading: previous.isPending, prefill: p && { ...p, equipment: p.equipment ?? undefined } as Prefill };
  }
  const q = equipment.data?.find((x) => x.id === eq);
  const service = params.get('service');
  const asked = (SERVICE_TYPES as readonly string[]).includes(service ?? '') ? (service as (typeof SERVICE_TYPES)[number]) : undefined;
  if (!from && !eq && asked) return { loading: false, prefill: { serviceType: asked } };
  return { loading: !!eq && equipment.isPending, prefill: q && { equipmentId: q.id, ...(service === 'maintenance' && { serviceType: 'maintenance' as const }), trade: q.trade, equipment: q.details ?? q.label, address: q.address, postalCode: q.postalCode, city: q.city } };
}

/** Deux façons de faire la même demande : en discutant (rapide) ou via le formulaire complet. */
export function NewRequest() {
  const base = usePrefill();
  const providerId = useSearchParams().get('provider') ?? undefined;
  const search = useSearchParams();
  const providerName = useFavorites().list.data?.find((f) => f.providerId === providerId)?.companyName ?? search.get('name');
  const { loading } = base;
  const prefill = providerId ? { ...base.prefill, preferredProviderId: providerId } : base.prefill;
  const [mode, setMode] = useState<'chat' | 'form'>(['from', 'equipment', 'service'].some((k) => search.has(k)) ? 'form' : 'chat');
  if (loading) return <Skeleton className="h-64" />;
  return (
    <>
      {providerId && providerName && <p className="mb-4 rounded-lg bg-accent p-3 text-sm text-accent-foreground">Cette demande sera envoyée en priorité à <b>{providerName}</b>, ainsi qu&apos;aux autres prestataires proches.</p>}
      <div className="mb-6 inline-flex rounded-xl bg-secondary p-1" role="tablist" aria-label="Mode de saisie">
        {([['chat', MessageCircle, 'En discutant'], ['form', FileText, 'Formulaire']] as const).map(([m, Icon, label]) => (
          <Button key={m} role="tab" aria-selected={mode === m} variant="ghost" onClick={() => setMode(m)}
            className={mode === m ? 'bg-background shadow-sm hover:bg-background' : 'text-muted-foreground'}><Icon /> {label}</Button>
        ))}
      </div>
      {mode === 'chat' ? <div className="mx-auto max-w-3xl"><NewRequestChat preferredProviderId={providerId} /></div> : <div className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"><NewRequestForm prefill={prefill} /></div>}
    </>
  );
}
