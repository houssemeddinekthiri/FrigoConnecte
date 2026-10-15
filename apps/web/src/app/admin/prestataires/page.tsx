'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { AdminStats, ProviderApplication } from '@frigoconnect/contracts';
import { apiMessage, EmptyState, ErrorNote, ListSkeleton, PageHeader, Segmented } from '@/components/admin/admin-ui';
import { ReasonAction } from '@/components/admin/reason-action';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { ago, dateFr, SERVICE_LABELS, TRADE_LABELS } from '@/lib/format';
import { cn } from '@/lib/utils';

const TABS = [
  { value: 'pending_review', label: 'À valider', empty: 'Aucun dossier en attente : tout est traité.' },
  { value: 'approved', label: 'Actifs', empty: 'Aucun prestataire actif pour le moment.' },
  { value: 'suspended', label: 'Suspendus', empty: 'Aucun prestataire suspendu.' },
  { value: 'rejected', label: 'Refusés', empty: 'Aucun dossier refusé.' },
] as const;
type Tab = (typeof TABS)[number]['value'];

const CERT_LABEL: Record<string, string> = {
  fluid_handling_cat1: 'Attestation de capacité (cat. I)', fluid_handling_cat2: 'Attestation de capacité (cat. II)', fluid_handling_cat3: 'Attestation de capacité (cat. III)',
  fluid_handling_cat4: 'Attestation de capacité (cat. IV)', qualipac: 'QualiPAC', rge: 'RGE', qualibat: 'Qualibat', electrical_habilitation: 'Habilitation électrique',
  insurance_decennale: 'Assurance décennale', other: 'Autre document',
};
const REVIEW = { pending: ['À examiner', 'warning'], approved: ['Validé', 'success'], rejected: ['Refusé', 'destructive'], not_applicable: ['—', 'secondary'] } as const;
const labels = (codes: string[], map: Record<string, string>) => codes.map((c) => map[c] ?? c);
const pendingDocs = (p: ProviderApplication) => p.certifications.filter((c) => c.reviewStatus === 'pending').length;

