'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Trash2, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { TRADES, type EquipmentDto } from '@frigoconnect/contracts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { geocode } from '@/lib/geocode';
import { dateFr, maintenanceDue, TRADE_LABELS } from '@/lib/format';
import { Badge } from '@/components/ui/badge';

export function Equipment() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['equipment'], queryFn: () => api<EquipmentDto[]>('client-equipment') });
  const [form, setForm] = useState({ label: '', trade: 'refrigeration', details: '', where: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const add = useMutation({
    mutationFn: async () => {
      const place = await geocode(form.where);
      return api('client-equipment', { method: 'POST', body: JSON.stringify({ label: form.label, trade: form.trade, details: form.details || undefined, ...place }) });
    },
    onSuccess: () => { setForm({ label: '', trade: 'refrigeration', details: '', where: '' }); void qc.invalidateQueries({ queryKey: ['equipment'] }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`client-equipment/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['equipment'] }),
  });
  const notFound = add.error instanceof Error && add.error.message === 'ADDRESS_NOT_FOUND';

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
      <section>
        {list.isPending && <Skeleton className="h-28" />}
        {list.data?.length === 0 && <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">Aucun équipement pour l&apos;instant. Ajoutez le premier avec le formulaire.</p>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.data?.map((q) => (
            <li key={q.id}>
              <Card className="grid gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold"><Wrench className="size-4 text-primary" />{q.label}</div>
                  <Button size="icon" variant="ghost" aria-label={`Supprimer ${q.label}`} onClick={() => window.confirm('Supprimer cet équipement ?') && remove.mutate(q.id)}><Trash2 /></Button>
                </div>
                <p className="text-sm text-muted-foreground">{TRADE_LABELS[q.trade]}{q.details && ` · ${q.details}`}</p>
                <p className="flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="size-4" />{q.address}, {q.postalCode} {q.city}</p>
                <MaintenanceLine e={q} />
                <div className="mt-1 flex flex-wrap gap-2">
                  {maintenanceDue(q).due && <Button asChild size="sm"><Link href={`/client/demandes/nouvelle?equipment=${q.id}&service=maintenance`}>Planifier l&apos;entretien</Link></Button>}
                  <Button asChild size="sm" variant="outline"><Link href={`/client/demandes/nouvelle?equipment=${q.id}`}>Demander une intervention</Link></Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <form className="grid gap-4 rounded-2xl border bg-card p-5 shadow-sm" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <h2 className="font-semibold">Ajouter un équipement</h2>
        <Field label="Nom"><Input required minLength={2} value={form.label} onChange={set('label')} placeholder="Chambre froide cuisine" /></Field>
        <Field label="Domaine"><Select value={form.trade} onChange={set('trade')}>{TRADES.map((t) => <option key={t} value={t}>{TRADE_LABELS[t]}</option>)}</Select></Field>
        <Field label="Marque, modèle… (optionnel)"><Input value={form.details} onChange={set('details')} /></Field>
        <Field label="Adresse complète" error={notFound ? 'Adresse introuvable, vérifiez-la' : undefined}><Input required value={form.where} onChange={set('where')} placeholder="1 place Bellecour, 69002 Lyon" autoComplete="street-address" /></Field>
        {add.isError && !notFound && <p role="alert" className="text-sm text-destructive">Ajout impossible, réessayez.</p>}
        <Button disabled={add.isPending}><Plus /> {add.isPending ? 'Ajout…' : 'Ajouter'}</Button>
      </form>
    </div>
  );
}

function MaintenanceLine({ e }: { e: EquipmentDto }) {
  const m = maintenanceDue(e);
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      {e.lastServiceAt ? `Dernier entretien : ${dateFr(e.lastServiceAt)}` : 'Aucun entretien enregistré'}
      {m.due && <Badge variant="warning">Entretien à prévoir</Badge>}
    </p>
  );
}
