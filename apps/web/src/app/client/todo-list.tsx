'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CreditCard, FileText, Star, CheckCircle2, Wrench } from 'lucide-react';
import type { EquipmentDto } from '@frigoconnect/contracts';
import { api } from '@/lib/api';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useContracts } from '@/components/contract-panel';
import { eur, maintenanceDue } from '@/lib/format';

interface Req { id: string; title: string; status: string; quotesCount: number }

/** Ce que le client doit faire maintenant, tiré des statuts : devis à examiner + actions autorisées par le serveur sur chaque contrat. */
export function TodoList({ requests }: { requests: Req[] | undefined }) {
  const contracts = useContracts('client');
  const equipment = useQuery({ queryKey: ['equipment'], queryFn: () => api<EquipmentDto[]>('client-equipment') }).data;
  const todo: { key: string; icon: typeof FileText; text: string; cta: string; href: string; urgent?: boolean }[] = [];

  for (const r of requests ?? []) if (r.status === 'quoted') todo.push({ key: `q${r.id}`, icon: FileText, text: `${r.quotesCount} devis à examiner : ${r.title}`, cta: 'Comparer', href: `/client/demandes/${r.id}` });
  for (const c of contracts.data ?? []) {
    const href = `/client/demandes/${c.requestId}`;
    if (c.actions.payDeposit) todo.push({ key: `d${c.id}`, icon: CreditCard, text: `Acompte de ${eur(c.depositCents)} à payer : ${c.requestTitle}`, cta: 'Payer', href, urgent: true });
    if (c.actions.payBalance) todo.push({ key: `b${c.id}`, icon: CreditCard, text: `Solde de ${eur(c.balanceCents)} à payer : ${c.requestTitle}`, cta: 'Payer', href, urgent: true });
    if (c.actions.validate) todo.push({ key: `v${c.id}`, icon: CheckCircle2, text: `Intervention terminée, à valider : ${c.requestTitle}`, cta: 'Valider', href, urgent: true });
    if (c.actions.review) todo.push({ key: `r${c.id}`, icon: Star, text: `Donnez votre avis : ${c.requestTitle}`, cta: 'Noter', href });
  }
  for (const e of equipment ?? []) {
    const m = maintenanceDue(e);
    if (m.due) todo.push({ key: `e${e.id}`, icon: Wrench, text: `Entretien à prévoir : ${e.label} (${m.known ? `dernier il y a ${m.months} mois` : `ajouté il y a ${m.months} mois, aucun entretien`})`, cta: 'Planifier', href: `/client/demandes/nouvelle?equipment=${e.id}&service=maintenance` });
  }
  if (!todo.length) return null;

  return (
    <section aria-labelledby="todo-title" className="mb-8 rounded-2xl border border-primary/40 bg-card p-5 shadow-sm">
      <h2 id="todo-title" className="font-semibold">À faire maintenant ({todo.length})</h2>
      <ul className="mt-3 divide-y">
        {todo.map(({ key, icon: Icon, text, cta, href, urgent }) => (
          <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <p className="flex min-w-0 items-center gap-3 text-sm"><Icon className="size-4 shrink-0 text-primary" /><span className="truncate">{text}</span></p>
            <Button asChild size="sm" variant={urgent ? 'default' : 'outline'}><Link href={href}>{cta} <ArrowRight /></Link></Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
