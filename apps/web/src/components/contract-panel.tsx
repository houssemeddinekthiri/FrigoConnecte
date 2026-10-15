'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/form-controls';
import type { ContractDocumentDto, ContractDto, PaymentStatus } from '@frigoconnect/contracts';
import { PaymentSheet } from '@/components/payment-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ApiError, api } from '@/lib/api';
import { dateFr, eur } from '@/lib/format';
import { useRealtimeEvent } from '@/lib/realtime';
import { ACCEPT, uploadFile } from '@/lib/upload';
import { useTemplates } from '@/components/templates-card';

const PAY_LABEL: Record<PaymentStatus, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  pending: { label: 'En attente', variant: 'warning' },
  held: { label: 'Reçu (séquestre)', variant: 'default' },
  authorized: { label: 'Versement en cours', variant: 'default' },
  released: { label: 'Versé au prestataire', variant: 'success' },
  failed: { label: 'Échec', variant: 'destructive' },
  refunded: { label: 'Remboursé', variant: 'secondary' },
  partially_refunded: { label: 'Remboursé en partie', variant: 'secondary' },
};
const CONTRACT_LABEL: Record<ContractDto['status'], string> = { pending_signature: 'À signer', active: 'En cours', completed: 'Terminé', cancelled: 'Annulé', disputed: 'En litige' };

/** Suivi d'un contrat : paiements, et les seules actions que le serveur autorise à cet instant. */
export function ContractPanel({ contract, role }: { contract: ContractDto; role: 'client' | 'provider' }) {
  const qc = useQueryClient();
  const [paying, setPaying] = useState<'deposit' | 'balance' | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['contracts'] });

  const act = useMutation({
    mutationFn: (action: 'work-done' | 'validate') => api(`contracts/${contract.id}/${action}`, { method: 'POST' }),
    onSuccess: refresh,
  });
  const [reviewing, setReviewing] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const a = contract.actions;

  return (
    <Card className="grid gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{contract.requestTitle}</p>
          <p className="text-sm text-muted-foreground">{role === 'client' ? 'Prestataire' : 'Client'} : {contract.counterpartName} · Total {eur(contract.totalCents)} TTC</p>
        </div>
        <Badge variant={contract.status === 'completed' ? 'success' : contract.status === 'disputed' ? 'destructive' : 'default'}>{CONTRACT_LABEL[contract.status]}</Badge>
      </div>

      <ul className="grid gap-1 text-sm">
        {contract.payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{p.kind === 'deposit' ? 'Acompte' : 'Solde'} · {eur(p.amountCents)}{role === 'provider' && p.providerCents !== null && <span className="text-muted-foreground"> (vous recevez {eur(p.providerCents)}, commission {eur(p.feeCents ?? 0)})</span>}</span>
            <Badge variant={PAY_LABEL[p.status].variant}>{PAY_LABEL[p.status].label}</Badge>
          </li>
        ))}
        {contract.payments.length === 0 && <li className="text-muted-foreground">Aucun paiement pour l&apos;instant (acompte {eur(contract.depositCents)}, solde {eur(contract.balanceCents)}).</li>}
      </ul>

      {contract.workDoneAt && contract.status === 'active' && (
        <p className="text-sm text-muted-foreground">Intervention déclarée terminée le {dateFr(contract.workDoneAt)}{contract.autoValidateAt && ` · validation automatique le ${dateFr(contract.autoValidateAt)}`}.</p>
      )}
      {contract.status === 'disputed' && <p role="status" className="text-sm text-destructive">Ce contrat est en litige : notre équipe vous contactera.</p>}
      {act.isError && <p role="alert" className="text-sm text-destructive">{act.error instanceof ApiError ? ((act.error.body as { message?: string })?.message ?? 'Action impossible') : 'Action impossible'}</p>}

      <div className="flex flex-wrap gap-2">
        {a.payDeposit && <Button onClick={() => setPaying('deposit')}>Payer l&apos;acompte ({eur(contract.depositCents)})</Button>}
        {a.payBalance && <Button onClick={() => setPaying('balance')}>Payer le solde ({eur(contract.balanceCents)})</Button>}
        {a.validate && <Button variant="outline" disabled={act.isPending} onClick={() => act.mutate('validate')}>Valider l&apos;intervention et libérer les fonds</Button>}
        {a.declareDone && <Button disabled={act.isPending} onClick={() => act.mutate('work-done')}>Intervention terminée</Button>}
        {a.review && <Button variant="outline" onClick={() => setReviewing(true)}>Laisser un avis</Button>}
        {a.dispute && <Button variant="ghost" className="text-destructive" onClick={() => setDisputing(true)}>Signaler un problème</Button>}
      </div>

      <ContractDocuments contractId={contract.id} />

      <DisputeSheet contractId={disputing ? contract.id : null} onClose={() => setDisputing(false)} onDone={refresh} />
      <ReviewSheet contractId={reviewing ? contract.id : null} onClose={() => setReviewing(false)} onDone={refresh} />
      <PaymentSheet contractId={paying ? contract.id : null} kind={paying ?? 'deposit'} onClose={() => setPaying(null)} onPaid={refresh} />
    </Card>
  );
}

