'use client';

import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, CheckCircle2, ChevronRight, FileSignature, FileText, Inbox, RefreshCw, Scale, ShieldCheck, Star, Timer, UserPlus, Users, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { AdminStats } from '@frigoconnect/contracts';
import { ErrorNote, PageHeader, Segmented } from '@/components/admin/admin-ui';
import { GmvChart } from '@/components/admin/gmv-chart';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { AUDIT_ACTION, ago, duration, eur, pct } from '@/lib/format';
import { cn } from '@/lib/utils';

const PERIODS = [7, 30, 90] as const;

/** Indicateur : valeur absente = « — » en grisé (jamais un « 0 » trompeur), et libellé d'aide toujours présent pour garder des cartes alignées. */
function Tile({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint?: string }) {
  const none = value === '—';
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><Icon className="size-4" aria-hidden /></span>
      </div>
      <p className={cn('text-2xl font-semibold tabular-nums', none && 'text-muted-foreground')}>{value}</p>
      <p className="mt-auto text-xs text-muted-foreground">{none ? 'Pas encore de données sur la période' : hint}</p>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Ce qui attend une décision de l'administrateur, tout en haut. L'urgence est portée par l'icône et le texte, pas par la couleur seule. */
function Todo({ k }: { k: AdminStats['kpis'] }) {
  const items = [
    { href: '/admin/prestataires', icon: ShieldCheck, n: k.pendingValidations, text: plural(k.pendingValidations, 'dossier prestataire à valider', 'dossiers prestataires à valider'), cta: 'Examiner', tone: 'border-warning/40 bg-warning/10 hover:bg-warning/15' },
    { href: '/admin/litiges', icon: Scale, n: k.disputes, text: plural(k.disputes, 'litige ouvert', 'litiges ouverts'), cta: 'Traiter', tone: 'border-destructive/40 bg-destructive/10 hover:bg-destructive/15' },
  ].filter((i) => i.n > 0);

  if (!items.length) {
    return <p role="status" className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success"><CheckCircle2 className="size-4 shrink-0" aria-hidden />Tout est à jour : aucun dossier à valider, aucun litige ouvert.</p>;
  }
  return (
    <section aria-label="À traiter" className="grid gap-3 sm:grid-cols-2">
      {items.map(({ href, icon: Icon, text, cta, tone }) => (
        <Link key={href} href={href} className={cn('flex items-center gap-3 rounded-lg border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', tone)}>
          <Icon className="size-5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 font-medium">{text}</span>
          <span className="flex items-center text-sm font-medium">{cta}<ChevronRight className="size-4" aria-hidden /></span>
        </Link>
      ))}
    </section>
  );
}

interface AuditRow { id: number; action: string; actor: string | null; createdAt: string }

function RecentActions() {
  const { data, isPending, isError } = useQuery({ queryKey: ['admin-audit-recent'], queryFn: () => api<AuditRow[]>('admin/audit?limit=5'), refetchInterval: 60_000 });
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold">Dernières actions d&apos;administration</h2>
        <Link href="/admin/audit" className="text-sm text-primary hover:underline">Journal complet →</Link>
      </div>
      {isPending && <Skeleton className="h-24" />}
      {isError && <p className="text-sm text-muted-foreground">Journal momentanément indisponible.</p>}
      {data?.length === 0 && <p className="text-sm text-muted-foreground">Aucune action enregistrée pour l&apos;instant.</p>}
      <ul className="divide-y text-sm">
        {data?.map((a) => (
          <li key={a.id} className="flex flex-wrap justify-between gap-x-3 py-2">
            <span className="font-medium">{AUDIT_ACTION[a.action] ?? a.action}</span>
            <span className="text-muted-foreground">{a.actor ?? '—'} · {ago(a.createdAt)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section aria-label={title}>
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
  </section>
);

export default function AdminDashboard() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const { data, isPending, isError, isFetching, refetch, dataUpdatedAt } = useQuery({ queryKey: ['admin-stats', days], queryFn: () => api<AdminStats>(`admin/stats?days=${days}`), refetchInterval: 60_000 });
  const k = data?.kpis;

  return (
    <>
      <PageHeader title="Indicateurs" description="Santé de la plateforme sur la période choisie : activité, argent et qualité de service.">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Période" value={days} onChange={setDays} options={PERIODS.map((p) => ({ value: p, label: `${p} j` }))} />
          <Button variant="outline" size="icon" aria-label="Actualiser" title={dataUpdatedAt ? `Mis à jour à ${new Date(dataUpdatedAt).toLocaleTimeString('fr-FR', { timeStyle: 'short' })}` : 'Actualiser'} disabled={isFetching} onClick={() => void refetch()}>
            <RefreshCw className={cn(isFetching && 'animate-spin')} />
          </Button>
        </div>
      </PageHeader>

      {isError && <ErrorNote onRetry={() => void refetch()}>Impossible de charger les indicateurs.</ErrorNote>}
      {isPending && !isError && (
        <div className="grid gap-6" role="status" aria-label="Chargement">
          <Skeleton className="h-72" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
        </div>
      )}

      {k && data && (
        <div className="grid gap-6">
          <Todo k={k} />

          <Card className="overflow-hidden">
            <div className="grid gap-5 p-5 md:grid-cols-[1fr_auto] md:items-end md:p-6">
              <div>
                <p className="text-sm text-muted-foreground">Volume d&apos;affaires · {days} derniers jours, TTC</p>
                <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">{eur(k.gmvCents)}</p>
              </div>
              <div className="grid grid-cols-2 gap-6 md:border-l md:pl-6">
                <Stat label="Commission" value={eur(k.commissionCents)} hint={k.gmvCents > 0 ? `${(k.takeRateBps / 100).toLocaleString('fr-FR')} % du volume TTC` : 'aucun encaissement'} />
                <Stat label="Fonds en séquestre" value={eur(k.escrowCents)} hint="encaissés, pas encore versés" />
              </div>
            </div>
            <div className="border-t p-5 md:p-6"><GmvChart data={data.gmvByDay} /></div>
          </Card>

          <Section title="Du besoin au contrat">
            <Tile icon={Inbox} label="Demandes déposées" value={String(k.requests)} hint="par les clients" />
            <Tile icon={FileText} label="Demandes avec devis" value={pct(k.quotedRate)} hint="part des demandes avec au moins un devis" />
            <Tile icon={BadgeCheck} label="Devis acceptés" value={pct(k.acceptanceRate)} hint="part des devis envoyés" />
            <Tile icon={FileSignature} label="Contrats terminés" value={String(k.contractsCompleted)} hint="validés par le client" />
          </Section>

          <Section title="Communauté et qualité">
            <Tile icon={UserPlus} label="Nouveaux inscrits" value={String(k.newUsers)} hint="clients et prestataires" />
            <Tile icon={Users} label="Prestataires actifs" value={String(k.activeProviders)} hint="profils validés" />
            <Tile icon={Timer} label="Délai médian du 1er devis" value={duration(k.medianFirstQuoteMinutes)} hint="entre la demande et le premier devis" />
            <Tile icon={Star} label="Note moyenne" value={k.avgRating === null ? '—' : `${k.avgRating.toLocaleString('fr-FR')} / 5`} hint="avis publiés" />
          </Section>

          <RecentActions />
        </div>
      )}
    </>
  );
}
