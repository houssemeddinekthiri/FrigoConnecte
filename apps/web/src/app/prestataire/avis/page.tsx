'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareReply, Star } from 'lucide-react';
import { useState } from 'react';
import type { ReceivedReviewDto } from '@frigoconnect/contracts';
import { ListFilters } from '@/components/list-filters';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api';
import { dateFr } from '@/lib/format';

const FILTERS = [
  { id: 'all', label: 'Tous', match: () => true },
  { id: 'todo', label: 'Sans réponse', match: (r: ReceivedReviewDto) => !r.response },
  { id: 'low', label: '3 étoiles et moins', match: (r: ReceivedReviewDto) => r.rating <= 3 },
];

const Stars = ({ n }: { n: number }) => (
  <span className="inline-flex" role="img" aria-label={`${n} sur 5`}>
    {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={i <= n ? 'size-4 fill-current text-warning' : 'size-4 text-muted-foreground/40'} />)}
  </span>
);

export default function ProviderReviewsPage() {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const { data, isPending, isError } = useQuery({ queryKey: ['reviews-received'], queryFn: () => api<ReceivedReviewDto[]>('reviews/received') });

  const match = FILTERS.find((f) => f.id === tab)!.match;
  const list = data?.filter((r) => match(r) && `${r.author} ${r.requestTitle} ${r.comment ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const average = data?.length ? data.reduce((s, r) => s + r.rating, 0) / data.length : null;

  return (
    <>
      <h1 className="text-2xl font-bold">Avis reçus</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Vos avis sont visibles sur votre fiche publique. Une réponse courtoise, même à une critique, rassure vos futurs clients.</p>

      {isPending && <div className="grid gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-28" />)}</div>}
      {isError && <p role="alert" className="text-destructive">Impossible de charger vos avis.</p>}
      {data?.length === 0 && <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Aucun avis pour le moment. Vos clients peuvent en laisser un dès qu&apos;une intervention est validée.</p>}

      {average !== null && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          <Card className="p-4"><p className="text-sm text-muted-foreground">Note moyenne</p><p className="mt-1 flex items-center gap-1.5 text-2xl font-bold">{average.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}<Star className="size-5 fill-current text-warning" /></p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">Avis publiés</p><p className="mt-1 text-2xl font-bold">{data!.length}</p></Card>
          <Card className="p-4"><p className="text-sm text-muted-foreground">Sans réponse</p><p className="mt-1 text-2xl font-bold">{data!.filter((r) => !r.response).length}</p></Card>
        </div>
      )}

      {!!data?.length && <ListFilters label="les avis" tabs={FILTERS.map((f) => ({ id: f.id, label: f.label, count: data.filter(f.match).length }))} tab={tab} onTab={setTab} q={q} onQ={setQ} />}
      {!!data?.length && list?.length === 0 && <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Aucun avis ne correspond.</p>}
      <ul className="grid gap-3">{list?.map((r) => <li key={r.id}><ReviewCard review={r} /></li>)}</ul>
    </>
  );
}

function ReviewCard({ review: r }: { review: ReceivedReviewDto }) {
  const qc = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const send = useMutation({
    mutationFn: () => api(`reviews/${r.id}/response`, { method: 'POST', body: JSON.stringify({ text: text.trim() }) }),
    onSuccess: () => { setReplying(false); void qc.invalidateQueries({ queryKey: ['reviews-received'] }); },
  });

  return (
    <Card className="grid gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex flex-wrap items-center gap-2 font-medium"><Stars n={r.rating} /> {r.author}</p>
          <p className="text-sm text-muted-foreground">{r.requestTitle} · {dateFr(r.createdAt)}</p>
        </div>
        {!r.response && !replying && <Button size="sm" variant="outline" onClick={() => setReplying(true)}><MessageSquareReply /> Répondre</Button>}
      </div>
      {r.comment ? <p className="whitespace-pre-wrap text-sm">{r.comment}</p> : <p className="text-sm text-muted-foreground">Note sans commentaire.</p>}
      {r.response && (
        <p className="whitespace-pre-wrap border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground"><b className="text-foreground">Votre réponse{r.responseAt ? ` du ${dateFr(r.responseAt)}` : ''} :</b> {r.response}</p>
      )}
      {replying && (
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} required autoFocus aria-label={`Votre réponse à ${r.author}`} placeholder="Merci pour votre confiance…" />
          <p className="text-xs text-muted-foreground">Votre réponse est publique et définitive : elle ne pourra plus être modifiée.</p>
          {send.isError && <p role="alert" className="text-sm text-destructive">{send.error instanceof ApiError ? ((send.error.body as { message?: string })?.message ?? 'Envoi impossible') : 'Envoi impossible'}</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={send.isPending || text.trim().length < 2}>{send.isPending ? 'Envoi…' : 'Publier ma réponse'}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setReplying(false)}>Annuler</Button>
          </div>
        </form>
      )}
    </Card>
  );
}
