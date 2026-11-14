'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

export interface MapMatch {
  companyName: string; lat: number; lng: number; distanceKm: number; availableNow: boolean;
  /** Détails de la bulle ouverte au clic sur le repère (facultatifs). */
  slug?: string; city?: string | null; avgRating?: number; reviewsCount?: number;
}

const km = (d: number) => (d < 1 ? '< 1 km' : `${d} km`);

/** Bulle du repère, construite en DOM (textContent) : les textes viennent du prestataire, jamais injectés en HTML. */
export function popup(m: Omit<MapMatch, 'distanceKm'> & { distanceKm?: number }) {
  const line = (text: string, className: string) => Object.assign(document.createElement('div'), { textContent: text, className });
  const box = document.createElement('div');
  box.className = 'grid gap-1 text-sm';
  box.append(line(m.companyName, 'font-semibold'), line([m.city, m.distanceKm === undefined ? null : km(m.distanceKm)].filter(Boolean).join(' · '), 'text-[#5F5E5A]')); // couleurs fixes : la bulle Leaflet reste blanche en thème sombre
  if (m.reviewsCount) box.append(line(`★ ${m.avgRating?.toFixed(1)} (${m.reviewsCount} avis)`, ''));
  if (m.availableNow) box.append(line('● Disponible maintenant', 'font-medium text-[#0F6E56]'));
  if (m.slug) box.append(Object.assign(document.createElement('a'), { href: `/prestataires/${m.slug}`, textContent: 'Voir le profil', className: 'font-medium underline' }));
  return box;
}

/** Carte OpenStreetMap : la position du client et les prestataires, numérotés dans l'ordre de la liste. Clic sur un repère = sa fiche. */
export function MatchesMap({ center, matches, centerLabel = 'Votre adresse', otherLabel = 'Prévenu' }: {
  center: { lat: number; lng: number }; matches: MapMatch[]; centerLabel?: string; otherLabel?: string;
}) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import('leaflet').Map | undefined;
    let cancelled = false;
    // Leaflet lit `window` dès l'import : chargé côté navigateur seulement
    void import('leaflet').then(({ default: L }) => {
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
      L.circleMarker([center.lat, center.lng], { radius: 8, color: '#fff', weight: 2, fillColor: '#185FA5', fillOpacity: 1 }).addTo(map).bindTooltip(centerLabel);
      matches.forEach((m, i) => {
        const tip = document.createElement('span'); // textContent : le nom vient du prestataire, jamais injecté en HTML
        tip.textContent = `${m.companyName} · ${km(m.distanceKm)}`;
        const icon = L.divIcon({
          className: '', iconSize: [24, 24],
          html: `<span class="grid size-6 place-items-center rounded-full border-2 border-white text-xs font-semibold text-white" style="background:${m.availableNow ? '#0F6E56' : '#5F5E5A'}">${i + 1}</span>`,
        });
        L.marker([m.lat, m.lng], { icon }).addTo(map!).bindTooltip(tip).bindPopup(popup(m));
      });
      map.fitBounds([[center.lat, center.lng], ...matches.map((m) => [m.lat, m.lng] as [number, number])], { padding: [30, 30], maxZoom: 14 });
    });
    return () => { cancelled = true; map?.remove(); };
  }, [center.lat, center.lng, matches, centerLabel]);

  return (
    <div className="mb-2 overflow-hidden rounded-xl border">
      {/* isolate : les calques Leaflet (z-index 400+) ne passent pas au-dessus des panneaux de la page */}
      <div ref={el} className="isolate h-72" role="img" aria-label="Carte des prestataires ; la liste ci-dessous donne les mêmes informations" />
      <p className="flex flex-wrap gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
        <Dot color="#185FA5" label={centerLabel} /><Dot color="#0F6E56" label="Disponible maintenant" /><Dot color="#5F5E5A" label={otherLabel} />
        <span className="ml-auto">Positions approximatives</span>
      </p>
    </div>
  );
}

const Dot = ({ color, label }: { color: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: color }} />{label}</span>
);
