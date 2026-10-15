'use client';

import { LocateFixed } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/** « Autour de moi » : position du navigateur -> ville (API Adresse) -> même recherche que la saisie manuelle (service, filtres et tri conservés). */
export function LocateButton({ keep }: { keep: Record<string, string | undefined> }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');

  function locate() {
    setState('busy');
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const res = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${coords.longitude}&lat=${coords.latitude}&type=municipality`);
          const postcode = (await res.json()).features?.[0]?.properties?.postcode as string | undefined;
          if (!postcode) throw new Error('no-city');
          router.push(`/prestataires?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(keep).filter(([, v]) => v)) as Record<string, string>), ville: postcode })}`);
          setState('idle');
        } catch { setState('error'); }
      },
      () => setState('error'),
      { timeout: 10_000 },
    );
  }

  return (
    <div className="mt-2">
      <Button type="button" variant="ghost" size="sm" disabled={state === 'busy'} onClick={locate}><LocateFixed /> {state === 'busy' ? 'Localisation…' : 'Autour de moi'}</Button>
      {state === 'error' && <span role="alert" className="ml-2 text-sm text-destructive">Position indisponible, saisissez votre ville.</span>}
    </div>
  );
}
