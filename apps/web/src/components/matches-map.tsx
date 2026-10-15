'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

export interface MapMatch { companyName: string; lat: number; lng: number; distanceKm: number; availableNow: boolean }

/** Carte OpenStreetMap : l'adresse du client et les prestataires prévenus, numérotés dans l'ordre de la liste. */
export function MatchesMap({ center, matches }: { center: { lat: number; lng: number }; matches: MapMatch[] }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import('leaflet').Map | undefined;
    let cancelled = false;
    // Leaflet lit `window` dès l'import : chargé côté navigateur seulement
    void import('leaflet').then(({ default: L }) => {
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
      L.circleMarker([center.lat, center.lng], { radius: 8, color: '#fff', weight: 2, fillColor: '#185FA5', fillOpacity: 1 }).addTo(map).bindTooltip('Votre adresse');
      matches.forEach((m, i) => {
        const tip = document.createElement('span'); // textContent : le nom vient du prestataire, jamais injecté en HTML
        tip.textContent = `${m.companyName} · ${m.distanceKm < 1 ? '< 1 km' : `${m.distanceKm} km`}`;
        const icon = L.divIcon({
          className: '', iconSize: [24, 24],
          html: `<span class="grid size-6 place-items-center rounded-full border-2 border-white text-xs font-semibold text-white" style="background:${m.availableNow ? '#0F6E56' : '#5F5E5A'}">${i + 1}</span>`,
        });
        L.marker([m.lat, m.lng], { icon, keyboard: false }).addTo(map!).bindTooltip(tip);
      });
      map.fitBounds([[center.lat, center.lng], ...matches.map((m) => [m.lat, m.lng] as [number, number])], { padding: [30, 30], maxZoom: 14 });
    });
    return () => { cancelled = true; map?.remove(); };
  }, [center.lat, center.lng, matches]);

  return (
    <div className="mb-2 overflow-hidden rounded-xl border">
      {/* isolate : les calques Leaflet (z-index 400+) ne passent pas au-dessus des panneaux de la page */}
      <div ref={el} className="isolate h-72" role="img" aria-label="Carte des prestataires prévenus ; la liste ci-dessous donne les mêmes informations" />
      <p className="flex flex-wrap gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
        <Dot color="#185FA5" label="Votre adresse" /><Dot color="#0F6E56" label="Disponible maintenant" /><Dot color="#5F5E5A" label="Prévenu" />
        <span className="ml-auto">Positions approximatives</span>
      </p>
    </div>
  );
}

const Dot = ({ color, label }: { color: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: color }} />{label}</span>
);
