'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { NotificationDto } from '@frigoconnect/contracts';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { useRealtimeEvent } from '@/lib/realtime';
import { cn } from '@/lib/utils';

export function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ items: NotificationDto[]; unread: number }>('notifications') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['notifications'] });
  useRealtimeEvent('notification', refresh);
  const readAll = useMutation({ mutationFn: () => api('notifications/read-all', { method: 'POST' }), onSuccess: refresh });
  const unread = data?.unread ?? 0;

  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (o && unread) readAll.mutate(); }}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `Notifications, ${unread} non lues` : 'Notifications'} className="relative">
          <Bell />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-destructive-foreground">{unread > 9 ? '9+' : unread}</span>}
        </Button>
      </SheetTrigger>
      <SheetContent title="Notifications" side="right">
        {data?.items.length === 0 && <p className="text-sm text-muted-foreground">Rien pour le moment.</p>}
        <ul className="grid gap-2">
          {data?.items.map((n) => {
            // lien enregistré par l'API avec la notification ; seules les pages internes sont suivies
            const href = typeof n.data.href === 'string' && n.data.href.startsWith('/') ? n.data.href : null;
            const content = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{n.title}</span>
                  {n.body && <span className="block text-muted-foreground">{n.body}</span>}
                  <span className="mt-1 block text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </span>
                {href && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
              </>
            );
            const box = cn('flex items-center gap-2 rounded-md border p-3 text-sm', !n.readAt && 'border-primary/40 bg-accent/40');
            return (
              <li key={n.id}>
                {href
                  ? <Link href={href} onClick={() => setOpen(false)} className={cn(box, 'transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>{content}</Link>
                  : <div className={box}>{content}</div>}
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
