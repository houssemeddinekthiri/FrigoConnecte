'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, FileText, Inbox, Landmark, Trophy, UserCog, Zap } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import type { ConnectStatus, QuoteDto } from '@frigoconnect/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface InboxItem { requestId: string; requestStatus: string; quote: { id: string; status: string } | null }

const eur = (cents: number) => (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export default function ProviderHome() {
  const { data: session } = useSession();
  // lit l'état RÉEL chez Stripe (aussi au retour de l'onboarding, avant même l'arrivée du webhook)
  const status = useQuery({ queryKey: ['connect-status'], queryFn: () => api<ConnectStatus>('payments/connect/status') });
  const inbox = useQuery({ queryKey: ['inbox'], queryFn: () => api<InboxItem[]>('provider/requests') });
  const quotes = useQuery({ queryKey: ['my-quotes'], queryFn: () => api<QuoteDto[]>('quotes/mine') });
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['provider-me'], queryFn: () => api<{ status: string | null; availableUntil?: string | null }>('providers/me') });
  const availability = useMutation({
    mutationFn: (availableNow: boolean) => api('providers/me/availability', { method: 'PUT', body: JSON.stringify({ availableNow }) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['provider-me'] }),
  });
  const availableUntil = me.data?.availableUntil;
  const start = useMutation({
    mutationFn: () => api<{ url: string }>('payments/connect/onboarding', { method: 'POST' }),
    onSuccess: ({ url }) => { window.location.href = url; },
  });

  const firstName = session?.user?.name?.split(' ')[0];
  const toQuote = inbox.data?.filter((r) => !r.quote && ['open', 'quoted'].includes(r.requestStatus)).length;
  const sent = quotes.data?.filter((q) => q.status === 'sent').length;
  const accepted = quotes.data?.filter((q) => q.status === 'accepted');
  const revenue = accepted?.reduce((sum, q) => sum + q.totalCents, 0);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Bonjour{firstName ? ` ${firstName}` : ''} 👋</h1>
        <p className="mt-1 text-muted-foreground">Voici l&apos;activité de votre entreprise.</p>
      </div>

      {me.data?.status === 'approved' && (
        <section className={cn('mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-5', availableUntil && 'border-success/40 bg-success/5')}>
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 font-semibold"><Zap className="size-5 text-primary" /> Disponible maintenant</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {availableUntil
                ? `Les clients voient que vous pouvez intervenir tout de suite, jusqu'à ${new Date(availableUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}. Vous remontez dans les résultats et pour les nouvelles demandes.`
                : 'Activez-le quand vous pouvez intervenir tout de suite : vous remontez dans les résultats pendant 4 h, puis le statut se désactive tout seul.'}
            </p>
            {availability.isError && <p role="alert" className="mt-1 text-sm text-destructive">Action impossible, réessayez.</p>}
          </div>
          <Button variant={availableUntil ? 'outline' : 'default'} disabled={availability.isPending} onClick={() => availability.mutate(!availableUntil)}>{availableUntil ? 'Désactiver' : 'Je suis disponible'}</Button>
        </section>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat href="/prestataire/demandes" icon={Inbox} label="Demandes à traiter" value={toQuote} highlight={!!toQuote} />
        <Stat href="/prestataire/devis" icon={FileText} label="Devis en attente" value={sent} />
        <Stat href="/prestataire/contrats" icon={Trophy} label="Devis acceptés" value={accepted?.length} />
        <Stat href="/prestataire/contrats" icon={Landmark} label="Chiffre d'affaires TTC" value={revenue === undefined ? undefined : eur(revenue)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold"><Landmark className="size-5 text-primary" /> Compte de paiement</h2>
            {status.data && <Badge variant={status.data.ready ? 'success' : 'warning'}>{status.data.ready ? 'Prêt à être payé' : status.data.hasAccount ? 'Informations à compléter' : 'Non configuré'}</Badge>}
          </div>
          {status.data?.ready ? (
            <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> Vos paiements sont versés sur votre compte bancaire après validation de chaque intervention (10 % de commission sur le montant HT).</p>
          ) : (
            <>
              <p className="mt-3 text-sm text-muted-foreground">Pour envoyer des devis et être payé, vérifiez votre identité et renseignez votre IBAN auprès de Stripe, notre partenaire de paiement (5 minutes).</p>
              {start.isError && <p role="alert" className="mt-2 text-sm text-destructive">Impossible d&apos;ouvrir Stripe, réessayez.</p>}
              <Button className="mt-4" disabled={start.isPending || status.isPending} onClick={() => start.mutate()}>
                {status.data?.hasAccount ? 'Reprendre la configuration' : 'Configurer mes paiements'} <ArrowRight />
              </Button>
            </>
          )}
        </section>

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="font-semibold">Raccourcis</h2>
          <ul className="mt-3 grid gap-1">
            {[
              { href: '/prestataire/demandes', icon: Inbox, label: 'Voir les demandes reçues' },
              { href: '/prestataire/devis/nouveau', icon: FileText, label: 'Créer un devis' },
              { href: '/prestataire/profil', icon: UserCog, label: 'Compléter mon profil' },
            ].map(({ href, icon: Icon, label }) => (
              <li key={href}>
                <Link href={href} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-accent">
                  <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-foreground"><Icon className="size-4" /></span>
                  <span className="flex-1">{label}</span>
                  <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function Stat({ href, icon: Icon, label, value, highlight }: { href: string; icon: typeof Inbox; label: string; value: number | string | undefined; highlight?: boolean }) {
  return (
    <Link href={href} className={cn('rounded-2xl border bg-card p-4 transition hover:-translate-y-0.5 hover:border-primary hover:shadow-md', highlight && 'border-primary/40 bg-accent/50')}>
      <span className={cn('grid size-10 place-items-center rounded-xl', highlight ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground')}><Icon className="size-5" /></span>
      {value === undefined ? <Skeleton className="mt-3 h-7 w-16" /> : <p className="mt-3 text-2xl font-bold leading-none">{value}</p>}
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </Link>
  );
}
