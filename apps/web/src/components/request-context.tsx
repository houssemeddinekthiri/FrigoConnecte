'use client';

import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, ShieldCheck, UserRound } from 'lucide-react';
import type { RequestContextDto, TrustLevel } from '@frigoconnect/contracts';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { eur } from '@/lib/format';

export const TRUST_LABEL: Record<TrustLevel, { label: string; variant: 'default' | 'secondary' | 'success'; icon: typeof ShieldCheck }> = {
  new: { label: 'Nouveau client', variant: 'secondary', icon: UserRound },
  regular: { label: 'Client régulier', variant: 'default', icon: BadgeCheck },
  trusted: { label: 'Client de confiance', variant: 'success', icon: ShieldCheck },
};

/** Ce que le prestataire doit savoir pour chiffrer : budget annoncé et fiabilité du client (faits, jamais d'identité). */
export function RequestContext({ requestId }: { requestId: string }) {
  const { data } = useQuery({ queryKey: ['request-context', requestId], queryFn: () => api<RequestContextDto>(`provider/requests/${requestId}/context`), staleTime: 60_000 });
  if (!data) return null;
  const t = TRUST_LABEL[data.trust.level];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <Badge variant={t.variant}><t.icon className="mr-1 size-3.5" />{t.label}</Badge>
      <span className="text-muted-foreground">
        {data.trust.completedMissions > 0 ? `${data.trust.completedMissions} intervention${data.trust.completedMissions > 1 ? 's' : ''} menée${data.trust.completedMissions > 1 ? 's' : ''}` : 'Première demande'}
        {data.trust.disputes > 0 && ` · ${data.trust.disputes} litige${data.trust.disputes > 1 ? 's' : ''}`}
        {data.trust.verified.company && ' · société vérifiée'}{data.trust.verified.phone && ' · téléphone renseigné'}
      </span>
      {data.budgetMaxCents && <Badge variant="warning">Budget max {eur(data.budgetMaxCents)}</Badge>}
    </div>
  );
}
