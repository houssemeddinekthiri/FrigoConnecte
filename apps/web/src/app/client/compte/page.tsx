import type { Metadata } from 'next';
import { TemplatesCard } from '@/components/templates-card';
import { Account } from './account';

export const metadata: Metadata = { title: 'Mon compte' };

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight">Mon compte</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Vos informations, celles de votre société et de facturation.</p>
      <Account />
      <div className="mt-6"><TemplatesCard /></div>
    </div>
  );
}
