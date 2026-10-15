'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { providerInvoicingSchema, type ProviderInvoicingDto } from '@frigoconnect/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form-controls';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api';
import { dateFr, eur } from '@/lib/format';

interface Invoice { id: string; number: string; issuedOn: string; totalCents: number; fileId: string | null; requestTitle: string; clientName: string }

export function Invoices() {
  const invoices = useQuery({ queryKey: ['invoices'], queryFn: () => api<Invoice[]>('invoices') });
  const open = async (id: string) => window.open((await api<{ url: string }>(`files/${id}/download-url`)).url, '_blank', 'noopener');

  return (
    <div className="grid gap-8">
      <LegalMentions />
      <section aria-labelledby="inv-title">
        <h2 id="inv-title" className="mb-3 text-lg font-semibold">Factures émises ({invoices.data?.length ?? 0})</h2>
        {invoices.isPending && <Skeleton className="h-24" />}
        {invoices.data?.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">Aucune facture pour l&apos;instant.</p>}
        {!!invoices.data?.length && (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[34rem] text-sm">
              <thead><tr className="border-b text-left text-muted-foreground"><th className="p-3 font-medium">N°</th><th className="p-3 font-medium">Date</th><th className="p-3 font-medium">Client</th><th className="p-3 font-medium">Intervention</th><th className="p-3 text-right font-medium">Total TTC</th><th /></tr></thead>
              <tbody>
                {invoices.data.map((i) => (
                  <tr key={i.id} className="border-b last:border-0">
                    <td className="p-3 font-medium">{i.number}</td><td className="p-3">{dateFr(i.issuedOn)}</td><td className="p-3">{i.clientName}</td><td className="max-w-[14rem] truncate p-3">{i.requestTitle}</td>
                    <td className="p-3 text-right">{eur(i.totalCents)}</td>
                    <td className="p-3 text-right">{i.fileId ? <Button size="sm" variant="outline" onClick={() => void open(i.fileId!)}><FileText /> PDF</Button> : <Badge variant="secondary">En préparation</Badge>}</td>
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

type Draft = { vatNumber: string; legalForm: string; shareCapitalEuros: string; registration: string };

/** Mentions obligatoires sur une facture : à renseigner une fois, reprises automatiquement. */
function LegalMentions() {
  const qc = useQueryClient();
  const current = useQuery({ queryKey: ['invoicing'], queryFn: () => api<ProviderInvoicingDto | null>('providers/me/invoicing') });
  const [f, setF] = useState<Draft>({ vatNumber: '', legalForm: '', shareCapitalEuros: '', registration: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const d = current.data;
    if (d) setF({ vatNumber: d.vatNumber ?? '', legalForm: d.legalForm ?? '', shareCapitalEuros: d.shareCapitalEuros === null ? '' : String(d.shareCapitalEuros), registration: d.registration ?? '' });
  }, [current.data]);
  const save = useMutation({
    mutationFn: (body: unknown) => api('providers/me/invoicing', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => { setSaved(true); void qc.invalidateQueries({ queryKey: ['invoicing'] }); },
  });
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => { setSaved(false); setF((x) => ({ ...x, [k]: e.target.value })); };
  const incomplete = current.data && (!current.data.vatNumber || !current.data.legalForm || !current.data.registration);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = providerInvoicingSchema.safeParse(f);
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
    setErrors({});
    save.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:grid-cols-2" noValidate>
      <h2 className="font-semibold sm:col-span-2">Mentions légales de facturation</h2>
      {incomplete && <p role="status" className="rounded-lg bg-warning/10 p-3 text-sm sm:col-span-2">Complétez ces informations : elles sont obligatoires sur vos factures (n° de TVA, forme juridique, immatriculation).</p>}
      <Field label="N° de TVA intracommunautaire" error={errors.vatNumber}><Input value={f.vatNumber} onChange={set('vatNumber')} placeholder="FR12345678901" /></Field>
      <Field label="Forme juridique"><Input value={f.legalForm} onChange={set('legalForm')} placeholder="SAS, SARL, EI…" /></Field>
      <Field label="Capital social (€)" error={errors.shareCapitalEuros}><Input value={f.shareCapitalEuros} onChange={set('shareCapitalEuros')} inputMode="decimal" placeholder="10000" /></Field>
      <Field label="Immatriculation"><Input value={f.registration} onChange={set('registration')} placeholder="RCS Lyon 123 456 789" /></Field>
      {save.isError && <p role="alert" className="text-sm text-destructive sm:col-span-2">{save.error instanceof ApiError ? ((save.error.body as { message?: string })?.message ?? 'Enregistrement impossible') : 'Enregistrement impossible'}</p>}
      {saved && <p role="status" className="text-sm text-success sm:col-span-2">Enregistré.</p>}
      <div className="sm:col-span-2"><Button disabled={save.isPending}>{save.isPending ? 'Enregistrement…' : 'Enregistrer'}</Button></div>
    </form>
  );
}
