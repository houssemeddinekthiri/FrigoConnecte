'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { dateFr, eur } from '@/lib/format';

interface Invoice { id: string; number: string; issuedOn: string; totalCents: number; fileId: string | null; requestTitle: string; providerName: string }
interface Data {
  quotes: { id: string; number: string; fileId: string; originalFileId: string | null; date: string; totalCents: number; requestTitle: string; providerName: string }[];
  payments: { id: string; date: string; kind: 'deposit' | 'balance' | 'refund'; status: string; amountCents: number; requestTitle: string; providerName: string }[];
}
const KIND = { deposit: 'Acompte', balance: 'Solde', refund: 'Remboursement' } as const;

/** CSV prêt pour Excel France : séparateur « ; », virgule décimale, BOM UTF-8. */
function exportCsv(rows: Data['payments']) {
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [['Date', 'Prestataire', 'Demande', 'Type', 'Montant TTC (EUR)'].join(';')].concat(
    rows.map((p) => [dateFr(p.date), cell(p.providerName), cell(p.requestTitle), KIND[p.kind], ((p.kind === 'refund' ? -p.amountCents : p.amountCents) / 100).toFixed(2)].map((x) => x.replace(/^(\d+)\.(\d+)$/, '$1,$2')).join(';')),
  );
  const url = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  Object.assign(document.createElement('a'), { href: url, download: 'paiements-frigoconnect.csv' }).click();
  URL.revokeObjectURL(url);
}

export function Documents() {
  const { data, isPending, isError } = useQuery({ queryKey: ['client-documents'], queryFn: () => api<Data>('client/documents') });
  const invoices = useQuery({ queryKey: ['invoices'], queryFn: () => api<Invoice[]>('invoices') }).data;
  const open = async (id: string) => window.open((await api<{ url: string }>(`files/${id}/download-url`)).url, '_blank', 'noopener');
  if (isPending) return <Skeleton className="h-40" />;
  if (isError) return <p role="alert" className="text-destructive">Impossible de charger vos documents.</p>;

  return (
    <div className="grid gap-8">
      <section aria-labelledby="inv-title">
        <h2 id="inv-title" className="mb-3 text-lg font-semibold">Factures ({invoices?.length ?? 0})</h2>
        {invoices?.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">Votre facture est émise automatiquement quand vous validez l&apos;intervention.</p>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {invoices?.map((i) => (
            <li key={i.id}>
              <Card className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{i.requestTitle}</p>
                  <p className="text-sm text-muted-foreground">{i.providerName} · {i.number} · {dateFr(i.issuedOn)} · {eur(i.totalCents)} TTC</p>
                </div>
                {i.fileId ? <Button size="sm" variant="outline" onClick={() => void open(i.fileId!)}><FileText /> PDF</Button> : <Badge variant="secondary">En préparation</Badge>}
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="quotes-title">
        <h2 id="quotes-title" className="mb-3 text-lg font-semibold">Devis signés ({data.quotes.length})</h2>
        {data.quotes.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">Vos devis signés apparaîtront ici.</p>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.quotes.map((q) => (
            <li key={q.id}>
              <Card className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{q.requestTitle}</p>
                  <p className="text-sm text-muted-foreground">{q.providerName} · {q.number} · {dateFr(q.date)} · {eur(q.totalCents)} TTC</p>
                </div>
                <div className="flex gap-2">
                  {q.originalFileId && <Button size="sm" variant="outline" onClick={() => void open(q.originalFileId!)}><FileText /> Devis</Button>}
                  <Button size="sm" variant="outline" onClick={() => void open(q.fileId)}><FileText /> {q.originalFileId ? 'Signature' : 'PDF'}</Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="pay-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="pay-title" className="text-lg font-semibold">Paiements ({data.payments.length})</h2>
          {data.payments.length > 0 && <Button size="sm" variant="outline" onClick={() => exportCsv(data.payments)}><Download /> Exporter en CSV</Button>}
        </div>
        {data.payments.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">Aucun paiement pour l&apos;instant.</p> : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[34rem] text-sm">
              <thead><tr className="border-b text-left text-muted-foreground"><th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Prestataire</th><th className="p-3 font-medium">Demande</th><th className="p-3 font-medium">Type</th><th className="p-3 text-right font-medium">Montant</th></tr></thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="p-3">{dateFr(p.date)}</td><td className="p-3">{p.providerName}</td><td className="max-w-[14rem] truncate p-3">{p.requestTitle}</td>
                    <td className="p-3"><Badge variant={p.kind === 'refund' ? 'secondary' : 'default'}>{KIND[p.kind]}</Badge></td>
                    <td className="p-3 text-right font-medium">{p.kind === 'refund' && '−'}{eur(p.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
