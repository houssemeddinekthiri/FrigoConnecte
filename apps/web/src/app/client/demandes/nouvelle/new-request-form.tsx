'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { PhotoPicker, type Uploaded } from '@/components/photo-picker';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { createServiceRequestSchema, type CreateServiceRequestInput, type EquipmentDto } from '@frigoconnect/contracts';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { api } from '@/lib/api';
import { estimateText, useEstimate } from '@/lib/estimate';

// `location` est calculée à l'envoi (géocodage), pas saisie par l'utilisateur
const formSchema = createServiceRequestSchema.innerType().innerType().omit({ location: true });
type FormValues = z.input<typeof formSchema>;

const LABELS = {
  service: { breakdown: 'Dépannage', maintenance: 'Maintenance', installation: 'Installation', audit: 'Audit', compliance: 'Mise en conformité', annual_contract: 'Contrat annuel' },
  trade: { refrigeration: 'Froid commercial', heating: 'Chauffage', air_conditioning: 'Climatisation', ventilation: 'Ventilation', heat_pump: 'Pompe à chaleur', maintenance_company: 'Maintenance multi-techniques' },
  urgency: { low: 'Pas pressé', normal: 'Sous quelques jours', high: 'Sous 24 h', emergency: 'Urgence (panne bloquante)' },
} as const;

const options = (m: Record<string, string>) => Object.entries(m).map(([k, l]) => <option key={k} value={k}>{l}</option>);

