import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'FrigoConnect', template: '%s | FrigoConnect' },
  description: 'Trouvez un frigoriste, chauffagiste ou technicien CVC qualifié près de chez vous.',
  applicationName: 'FrigoConnect',
  appleWebApp: { capable: true, title: 'FrigoConnect', statusBarStyle: 'default' },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // encoches iPhone : on gère nous-mêmes les safe areas
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#ffffff' }, { media: '(prefers-color-scheme: dark)', color: '#0b1220' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
