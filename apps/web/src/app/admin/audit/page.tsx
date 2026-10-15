'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Download, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorNote, ListSkeleton, PageHeader } from '@/components/admin/admin-ui';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form-controls';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { AUDIT_ACTION as ACTION, AUDIT_ENTITY as ENTITY, dateTimeFr } from '@/lib/format';

interface Entry { id: number; action: string; entityType: string; entityId: string | null; diff: Record<string, unknown> | null; ip: string | null; createdAt: string; actor: string | null }
const PAGE = 50;
const val = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));

export default function AdminAuditPage() {
  const [entityType, setEntityType] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['admin-audit', entityType],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api<Entry[]>(`admin/audit?limit=${PAGE}${entityType ? `&entityType=${entityType}` : ''}${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].id : undefined),
  });
  const rows = q.data?.pages.flat() ?? [];

  return (
    <>
      <PageHeader title="Journal d'audit" description="Toute action d'administration est enregistrée ici. Les lignes ne peuvent être ni modifiées ni supprimées.">
        {rows.length > 0 && (
          <Button variant="outline" onClick={() => downloadCsv('audit.csv', ['Date', 'Administrateur', 'IP', 'Action', 'Objet', 'Identifiant', 'Détail'], rows.map((r) => [r.createdAt, r.actor, r.ip, ACTION[r.action] ?? r.action, ENTITY[r.entityType] ?? r.entityType, r.entityId, r.diff ? JSON.stringify(r.diff) : null]))}>
            <Download />Exporter (CSV)
          </Button>
        )}
      </PageHeader>
      <Select aria-label="Type d'objet" className="mb-4 max-w-56" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
        <option value="">Tous les objets</option>
        {Object.entries(ENTITY).map(([t, l]) => <option key={t} value={t}>{l}</option>)}
      </Select>

      {q.isPending && <ListSkeleton rows={5} className="h-12" />}
      {q.isError && <ErrorNote onRetry={() => void q.refetch()}>Impossible de charger le journal.</ErrorNote>}
      {q.isSuccess && rows.length === 0 && <EmptyState icon={ScrollText} title="Aucune entrée">Les actions des administrateurs apparaîtront ici.</EmptyState>}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted text-left text-muted-foreground"><tr><th className="p-2 font-medium">Date</th><th className="p-2 font-medium">Administrateur</th><th className="p-2 font-medium">Action</th><th className="p-2 font-medium">Détail</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="whitespace-nowrap p-2 tabular-nums">{dateTimeFr(r.createdAt)}</td>
                  <td className="p-2">{r.actor ?? '—'}<span className="block text-xs text-muted-foreground">{r.ip}</span></td>
                  <td className="p-2"><b>{ACTION[r.action] ?? r.action}</b><span className="block break-all text-xs text-muted-foreground">{ENTITY[r.entityType] ?? r.entityType} {r.entityId}</span></td>
                  <td className="max-w-xs break-words p-2 text-xs text-muted-foreground">{r.diff ? Object.entries(r.diff).map(([k, v]) => `${k}: ${val(v)}`).join(' · ') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.hasNextPage && <Button variant="outline" className="mt-4" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Entrées plus anciennes</Button>}
    </>
  );
}
