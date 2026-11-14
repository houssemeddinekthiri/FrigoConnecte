import type { Metadata } from 'next';
import { Search, Snowflake } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Page introuvable' };

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-16 text-center">
      <div className="max-w-md">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent text-accent-foreground"><Snowflake className="size-7" /></span>
        <p className="mt-6 text-sm font-semibold text-primary">Erreur 404</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Cette page est introuvable</h1>
        <p className="mt-3 text-muted-foreground">Le lien est peut-être ancien, ou la page a été déplacée.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Button asChild><Link href="/">Retour à l&apos;accueil</Link></Button>
          <Button asChild variant="outline"><Link href="/prestataires"><Search /> Trouver un pro</Link></Button>
        </div>
      </div>
    </main>
  );
}
