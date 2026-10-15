'use client';

import { useMutation } from '@tanstack/react-query';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_PROVIDER_PHOTOS, MAX_PUBLIC_IMAGE_BYTES } from '@frigoconnect/contracts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ApiError, api } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { cn } from '@/lib/utils';

interface Showcase { logoFileId: string | null; photos: { id: string; fileId: string }[] }

const IMAGE_TYPES = 'image/jpeg,image/png,image/webp';
const message = (e: unknown) => (e instanceof ApiError ? ((e.body as { message?: string })?.message ?? 'Action impossible') : (e as Error).message);

/** Image envoyée par le prestataire : on la montre avant même l'approbation du dossier (URL signée courte, réservée à l'auteur). */
function Preview({ fileId, className }: { fileId: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api<{ url: string }>(`files/${fileId}/download-url`).then((r) => alive && setUrl(r.url)).catch(() => alive && setUrl(null));
    return () => { alive = false; };
  }, [fileId]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className={className} /> : <div className={cn('animate-pulse bg-muted', className)} />;
}

/** Envoi direct d'une image (JPEG, PNG, WebP, 8 Mo max : elle est affichée telle quelle sur la page publique). */
async function uploadImage(f: File) {
  if (!IMAGE_TYPES.split(',').includes(f.type)) throw new Error('Formats acceptés : JPEG, PNG ou WebP.');
  if (f.size > MAX_PUBLIC_IMAGE_BYTES) throw new Error('Image trop lourde (8 Mo maximum).');
  return uploadFile(f);
}

export function ShowcaseCard({ mine, onChanged }: { mine: Showcase; onChanged: () => void }) {
  const logoInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const logo = useMutation({
    mutationFn: async (f: File | null) => api('providers/me/logo', { method: 'PUT', body: JSON.stringify({ fileId: f ? await uploadImage(f) : null }) }),
    onSuccess: onChanged,
  });
  const addPhotos = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) await api('providers/me/photos', { method: 'POST', body: JSON.stringify({ fileId: await uploadImage(f) }) });
    },
    onSettled: onChanged, // même en cas d'échec partiel : les photos déjà ajoutées apparaissent
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`providers/me/photos/${id}`, { method: 'DELETE' }), onSuccess: onChanged });
  const error = logo.error ?? addPhotos.error ?? remove.error;
  const room = MAX_PROVIDER_PHOTOS - mine.photos.length;

  return (
    <Card className="grid gap-5 p-4">
      <div>
        <h2 className="font-semibold">Logo et photos</h2>
        <p className="text-sm text-muted-foreground">Affichés sur votre profil public une fois votre dossier validé. Des photos de vos réalisations rassurent les clients.</p>
      </div>

      <div className="flex items-center gap-4">
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border bg-white">
          {mine.logoFileId ? <Preview fileId={mine.logoFileId} className="size-full object-contain" /> : <ImagePlus className="size-6 text-muted-foreground" aria-hidden />}
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={logoInput} type="file" accept={IMAGE_TYPES} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) logo.mutate(f); }} />
          <Button type="button" size="sm" variant="outline" disabled={logo.isPending} onClick={() => logoInput.current?.click()}>{logo.isPending ? 'Envoi…' : mine.logoFileId ? 'Changer le logo' : 'Ajouter un logo'}</Button>
          {mine.logoFileId && <Button type="button" size="sm" variant="ghost" disabled={logo.isPending} onClick={() => logo.mutate(null)}><Trash2 /> Retirer</Button>}
        </div>
      </div>

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Photos de réalisations ({mine.photos.length}/{MAX_PROVIDER_PHOTOS})</h3>
          <input ref={photoInput} type="file" accept={IMAGE_TYPES} multiple hidden onChange={(e) => { const fs = Array.from(e.target.files ?? []).slice(0, room); e.target.value = ''; if (fs.length) addPhotos.mutate(fs); }} />
          <Button type="button" size="sm" variant="outline" disabled={addPhotos.isPending || room <= 0} onClick={() => photoInput.current?.click()}><ImagePlus /> {addPhotos.isPending ? 'Envoi…' : 'Ajouter des photos'}</Button>
        </div>
        {mine.photos.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {mine.photos.map((ph) => (
              <li key={ph.id} className="group relative">
                <Preview fileId={ph.fileId} className="aspect-[4/3] w-full rounded-md object-cover" />
                <Button type="button" size="icon" variant="secondary" className="absolute right-1 top-1 size-8 opacity-90" aria-label="Supprimer la photo" disabled={remove.isPending} onClick={() => remove.mutate(ph.id)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{message(error)}</p>}
    </Card>
  );
}
