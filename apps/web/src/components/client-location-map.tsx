'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

/** Carte OpenStreetMap du chantier : position approximative du client (arrondie côté API). */
export function ClientLocationMap({ location, label = 'Client' }: { location: { lat: number; lng: number }; label?: string }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import('leaflet').Map | undefined;
    let cancelled = false;
    void import('leaflet').then(({ default: L }) => {
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false }).setView([location.lat, location.lng], 12);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
      L.circleMarker([location.lat, location.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#185FA5', fillOpacity: 1 }).addTo(map).bindTooltip(label);
      L.circle([location.lat, location.lng], { radius: 1000, color: '#185FA5', weight: 1, fillOpacity: 0.1 }).addTo(map);
    });
    return () => { cancelled = true; map?.remove(); };
  }, [location.lat, location.lng, label]);

  return (
    <div className="mt-3 overflow-hidden rounded-xl border">
      <div ref={el} className="isolate h-48" role="img" aria-label="Carte : position approximative du client" />
      <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">Position approximative du client. L&apos;adresse exacte est communiquée après acceptation du devis.</p>
    </div>
  );
}
