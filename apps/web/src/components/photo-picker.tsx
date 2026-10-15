'use client';

import { Paperclip, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ACCEPT, uploadFile } from '@/lib/upload';

export interface Uploaded { id: string; name: string }
const MAX = 6;

/** Photos de la machine, étiquette, code d'erreur… : envoyées dès le choix, on garde seulement les ids. */
export function PhotoPicker({ value, onChange }: { value: Uploaded[]; onChange: (v: Uploaded[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    setBusy(true);
    const added: Uploaded[] = [];
    try {
      for (const f of Array.from(files).slice(0, MAX - value.length)) added.push({ id: await uploadFile(f), name: f.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Envoi impossible.');
    }
    onChange([...value, ...added]);
    setBusy(false);
    if (input.current) input.current.value = '';
  }

  return (
    <div className="grid gap-2">
      <input ref={input} type="file" accept={ACCEPT} multiple capture="environment" hidden onChange={(e) => void pick(e.target.files)} />
      <div className="flex flex-wrap items-center gap-2">
        {value.map((f) => (
          <span key={f.id} className="inline-flex max-w-[14rem] items-center gap-1 rounded-full bg-secondary py-1 pl-3 pr-1 text-sm">
            <span className="truncate">{f.name}</span>
            <button type="button" aria-label={`Retirer ${f.name}`} className="rounded-full p-1 hover:bg-background" onClick={() => onChange(value.filter((x) => x.id !== f.id))}><X className="size-3.5" /></button>
          </span>
        ))}
        {value.length < MAX && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}><Paperclip /> {busy ? 'Envoi…' : 'Ajouter des photos'}</Button>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
