'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiMessage, ErrorNote, ListSkeleton, PageHeader } from '@/components/admin/admin-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { api } from '@/lib/api';
import { dateTimeFr } from '@/lib/format';

interface ProviderOpt { providerId: string; companyName: string; city: string }
interface Rule { id: string; providerId: string | null; provider: string | null; rateBps: number; validFrom: string; createdBy: string }

const MAX_PERCENT = 30; // plafond imposé par l'API (commissionSchema)
const fmt = (bps: number) => `${(bps / 100).toLocaleString('fr-FR')} %`;

export default function AdminCommissionsPage() {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ['admin-commissions'], queryFn: () => api<Rule[]>('admin/commissions') });
  const providers = useQuery({ queryKey: ['admin-providers', 'approved'], queryFn: () => api<ProviderOpt[]>('admin/providers?status=approved') });
  const [form, setForm] = useState({ providerId: '', percent: '10', reason: '' });
  const percent = Number(form.percent.replace(',', '.'));
  const percentOk = form.percent.trim() !== '' && Number.isFinite(percent) && percent >= 0 && percent <= MAX_PERCENT;
  const save = useMutation({
    mutationFn: () => api('admin/commissions', { method: 'POST', body: JSON.stringify({ ...(form.providerId && { providerId: form.providerId }), rateBps: Math.round(percent * 100), reason: form.reason }) }),
    onSuccess: () => { setForm((f) => ({ ...f, reason: '' })); void qc.invalidateQueries({ queryKey: ['admin-commissions'] }); },
  });
  const edit = (patch: Partial<typeof form>) => { save.reset(); setForm({ ...form, ...patch }); };

  // règle en vigueur par portée (barème par défaut ou prestataire) : l'API renvoie la plus récente d'abord ; une règle datée du futur est « programmée »
  const now = Date.now();
  const live = new Map<string | null, string>();
  for (const r of rules.data ?? []) if (new Date(r.validFrom).getTime() <= now && !live.has(r.providerId)) live.set(r.providerId, r.id);
  const current = rules.data?.find((r) => r.id === live.get(null));
  const overrides = live.size - (live.has(null) ? 1 : 0);

  return (
    <>
      <PageHeader title="Commissions" description={<>Taux appliqué au montant <b>HT</b> du contrat. Un changement ne concerne que les <b>nouveaux</b> contrats : le taux est figé au premier paiement de chaque contrat.</>} />

      <section className="mb-6 grid gap-3 sm:grid-cols-2" aria-label="Barème en vigueur">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Barème par défaut</p>
          <p className="text-2xl font-semibold tabular-nums">{rules.isPending ? '…' : current ? fmt(current.rateBps) : '10 %'}</p>
          <p className="text-xs text-muted-foreground">{current ? `depuis le ${dateTimeFr(current.validFrom)}` : 'valeur de l\'environnement (aucune règle enregistrée)'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Taux négociés</p>
          <p className="text-2xl font-semibold tabular-nums">{rules.isPending ? '…' : overrides}</p>
          <p className="text-xs text-muted-foreground">prestataire(s) avec un taux spécifique</p>
        </Card>
      </section>

      <Card className="mb-6 p-4">
        <h2 className="mb-3 font-semibold">Définir un taux</h2>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <Field label="Prestataire (vide = barème par défaut)">
              <Select value={form.providerId} onChange={(e) => edit({ providerId: e.target.value })}>
                <option value="">Barème par défaut</option>
                {providers.data?.map((p) => <option key={p.providerId} value={p.providerId}>{p.companyName} · {p.city}</option>)}
              </Select>
            </Field>
            <Field label="Taux (%)" error={form.percent && !percentOk ? `0 à ${MAX_PERCENT} %` : undefined}><Input inputMode="decimal" value={form.percent} aria-invalid={!percentOk} onChange={(e) => edit({ percent: e.target.value })} /></Field>
          </div>
          <Field label="Motif (enregistré dans le journal d'audit)"><Textarea rows={2} value={form.reason} onChange={(e) => edit({ reason: e.target.value })} maxLength={500} /></Field>
          {save.isError && <ErrorNote>{apiMessage(save.error, 'Taux ou motif invalide')}</ErrorNote>}
          {save.isSuccess && <p role="status" className="text-sm font-medium text-success">Taux enregistré : il s&apos;appliquera aux prochains contrats.</p>}
          <Button className="justify-self-start" disabled={save.isPending || !percentOk || form.reason.trim().length < 5}>Appliquer</Button>
        </form>
      </Card>

      <h2 className="mb-2 text-lg font-semibold">Historique</h2>
      {rules.isPending && <ListSkeleton rows={2} className="h-12" />}
      {rules.isError && <ErrorNote onRetry={() => void rules.refetch()}>Impossible de charger l&apos;historique.</ErrorNote>}
      <ul className="grid gap-2">
        {rules.data?.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <span className="flex flex-wrap items-center gap-2"><b className="tabular-nums">{fmt(r.rateBps)}</b> · {r.provider ?? 'barème par défaut'}
              {live.get(r.providerId) === r.id && <Badge variant="success">En vigueur</Badge>}
              {new Date(r.validFrom).getTime() > now && <Badge variant="warning">Programmé</Badge>}
            </span>
            <span className="text-muted-foreground">dès le {dateTimeFr(r.validFrom)} · {r.createdBy}</span>
          </li>
        ))}
        {rules.data?.length === 0 && <li className="text-sm text-muted-foreground">Aucune règle enregistrée : le barème par défaut de l&apos;environnement s&apos;applique (10 %).</li>}
      </ul>
    </>
  );
}
