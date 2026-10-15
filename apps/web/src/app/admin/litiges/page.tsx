'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import { EmptyState, ErrorNote, ListSkeleton, PageHeader } from '@/components/admin/admin-ui';
import { ReasonAction } from '@/components/admin/reason-action';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { ago, dateFr, eur, PAYMENT_STATUS } from '@/lib/format';

interface Dispute {
  id: string; title: string; provider: string; client: string; totalCents: number; workDoneAt: string | null; createdAt: string; disputedAt: string | null; reason: string | null; byClient: boolean | null;
  payments: { id: string; kind: string; status: string; amountCents: number }[];
}

export default function AdminDisputesPage() {
  const qc = useQueryClient();
  const { data, isPending, isError, refetch } = useQuery({ queryKey: ['admin-disputes'], queryFn: () => api<Dispute[]>('admin/disputes') });
  // la fiche disparaît de la liste ET le compteur de la navigation doit suivre
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['admin-disputes'] }), qc.invalidateQueries({ queryKey: ['admin-stats'] })]);
  const resolve = (id: string, resolution: 'complete' | 'cancel', note: string) =>
    api(`admin/disputes/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolution, note }) }).then(refresh);

  return (
    <>
      <PageHeader title="Litiges" description="Un contrat arrive ici si le solde n'est pas réglé 7 jours après la fin de l'intervention, ou en cas de contestation. Les plus anciens sont en tête." />
      {isPending && <ListSkeleton rows={2} className="h-48" />}
      {isError && <ErrorNote onRetry={() => void refetch()}>Impossible de charger les litiges.</ErrorNote>}
      {data?.length === 0 && <EmptyState icon={Scale} title="Aucun litige ouvert">Les contrats contestés ou impayés apparaîtront ici.</EmptyState>}
      <ul className="grid gap-3">
        {data?.map((d) => (
          <li key={d.id}>
            <Card className="grid gap-3 p-4">
              <div>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-semibold">{d.title} · <span className="tabular-nums">{eur(d.totalCents)}</span> TTC</p>
                  <Badge variant="destructive">Ouvert {ago(d.disputedAt ?? d.createdAt)}</Badge>
                </div>
                {d.reason && <p className="mt-2 rounded-lg bg-secondary p-3 text-sm"><b>{d.byClient ? 'Le client' : 'Le prestataire'} signale :</b> {d.reason}</p>}
                <p className="mt-2 text-sm text-muted-foreground">Client {d.client} · Prestataire {d.provider} · {d.workDoneAt ? `travaux déclarés terminés le ${dateFr(d.workDoneAt)}` : 'travaux jamais déclarés terminés'}</p>
              </div>
              <ul className="grid gap-2 text-sm">
                {d.payments.map((p) => {
                  const s = PAYMENT_STATUS[p.status] ?? { label: p.status, variant: 'secondary' as const };
                  return (
                    <li key={p.id} className="grid gap-2">
                      <div className="flex justify-between gap-2"><span>{p.kind === 'deposit' ? 'Acompte' : 'Solde'} · <span className="tabular-nums">{eur(p.amountCents)}</span></span><Badge variant={s.variant}>{s.label}</Badge></div>
                      {/* remboursement total, possible tant que les fonds n'ont pas été versés au prestataire */}
                      {['held', 'partially_refunded'].includes(p.status) && (
                        <ReasonAction label="Rembourser le client" variant="destructive" confirmLabel="Confirmer le remboursement" onSubmit={(reason) => api(`payments/${p.id}/refund`, { method: 'POST', body: JSON.stringify({ reason }) }).then(refresh)} />
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-start gap-2 border-t pt-3">
                {d.workDoneAt && <ReasonAction label="Travail effectué : verser les fonds" confirmLabel="Valider et verser" onSubmit={(note) => resolve(d.id, 'complete', note)} />}
                <ReasonAction label="Annuler le contrat" variant="destructive" confirmLabel="Confirmer l'annulation" onSubmit={(note) => resolve(d.id, 'cancel', note)} />
              </div>
              <p className="text-xs text-muted-foreground">Avant d&apos;annuler, remboursez les paiements conservés ci-dessus (tant que rien n&apos;est versé) : une fois le contrat annulé, il quitte cette liste et le remboursement n&apos;y est plus accessible.</p>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
