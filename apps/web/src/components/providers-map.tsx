'use client';

import 'leaflet/dist/leaflet.css';
import { LocateFixed, MapPin, Star } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderMapPoint } from '@frigoconnect/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { popup } from './matches-map';

type LatLng = { lat: number; lng: number };
const FRANCE: LatLng = { lat: 46.6, lng: 2.4 };
const NEAREST = 5;

/** Distance à vol d'oiseau (haversine), en km. */
function distanceKm(a: LatLng, b: LatLng) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}
const km = (d: number) => (d < 1 ? '< 1 km' : `${Math.round(d)} km`);

/**
 * Carte de TOUS les prestataires (pas seulement ceux d'une recherche). « Autour de moi » ou une ville (`center`) recentre la carte
 * et liste les plus proches, à vol d'oiseau : le client voit d'un coup d'œil qui est à côté de lui.
 */
export function ProvidersMap({ points, center, centerLabel }: { points: ProviderMapPoint[]; center?: LatLng | null; centerLabel?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const [me, setMe] = useState<LatLng | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  const origin = me ?? center ?? null;
  const originLabel = me ? 'Votre position' : centerLabel ?? 'Votre recherche';

  const nearest = useMemo(
    () => (origin ? points.map((p) => ({ ...p, distanceKm: distanceKm(origin, p) })).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, NEAREST) : []),
    [origin, points],
  );

  useEffect(() => {
    let map: import('leaflet').Map | undefined;
    let cancelled = false;
    // Leaflet lit `window` dès l'import : chargé côté navigateur seulement
    void import('leaflet').then(({ default: L }) => {
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
      for (const p of points) {
        const tip = document.createElement('span'); // textContent : le nom vient du prestataire, jamais injecté en HTML
        tip.textContent = p.companyName;
        L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: p.availableNow ? '#0F6E56' : '#5F5E5A', fillOpacity: 1 })
          .addTo(map).bindTooltip(tip).bindPopup(popup(origin ? { ...p, distanceKm: Math.round(distanceKm(origin, p)) } : p));
      }
      if (origin) {
        L.circleMarker([origin.lat, origin.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#185FA5', fillOpacity: 1 }).addTo(map).bindTooltip(originLabel);
        // cadre : ma position et les plus proches, pour voir tout de suite qui est à côté
        map.fitBounds([[origin.lat, origin.lng], ...nearest.map((p) => [p.lat, p.lng] as [number, number])], { padding: [40, 40], maxZoom: 12 });
      } else if (points.length) {
        map.fitBounds(points.map((p) => [p.lat, p.lng] as [number, number]), { padding: [30, 30], maxZoom: 11 });
      } else {
        map.setView([FRANCE.lat, FRANCE.lng], 5);
      }
    });
    return () => { cancelled = true; map?.remove(); };
  }, [points, origin, originLabel, nearest]);

  function locate() {
    setState('busy');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setMe({ lat: coords.latitude, lng: coords.longitude }); setState('idle'); },
      () => setState('error'),
      { timeout: 10_000 },
    );
  }

  return (
    <section aria-labelledby="map-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="map-title" className="text-lg font-semibold">Carte des prestataires</h2>
          <p className="text-sm text-muted-foreground">{points.length} professionnel{points.length > 1 ? 's' : ''} sur la carte. Cliquez sur un repère pour voir sa fiche.</p>
        </div>
        <Button type="button" disabled={state === 'busy'} onClick={locate}><LocateFixed /> {state === 'busy' ? 'Localisation…' : me ? 'Actualiser ma position' : 'Autour de moi'}</Button>
      </div>
      {state === 'error' && <p role="alert" className="mb-3 text-sm text-destructive">Position indisponible : autorisez la localisation dans votre navigateur, ou saisissez votre ville ci-dessus.</p>}

      <div className="overflow-hidden rounded-xl border">
        {/* isolate : les calques Leaflet (z-index 400+) ne passent pas au-dessus des panneaux de la page */}
        <div ref={el} className="isolate h-[26rem]" role="img" aria-label="Carte de tous les prestataires" />
        <p className="flex flex-wrap gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
          {origin && <Dot color="#185FA5" label={originLabel} />}<Dot color="#0F6E56" label="Disponible maintenant" /><Dot color="#5F5E5A" label="Prestataire" />
          <span className="ml-auto">Positions approximatives</span>
        </p>
      </div>

      {origin && nearest.length > 0 && (
        <div className="mt-5">
          <h3 className="font-semibold">Les plus proches de {me ? 'vous' : centerLabel ?? 'votre recherche'}</h3>
          <p className="text-sm text-muted-foreground">Distances à vol d&apos;oiseau. Chaque professionnel a sa propre zone d&apos;intervention, indiquée sur sa fiche.</p>
          <ul className="mt-3 grid gap-2">
            {nearest.map((p) => (
              <li key={p.slug}>
                <Link href={`/prestataires/${p.slug}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.companyName}</span>
                    <span className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{km(p.distanceKm)}{p.city ? ` · ${p.city}` : ''}</span>
                      {p.reviewsCount > 0 && <span className="inline-flex items-center gap-1"><Star className="size-3.5 fill-current text-warning" />{p.avgRating.toFixed(1)} ({p.reviewsCount})</span>}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {p.availableNow && <Badge variant="success">● Disponible maintenant</Badge>}
                    {p.emergencyAvailable && <Badge variant="warning">Urgences</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const Dot = ({ color, label }: { color: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: color }} />{label}</span>
);
