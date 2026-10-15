import type { Metadata } from 'next';
import { Equipment } from './equipment';

export const metadata: Metadata = { title: 'Mes équipements' };

export default function EquipmentPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight">Mes équipements</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Enregistrez-les une fois : vos prochaines demandes se remplissent en un clic.</p>
      <Equipment />
    </div>
  );
}
