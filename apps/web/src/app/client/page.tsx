'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronRight, ClipboardList, FileText, LifeBuoy, MapPin, Plus, Search, Siren, Snowflake, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { RequestStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { TodoList } from './todo-list';

interface Summary { id: string; title: string; status: string; city: string; quotesCount: number; createdAt: string }

const FILTERS = [
  { id: 'all', label: 'Toutes', match: () => true },
  { id: 'draft', label: 'Brouillons', match: (r: Summary) => r.status === 'draft' },
  { id: 'quoted', label: 'Devis reçus', match: (r: Summary) => r.status === 'quoted' },
  { id: 'active', label: 'En cours', match: (r: Summary) => ['open', 'awarded', 'in_progress'].includes(r.status) },
  { id: 'done', label: 'Terminées', match: (r: Summary) => ['completed', 'cancelled', 'expired'].includes(r.status) },
] as const;

const dateFr = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

export default function ClientDashboard() {
  const { data: session } = useSession();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [q, setQ] = useState('');
  const { data, isPending, isError } = useQuery({ queryKey: ['my-requests'], queryFn: () => api<Summary[]>('service-requests') });

  const firstName = session?.user?.name?.split(' ')[0];
  const match = FILTERS.find((f) => f.id === filter)!.match;
  const list = (data ?? []).filter((r) => match(r) && `${r.title} ${r.city}`.toLowerCase().includes(q.trim().toLowerCase()));
  const toReview = data?.filter((r) => r.status === 'quoted') ?? [];
  const totalQuotes = data?.reduce((s, r) => s + r.quotesCount, 0) ?? 0;

  return (
    <>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Espace client</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Bonjour{firstName ? `, ${firstName}` : ''}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="lg" variant="destructive"><Link href="/client/demandes/urgence"><Siren /> Panne urgente</Link></Button>
          <Button asChild size="lg"><Link href="/client/demandes/nouvelle"><Plus /> Nouvelle demande</Link></Button>
        </div>
      </header>

      <TodoList requests={data} />

      <section aria-label="Indicateurs" className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={ClipboardList} label="Demandes" value={data?.length} />
        <Kpi icon={FileText} label="Devis reçus" value={data ? totalQuotes : undefined} />
        <Kpi icon={TrendingUp} label="À examiner" value={data ? toReview.length : undefined} accent={toReview.length > 0} />
        <Kpi icon={Snowflake} label="En cours" value={data?.filter(FILTERS[2].match).length} />
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_20rem]">
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm" aria-labelledby="requests-title">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
            <h2 id="requests-title" className="font-semibold">Mes demandes</h2>
            <label className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" aria-label="Rechercher une demande"
                className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
          </div>

          <div role="tablist" aria-label="Filtrer les demandes" className="flex gap-1 overflow-x-auto border-b px-3 py-2 [scrollbar-width:none]">
            {FILTERS.map((f) => (
              <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
                className={cn('shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors', filter === f.id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {f.label}
              </button>
            ))}
          </div>

          {isPending && <div className="grid gap-px p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="my-1 h-14" />)}</div>}
          {isError && <p role="alert" className="p-5 text-destructive">Impossible de charger vos demandes.</p>}

          {data && list.length === 0 && (
            <div className="p-12 text-center">
              <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent text-accent-foreground"><ClipboardList className="size-6" /></span>
              <p className="mt-4 font-medium">{data.length === 0 ? 'Aucune demande pour le moment' : 'Aucun résultat'}</p>
              {data.length === 0 && (
                <>
                  <p className="mt-1 text-sm text-muted-foreground">Décrivez votre besoin en 2 minutes, les pros près de chez vous vous répondent.</p>
                  <Button asChild className="mt-4"><Link href="/client/demandes/nouvelle"><Plus /> Déposer une demande</Link></Button>
                </>
              )}
            </div>
          )}

          {list.length > 0 && (
            <>
              <div className="hidden grid-cols-[1fr_8rem_7rem_6rem_1.5rem] gap-4 border-b bg-secondary/50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                <span>Demande</span><span>Statut</span><span>Date</span><span className="text-right">Devis</span><span />
              </div>
              <ul className="divide-y">
                {list.map((r) => (
                  <li key={r.id}>
                    <Link href={`/client/demandes/${r.id}`} className="group grid items-center gap-x-4 gap-y-1 px-5 py-4 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[1fr_8rem_7rem_6rem_1.5rem]">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.title}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="size-3.5" />{r.city}</p>
                      </div>
                      <div><RequestStatusBadge status={r.status} /></div>
                      <p className="text-sm text-muted-foreground">{dateFr(r.createdAt)}</p>
                      <p className={cn('text-sm md:text-right', r.quotesCount > 0 ? 'font-semibold text-primary' : 'text-muted-foreground')}>{r.quotesCount} devis</p>
                      <ChevronRight className="hidden size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary md:block" />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <aside className="grid gap-4">
          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <h2 className="font-semibold">Comment ça se passe</h2>
            <ol className="mt-3 space-y-3 text-sm text-muted-foreground">
              <li className="flex gap-3"><b className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs text-accent-foreground">1</b>Les pros de votre zone reçoivent votre demande.</li>
              <li className="flex gap-3"><b className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs text-accent-foreground">2</b>Vous comparez les devis et échangez par messagerie.</li>
              <li className="flex gap-3"><b className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs text-accent-foreground">3</b>Vous signez, payez l&apos;acompte, puis validez les travaux.</li>
            </ol>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border bg-card p-5 shadow-sm">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><LifeBuoy className="size-4" /></span>
            <div><p className="font-semibold">Besoin d&apos;aide ?</p><p className="mt-1 text-sm text-muted-foreground">Écrivez-nous depuis la messagerie, nous répondons sous 24 h.</p></div>
          </div>
        </aside>
      </div>
    </>
  );
}

function Kpi({ icon: Icon, label, value, accent }: { icon: typeof FileText; label: string; value: number | undefined; accent?: boolean }) {
  return (
    <div className={cn('rounded-2xl border bg-card p-5 shadow-sm', accent && 'border-primary/40')}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className={cn('grid size-9 place-items-center rounded-lg', accent ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground')}><Icon className="size-[18px]" /></span>
      </div>
      {value === undefined ? <Skeleton className="mt-3 h-8 w-12" /> : <p className="mt-3 text-3xl font-bold leading-none tracking-tight">{value}</p>}
    </div>
  );
}
