import type { Metadata } from 'next';
import { EmergencyForm } from './emergency-form';

export const metadata: Metadata = { title: 'Panne urgente' };

export default function EmergencyPage() {
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight">Panne urgente</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Deux informations suffisent : les prestataires proches sont prévenus immédiatement.</p>
      <EmergencyForm />
    </div>
  );
}
