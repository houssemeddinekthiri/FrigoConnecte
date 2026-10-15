import type { Metadata } from 'next';
import { Invoices } from './invoices';

export const metadata: Metadata = { title: 'Factures' };

export default function ProviderInvoicesPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight">Factures</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Une facture est émise en votre nom dès que le client valide l&apos;intervention. Elle reprend les mentions légales ci-dessous.</p>
      <Invoices />
    </div>
  );
}
