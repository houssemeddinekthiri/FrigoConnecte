import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Favorite {
  providerId: string; slug: string; companyName: string; headline: string | null; city: string | null;
  avgRating: number; reviewsCount: number; available: boolean; missionsWithMe: number;
}

/** Prestataires favoris du client + bascule (ajout/retrait) avec rafraîchissement de la liste. */
export function useFavorites() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['favorites'], queryFn: () => api<Favorite[]>('client/favorites') });
  const toggle = useMutation({
    mutationFn: ({ providerId, on }: { providerId: string; on: boolean }) => api(`client/favorites/${providerId}`, { method: on ? 'PUT' : 'DELETE' }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['favorites'] }),
  });
  return { list, isFavorite: (id: string) => !!list.data?.some((f) => f.providerId === id), toggle };
}