/** API Adresse (data.gouv.fr) : gratuite, sans clé, adresses françaises. */
async function geocode(address: string, postalCode: string, city: string) {
  const q = encodeURIComponent(`${address} ${postalCode} ${city}`);
  const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${q}&limit=1`);
  const [lng, lat] = (await res.json()).features?.[0]?.geometry?.coordinates ?? [];
  if (lat === undefined) throw new Error('ADDRESS_NOT_FOUND');
  return { lat: lat as number, lng: lng as number };
}

/** Sans `edit` : création. Avec `edit` : modification d'un brouillon ou d'une demande publiée sans devis. */
export function NewRequestForm({ edit, prefill }: { edit?: { id: string; status: string; values: FormValues }; prefill?: Partial<FormValues> }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { register, handleSubmit, setError, setValue, watch, formState: { errors } } = useForm<FormValues, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: edit?.values ?? { urgency: 'normal', serviceType: 'breakdown', trade: 'refrigeration', ...prefill },
  });
  const equipment = useQuery({ queryKey: ['equipment'], queryFn: () => api<EquipmentDto[]>('client-equipment'), enabled: !edit });
  const fillFrom = (id: string) => {
    const q = equipment.data?.find((x) => x.id === id);
    if (!q) return;
    setValue('equipmentId', q.id); setValue('trade', q.trade); setValue('equipment', q.details ?? q.label); setValue('address', q.address); setValue('postalCode', q.postalCode); setValue('city', q.city);
  };
  const [photos, setPhotos] = useState<Uploaded[]>([]);
  const [budget, setBudget] = useState(edit?.values.budgetMaxCents ? String(edit.values.budgetMaxCents / 100) : '');
  const estimate = useEstimate(watch('serviceType'), watch('trade'));
  const intent = useRef<'publish' | 'draft'>('publish');

  const create = useMutation({
    mutationFn: async (v: z.output<typeof formSchema>) => {
      const asDraft = intent.current === 'draft';
      const body: CreateServiceRequestInput = { ...v, attachmentIds: photos.map((p) => p.id), budgetMaxCents: Number(budget.replace(',', '.')) > 0 ? Math.round(Number(budget.replace(',', '.')) * 100) : edit ? null : undefined, draft: asDraft, location: await geocode(v.address, v.postalCode, v.city) };
      if (!edit) return api('service-requests', { method: 'POST', body: JSON.stringify(body) });
      await api(`service-requests/${edit.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      if (edit.status === 'draft' && !asDraft) await api(`service-requests/${edit.id}/publish`, { method: 'POST' });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-requests'] });
      void qc.invalidateQueries({ queryKey: ['request'] });
      router.push(edit ? `/client/demandes/${edit.id}` : '/client');
    },
    onError: (e) => {
      if (e instanceof Error && e.message === 'ADDRESS_NOT_FOUND') setError('address', { message: 'Adresse introuvable, vérifiez-la' });
    },
  });

  const e = (k: keyof FormValues) => errors[k]?.message as string | undefined;
  const addressNotFound = create.error instanceof Error && create.error.message === 'ADDRESS_NOT_FOUND';

  return (
    <form onSubmit={handleSubmit((v) => create.mutate(v))} className="grid gap-x-8 gap-y-4 lg:grid-cols-2" noValidate>
      {!!equipment.data?.length && (
        <div className="lg:col-span-2">
          <Field label="Partir d'un de mes équipements">
            <Select defaultValue="" onChange={(e) => fillFrom(e.target.value)}>
              <option value="">— Choisir (facultatif) —</option>
              {equipment.data.map((q) => <option key={q.id} value={q.id}>{q.label} · {q.city}</option>)}
            </Select>
          </Field>
        </div>
      )}
      <div className="grid content-start gap-4">
        <Field label="Titre" error={e('title')}><Input {...register('title')} placeholder="Ex : chambre froide qui ne descend plus" aria-invalid={!!errors.title} /></Field>
        <Field label="Description" error={e('description')}><Textarea {...register('description')} rows={8} aria-invalid={!!errors.description} /></Field>
        <Field label="Équipement (optionnel)" error={e('equipment')}><Input {...register('equipment')} placeholder="Marque, modèle, volume…" /></Field>
      </div>
      <div className="grid content-start gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type de service"><Select {...register('serviceType')}>{options(LABELS.service)}</Select></Field>
          <Field label="Domaine"><Select {...register('trade')}>{options(LABELS.trade)}</Select></Field>
        </div>
        {estimate && <p className="rounded-lg bg-accent p-3 text-sm text-accent-foreground">Repère : les devis pour ce type de demande vont en général de <b>{estimateText(estimate)}</b> ({estimate.count} devis). Indicatif : chaque prestataire chiffre selon votre cas.</p>}
        <Field label="Budget maximum (€, optionnel)"><Input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="Ex : 1500" /></Field>
        <Field label="Urgence"><Select {...register('urgency')}>{options(LABELS.urgency)}</Select></Field>
        <Field label="Adresse de l'intervention" error={e('address')}><Input {...register('address')} autoComplete="street-address" aria-invalid={!!errors.address} /></Field>
        <div className="grid grid-cols-[7rem_1fr] gap-4">
          <Field label="Code postal" error={e('postalCode')}><Input {...register('postalCode')} inputMode="numeric" autoComplete="postal-code" aria-invalid={!!errors.postalCode} /></Field>
          <Field label="Ville" error={e('city')}><Input {...register('city')} autoComplete="address-level2" aria-invalid={!!errors.city} /></Field>
        </div>
      </div>
      <div className="lg:col-span-2"><Field label="Photos de l'équipement (étiquette, code d'erreur…) — optionnel"><PhotoPicker value={photos} onChange={setPhotos} /></Field></div>
      <div className="grid gap-3 lg:col-span-2">
      {create.isError && !addressNotFound && <p role="alert" className="text-sm text-destructive">Envoi impossible, réessayez dans un instant.</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="lg" disabled={create.isPending} onClick={() => { intent.current = 'publish'; }}>
          {create.isPending ? 'Envoi…' : edit?.status === 'open' ? 'Enregistrer les modifications' : 'Publier ma demande'}
        </Button>
        {(!edit || edit.status === 'draft') && (
          <Button size="lg" type="submit" variant="outline" disabled={create.isPending} onClick={() => { intent.current = 'draft'; }}>Enregistrer en brouillon</Button>
        )}
      </div>
      </div>
    </form>
  );
}
