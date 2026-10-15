'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CLIENT_TYPES, updateClientProfileSchema, type ClientProfileDto } from '@frigoconnect/contracts';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api';
import { dateFr } from '@/lib/format';
import { uploadFile } from '@/lib/upload';
import { TrustCard } from './trust-card';

const TYPE_LABELS: Record<string, string> = {
  individual: 'Particulier', company: 'Entreprise', shop: 'Commerce', hotel: 'Hôtel', restaurant: 'Restaurant', syndic: 'Syndic / copropriété', public_body: 'Collectivité',
};

type Form = Omit<ClientProfileDto, 'email' | 'memberSince'>;
const blank = (v: string | null) => v ?? '';

export function Account() {
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ['client-profile'], queryFn: () => api<ClientProfileDto>('client/profile') });
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (profile.data && !form) { const { email: _e, memberSince: _m, ...f } = profile.data; setForm(f); } }, [profile.data, form]);
  // le logo est servi par une URL signée courte : on la demande dès que l'id change
  useEffect(() => {
    if (!form?.logoFileId) { setLogoUrl(null); return; }
    let alive = true;
    api<{ url: string }>(`files/${form.logoFileId}/download-url`).then((r) => alive && setLogoUrl(r.url)).catch(() => alive && setLogoUrl(null));
    return () => { alive = false; };
  }, [form?.logoFileId]);

  const upload = useMutation({
    mutationFn: uploadFile,
    onSuccess: (id) => { setSaved(false); setForm((f) => f && { ...f, logoFileId: id }); },
  });
  const save = useMutation({
    mutationFn: (body: unknown) => api('client/profile', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => { setSaved(true); void qc.invalidateQueries({ queryKey: ['client-profile'] }); },
  });

  if (profile.isError) return <p role="alert" className="text-destructive">Impossible de charger votre compte.</p>;
  if (profile.isPending || !form) return <Skeleton className="h-96" />;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setSaved(false); setForm((f) => f && { ...f, [k]: v }); };
  const text = (k: keyof Form) => ({ value: blank(form[k] as string | null), onChange: (e: { target: { value: string } }) => set(k, e.target.value as never) });
  const pro = form.clientType !== 'individual';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = updateClientProfileSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <section className="flex flex-wrap items-center gap-5 rounded-2xl border bg-card p-5 shadow-sm">
        <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-2xl border bg-secondary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logoUrl ? <img src={logoUrl} alt="Logo de la société" className="size-full object-contain" /> : <Building2 className="size-9 text-muted-foreground" aria-hidden />}
        </div>
        <div className="grid gap-2">
          <p className="font-semibold">{pro && form.companyName ? form.companyName : `${form.firstName} ${form.lastName}`}</p>
          <p className="text-sm text-muted-foreground">{profile.data.email} · client depuis le {dateFr(profile.data.memberSince)}</p>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}><ImagePlus /> {upload.isPending ? 'Envoi…' : form.logoFileId ? 'Changer le logo' : 'Ajouter un logo'}</Button>
            {form.logoFileId && <Button type="button" size="sm" variant="ghost" onClick={() => set('logoFileId', null)}><Trash2 /> Retirer</Button>}
          </div>
          {upload.isError && <p role="alert" className="text-sm text-destructive">{upload.error instanceof Error ? upload.error.message : 'Envoi impossible'}</p>}
        </div>
      </section>

      <TrustCard />

      <section className="grid gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Vos informations</h2>
        <Field label="Prénom" error={errors.firstName}><Input {...text('firstName')} autoComplete="given-name" /></Field>
        <Field label="Nom" error={errors.lastName}><Input {...text('lastName')} autoComplete="family-name" /></Field>
        <Field label="Email"><Input value={profile.data.email} readOnly disabled /></Field>
        <Field label="Téléphone" error={errors.phone}><Input {...text('phone')} type="tel" autoComplete="tel" placeholder="06 12 34 56 78" /></Field>
      </section>

      <section className="grid gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Société</h2>
        <Field label="Vous êtes"><Select value={form.clientType} onChange={(e) => set('clientType', e.target.value as Form['clientType'])}>{CLIENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</Select></Field>
        {pro && <Field label="Raison sociale" error={errors.companyName}><Input {...text('companyName')} autoComplete="organization" /></Field>}
        {pro && <Field label="SIRET" error={errors.siret}><Input {...text('siret')} inputMode="numeric" placeholder="14 chiffres" /></Field>}
        {pro && <Field label="N° de TVA intracommunautaire"><Input {...text('vatNumber')} placeholder="FR12345678901" /></Field>}
      </section>

      <section className="grid gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Adresse de facturation</h2>
        <div className="sm:col-span-2"><Field label="Adresse"><Input {...text('billingAddress')} autoComplete="street-address" /></Field></div>
        <Field label="Code postal" error={errors.billingPostalCode}><Input {...text('billingPostalCode')} inputMode="numeric" autoComplete="postal-code" /></Field>
        <Field label="Ville"><Input {...text('billingCity')} autoComplete="address-level2" /></Field>
      </section>

      {save.isError && <p role="alert" className="text-sm text-destructive">{save.error instanceof ApiError ? ((save.error.body as { message?: string })?.message ?? 'Enregistrement impossible') : 'Enregistrement impossible'}</p>}
      {saved && <p role="status" className="text-sm text-success">Modifications enregistrées.</p>}
      <div><Button size="lg" disabled={save.isPending || upload.isPending}>{save.isPending ? 'Enregistrement…' : 'Enregistrer'}</Button></div>
    </form>
  );
}
