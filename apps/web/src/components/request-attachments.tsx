'use client';

import { useQuery } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import { api } from '@/lib/api';

/** Pièces jointes d'une demande (client propriétaire ou prestataire mis en relation). N'affiche rien s'il n'y en a pas. */
export function RequestAttachments({ requestId }: { requestId: string }) {
  const { data } = useQuery({ queryKey: ['attachments', requestId], queryFn: () => api<{ id: string; name: string }[]>(`service-requests/${requestId}/attachments`) });
  if (!data?.length) return null;
  const open = async (id: string) => window.open((await api<{ url: string }>(`files/${id}/download-url`)).url, '_blank', 'noopener');
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {data.map((f) => (
        <button key={f.id} type="button" onClick={() => void open(f.id)} className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border px-3 py-1 text-sm hover:bg-secondary">
          <Paperclip className="size-3.5 shrink-0" /><span className="truncate">{f.name}</span>
        </button>
      ))}
    </div>
  );
}
