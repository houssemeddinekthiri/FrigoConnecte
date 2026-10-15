import type { Metadata } from 'next';
import { QuoteForm } from './quote-form';

export const metadata: Metadata = { title: 'Nouveau devis' };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ requestId?: string }> }) {
  const { requestId } = await searchParams;
  if (!requestId) return <p className="text-muted-foreground">Choisissez d&apos;abord une demande dans « Demandes ».</p>;
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold">Nouveau devis</h1>
      <QuoteForm requestId={requestId} />
    </div>
  );
}
