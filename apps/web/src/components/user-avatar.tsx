'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Pastille de la barre latérale : logo du compte s'il existe (client), sinon l'initiale. */
export function UserAvatar({ name, withLogo }: { name: string; withLogo?: boolean }) {
  const profile = useQuery({ queryKey: ['client-profile'], queryFn: () => api<{ logoFileId: string | null }>('client/profile'), enabled: !!withLogo });
  const fileId = profile.data?.logoFileId;
  // l'URL signée vit 5 min : on la renouvelle un peu avant
  const logo = useQuery({ queryKey: ['logo-url', fileId], queryFn: () => api<{ url: string }>(`files/${fileId}/download-url`), enabled: !!fileId, staleTime: 4 * 60_000, refetchInterval: 4 * 60_000 }).data?.url;
  return (
    <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-primary text-sm font-semibold uppercase text-primary-foreground">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo ? <img src={logo} alt="" className="size-full bg-white object-contain" /> : name[0]}
    </span>
  );
}
