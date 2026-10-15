'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, Paperclip, Send } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationSummary, MessageDto } from '@frigoconnect/contracts';
import { ALLOWED_MIME, MAX_FILE_BYTES } from '@frigoconnect/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form-controls';
import { api } from '@/lib/api';
import { useRealtimeEvent } from '@/lib/realtime';
import { cn } from '@/lib/utils';

const PAGE = 30;
const time = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function Messenger() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: () => api<ConversationSummary[]>('conversations') });

  // Nouveau message : la liste (aperçu, non-lus) et le fil ouvert se rafraîchissent
  useRealtimeEvent<MessageDto>('message:new', (m) => {
    void qc.invalidateQueries({ queryKey: ['conversations'] });
    void qc.invalidateQueries({ queryKey: ['messages', m.conversationId] });
  });
  useRealtimeEvent('conversation:read', () => void qc.invalidateQueries({ queryKey: ['conversations'] }));

  const current = conversations.data?.find((c) => c.id === selected) ?? null;

  return (
    <div className="grid h-[calc(100dvh-13rem)] overflow-hidden rounded-lg border md:h-[calc(100dvh-7rem)] md:grid-cols-[18rem_1fr]">
      <aside className={cn('overflow-y-auto border-r', selected && 'hidden md:block')}>
        {conversations.isPending && <p className="p-4 text-sm text-muted-foreground">Chargement…</p>}
        {conversations.data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">Aucune conversation. Elles apparaissent dès qu&apos;une demande vous met en relation avec un prestataire.</p>}
        <ul>
          {conversations.data?.map((c) => (
            <li key={c.id}>
              <button onClick={() => setSelected(c.id)} className={cn('flex w-full flex-col gap-0.5 border-b px-4 py-3 text-left hover:bg-accent/50', c.id === selected && 'bg-accent')}>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{c.counterpart.name}</span>
                  {c.unreadCount > 0 && <Badge variant="success">{c.unreadCount}</Badge>}
                </span>
                {c.requestTitle && <span className="truncate text-xs text-muted-foreground">{c.requestTitle}</span>}
                <span className="truncate text-sm text-muted-foreground">{c.lastMessage ? (c.lastMessage.type === 'file' ? '📎 Pièce jointe' : c.lastMessage.body) : 'Aucun message'}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className={cn('flex min-h-0 flex-col', !selected && 'hidden md:flex')}>
        {current ? <Thread key={current.id} conversation={current} onBack={() => setSelected(null)} /> : <p className="m-auto p-4 text-muted-foreground">Sélectionnez une conversation</p>}
      </section>
    </div>
  );
}

function Thread({ conversation, onBack }: { conversation: ConversationSummary; onBack: () => void }) {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const me = session?.user.id;
  const isProvider = !!session?.user.roles.includes('provider');
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const messages = useInfiniteQuery({
    queryKey: ['messages', conversation.id],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => api<MessageDto[]>(`conversations/${conversation.id}/messages?limit=${PAGE}${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].id : undefined), // curseur = plus ancien id reçu
  });
  const ordered = useMemo(() => (messages.data?.pages.flat() ?? []).slice().reverse(), [messages.data]);

  const markRead = useMutation({
    mutationFn: () => api(`conversations/${conversation.id}/read`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
  // Marque lu à l'ouverture et quand un message arrive pendant que le fil est ouvert
  const lastId = ordered[ordered.length - 1]?.id;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
    if (lastId && conversation.unreadCount > 0) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);

  const send = useMutation({
    mutationFn: (body: { body?: string; fileId?: string }) => api<MessageDto>(`conversations/${conversation.id}/messages`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (m) => {
      if (m.masked) setNotice('Vos coordonnées ont été masquées : elles seront échangeables après l\'acceptation d\'un devis.');
      void qc.invalidateQueries({ queryKey: ['messages', conversation.id] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  const attach = useMutation({
    mutationFn: async (file: File) => {
      const up = await api<{ fileId: string; url: string; headers: Record<string, string> }>('files/upload-url', {
        method: 'POST', body: JSON.stringify({ fileName: file.name, mimeType: file.type, sizeBytes: file.size }),
      });
      const put = await fetch(up.url, { method: 'PUT', headers: up.headers, body: file }); // direct vers MinIO
      if (!put.ok) throw new Error('UPLOAD_FAILED');
      await api(`files/${up.fileId}/confirm`, { method: 'POST' });
      return send.mutateAsync({ fileId: up.fileId });
    },
  });

  const onPick = (file?: File) => {
    setNotice(null);
    if (!file) return;
    if (!(ALLOWED_MIME as readonly string[]).includes(file.type)) return setNotice('Formats acceptés : PDF, JPEG, PNG, WebP.');
    if (file.size > MAX_FILE_BYTES) return setNotice('Fichier trop volumineux (25 Mo maximum).');
    attach.mutate(file);
  };

  const download = async (id: string) => window.open((await api<{ url: string }>(`files/${id}/download-url`)).url, '_blank', 'noopener');

  return (
    <>
      <header className="flex items-center gap-2 border-b p-3">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="Retour"><ArrowLeft /></Button>
        <div className="min-w-0">
          <p className="truncate font-semibold">{conversation.counterpart.name}</p>
          {conversation.requestTitle && <p className="truncate text-xs text-muted-foreground">{conversation.requestTitle}</p>}
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
        {messages.hasNextPage && <Button variant="ghost" size="sm" className="mx-auto flex" onClick={() => void messages.fetchNextPage()} disabled={messages.isFetchingNextPage}>Messages précédents</Button>}
        {ordered.map((m) => {
          const mine = m.senderId === me;
          return (
            <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[85%] rounded-lg px-3 py-2 text-sm', mine ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground', m.type === 'system' && 'mx-auto bg-muted italic')}>
                {m.type === 'quote' ? (
                  <Link href={isProvider ? '/prestataire/devis' : `/client/demandes/${conversation.requestId}`} className="flex items-center gap-1 font-medium underline"><FileText className="size-4" />{m.body} — voir le devis</Link>
                ) : (
                  m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>
                )}
                {m.file && <button onClick={() => void download(m.file!.id)} className="mt-1 flex items-center gap-1 underline"><Paperclip className="size-3.5" />{m.file.name}</button>}
                {m.masked && <p className="mt-1 text-[11px] opacity-80">Coordonnées masquées avant acceptation d&apos;un devis</p>}
                <p className="mt-0.5 text-right text-[10px] opacity-70">{time(m.createdAt)}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {(notice || send.isError || attach.isError) && <p role="alert" className="border-t px-3 py-2 text-xs text-warning">{notice ?? 'Envoi impossible, réessayez.'}</p>}
      <form
        className="flex items-center gap-2 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          const body = text.trim();
          if (!body) return;
          setNotice(null);
          setText('');
          send.mutate({ body });
        }}
      >
        <input ref={fileInput} type="file" hidden accept={ALLOWED_MIME.join(',')} onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }} />
        <Button type="button" variant="ghost" size="icon" aria-label="Joindre un fichier" disabled={attach.isPending} onClick={() => fileInput.current?.click()}><Paperclip /></Button>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Votre message…" aria-label="Message" maxLength={4000} />
        <Button size="icon" aria-label="Envoyer" disabled={send.isPending || !text.trim()}><Send /></Button>
      </form>
    </>
  );
}
