'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { CERTIFICATION_TYPES, SERVICE_TYPES, TRADES, providerProfileSchema, addCertificationSchema, type CertificationType } from '@frigoconnect/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { ApiError, api } from '@/lib/api';
import { ShowcaseCard } from './showcase';
import { dateFr, SERVICE_LABELS } from '@/lib/format';

interface Mine {
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'suspended' | null;
  rejectionReason?: string | null;
  logoFileId?: string | null; photos?: { id: string; fileId: string }[];
  companyName?: string; siret?: string; headline?: string | null; bio?: string | null; trades?: string[]; services?: string[]; yearsExperience?: number;
  emergencyAvailable?: boolean; address?: string; postalCode?: string; city?: string; location?: { lat: number; lng: number }; serviceRadiusKm?: number;
  certifications?: { id: string; type: CertificationType; label: string | null; number: string | null; expiresOn: string | null; reviewStatus: 'pending' | 'approved' | 'rejected' | 'not_applicable'; rejectionReason: string | null }[];
}
const TRADE_LABELS: Record<string, string> = { refrigeration: 'Froid commercial', heating: 'Chauffage', air_conditioning: 'Climatisation', ventilation: 'Ventilation', heat_pump: 'Pompe à chaleur', maintenance_company: 'Maintenance multi-techniques' };
const CERT_LABELS: Record<CertificationType, string> = {
  fluid_handling_cat1: 'Attestation de capacité — catégorie I', fluid_handling_cat2: 'Attestation de capacité — catégorie II', fluid_handling_cat3: 'Attestation de capacité — catégorie III',
  fluid_handling_cat4: 'Attestation de capacité — catégorie IV', qualipac: 'QualiPAC', rge: 'RGE', qualibat: 'Qualibat', electrical_habilitation: 'Habilitation électrique', insurance_decennale: 'Assurance décennale', other: 'Autre',
};
const STATUS = { draft: ['Brouillon', 'secondary'], pending_review: ['En cours d\'examen', 'warning'], approved: ['Validé', 'success'], rejected: ['À corriger', 'destructive'], suspended: ['Suspendu', 'destructive'] } as const;
const CERT_STATUS = { pending: ['À l\'examen', 'warning'], approved: ['Validé', 'success'], rejected: ['Refusé', 'destructive'], not_applicable: ['—', 'secondary'] } as const;

const message = (e: unknown) => (e instanceof ApiError ? ((e.body as { message?: string })?.message ?? 'Action impossible') : (e as Error).message);

