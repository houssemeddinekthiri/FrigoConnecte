'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ListFilters } from '@/components/list-filters';
import { useRealtimeEvent } from '@/lib/realtime';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { RequestAttachments } from '@/components/request-attachments';
import { RequestContext } from '@/components/request-context';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { dateFr, QUOTE_STATUS, SERVICE_LABELS, URGENCY_LABELS } from '@/lib/format';

interface InboxItem {
  requestId: string; title: string; serviceType: string; urgency: string; city: string; requestStatus: string;
  score: number; receivedAt: string; quote: { id: string; status: string } | null;
}

const isOpen = (r: InboxItem) => ['open', 'quoted'].includes(r.requestStatus);
const FILTERS = [
  { id: 'todo', label: 'À traiter', match: (r: InboxItem) => isOpen(r) && !r.quote },
  { id: 'answered', label: 'Devis envoyé', match: (r: InboxItem) => !!r.quote },
  { id: 'closed', label: 'Clôturées', match: (r: InboxItem) => !isOpen(r) && !r.quote },
  { id: 'all', label: 'Toutes', match: () => true },
];

export default function ProviderRequestsPage() {
  const [tab, setTab] = useState('todo');
  const [q, setQ] = useState('');
  const qc = useQueryClient();
  const { data, isPending, isError } = useQuery({ queryKey: ['inbox'], queryFn: () => api<InboxItem[]>('provider/requests') });
  // une nouvelle mise en relation arrive par notification temps réel : on recharge la liste
  useRealtimeEvent('notification', () => void qc.invalidateQueries({ queryKey: ['inbox'] }));

  const decline = useMutation({
    mutationFn: (requestId: string) => api(`provider/requests/${requestId}/decline`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['inbox'] }),
  });
  const match = FILTERS.find((f) => f.id === tab)!.match;
  const list = data?.filter((r) => match(r) && `${r.title} ${r.city} ${SERVICE_LABELS[r.serviceType] ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">Demandes reçues</h1>
      {!!data?.length && <ListFilters label="les demandes" tabs={FILTERS.map((f) => ({ id: f.id, label: f.label, count: data.filter(f.match).length }))} tab={tab} onTab={setTab} q={q} onQ={setQ} />}
      {isPending && <div className="grid gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>}
      {isError && <p role="alert" className="text-destructive">Impossible de charger les demandes.</p>}
      {decline.isError && <p role="alert" className="mb-3 text-sm text-destructive">Cette demande ne peut plus être déclinée.</p>}
      {data?.length === 0 && <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Aucune demande pour le moment. Vérifiez votre zone d&apos;intervention et vos certifications.</p>}
      {!!data?.length && list?.length === 0 && <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">{tab === 'todo' && !q ? 'Vous êtes à jour : aucune demande en attente de devis.' : 'Aucune demande ne correspond.'}</p>}
      <ul className="grid gap-3">
        {list?.map((r) => {
          const open = isOpen(r);
          return (
            <li key={r.requestId}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.title}</p>
                  <p className="text-sm text-muted-foreground">{SERVICE_LABELS[r.serviceType] ?? r.serviceType} · {r.city} · reçue le {dateFr(r.receivedAt)}</p>
                  <div className="mt-2 flex gap-1">
                    <Badge variant={r.urgency === 'emergency' ? 'destructive' : 'default'}>{URGENCY_LABELS[r.urgency]}</Badge>
                    {r.quote && <Badge variant={QUOTE_STATUS[r.quote.status]?.variant}>Devis : {QUOTE_STATUS[r.quote.status]?.label}</Badge>}
                  </div>
                  <RequestContext requestId={r.requestId} />
                  <RequestAttachments requestId={r.requestId} />
                </div>
                {open && !r.quote && (
                  <div className="flex flex-wrap gap-2">
                    <Button asChild><Link href={`/prestataire/devis/nouveau?requestId=${r.requestId}`}>Faire un devis</Link></Button>
                    <Button variant="ghost" disabled={decline.isPending} onClick={() => window.confirm('Décliner cette demande ? Elle disparaîtra de votre liste.') && decline.mutate(r.requestId)}>Décliner</Button>
                  </div>
                )}
                {r.quote && <Button asChild variant="outline"><Link href="/prestataire/devis">Voir mes devis</Link></Button>}
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
