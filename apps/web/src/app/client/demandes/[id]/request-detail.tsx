'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Heart, MapPin } from 'lucide-react';
import { useFavorites } from '@/lib/favorites';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { QuoteDto } from '@frigoconnect/contracts';
import { Badge, RequestStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/form-controls';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api';
import { dateFr, eur, QUOTE_STATUS, SERVICE_LABELS } from '@/lib/format';
import { useRealtimeEvent } from '@/lib/realtime';
import { RequestAttachments } from '@/components/request-attachments';
import { ContractPanel, useContracts } from '@/components/contract-panel';
import { MatchesMap, type MapMatch } from '@/components/matches-map';

interface Details { budgetMaxCents: number | null; id: string; title: string; description: string; status: string; city: string; address: string; postalCode: string; serviceType: string; quotesCount: number; location: { lat: number; lng: number } }

interface Match extends MapMatch { providerId: string; slug: string; city: string | null; avgResponseMinutes: number | null }

const errorMessage =(e: unknown) => (e instanceof ApiError ? ((e.body as { message?: string })?.message ?? 'Action impossible') : 'Action impossible');

export function RequestDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [signing, setSigning] = useState<QuoteDto | null>(null);
  const request = useQuery({ queryKey: ['request', id], queryFn: () => api<Details>(`service-requests/${id}`) });
  const quotes = useQuery({ queryKey: ['request-quotes', id], queryFn: () => api<QuoteDto[]>(`quotes?requestId=${id}`) });
  // le matching tourne juste après la publication : on réinterroge tant que la liste est vide
  const matches = useQuery({
    queryKey: ['request-matches', id], queryFn: () => api<Match[]>(`service-requests/${id}/matches`),
    refetchInterval: (q) => (q.state.data?.length || q.state.dataUpdateCount > 6 ? false : 3000),
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['request', id] }); void qc.invalidateQueries({ queryKey: ['request-quotes', id] }); void qc.invalidateQueries({ queryKey: ['request-matches', id] }); };
  useRealtimeEvent('notification', refresh); // un nouveau devis arrive en direct

  const contracts = useContracts('client', id);
  const favorites = useFavorites();
  const reject = useMutation({ mutationFn: (q: QuoteDto) => api(`quotes/${q.id}/reject`, { method: 'POST', body: '{}' }), onSuccess: refresh });
  const openPdf = async (fileId: string) => window.open((await api<{ url: string }>(`files/${fileId}/download-url`)).url, '_blank', 'noopener');

  const publish = useMutation({ mutationFn: () => api(`service-requests/${id}/publish`, { method: 'POST' }), onSuccess: () => { refresh(); void qc.invalidateQueries({ queryKey: ['my-requests'] }); } });
  const remove = useMutation({
    mutationFn: () => api(`service-requests/${id}`, { method: 'DELETE' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['my-requests'] }); router.push('/client'); },
  });
  const cancel = useMutation({ mutationFn: () => api(`service-requests/${id}/cancel`, { method: 'POST' }), onSuccess: () => { refresh(); void qc.invalidateQueries({ queryKey: ['my-requests'] }); } });

  if (request.isPending) return <Skeleton className="h-40" />;
  if (request.isError) return <p role="alert" className="text-destructive">Demande introuvable.</p>;
  const r = request.data;
  const decided = r.status === 'awarded' || r.status === 'in_progress' || r.status === 'completed';

  return (
    <>
      <Link href="/client" className="text-sm text-muted-foreground hover:underline">← Mes demandes</Link>
      <div className="mt-2 flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold">{r.title}</h1><RequestStatusBadge status={r.status} /></div>
      <p className="mt-1 text-sm text-muted-foreground">{SERVICE_LABELS[r.serviceType]} · {r.address}, {r.postalCode} {r.city}</p>
      <Progress status={r.status} quotes={r.quotesCount} workDone={!!contracts.data?.some((c) => c.workDoneAt || c.status === 'completed')} />
      <p className="mt-3 whitespace-pre-wrap">{r.description}</p>
      {r.budgetMaxCents && <p className="mt-3 text-sm"><b>Votre budget maximum :</b> {eur(r.budgetMaxCents)}</p>}
      <RequestAttachments requestId={id} />

      {(r.status === 'draft' || (r.status === 'open' && r.quotesCount === 0)) && (
        <div className="mt-4 rounded-xl border bg-card p-4">
          {r.status === 'draft' && <p className="mb-3 text-sm text-muted-foreground">Brouillon : cette demande n&apos;est pas encore visible des prestataires.</p>}
          <div className="flex flex-wrap gap-2">
            {r.status === 'draft' && <Button size="sm" disabled={publish.isPending} onClick={() => publish.mutate()}>Publier</Button>}
            <Button size="sm" variant="outline" asChild><Link href={`/client/demandes/${id}/modifier`}>Modifier</Link></Button>
            {r.status === 'draft'
              ? <Button size="sm" variant="ghost" className="text-destructive" disabled={remove.isPending} onClick={() => window.confirm('Supprimer ce brouillon définitivement ?') && remove.mutate()}>Supprimer</Button>
              : <Button size="sm" variant="ghost" className="text-destructive" disabled={cancel.isPending} onClick={() => window.confirm('Annuler cette demande ?') && cancel.mutate()}>Annuler la demande</Button>}
          </div>
          {[publish, remove, cancel].map((m, i) => m.isError && <p key={i} role="alert" className="mt-2 text-sm text-destructive">{errorMessage(m.error)}</p>)}
        </div>
      )}

      {contracts.data && contracts.data.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-xl font-semibold">Contrat et paiements</h2>
          <div className="grid gap-3">{contracts.data.map((c) => <ContractPanel key={c.id} contract={c} role="client" />)}</div>
        </>
      )}

      {r.status !== 'draft' && (
        <Button asChild size="sm" variant="outline" className="mt-4"><Link href={`/client/demandes/nouvelle?from=${id}`}>Refaire cette demande</Link></Button>
      )}

      {(r.status === 'open' || r.status === 'quoted') && matches.data && matches.data.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-xl font-semibold">Prestataires prévenus près de {r.city} ({matches.data.length})</h2>
          <MatchesMap center={r.location} matches={matches.data} />
          <ul className="grid gap-2">
            {matches.data.map((m, i) => (
              <li key={m.providerId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3 text-sm">
                <span className="flex items-center gap-2"><span className="text-muted-foreground">{i + 1}</span><Link href={`/prestataires/${m.slug}`} className="font-semibold hover:underline">{m.companyName}</Link></span>
                <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{m.distanceKm < 1 ? '< 1 km' : `${m.distanceKm} km`}{m.city ? ` · ${m.city}` : ''}</span>
                  {m.avgResponseMinutes !== null && <span>répond en ~{m.avgResponseMinutes} min</span>}
                  {m.availableNow && <Badge variant="success">Disponible maintenant</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mb-3 mt-8 text-xl font-semibold">Devis reçus {quotes.data && `(${quotes.data.length})`}</h2>
      {quotes.isPending && <Skeleton className="h-28" />}
      {quotes.data && <QuoteComparison quotes={quotes.data} />}
      {quotes.data?.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">Pas encore de devis. Les prestataires proches ont été prévenus ; vous serez notifié dès qu&apos;un devis arrive.</p>}
      {reject.isError && <p role="alert" className="mb-3 text-sm text-destructive">{errorMessage(reject.error)}</p>}
      <ul className="grid gap-3">
        {quotes.data?.map((q) => {
          const pdf = q.signedPdfFileId ?? q.pdfFileId;
          return (
            <li key={q.id}>
              <Card className="grid gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-1 font-semibold">{q.providerName}
                      <button type="button" aria-pressed={favorites.isFavorite(q.providerId)} aria-label={favorites.isFavorite(q.providerId) ? `Retirer ${q.providerName} des favoris` : `Ajouter ${q.providerName} aux favoris`}
                        className="rounded p-1 text-muted-foreground hover:text-destructive" onClick={() => favorites.toggle.mutate({ providerId: q.providerId, on: !favorites.isFavorite(q.providerId) })}>
                        <Heart className={favorites.isFavorite(q.providerId) ? 'size-4 fill-destructive text-destructive' : 'size-4'} />
                      </button>
                    </p>
                    <p className="text-sm text-muted-foreground">{q.number} · valable jusqu&apos;au {dateFr(q.validUntil)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {r.budgetMaxCents && q.status === 'sent' && (q.totalCents <= r.budgetMaxCents
                      ? <Badge variant="success">Dans votre budget</Badge>
                      : <Badge variant="warning">Dépasse de {eur(q.totalCents - r.budgetMaxCents)}</Badge>)}
                    <Badge variant={QUOTE_STATUS[q.status].variant}>{QUOTE_STATUS[q.status].label}</Badge>
                  </div>
                </div>
                <ul className="text-sm text-muted-foreground">{q.items.map((i) => <li key={i.position} className="flex justify-between gap-2"><span className="truncate">{i.label}</span><span>{eur(i.lineSubtotalCents)} HT</span></li>)}</ul>
                <p className="flex flex-wrap justify-between gap-2 font-semibold"><span>Total {eur(q.totalCents)} TTC</span><span className="font-normal text-muted-foreground">Acompte {eur(q.depositCents)} ({q.depositPercent} %)</span></p>
                <div className="flex flex-wrap gap-2">
                  {pdf && <Button variant="outline" size="sm" onClick={() => void openPdf(pdf)}><FileText />{q.status === 'accepted' ? 'Devis signé (PDF)' : 'Voir le PDF'}</Button>}
                  {q.status === 'sent' && !decided && (
                    <>
                      <Button size="sm" onClick={() => setSigning(q)}>Accepter et signer</Button>
                      <Button size="sm" variant="ghost" disabled={reject.isPending} onClick={() => reject.mutate(q)}>Refuser</Button>
                    </>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <SignSheet quote={signing} budgetCents={r.budgetMaxCents} onClose={() => setSigning(null)} onSigned={refresh} />
    </>
  );
}

/** Signature électronique simple : on demande un code envoyé par email au titulaire du compte, puis on le saisit. */
function SignSheet({ quote, budgetCents, onClose, onSigned }: { quote: QuoteDto | null; budgetCents: number | null; onClose: () => void; onSigned: () => void }) {
  const [step, setStep] = useState<'code' | 'done'>('code');
  const [code, setCode] = useState('');
  const [overBudgetOk, setOverBudgetOk] = useState(false);
  const over = quote && budgetCents ? Math.max(0, quote.totalCents - budgetCents) : 0;
  const close = () => { setStep('code'); setCode(''); setOverBudgetOk(false); onClose(); };

  const request = useMutation({
    mutationFn: () => api<{ devCode: string | null }>(`quotes/${quote!.id}/acceptance-code`, { method: 'POST' }),
    onSuccess: (r) => { if (r?.devCode) setCode(r.devCode); }, // test local : code déjà rempli
  });
  const sign = useMutation({
    mutationFn: () => api(`quotes/${quote!.id}/accept`, { method: 'POST', body: JSON.stringify({ code }) }),
    onSuccess: () => { setStep('done'); onSigned(); },
  });
  // le code part dès l'ouverture : un seul écran au lieu de « intro » puis « code »
  const quoteId = quote?.id;
  useEffect(() => { if (quoteId) request.mutate(); }, [quoteId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={!!quote} onOpenChange={(o) => !o && close()}>
      <SheetContent title="Accepter et signer">
        {quote && step === 'code' && (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); sign.mutate(); }}>
            {over > 0 && (
              <label className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4" checked={overBudgetOk} onChange={(e) => setOverBudgetOk(e.target.checked)} />
                <span>Ce devis <b>dépasse votre budget de {eur(over)}</b> ({eur(budgetCents!)}). Je confirme accepter ce montant.</span>
              </label>
            )}
            <p>Vous acceptez le devis <b>{quote.number}</b> de <b>{quote.providerName}</b> pour <b>{eur(quote.totalCents)} TTC</b>.</p>
            <p className="text-sm text-muted-foreground">{request.isPending ? 'Envoi du code…' : "Un code à 6 chiffres vient d'être envoyé à l'email de votre compte : il vaut signature. Les autres devis de cette demande seront refusés."}</p>
            {request.data?.devCode && <p role="status" className="rounded-lg bg-warning/10 p-3 text-sm"><b>Mode test</b> : aucun email envoyé, le code est <b className="tracking-widest">{request.data.devCode}</b> (déjà saisi ci-dessous).</p>}
            {request.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(request.error)}</p>}
            <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" aria-label="Code reçu par email" autoFocus className="text-center text-xl tracking-widest" />
            {sign.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(sign.error)}</p>}
            <Button size="lg" disabled={code.length !== 6 || sign.isPending || (over > 0 && !overBudgetOk)}>{sign.isPending ? 'Signature…' : 'Signer le devis'}</Button>
            <Button type="button" variant="ghost" disabled={request.isPending} onClick={() => request.mutate()}>Renvoyer un code</Button>
          </form>
        )}
        {step === 'done' && (
          <div className="grid gap-4">
            <p role="status" className="rounded-lg bg-success/10 p-4 text-success">Devis signé. Le prestataire est prévenu ; vous retrouvez le PDF signé sur cette page.</p>
            <Button onClick={close}>Fermer</Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Tableau côte à côte dès qu'on a au moins 2 devis en cours : prix, acompte, délai, durée, validité. */
function QuoteComparison({ quotes }: { quotes: QuoteDto[] }) {
  const live = quotes.filter((q) => q.status === 'sent' || q.status === 'accepted');
  if (live.length < 2) return null;
  const cheapest = Math.min(...live.map((q) => q.totalCents));
  const soonest = live.map((q) => q.estimatedStart).filter(Boolean).sort()[0];
  const rows: [string, (q: QuoteDto) => React.ReactNode][] = [
    ['Total TTC', (q) => <span className="font-semibold">{eur(q.totalCents)} {q.totalCents === cheapest && <Badge variant="success">Moins cher</Badge>}</span>],
    ['Acompte', (q) => `${eur(q.depositCents)} (${q.depositPercent} %)`],
    ['Début estimé', (q) => (q.estimatedStart ? <>{dateFr(q.estimatedStart)} {q.estimatedStart === soonest && <Badge variant="success">Plus tôt</Badge>}</> : '—')],
    ['Durée estimée', (q) => (q.estimatedDurationHours ? `${q.estimatedDurationHours} h` : '—')],
    ['Valable jusqu\'au', (q) => dateFr(q.validUntil)],
  ];
  return (
    <div className="mb-4 overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[32rem] text-sm">
        <thead><tr className="border-b text-left"><th className="p-3 font-medium text-muted-foreground">Comparatif</th>{live.map((q) => <th key={q.id} className="p-3">{q.providerName}</th>)}</tr></thead>
        <tbody>
          {rows.map(([label, cell]) => (
            <tr key={label} className="border-b last:border-0"><th scope="row" className="p-3 text-left font-normal text-muted-foreground">{label}</th>{live.map((q) => <td key={q.id} className="p-3">{cell(q)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STEPS = ['Demande publiée', 'Devis reçus', 'Devis signé', 'Intervention faite', 'Terminée'];

/** Frise d'avancement, déduite du statut de la demande et des contrats : aucune donnée en plus à gérer. */
function Progress({ status, quotes, workDone }: { status: string; quotes: number; workDone: boolean }) {
  if (['draft', 'cancelled', 'expired'].includes(status)) return null;
  const done = status === 'completed' ? 5 : workDone ? 4 : ['awarded', 'in_progress'].includes(status) ? 3 : quotes > 0 ? 2 : 1;
  return (
    <ol className="mt-5 grid grid-cols-5 gap-1" aria-label="Avancement de la demande">
      {STEPS.map((label, i) => {
        const ok = i < done;
        return (
          <li key={label} aria-current={i === done - 1 ? 'step' : undefined} className="grid gap-1.5 text-center">
            <span className={`h-1.5 rounded-full ${ok ? 'bg-primary' : 'bg-secondary'}`} />
            <span className={`text-xs ${ok ? 'font-medium' : 'text-muted-foreground'}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
