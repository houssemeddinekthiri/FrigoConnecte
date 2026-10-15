'use client';

import { useQuery } from '@tanstack/react-query';
import type { ClientTrustDto } from '@frigoconnect/contracts';
import { TRUST_LABEL } from '@/components/request-context';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';

/** « Votre profil de confiance » : ce que voient les prestataires, et comment le faire progresser. */
export function TrustCard() {
  const { data } = useQuery({ queryKey: ['client-trust'], queryFn: () => api<ClientTrustDto>('client/trust') });
  if (!data) return null;
  const t = TRUST_LABEL[data.level];
  return (
    <section className="grid gap-3 rounded-2xl border bg-card p-5 shadow-sm" aria-labelledby="trust-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="trust-title" className="font-semibold">Votre profil de confiance</h2>
        <Badge variant={t.variant}><t.icon className="mr-1 size-3.5" />{t.label}</Badge>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={data.score} aria-valuemin={0} aria-valuemax={100} aria-label="Score de confiance"><div className="h-full bg-primary transition-all" style={{ width: `${data.score}%` }} /></div>
      <p className="text-sm text-muted-foreground">{data.score} / 100 · {data.completedMissions} intervention{data.completedMissions > 1 ? 's' : ''} menée{data.completedMissions > 1 ? 's' : ''} · {data.memberMonths} mois d&apos;ancienneté. Les prestataires voient votre niveau, jamais votre score ni vos coordonnées.</p>
      {data.tips.length > 0 && <ul className="grid gap-1 text-sm">{data.tips.map((x) => <li key={x} className="flex gap-2"><span aria-hidden>→</span>{x}</li>)}</ul>}
    </section>
  );
}