/** API Adresse (data.gouv) : coordonnées de l'adresse de l'entreprise (centre de la zone d'intervention). */
async function geocode(address: string, postalCode: string, city: string) {
  const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(`${address} ${postalCode} ${city}`)}&limit=1`);
  const [lng, lat] = (await res.json()).features?.[0]?.geometry?.coordinates ?? [];
  if (lat === undefined) throw new Error('Adresse introuvable, vérifiez-la');
  return { lat: lat as number, lng: lng as number };
}

interface FormValues { companyName: string; siret: string; headline: string; bio: string; yearsExperience: string; address: string; postalCode: string; city: string; serviceRadiusKm: string; emergencyAvailable: boolean; trades: string[]; services: string[] }

export function ProfileEditor() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({ queryKey: ['provider-me'], queryFn: () => api<Mine>('providers/me') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['provider-me'] });

  if (isPending || !data) return <p className="text-muted-foreground">Chargement…</p>;
  const locked = !!data.status && !['draft', 'rejected'].includes(data.status); // SIRET et métiers figés après soumission
  return (
    <div className="grid gap-6">
      {data.status && <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">Statut du dossier :</span><Badge variant={STATUS[data.status][1]}>{STATUS[data.status][0]}</Badge></div>}
      {data.status === 'rejected' && data.rejectionReason && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">Motif du refus : {data.rejectionReason}</p>}
      <Profile key={data.status ?? 'new'} mine={data} locked={locked} onSaved={refresh} />
      {data.status && <ShowcaseCard mine={{ logoFileId: data.logoFileId ?? null, photos: data.photos ?? [] }} onChanged={refresh} />}
      {data.status && <Certifications mine={data} onChanged={refresh} />}
    </div>
  );
}

function Profile({ mine, locked, onSaved }: { mine: Mine; locked: boolean; onSaved: () => void }) {
  const { register, handleSubmit } = useForm<FormValues>({
    defaultValues: {
      companyName: mine.companyName ?? '', siret: mine.siret ?? '', headline: mine.headline ?? '', bio: mine.bio ?? '', yearsExperience: String(mine.yearsExperience ?? 0),
      address: mine.address ?? '', postalCode: mine.postalCode ?? '', city: mine.city ?? '', serviceRadiusKm: String(mine.serviceRadiusKm ?? 30), emergencyAvailable: mine.emergencyAvailable ?? false,
      trades: mine.trades ?? [], services: mine.services ?? [],
    },
  });
  const [info, setInfo] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const parsed = providerProfileSchema.safeParse({
        ...v, headline: v.headline || undefined, bio: v.bio || undefined, yearsExperience: Number(v.yearsExperience), serviceRadiusKm: Number(v.serviceRadiusKm),
        location: await geocode(v.address, v.postalCode, v.city),
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      await api('providers/me', { method: 'PUT', body: JSON.stringify(parsed.data) });
    },
    onSuccess: () => { setInfo('Profil enregistré.'); onSaved(); },
    onError: () => setInfo(null),
  });
  const submit = useMutation({ mutationFn: () => api('providers/me/submit', { method: 'POST' }), onSuccess: onSaved });

  return (
    <form className="grid gap-4" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
      <Field label="Raison sociale"><Input {...register('companyName')} /></Field>
      <Field label="SIRET" hint={locked ? 'Non modifiable une fois le dossier soumis' : '14 chiffres'}><Input {...register('siret')} inputMode="numeric" disabled={locked} /></Field>
      <Field label="Accroche (optionnel)"><Input {...register('headline')} maxLength={150} /></Field>
      <Field label="Présentation (optionnel)"><Textarea {...register('bio')} rows={4} maxLength={3000} /></Field>
      <fieldset className="grid gap-2" disabled={locked}>
        <legend className="mb-1 text-sm font-medium">Métiers {locked && <span className="font-normal text-muted-foreground">(non modifiables après soumission)</span>}</legend>
        <div className="grid grid-cols-2 gap-2">{TRADES.map((t) => <label key={t} className="flex min-h-11 items-center gap-2 rounded-md border p-2 text-sm"><input type="checkbox" value={t} {...register('trades')} className="size-4" />{TRADE_LABELS[t]}</label>)}</div>
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Services proposés</legend>
        <div className="grid grid-cols-2 gap-2">{SERVICE_TYPES.map((s) => <label key={s} className="flex min-h-11 items-center gap-2 rounded-md border p-2 text-sm"><input type="checkbox" value={s} {...register('services')} className="size-4" />{SERVICE_LABELS[s]}</label>)}</div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Années d'expérience"><Input type="number" min="0" max="60" inputMode="numeric" {...register('yearsExperience')} /></Field>
        <Field label="Rayon d'intervention (km)"><Input type="number" min="1" max="500" inputMode="numeric" {...register('serviceRadiusKm')} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('emergencyAvailable')} className="size-4" />J&apos;accepte les urgences (hors horaires habituels)</label>
      <Field label="Adresse de l'entreprise"><Input {...register('address')} autoComplete="street-address" /></Field>
      <div className="grid grid-cols-[7rem_1fr] gap-4">
        <Field label="Code postal"><Input {...register('postalCode')} inputMode="numeric" /></Field>
        <Field label="Ville"><Input {...register('city')} /></Field>
      </div>
      {save.isError && <p role="alert" className="text-sm text-destructive">{message(save.error)}</p>}
      {info && <p role="status" className="text-sm text-success">{info}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={save.isPending}>{save.isPending ? 'Enregistrement…' : 'Enregistrer'}</Button>
        {(mine.status === 'draft' || mine.status === 'rejected') && <Button type="button" variant="outline" disabled={submit.isPending} onClick={() => submit.mutate()}>Soumettre mon dossier</Button>}
      </div>
      {submit.isError && <p role="alert" className="text-sm text-destructive">{message(submit.error)}</p>}
    </form>
  );
}

function Certifications({ mine, onChanged }: { mine: Mine; onChanged: () => void }) {
  const [form, setForm] = useState({ type: 'fluid_handling_cat1' as CertificationType, number: '', issuedOn: '', expiresOn: '' });
  const file = useRef<HTMLInputElement>(null);
  const add = useMutation({
    mutationFn: async () => {
      const f = file.current?.files?.[0];
      if (!f) throw new Error('Choisissez un fichier (PDF ou image)');
      // 1) URL signée, 2) envoi direct à MinIO, 3) confirmation, 4) rattachement à la certification
      const up = await api<{ fileId: string; url: string; headers: Record<string, string> }>('files/upload-url', { method: 'POST', body: JSON.stringify({ fileName: f.name, mimeType: f.type, sizeBytes: f.size }) });
      if (!(await fetch(up.url, { method: 'PUT', headers: up.headers, body: f })).ok) throw new Error('Envoi du fichier impossible');
      await api(`files/${up.fileId}/confirm`, { method: 'POST' });
      const body = addCertificationSchema.safeParse({ type: form.type, number: form.number || undefined, issuedOn: form.issuedOn || undefined, expiresOn: form.expiresOn || undefined, fileId: up.fileId });
      if (!body.success) throw new Error(body.error.issues[0].message);
      await api('providers/me/certifications', { method: 'POST', body: JSON.stringify(body.data) });
    },
    onSuccess: () => { if (file.current) file.current.value = ''; setForm({ ...form, number: '', issuedOn: '', expiresOn: '' }); onChanged(); },
  });

  return (
    <Card className="grid gap-4 p-4">
      <h2 className="font-semibold">Documents et certifications</h2>
      <p className="text-sm text-muted-foreground">Pour le froid, la climatisation et les pompes à chaleur, l&apos;attestation de capacité est obligatoire. Chaque document est examiné par notre équipe.</p>
      <ul className="grid gap-2">
        {mine.certifications?.length === 0 && <li className="text-sm text-muted-foreground">Aucun document déposé.</li>}
        {mine.certifications?.map((c) => (
          <li key={c.id} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><b>{CERT_LABELS[c.type]}</b><Badge variant={CERT_STATUS[c.reviewStatus][1]}>{CERT_STATUS[c.reviewStatus][0]}</Badge></div>
            <p className="text-xs text-muted-foreground">{c.number && `n° ${c.number} · `}{c.expiresOn ? `expire le ${dateFr(c.expiresOn)}` : 'sans expiration'}</p>
            {c.rejectionReason && <p className="mt-1 text-xs text-destructive">Refusé : {c.rejectionReason}</p>}
          </li>
        ))}
      </ul>
      <form className="grid gap-3 border-t pt-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <Field label="Type de document"><Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CertificationType })}>{CERTIFICATION_TYPES.map((t) => <option key={t} value={t}>{CERT_LABELS[t]}</option>)}</Select></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Numéro (optionnel)"><Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></Field>
          <Field label="Délivré le"><Input type="date" value={form.issuedOn} onChange={(e) => setForm({ ...form, issuedOn: e.target.value })} /></Field>
          <Field label="Expire le" hint="Vous serez alerté avant l'expiration"><Input type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} /></Field>
        </div>
        <Field label="Fichier (PDF, JPEG, PNG, WebP — 25 Mo max)"><input ref={file} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-sm" /></Field>
        {add.isError && <p role="alert" className="text-sm text-destructive">{message(add.error)}</p>}
        <Button className="justify-self-start" variant="outline" disabled={add.isPending}>{add.isPending ? 'Envoi…' : 'Ajouter le document'}</Button>
      </form>
    </Card>
  );
}
