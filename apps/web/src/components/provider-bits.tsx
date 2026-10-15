import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Logo et photos publics : servis par l'API via le BFF (jamais d'URL de stockage dans la page). */
export const publicImageSrc = (fileId: string) => `/api/proxy/providers/images/${fileId}`;

/** Logo du prestataire, ou ses initiales s'il n'en a pas : même rendu sur la recherche et sur le profil. */
export function ProviderAvatar({ name, fileId, className }: { name: string; fileId?: string | null; className?: string }) {
  const box = cn('grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-accent text-lg font-bold uppercase text-accent-foreground', className);
  if (fileId) {
    // eslint-disable-next-line @next/next/no-img-element
    return <span className={box}><img src={publicImageSrc(fileId)} alt="" className="size-full bg-white object-contain" /></span>;
  }
  return <span aria-hidden className={box}>{name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('')}</span>;
}

export const Stars = ({ rating }: { rating: number }) => (
  <span role="img" aria-label={`${rating} sur 5`} className="inline-flex text-warning">
    {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={cn('size-4', i <= Math.round(rating) && 'fill-current')} />)}
  </span>
);
