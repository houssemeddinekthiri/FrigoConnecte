import type { Metadata } from 'next';
import { signIn } from '@/auth';
import { Button } from '@/components/ui/button';
import { AutoSubmit } from '@/components/auto-submit';

export const metadata: Metadata = { title: 'Connexion' };

// Cette page n'affiche rien : elle envoie tout de suite vers la page de connexion (Keycloak habillé FrigoConnect).
// Seule exception : après une erreur de connexion, un bouton « Réessayer » évite de repartir en boucle.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; error?: string }> }) {
  const { callbackUrl, error } = await searchParams;
  // callbackUrl relatif uniquement : évite la redirection ouverte
  const redirectTo = callbackUrl?.startsWith('/') && !callbackUrl.startsWith('//') ? callbackUrl : '/client';

  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <form
        id="login-form"
        action={async () => {
          'use server';
          await signIn('keycloak', { redirectTo });
        }}
      >
        {error ? (
          <>
            <p className="mb-4 text-muted-foreground">Connexion impossible.</p>
            <Button size="lg">Réessayer</Button>
          </>
        ) : (
          <AutoSubmit formId="login-form" />
        )}
      </form>
    </main>
  );
}
