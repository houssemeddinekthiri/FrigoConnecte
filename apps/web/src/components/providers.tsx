'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { ThemeProvider } from 'next-themes';
import { useState } from 'react';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // pas de retry sur les erreurs 4xx : elles ne changeront pas
            retry: (n, e) => !(e instanceof ApiError && e.status < 500 && e.status !== 401) && n < 2,
          },
        },
      }),
  );
  // refetchInterval < durée du jeton (10 min) : /api/auth/session déclenche le refresh côté serveur
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SessionProvider refetchInterval={240} refetchOnWindowFocus>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
