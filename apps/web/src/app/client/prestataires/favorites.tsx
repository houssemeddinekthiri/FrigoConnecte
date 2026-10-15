'use client';

import { Heart, MapPin, Star } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useFavorites } from '@/lib/favorites';

export function Favorites() {
  const { list, toggle } = useFavorites();
  if (list.isPending) return <Skeleton className="h-32" />;
  if (list.isError) return <p role="alert" className="text-destructive">Impossible de charger vos prestataires.</p>;
  if (!list.data.length) return <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">Aucun favori pour l&apos;instant.</p>;

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {list.data.map((f) => (
        <li key={f.providerId}>
          <Card className="grid gap-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/prestataires/${f.slug}`} className="font-semibold hover:underline">{f.companyName}</Link>
              <Button size="icon" variant="ghost" aria-label={`Retirer ${f.companyName} des favoris`} onClick={() => toggle.mutate({ providerId: f.providerId, on: false })}><Heart className="fill-destructive text-destructive" /></Button>
            </div>
            {f.headline && <p className="text-sm text-muted-foreground">{f.headline}</p>}
            <p className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {f.reviewsCount > 0 && <span className="flex items-center gap-1"><Star className="size-3.5 fill-warning text-warning" />{f.avgRating.toFixed(1)} ({f.reviewsCount})</span>}
              {f.city && <span className="flex items-center gap-1"><MapPin className="size-3.5" />{f.city}</span>}
              {f.missionsWithMe > 0 && <span>{f.missionsWithMe} mission{f.missionsWithMe > 1 ? 's' : ''} avec vous</span>}
            </p>
            {f.available
              ? <Button asChild size="sm" className="mt-1 w-fit"><Link href={`/client/demandes/nouvelle?provider=${f.providerId}`}>Re-solliciter</Link></Button>
              : <p className="text-sm text-muted-foreground">Actuellement indisponible.</p>}
          </Card>
        </li>
      ))}
    </ul>
  );
}
