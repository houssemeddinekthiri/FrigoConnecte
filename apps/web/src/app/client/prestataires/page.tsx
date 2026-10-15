import type { Metadata } from 'next';
import { Favorites } from './favorites';

export const metadata: Metadata = { title: 'Mes prestataires' };

export default function FavoritesPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight">Mes prestataires</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Ajoutez avec le cœur ♥ les prestataires qui vous ont convaincu sur la page d&apos;un devis, puis re-sollicitez-les en un clic.</p>
      <Favorites />
    </div>
  );
}
