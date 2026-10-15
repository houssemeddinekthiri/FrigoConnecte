'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from '@/lib/api';

const Ctx = createContext<Socket | null>(null);

/**
 * Connexion Socket.IO authentifiée par un ticket de 30 s demandé au BFF (le jeton d'accès reste côté serveur).
 * `auth` est une fonction : à chaque (re)connexion, un ticket frais est demandé.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const s = io(process.env.NEXT_PUBLIC_WS_URL || window.location.origin, {
      transports: ['websocket'],
      auth: (cb) => {
        api<{ ticket: string }>('realtime/ticket', { method: 'POST' })
          .then((t) => cb({ ticket: t.ticket }))
          .catch(() => cb({})); // le serveur refusera, socket.io retentera avec son backoff
      },
    });
    setSocket(s);
    return () => {
      s.close();
    };
  }, []);

  return <Ctx.Provider value={socket}>{children}</Ctx.Provider>;
}

export function useRealtimeEvent<T>(event: string, handler: (payload: T) => void) {
  const socket = useContext(Ctx);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!socket) return;
    const fn = (p: T) => latest.current(p);
    socket.on(event, fn);
    return () => {
      socket.off(event, fn);
    };
  }, [socket, event]);
}