export default function AdminProvidersPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('pending_review');
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['admin-providers', tab], queryFn: () => api<ProviderApplication[]>(`admin/providers?status=${tab}`) });
  // même requête que la navigation : le compteur de l'onglet « À valider » ne coûte rien de plus
  const stats = useQuery({ queryKey: ['admin-stats', 30], queryFn: () => api<AdminStats>('admin/stats?days=30'), refetchInterval: 60_000 });
  // `current` (et non `selected`) pilote l'affichage : un dossier traité disparaît de la liste, on revient alors à celle-ci
  const current = list.data?.find((p) => p.providerId === selected) ?? null;
  const post = (path: string, body?: unknown) =>
    api(`admin/providers/${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) }).then((r) => {
      void qc.invalidateQueries({ queryKey: ['admin-providers'] });
      void qc.invalidateQueries({ queryKey: ['admin-stats'] });
      return r;
    });
  const openDoc = useMutation({ mutationFn: async (fileId: string) => window.open((await api<{ url: string }>(`files/${fileId}/download-url`)).url, '_blank', 'noopener') });
  // boutons directs (sans motif) : un seul endroit pour afficher leur erreur
  const act = useMutation({ mutationFn: ({ path, body }: { path: string; body?: unknown }) => post(path, body) });
  const today = new Date().toISOString().slice(0, 10);
  const error = act.isError ? apiMessage(act.error) : openDoc.isError ? 'Impossible d\'ouvrir le document.' : null;

  return (
    <>
      <PageHeader title="Validation des prestataires" description="Vérifiez le SIRET et chaque document avant d'activer un profil. Les prestataires validés deviennent visibles des clients.">
        <Segmented label="Statut" value={tab} onChange={(t) => { setTab(t); setSelected(null); act.reset(); }}
          options={TABS.map((t) => ({ value: t.value, label: t.label, count: t.value === 'pending_review' ? stats.data?.kpis.pendingValidations : undefined }))} />
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-[20rem_1fr]">
        <ul className={cn('grid content-start gap-2', current && 'hidden md:grid')}>
          {list.isPending && <li><ListSkeleton rows={3} className="h-[4.5rem]" /></li>}
          {list.isError && <li><ErrorNote onRetry={() => void list.refetch()}>Impossible de charger les dossiers.</ErrorNote></li>}
          {list.data?.length === 0 && <li><EmptyState icon={ShieldCheck} title="Aucun dossier">{TABS.find((t) => t.value === tab)?.empty}</EmptyState></li>}
          {list.data?.map((p) => (
            <li key={p.providerId}>
              <button type="button" onClick={() => { setSelected(p.providerId); act.reset(); }} aria-current={p.providerId === selected ? 'true' : undefined}
                className={cn('w-full rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', p.providerId === selected && 'border-primary bg-accent/40')}>
                <span className="flex items-start justify-between gap-2">
                  <span className="font-medium">{p.companyName}</span>
                  {pendingDocs(p) > 0 && <Badge variant="warning" className="shrink-0">{pendingDocs(p)} à examiner</Badge>}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{p.city} · {p.certifications.length} document(s){p.submittedAt && ` · soumis ${ago(p.submittedAt)}`}</span>
              </button>
            </li>
          ))}
        </ul>

        <section aria-label="Dossier" className={cn(!current && 'hidden md:block')}>
          {!current && <EmptyState title="Sélectionnez un dossier">Les documents, le SIRET et les actions de validation s&apos;affichent ici.</EmptyState>}
          {current && (
            <Card className="grid gap-4 p-4 md:p-5">
              <Button variant="ghost" size="sm" className="justify-self-start md:hidden" onClick={() => setSelected(null)}>← Retour à la liste</Button>
              <div>
                <h2 className="text-lg font-semibold">{current.companyName}</h2>
                <p className="text-sm text-muted-foreground">{current.email} · {current.city}</p>
                <p className="mt-1 text-sm">
                  SIRET <b className="tabular-nums">{current.siret}</b>{' '}
                  <a className="inline-flex items-center gap-1 text-primary underline" href={`https://annuaire-entreprises.data.gouv.fr/rechercher?terme=${current.siret}`} target="_blank" rel="noopener noreferrer">vérifier<ExternalLink className="size-3" aria-hidden /></a>
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {labels(current.trades, TRADE_LABELS).map((l) => <Badge key={l} variant="secondary">{l}</Badge>)}
                  {labels(current.services, SERVICE_LABELS).map((l) => <Badge key={l} variant="outline">{l}</Badge>)}
                </div>
                <p className="mt-2 break-all text-xs text-muted-foreground">Identifiant : {current.providerId}</p>
                {current.rejectionReason && <p className="mt-2 text-sm text-destructive">Motif du refus : {current.rejectionReason}</p>}
              </div>

              <ul className="grid gap-2">
                {current.certifications.length === 0 && <li className="text-sm text-muted-foreground">Aucun document déposé.</li>}
                {current.certifications.map((c) => (
                  <li key={c.id} className="grid gap-2 rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{CERT_LABEL[c.type] ?? c.type}{c.number && <span className="font-normal text-muted-foreground"> · n° {c.number}</span>}</p>
                      <span className="flex gap-1">
                        {c.expiresOn && c.expiresOn < today && <Badge variant="destructive">Expiré</Badge>}
                        <Badge variant={REVIEW[c.reviewStatus][1]}>{REVIEW[c.reviewStatus][0]}</Badge>
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{c.issuer && `${c.issuer} · `}{c.issuedOn && `délivré le ${dateFr(c.issuedOn)} · `}{c.expiresOn ? `expire le ${dateFr(c.expiresOn)}` : 'sans expiration'}</p>
                    {c.rejectionReason && <p className="text-xs text-destructive">Refusé : {c.rejectionReason}</p>}
                    <div className="flex flex-wrap items-start gap-2">
                      <Button size="sm" variant="outline" disabled={openDoc.isPending} onClick={() => openDoc.mutate(c.fileId)}><FileText />Ouvrir le document</Button>
                      {c.reviewStatus === 'pending' && (
                        <>
                          <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ path: `${current.providerId}/certifications/${c.id}/review`, body: { decision: 'approve' } })}>Valider</Button>
                          <ReasonAction label="Refuser" variant="destructive" confirmLabel="Confirmer le refus" onSubmit={(reason) => post(`${current.providerId}/certifications/${c.id}/review`, { decision: 'reject', reason })} />
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {current.status === 'pending_review' && current.blockers.length > 0 && (
                <div role="status" className="rounded-md bg-warning/10 p-3 text-sm text-warning">
                  <p className="font-medium">Avant d&apos;approuver :</p>
                  <ul className="list-disc pl-5">{current.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                </div>
              )}
              {error && <ErrorNote>{error}</ErrorNote>}

              <div className="flex flex-wrap items-start gap-2 border-t pt-3">
                {current.status === 'pending_review' && (
                  <>
                    <Button disabled={current.blockers.length > 0 || act.isPending} onClick={() => act.mutate({ path: `${current.providerId}/approve` })}>Approuver le dossier</Button>
                    <ReasonAction label="Refuser le dossier" variant="destructive" confirmLabel="Confirmer le refus" onSubmit={(reason) => post(`${current.providerId}/reject`, { reason })} />
                  </>
                )}
                {current.status === 'approved' && <ReasonAction label="Suspendre le profil" variant="destructive" confirmLabel="Confirmer la suspension" onSubmit={(reason) => post(`${current.providerId}/suspend`, { reason })} />}
                {current.status === 'suspended' && <Button disabled={act.isPending} onClick={() => act.mutate({ path: `${current.providerId}/reinstate` })}>Réintégrer</Button>}
              </div>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}
