import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewRequest } from './new-request-modes';

export const metadata: Metadata = { title: 'Nouvelle demande' };

export default function NewRequestPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight">Décrivez votre besoin</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Quelques questions, et les prestataires proches vous envoient leurs devis.</p>
      <Suspense><NewRequest /></Suspense>
    </div>
  );
}
