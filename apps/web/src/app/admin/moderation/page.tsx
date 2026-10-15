'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { useState } from 'react';
import { apiMessage, EmptyState, ErrorNote, ListSkeleton, PageHeader, Segmented } from '@/components/admin/admin-ui';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { ago, dateTimeFr } from '@/lib/format';

interface ReviewRow { id: string; rating: number; comment: string | null; author: string; target: string; createdAt: string }

const TABS = [
  { value: 'pending_moderation', label: 'À modérer', empty: 'Aucun avis en attente.' },
  { value: 'hidden', label: 'Masqués', empty: 'Aucun avis masqué.' },
] as const;

export default function AdminModerationPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('pending_moderation');
  const { data, isPending, isError, refetch } = useQuery({ queryKey: ['admin-reviews', tab], queryFn: () => api<ReviewRow[]>(`admin/reviews?status=${tab}`) });
  const act = useMutation({
    mutationFn: ({ id, a }: { id: string; a: 'publish' | 'hide' }) => api(`admin/reviews/${id}/${a}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-reviews'] }),
  });

  return (
    <>
      <PageHeader title="Modération des avis" description="Seuls les avis contenant des coordonnées ou des liens arrivent ici ; les autres sont publiés directement. Un avis masqué peut être republié.">
        <Segmented label="Statut" value={tab} onChange={(t) => { setTab(t); act.reset(); }} options={TABS} />
      </PageHeader>
      {isPending && <ListSkeleton rows={2} />}
      {isError && <ErrorNote onRetry={() => void refetch()}>Impossible de charger les avis.</ErrorNote>}
      {act.isError && <div className="mb-3"><ErrorNote>{apiMessage(act.error)}</ErrorNote></div>}
      {data?.length === 0 && <EmptyState icon={Star} title="Rien à afficher">{TABS.find((t) => t.value === tab)?.empty}</EmptyState>}
      <ul className="grid gap-3">
        {data?.map((r) => (
          <li key={r.id}>
            <Card className="grid gap-2 p-4">
              <p className="text-sm text-muted-foreground">{r.author} → {r.target} · {dateTimeFr(r.createdAt)} ({ago(r.createdAt)}) · <span aria-label={`${r.rating} sur 5`}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span></p>
              <p className="whitespace-pre-wrap break-words">{r.comment}</p>
              <div className="flex gap-2">
                <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, a: 'publish' })}>Publier</Button>
                {tab === 'pending_moderation' && <Button size="sm" variant="destructive" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, a: 'hide' })}>Masquer</Button>}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