/** Documents importés sur le contrat (contrat ou facture) par l'une ou l'autre partie : l'autre partie les voit et les télécharge tels quels. */
function ContractDocuments({ contractId }: { contractId: string }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ContractDocumentDto['kind']>('contract');
  const docs = useQuery({ queryKey: ['contract-docs', contractId], queryFn: () => api<ContractDocumentDto[]>(`contracts/${contractId}/documents`) });
  const add = useMutation({
    mutationFn: async (file: File) => api(`contracts/${contractId}/documents`, { method: 'POST', body: JSON.stringify({ fileId: await uploadFile(file), kind }) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contract-docs', contractId] }),
  });
  const open = async (id: string) => window.open((await api<{ url: string }>(`files/${id}/download-url`)).url, '_blank', 'noopener');
  const templates = useTemplates().data;
  const generate = useMutation({
    mutationFn: () => api(`templates/${kind}/generate/${contractId}`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contract-docs', contractId] }),
  });

  return (
    <div className="grid gap-2 border-t pt-3">
      <p className="text-sm font-medium">Documents</p>
      <ul className="grid gap-1 text-sm">
        {docs.data?.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">{d.kind === 'contract' ? 'Contrat' : 'Facture'} · {d.name} <span className="text-muted-foreground">({d.mine ? 'vous' : "l'autre partie"}, {dateFr(d.createdAt)})</span></span>
            <Button size="sm" variant="outline" onClick={() => void open(d.fileId)}><FileText /> Ouvrir</Button>
          </li>
        ))}
        {docs.data?.length === 0 && <li className="text-muted-foreground">Aucun document importé.</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Type de document" className="h-9 rounded-md border bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="contract">Contrat</option>
          <option value="invoice">Facture</option>
        </select>
        <input ref={input} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) add.mutate(f); e.target.value = ''; }} />
        <Button size="sm" variant="outline" disabled={add.isPending} onClick={() => input.current?.click()}><Upload /> {add.isPending ? 'Envoi…' : 'Importer un fichier'}</Button>
        {templates?.[kind] && <Button size="sm" disabled={generate.isPending} onClick={() => generate.mutate()}><FileText /> {generate.isPending ? 'Création…' : 'Générer depuis mon modèle'}</Button>}
      </div>
      {generate.isError && <p role="alert" className="text-sm text-destructive">{generate.error instanceof ApiError ? ((generate.error.body as { message?: string })?.message ?? 'Génération impossible') : 'Génération impossible'}</p>}
      {add.isError && <p role="alert" className="text-sm text-destructive">{add.error instanceof Error ? add.error.message : 'Import impossible'}</p>}
    </div>
  );
}

