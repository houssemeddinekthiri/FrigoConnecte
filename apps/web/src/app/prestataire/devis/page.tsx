'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Upload } from 'lucide-react';
import type { QuoteDto } from '@frigoconnect/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { dateFr, eur, QUOTE_STATUS } from '@/lib/format';

export default function ProviderQuotesPage() {
  const qc = useQueryClient();
  const { data, isPending, isError } = useQuery({ queryKey: ['my-quotes'], queryFn: () => api<QuoteDto[]>('quotes/mine') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['my-quotes'] });
  const act = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'send' | 'withdraw' }) => api(`quotes/${id}/${action}`, { method: 'POST' }), onSuccess: refresh });
  const importPdf = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => api(`quotes/${id}/import-pdf`, { method: 'POST', body: JSON.stringify({ fileId: await uploadFile(file) }) }),
    onSuccess: refresh,
  });
  const openPdf = async (fileId: string) => window.open((await api<{ url: string }>(`files/${fileId}/download-url`)).url, '_blank', 'noopener');

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">Mes devis</h1>
      {isPending && <div className="grid gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-24" />)}</div>}
      {isError && <p role="alert" className="text-destructive">Impossible de charger vos devis.</p>}
      {data?.length === 0 && <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Aucun devis. Répondez à une demande reçue pour en créer un.</p>}
      {importPdf.isError && <p role="alert" className="mb-3 text-sm text-destructive">{importPdf.error instanceof Error ? importPdf.error.message : 'Import impossible'}</p>}
      {act.isError && <p role="alert" className="mb-3 text-sm text-destructive">Action impossible (demande clôturée ou devis expiré ?).</p>}
      <ul className="grid gap-3">
        {data?.map((q) => (
          <li key={q.id}>
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{q.number} <Badge variant={QUOTE_STATUS[q.status].variant}>{QUOTE_STATUS[q.status].label}</Badge></p>
                <p className="text-sm text-muted-foreground">{eur(q.totalCents)} TTC · acompte {eur(q.depositCents)} · valable jusqu&apos;au {dateFr(q.validUntil)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(q.signedPdfFileId ?? q.pdfFileId) && <Button variant="outline" size="sm" onClick={() => void openPdf((q.signedPdfFileId ?? q.pdfFileId)!)}><FileText />PDF</Button>}
                {q.signedPdfFileId && q.pdfFileId && <Button variant="outline" size="sm" onClick={() => void openPdf(q.pdfFileId!)}><FileText />Devis d&apos;origine</Button>}
                {q.status === 'draft' && (
                  <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                    <Upload className="size-4" />{importPdf.isPending ? 'Envoi…' : q.pdfFileId ? 'Remplacer mon PDF' : 'Importer mon PDF'}
                    <input type="file" accept="application/pdf" className="sr-only" disabled={importPdf.isPending} onChange={(e) => { const file = e.target.files?.[0]; if (file) importPdf.mutate({ id: q.id, file }); e.target.value = ''; }} />
                  </label>
                )}
                {q.status === 'draft' && <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: q.id, action: 'send' })}>Envoyer</Button>}
                {(q.status === 'draft' || q.status === 'sent') && <Button variant="ghost" size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: q.id, action: 'withdraw' })}>{q.status === 'draft' ? 'Supprimer' : 'Retirer'}</Button>}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
