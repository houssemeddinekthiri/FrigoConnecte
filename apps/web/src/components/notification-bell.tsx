'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
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
          {data?.items.map((n) => (
            <li key={n.id} className={cn('rounded-md border p-3 text-sm', !n.readAt && 'border-primary/40 bg-accent/40')}>
              <p className="font-medium">{n.title}</p>
              {n.body && <p className="text-muted-foreground">{n.body}</p>}
              <p className="mt-1 text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</p>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
