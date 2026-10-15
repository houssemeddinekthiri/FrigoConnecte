import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { eur } from '@/lib/format';

export interface Estimate { count: number; lowCents: number; highCents: number }

/** Fourchette indicative issue des devis passés (null tant que l'échantillon est trop petit). */
export function useEstimate(serviceType: string | undefined, trade: string | undefined) {
  return useQuery({
    queryKey: ['estimate', serviceType, trade],
    queryFn: () => api<Estimate | null>(`service-requests/estimate?serviceType=${serviceType}&trade=${trade}`),
    enabled: !!serviceType && !!trade,
    staleTime: 5 * 60_000,
  }).data;
}

export const estimateText = (e: Estimate) => `${eur(e.lowCents).replace(',00', '')} à ${eur(e.highCents).replace(',00', '')} TTC`;
