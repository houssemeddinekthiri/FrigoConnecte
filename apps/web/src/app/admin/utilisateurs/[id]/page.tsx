'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiMessage, ErrorNote, ListSkeleton } from '@/components/admin/admin-ui';
import { ReasonAction } from '@/components/admin/reason-action';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { AUDIT_ACTION, CONTRACT_STATUS, dateTimeFr, eur } from '@/lib/format';

interface Detail {
  id: string; email: string; firstName: string; lastName: string; role: string; status: string; createdAt: string; lastLoginAt: string | null;
  stats: { requests: number; contracts: number; paidCents: number; reviews: number };
  contracts: { id: string; title: string; status: string; totalCents: number; createdAt: string }[];
  audit: { id: number; action: string; diff: { reason?: string } | null; createdAt: string; actor: string | null }[];
}
const ROLE: Record<string, string> = { client: 'Client', provider: 'Prestataire', super_admin: 'Administrateur' };

export default function AdminUserPage() {
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const { data: u, isPending, isError } = useQuery({ queryKey: ['admin-user', id], queryFn: () => api<Detail>(`admin/users/${id}`) });
  const act = (path: 'suspend' | 'reactivate', body: unknown) => api(`admin/users/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) }).then(() => qc.invalidateQueries({ queryKey: ['admin-user', id] }));
  const reactivate = useMutation({ mutationFn: () => act('reactivate', {}) });
  const back = <Link href="/admin/utilisateurs" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"><ArrowLeft className="size-4" aria-hidden />Utilisateurs</Link>;

  if (isError) return <>{back}<ErrorNote>Utilisateur introuvable.</ErrorNote></>;
  if (isPending) return <>{back}<ListSkeleton rows={3} className="h-24" /></>;

  return (
    <>
      {back}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{u.firstName} {u.lastName}</h1>
        <Badge variant="secondary">{ROLE[u.role] ?? u.role}</Badge>
        <Badge variant={u.status === 'active' ? 'success' : 'destructive'}>{u.status === 'active' ? 'Actif' : 'Suspendu'}</Badge>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">{u.email} · inscrit le {dateTimeFr(u.createdAt)}{u.lastLoginAt ? ` · dernière connexion le ${dateTimeFr(u.lastLoginAt)}` : ' · jamais connecté'}</p>

      {u.role !== 'super_admin' && (
        <div className="mb-6">
          {u.status === 'suspended'
            ? <Button variant="outline" disabled={reactivate.isPending} onClick={() => reactivate.mutate()}>Réactiver le compte</Button>
            : <ReasonAction label="Suspendre le compte" variant="destructive" confirmLabel="Confirmer la suspension" onSubmit={(reason) => act('suspend', { reason })} />}
          {reactivate.isError && <div className="mt-2"><ErrorNote>{apiMessage(reactivate.error)}</ErrorNote></div>}
        </div>
      )}

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Activité">
        {[['Demandes', String(u.stats.requests)], ['Contrats', String(u.stats.contracts)], ['Payé', eur(u.stats.paidCents)], ['Avis reçus', String(u.stats.reviews)]].map(([l, v]) => (
          <Card key={l} className="p-4"><p className="text-sm text-muted-foreground">{l}</p><p className="text-2xl font-semibold tabular-nums">{v}</p></Card>
        ))}
      </section>

      <h2 className="mb-2 text-lg font-semibold">Derniers contrats</h2>
      <ul className="mb-6 grid gap-2">
        {u.contracts.map((c) => {
          const s = CONTRACT_STATUS[c.status] ?? { label: c.status, variant: 'secondary' as const };
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
              <span>{c.title} · <span className="tabular-nums">{eur(c.totalCents)}</span> TTC</span>
              <span className="flex items-center gap-2 text-muted-foreground"><Badge variant={s.variant}>{s.label}</Badge>{dateTimeFr(c.createdAt)}</span>
            </li>
          );
        })}
        {u.contracts.length === 0 && <li className="text-sm text-muted-foreground">Aucun contrat.</li>}
      </ul>

      <h2 className="mb-2 text-lg font-semibold">Actions d&apos;administration</h2>
      <ul className="grid gap-2">
        {u.audit.map((a) => <li key={a.id} className="rounded-lg border p-3 text-sm"><b>{AUDIT_ACTION[a.action] ?? a.action}</b> par {a.actor ?? '—'} · {dateTimeFr(a.createdAt)}{a.diff?.reason && <span className="block text-muted-foreground">Motif : {a.diff.reason}</span>}</li>)}
        {u.audit.length === 0 && <li className="text-sm text-muted-foreground">Aucune action.</li>}
      </ul>
    </>
  );
}