/** Liste des contrats avec rafraîchissement : par notification temps réel, et en continu tant qu'un paiement attend la confirmation de Stripe. */
export function useContracts(role: 'client' | 'provider', requestId?: string) {
  const qc = useQueryClient();
  useRealtimeEvent('notification', () => void qc.invalidateQueries({ queryKey: ['contracts'] }));
  return useQuery({
    queryKey: ['contracts', role, requestId ?? 'all'],
    queryFn: () => api<ContractDto[]>(`contracts${requestId ? `?requestId=${requestId}` : ''}`),
    refetchInterval: (q) => (q.state.data?.some((c) => c.payments.some((p) => p.status === 'pending')) ? 3000 : false),
  });
}

/** Avis après un contrat terminé. Un avis contenant coordonnées ou lien est relu par la modération avant publication. */
function ReviewSheet({ contractId, onClose, onDone }: { contractId: string | null; onClose: () => void; onDone: () => void }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const send = useMutation({
    mutationFn: () => api<{ status: string }>(`contracts/${contractId}/reviews`, { method: 'POST', body: JSON.stringify({ rating, ...(comment.trim() && { comment: comment.trim() }) }) }),
    onSuccess: onDone,
  });
  const close = () => { send.reset(); setComment(''); onClose(); };

  return (
    <Sheet open={!!contractId} onOpenChange={(o) => !o && close()}>
      <SheetContent title="Votre avis">
        {send.isSuccess ? (
          <div className="grid gap-4">
            <p role="status" className="rounded-lg bg-success/10 p-4 text-success">{send.data.status === 'published' ? 'Merci, votre avis est publié.' : 'Merci, votre avis sera publié après relecture par notre équipe.'}</p>
            <Button onClick={close}>Fermer</Button>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
            <fieldset className="flex gap-1">
              <legend className="mb-1 text-sm font-medium">Note</legend>
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="cursor-pointer text-3xl leading-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                  <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="sr-only" aria-label={`${n} sur 5`} />
                  <span className={n <= rating ? 'text-warning' : 'text-muted-foreground'} aria-hidden>★</span>
                </label>
              ))}
            </fieldset>
            <label className="grid gap-1.5 text-sm font-medium">Commentaire (optionnel)
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} maxLength={2000} />
            </label>
            {send.isError && <p role="alert" className="text-sm text-destructive">{send.error instanceof ApiError ? ((send.error.body as { message?: string })?.message ?? 'Envoi impossible') : 'Envoi impossible'}</p>}
            <Button size="lg" disabled={send.isPending}>{send.isPending ? 'Envoi…' : 'Publier mon avis'}</Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Signalement d'un problème : le contrat passe en litige, les fonds restent conservés et l'équipe tranche. */
function DisputeSheet({ contractId, onClose, onDone }: { contractId: string | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const send = useMutation({
    mutationFn: () => api(`contracts/${contractId}/dispute`, { method: 'POST', body: JSON.stringify({ reason }) }),
    onSuccess: () => { onDone(); close(); },
  });
  const close = () => { send.reset(); setReason(''); onClose(); };

  return (
    <Sheet open={!!contractId} onOpenChange={(o) => !o && close()}>
      <SheetContent title="Signaler un problème">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <p className="text-sm text-muted-foreground">Le contrat sera marqué « en litige ». Les sommes déjà versées restent conservées en sécurité et notre équipe vous contacte pour trancher.</p>
          <label className="grid gap-1.5 text-sm font-medium">Que s&apos;est-il passé ?
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={5} maxLength={1000} minLength={10} required placeholder="Ex : la panne est revenue le lendemain, le technicien n'est pas venu au rendez-vous…" />
          </label>
          {send.isError && <p role="alert" className="text-sm text-destructive">{send.error instanceof ApiError ? ((send.error.body as { message?: string })?.message ?? 'Envoi impossible') : 'Envoi impossible'}</p>}
          <Button size="lg" variant="destructive" disabled={send.isPending || reason.trim().length < 10}>{send.isPending ? 'Envoi…' : 'Ouvrir un litige'}</Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
