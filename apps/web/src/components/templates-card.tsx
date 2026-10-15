'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ApiError, api } from '@/lib/api';
import { uploadFile } from '@/lib/upload';

export interface MyTemplates { contract: string | null; invoice: string | null; fields: Record<string, string>; lineFields: string[] }
export const useTemplates = () => useQuery({ queryKey: ['templates'], queryFn: () => api<MyTemplates>('templates') });

const KINDS = [['contract', 'Modèle de contrat'], ['invoice', 'Modèle de facture']] as const;
const DOCX = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Modèles Word de l'utilisateur (client ou prestataire) : les contrats et factures sont produits à ce format. */
export function TemplatesCard() {
  const qc = useQueryClient();
  const { data } = useTemplates();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['templates'] });
  const upload = useMutation({
    mutationFn: async ({ kind, file }: { kind: string; file: File }) => api(`templates/${kind}`, { method: 'PUT', body: JSON.stringify({ fileId: await uploadFile(file) }) }),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (kind: string) => api(`templates/${kind}`, { method: 'DELETE' }), onSuccess: refresh });
  const err = upload.error instanceof ApiError ? ((upload.error.body as { message?: string })?.message ?? 'Import impossible') : upload.error instanceof Error ? upload.error.message : null;

  return (
    <Card className="grid gap-4 p-4">
      <div>
        <h2 className="text-lg font-semibold">Mes modèles de contrat et de facture</h2>
        <p className="text-sm text-muted-foreground">Importez vos documents Word : l&apos;application remplace les champs <code>{'{{client_nom}}'}</code>, <code>{'{{total_ttc}}'}</code>… par les données du dossier et vous rend un document à votre format.</p>
      </div>
      {KINDS.map(([kind, label]) => (
        <div key={kind} className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">{label}</p>
            <p className="truncate text-sm text-muted-foreground">{data?.[kind] ? <><FileText className="mr-1 inline size-4" />{data[kind]}</> : 'Aucun modèle importé'}</p>
          </div>
          <div className="flex gap-2">
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <Upload className="size-4" />{upload.isPending && upload.variables?.kind === kind ? 'Envoi…' : data?.[kind] ? 'Remplacer' : 'Importer (.docx)'}
              <input type="file" accept={DOCX} className="sr-only" disabled={upload.isPending} onChange={(e) => { const file = e.target.files?.[0]; if (file) upload.mutate({ kind, file }); e.target.value = ''; }} />
            </label>
            {data?.[kind] && <Button size="sm" variant="ghost" aria-label={`Supprimer le ${label.toLowerCase()}`} disabled={remove.isPending} onClick={() => remove.mutate(kind)}><Trash2 /></Button>}
          </div>
        </div>
      ))}
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">Champs disponibles</summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {data && Object.entries(data.fields).map(([k, v]) => <li key={k}><code>{`{{${k}}}`}</code> <span className="text-muted-foreground">{v}</span></li>)}
        </ul>
        {data && <p className="mt-2 text-muted-foreground">Lignes de prestation : placez <code>{'{{#lignes}}'}</code> avant et <code>{'{{/lignes}}'}</code> après une ligne (ou dans une ligne de tableau), avec {data.lineFields.map((f) => <code key={f} className="mr-1">{`{{${f}}}`}</code>)}</p>}
      </details>
    </Card>
  );
}
