import type { Metadata } from 'next';
import { Documents } from './documents';

export const metadata: Metadata = { title: 'Mes documents' };

export default function DocumentsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight">Mes documents</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Vos devis signés et vos paiements, au même endroit, prêts pour la comptabilité.</p>
      <Documents />
    </div>
  );
}
