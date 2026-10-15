import type { Metadata } from 'next';
import { Clock, MapPin, Star } from 'lucide-react';
import Link from 'next/link';
import { SERVICE_TYPES, type ProviderSearchResult } from '@frigoconnect/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form-controls';
import { ProviderAvatar } from '@/components/provider-bits';
import { duration, SERVICE_LABELS } from '@/lib/format';
import { LocateButton } from './locate-button';

export const metadata: Metadata = { title: 'Trouver un prestataire' };

type Search = { service?: string; ville?: string; tri?: string; urgences?: string; dispo?: string };
const SORTS = { note: 'rating', distance: 'distance' } as const; // tri absent = pertinence (score du matching)

/** API Adresse (data.gouv) : ville ou code postal -> coordonnées. */
async function geocodeCity(q: string) {
  const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&type=municipality&limit=1`, { next: { revalidate: 86_400 } });
  const f = (await res.json()).features?.[0];
  return f ? { lat: f.geometry.coordinates[1] as number, lng: f.geometry.coordinates[0] as number, label: f.properties.city as string } : null;
}

async function search(service: string | undefined, ville: string, f: { sort?: 'rating' | 'distance'; emergency: boolean; availableNow: boolean }) {
  const place = await geocodeCity(ville);
  if (!place) return { place: null, results: [] as ProviderSearchResult[] };
  const qs = new URLSearchParams({
    lat: String(place.lat), lng: String(place.lng), ...(service && { service }),
    ...(f.sort && { sort: f.sort }), ...(f.emergency && { emergency: 'true' }), ...(f.availableNow && { availableNow: 'true' }),
  });
  const res = await fetch(`${process.env.API_URL}/api/v1/providers/search?${qs}`, { next: { revalidate: 60 } });
  return { place, results: res.ok ? ((await res.json()) as ProviderSearchResult[]) : null };
}

// Rendu serveur : indexable par Google (/prestataires?service=…&ville=…)
export default async function SearchPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { service, ville, tri, urgences, dispo } = await searchParams;
  const filters = { sort: tri && tri in SORTS ? SORTS[tri as keyof typeof SORTS] : undefined, emergency: urgences === '1', availableNow: dispo === '1' };
  const found = ville ? await search(service && service in SERVICE_LABELS ? service : undefined, ville, filters) : null;
  const filtered = filters.emergency || filters.availableNow;

  const requestHref = `/client/demandes/nouvelle${service && service in SERVICE_LABELS ? `?service=${service}` : ''}`;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold sm:text-3xl">Trouver un prestataire</h1>
      <p className="mt-1 text-muted-foreground">Les pros du froid, du chauffage et de la climatisation qui interviennent chez vous.</p>
      <Card className="mt-5 p-4">
      <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Select name="service" aria-label="Service" defaultValue={service ?? ''}>
          <option value="">Tous les services</option>
          {SERVICE_TYPES.map((s) => <option key={s} value={s}>{SERVICE_LABELS[s]}</option>)}
        </Select>
        <Input name="ville" aria-label="Ville ou code postal" placeholder="Ville ou code postal" defaultValue={ville ?? ''} required />
        <Button>Rechercher</Button>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm sm:col-span-3">
          <label className="flex min-h-9 items-center gap-2"><input type="checkbox" name="dispo" value="1" defaultChecked={dispo === '1'} className="size-4" />Disponible maintenant</label>
          <label className="flex min-h-9 items-center gap-2"><input type="checkbox" name="urgences" value="1" defaultChecked={urgences === '1'} className="size-4" />Urgences acceptées</label>
          <label className="flex items-center gap-2 sm:ml-auto">Trier par
            <Select name="tri" defaultValue={tri ?? ''} className="w-auto">
              <option value="">Pertinence</option>
              <option value="note">Mieux notés</option>
              <option value="distance">Plus proches</option>
            </Select>
          </label>
        </div>
      </form>
      <LocateButton keep={{ service, tri, urgences, dispo }} />
      </Card>

      {!found && <p className="mt-8 text-muted-foreground">Indiquez une ville ou un code postal pour voir les prestataires qui interviennent chez vous.</p>}
      {found && !found.place && <p role="alert" className="mt-8 text-destructive">Ville introuvable, vérifiez l&apos;orthographe ou saisissez un code postal.</p>}
      {found?.place && found.results === null && <p role="alert" className="mt-8 text-destructive">Recherche momentanément indisponible.</p>}
      {found?.place && found.results?.length === 0 && (
        <div className="mt-8 rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">Aucun prestataire disponible à {found.place.label} pour le moment.</p>
          <p className="mt-1 text-sm text-muted-foreground">{filtered ? 'Essayez sans les filtres, ou déposez' : 'Déposez'} quand même votre demande : nous prévenons dès qu&apos;un pro peut intervenir.</p>
          {filtered && <Button asChild variant="outline" className="mt-4 mr-2"><Link href={`/prestataires?${new URLSearchParams({ ...(service && { service }), ville: ville! })}`}>Retirer les filtres</Link></Button>}
          <Button asChild className="mt-4"><Link href={requestHref}>Déposer une demande</Link></Button>
        </div>
      )}

      {!!found?.results?.length && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent p-4 text-accent-foreground">
          <p className="text-sm"><b>{found.results.length} pro{found.results.length > 1 ? 's' : ''}</b> à proximité de {found.place?.label}. Pas envie de choisir ? Décrivez votre besoin, ils vous envoient leurs devis.</p>
          <Button asChild><Link href={requestHref}>Déposer une demande</Link></Button>
        </div>
      )}

      <ul className="mt-6 grid gap-3">
        {found?.results?.map((p) => (
          <li key={p.providerId}>
            <Card className="flex flex-col gap-4 p-4 transition-shadow hover:shadow-md sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-4">
              <ProviderAvatar name={p.companyName} fileId={p.logoFileId} />
              <div className="min-w-0 flex-1">
                <Link href={`/prestataires/${p.slug}`} className="font-semibold hover:underline">{p.companyName}</Link>
                {p.headline && <p className="truncate text-sm text-muted-foreground">{p.headline}</p>}
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  {p.reviewsCount > 0
                    ? <span className="inline-flex items-center gap-1 font-medium text-foreground"><Star className="size-3.5 fill-current text-warning" />{p.avgRating.toFixed(1)} <span className="font-normal text-muted-foreground">({p.reviewsCount})</span></span>
                    : <Badge variant="secondary">Nouveau</Badge>}
                  <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{p.distanceKm < 1 ? '< 1 km' : `${p.distanceKm} km`}{p.city ? ` · ${p.city}` : ''}</span>
                  {p.avgResponseMinutes !== null && <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />répond en {duration(p.avgResponseMinutes)}</span>}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.availableNow && <Badge variant="success">● Disponible maintenant</Badge>}
                  {p.emergencyAvailable && <Badge variant="warning">Urgences</Badge>}
                  {p.services.slice(0, 3).map((s) => <Badge key={s}>{SERVICE_LABELS[s] ?? s}</Badge>)}
                  {p.services.length > 3 && <Badge variant="outline">+{p.services.length - 3}</Badge>}
                </div>
              </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-col">
                <Button asChild variant="outline"><Link href={`/prestataires/${p.slug}`}>Voir le profil</Link></Button>
                <Button asChild><Link href={`${requestHref}${requestHref.includes('?') ? '&' : '?'}provider=${p.providerId}&name=${encodeURIComponent(p.companyName)}`}>Demander un devis</Link></Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </main>
  );
}
