'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { apiMessage, EmptyState, ErrorNote, ListSkeleton, PageHeader } from '@/components/admin/admin-ui';
import { ReasonAction } from '@/components/admin/reason-action';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { dateTimeFr } from '@/lib/format';

interface UserRow { id: string; email: string; firstName: string; lastName: string; role: string; status: string; createdAt: string; lastLoginAt: string | null }
const ROLE: Record<string, string> = { client: 'Client', provider: 'Prestataire', super_admin: 'Administrateur' };
const STATUS: Record<string, { label: string; variant: 'success' | 'destructive' | 'warning' }> = { active: { label: 'Actif', variant: 'success' }, suspended: { label: 'Suspendu', variant: 'destructive' }, pending: { label: 'En attente', variant: 'warning' } };
const STEP = 30;

export default function AdminUsersPage() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState({ q: '', role: '', status: '' });
  const [f, setF] = useState(draft);
  const [limit, setLimit] = useState(STEP);
  const qs = new URLSearchParams({ limit: String(limit), ...(f.q && { q: f.q }), ...(f.role && { role: f.role }), ...(f.status && { status: f.status }) });
  const { data, isPending, isError, isPlaceholderData, refetch } = useQuery({ queryKey: ['admin-users', qs.toString()], queryFn: () => api<UserRow[]>(`admin/users?${qs}`), placeholderData: (prev) => prev });
  const act = (id: string, path: 'suspend' | 'reactivate', body: unknown) => api(`admin/users/${id}/${path}`, { method: 'POST', body: JSON.stringify(body) }).then(() => qc.invalidateQueries({ queryKey: ['admin-users'] }));
  const reactivate = useMutation({ mutationFn: (id: string) => act(id, 'reactivate', {}) });
  const filtered = !!(f.q || f.role || f.status);

  return (
    <>
      <PageHeader title="Utilisateurs" description="Clients, prestataires et administrateurs. Ouvrez une fiche pour voir l'activité et l'historique des actions.">
        {!!data?.length && (
          <Button variant="outline" onClick={() => downloadCsv('utilisateurs.csv', ['Email', 'Prénom', 'Nom', 'Rôle', 'Statut', 'Inscrit le', 'Dernière connexion'], data.map((u) => [u.email, u.firstName, u.lastName, ROLE[u.role], STATUS[u.status]?.label ?? u.status, u.createdAt, u.lastLoginAt]))}>
            <Download />Exporter (CSV)
          </Button>
        )}
      </PageHeader>

      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_10rem_10rem_auto]" onSubmit={(e) => { e.preventDefault(); setF(draft); setLimit(STEP); }}>
        <Input type="search" aria-label="Recherche" placeholder="Rechercher par e-mail ou nom" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
        <Select aria-label="Rôle" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}><option value="">Tous les rôles</option><option value="client">Clients</option><option value="provider">Prestataires</option><option value="super_admin">Administrateurs</option></Select>
        <Select aria-label="Statut" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}><option value="">Tous les statuts</option><option value="active">Actifs</option><option value="suspended">Suspendus</option></Select>
        <Button>Filtrer</Button>
      </form>

      {isError && <ErrorNote onRetry={() => void refetch()}>Impossible de charger les utilisateurs.</ErrorNote>}
      {reactivate.isError && <div className="mb-3"><ErrorNote>{apiMessage(reactivate.error)}</ErrorNote></div>}
      {isPending && !isError && <ListSkeleton rows={4} className="h-[4.5rem]" />}
      {data?.length === 0 && <EmptyState icon={SearchX} title="Aucun résultat">{filtered ? 'Aucun utilisateur ne correspond à ces filtres.' : 'Aucun utilisateur inscrit.'}</EmptyState>}
      <ul className={`grid gap-2 transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`}>
        {data?.map((u) => (
          <li key={u.id}>
            <Card className="grid gap-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium"><Link href={`/admin/utilisateurs/${u.id}`} className="hover:underline">{u.firstName} {u.lastName}</Link> <span className="font-normal text-muted-foreground">· {u.email}</span></p>
                  <p className="text-xs text-muted-foreground">Inscrit le {dateTimeFr(u.createdAt)}{u.lastLoginAt ? ` · dernière connexion le ${dateTimeFr(u.lastLoginAt)}` : ' · jamais connecté'}</p>
                </div>
                <div className="flex gap-1"><Badge variant="secondary">{ROLE[u.role] ?? u.role}</Badge><Badge variant={STATUS[u.status]?.variant ?? 'secondary'}>{STATUS[u.status]?.label ?? u.status}</Badge></div>
              </div>
              {u.role !== 'super_admin' && (u.status === 'suspended'
                ? <Button size="sm" variant="outline" className="justify-self-start" disabled={reactivate.isPending} onClick={() => reactivate.mutate(u.id)}>Réactiver</Button>
                : <ReasonAction label="Suspendre" variant="destructive" confirmLabel="Confirmer la suspension" onSubmit={(reason) => act(u.id, 'suspend', { reason })} />)}
            </Card>
          </li>
        ))}
      </ul>
      {data && data.length === limit && <Button variant="outline" className="mt-4" onClick={() => setLimit(limit + STEP)}>Afficher plus</Button>}
    </>
  );
}
