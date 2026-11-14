import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';
import { SITE_URL } from '@/lib/site';
import './globals.css';

const description = 'Trouvez un frigoriste, chauffagiste ou technicien CVC qualifié près de chez vous.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'FrigoConnect : frigoristes, chauffagistes et techniciens CVC', template: '%s | FrigoConnect' },
  description,
  // aperçu lors d'un partage (WhatsApp, LinkedIn, SMS) ; chaque page peut le préciser
  openGraph: { type: 'website', siteName: 'FrigoConnect', locale: 'fr_FR', title: 'FrigoConnect', description },
  twitter: { card: 'summary' },
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
