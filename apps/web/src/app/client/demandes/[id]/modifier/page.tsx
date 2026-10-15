import type { Metadata } from 'next';
import { EditRequest } from './edit-request';

export const metadata: Metadata = { title: 'Modifier la demande' };

export default async function EditRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Modifier la demande</h1>
      <EditRequest id={id} />
    </div>
  );
}
