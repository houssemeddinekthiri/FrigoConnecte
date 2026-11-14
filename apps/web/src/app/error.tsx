'use client';

import { RotateCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/** Erreur inattendue d'une page : message clair, nouvel essai sans recharger tout le site, référence à donner au support. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-16 text-center">
      <div className="max-w-md">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive"><TriangleAlert className="size-7" /></span>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">Un problème est survenu</h1>
        <p className="mt-3 text-muted-foreground">Rien n&apos;est perdu de notre côté. Réessayez dans un instant ; si le problème persiste, contactez-nous.</p>
        {error.digest && <p className="mt-3 text-xs text-muted-foreground">Référence à nous communiquer : <code className="font-mono">{error.digest}</code></p>}
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Button onClick={reset}><RotateCw /> Réessayer</Button>
          <Button asChild variant="outline"><Link href="/">Retour à l&apos;accueil</Link></Button>
        </div>
      </div>
    </main>
  );
}
