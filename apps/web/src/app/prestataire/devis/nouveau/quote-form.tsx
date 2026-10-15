'use client';

import { useMutation } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { computeTotals, depositCents, quoteContentSchema } from '@frigoconnect/contracts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { ApiError, api } from '@/lib/api';
import { eur } from '@/lib/format';

interface FormValues {
  items: { label: string; quantity: number; unit: string; unitPriceEuros: number; vatRateBps: string }[];
  depositPercent: number;
  validUntil: string;
  estimatedStart: string;
  estimatedDurationHours: number | '';
  notes: string;
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const VAT = [['2000', '20 %'], ['1000', '10 %'], ['550', '5,5 %'], ['0', '0 %']];

export function QuoteForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, control, handleSubmit } = useForm<FormValues>({
    defaultValues: { items: [{ label: '', quantity: 1, unit: 'u', unitPriceEuros: 0, vatRateBps: '2000' }], depositPercent: 30, validUntil: inDays(30), estimatedStart: '', estimatedDurationHours: '', notes: '' },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  // Aperçu en direct : MÊME fonction que le serveur (packages/contracts). Le serveur recalcule de toute façon.
  const watched = useWatch({ control });
  const toCents = (e: number) => Math.round((Number(e) || 0) * 100);
  const preview = computeTotals((watched.items ?? []).map((i) => ({ quantity: Number(i?.quantity) || 0, unitPriceCents: toCents(i?.unitPriceEuros ?? 0), vatRateBps: Number(i?.vatRateBps) || 0 })));
  const deposit = depositCents(preview.totalCents, Number(watched.depositPercent) || 0);

  const save = useMutation({
    mutationFn: async ({ v, send }: { v: FormValues; send: boolean }) => {
      const parsed = quoteContentSchema.safeParse({
        items: v.items.map((i) => ({ label: i.label, quantity: Number(i.quantity), unit: i.unit || 'u', unitPriceCents: toCents(i.unitPriceEuros), vatRateBps: Number(i.vatRateBps) })),
        depositPercent: Number(v.depositPercent), validUntil: v.validUntil,
        estimatedStart: v.estimatedStart || undefined, estimatedDurationHours: v.estimatedDurationHours === '' ? undefined : Number(v.estimatedDurationHours), notes: v.notes || undefined,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const { id } = await api<{ id: string }>('quotes', { method: 'POST', body: JSON.stringify({ requestId, ...parsed.data }) });
      if (send) await api(`quotes/${id}/send`, { method: 'POST' });
    },
    onSuccess: () => router.push('/prestataire/devis'),
    onError: (e) => setError(e instanceof ApiError ? ((e.body as { message?: string })?.message ?? 'Envoi impossible') : (e as Error).message),
  });
  const submit = (send: boolean) => handleSubmit((v) => { setError(null); save.mutate({ v, send }); });

  return (
    <form className="grid gap-4" onSubmit={submit(true)} noValidate>
      <div className="grid gap-3">
        {fields.map((f, i) => (
          <Card key={f.id} className="grid gap-3 p-3 sm:grid-cols-[1fr_5rem_5rem_7rem_6rem_auto] sm:items-end">
            <Field label="Désignation"><Input {...register(`items.${i}.label`)} /></Field>
            <Field label="Qté"><Input type="number" step="0.01" min="0" inputMode="decimal" {...register(`items.${i}.quantity`)} /></Field>
            <Field label="Unité"><Input {...register(`items.${i}.unit`)} maxLength={10} /></Field>
            <Field label="PU HT (€)"><Input type="number" step="0.01" min="0" inputMode="decimal" {...register(`items.${i}.unitPriceEuros`)} /></Field>
            <Field label="TVA"><Select {...register(`items.${i}.vatRateBps`)}>{VAT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            <Button type="button" variant="ghost" size="icon" aria-label="Supprimer la ligne" disabled={fields.length === 1} onClick={() => remove(i)}><Trash2 /></Button>
          </Card>
        ))}
        <Button type="button" variant="outline" className="justify-self-start" onClick={() => append({ label: '', quantity: 1, unit: 'u', unitPriceEuros: 0, vatRateBps: '2000' })}><Plus />Ajouter une ligne</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Valable jusqu'au"><Input type="date" {...register('validUntil')} min={inDays(0)} /></Field>
        <Field label="Début estimé (optionnel)"><Input type="date" {...register('estimatedStart')} /></Field>
        <Field label="Durée estimée en h (optionnel)"><Input type="number" step="0.5" min="0" inputMode="decimal" {...register('estimatedDurationHours')} /></Field>
      </div>
      <Field label="Acompte à la signature (%)" hint="Versé par le client à l'acceptation"><Input type="number" min="0" max="100" inputMode="numeric" {...register('depositPercent')} /></Field>
      <Field label="Remarques (optionnel)"><Textarea {...register('notes')} maxLength={2000} /></Field>

      <Card className="grid gap-1 p-4 text-sm" aria-live="polite">
        <p className="flex justify-between"><span>Total HT</span><span>{eur(preview.subtotalCents)}</span></p>
        {preview.vatByRate.map((v) => <p key={v.rateBps} className="flex justify-between text-muted-foreground"><span>TVA {(v.rateBps / 100).toString().replace('.', ',')} %</span><span>{eur(v.vatCents)}</span></p>)}
        <p className="flex justify-between text-base font-semibold"><span>Total TTC</span><span>{eur(preview.totalCents)}</span></p>
        <p className="flex justify-between text-muted-foreground"><span>Acompte</span><span>{eur(deposit)}</span></p>
      </Card>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="lg" disabled={save.isPending}>{save.isPending ? 'Envoi…' : 'Envoyer au client'}</Button>
        <Button type="button" size="lg" variant="outline" disabled={save.isPending} onClick={submit(false)}>Enregistrer le brouillon</Button>
      </div>
      <p className="text-xs text-muted-foreground">En envoyant, vous vous engagez sur ce devis jusqu&apos;à sa date de validité. Il ne pourra plus être modifié, seulement retiré.</p>
    </form>
  );
}
