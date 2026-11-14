import Link from 'next/link';
import { auth } from '@/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { BottomNav } from '@/components/bottom-nav';
import { RegisterSW } from '@/components/pwa';

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const roles = session?.user.roles ?? [];
  const space = roles.includes('super_admin') ? '/admin' : roles.includes('provider') ? '/prestataire' : '/client';

  return (
    <>
      <header className="sticky top-0 z-20 border-b bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2">
          <Link href="/" className="text-lg font-bold text-primary">FrigoConnect</Link>
          <nav className="flex items-center gap-1" aria-label="Principal">
            <Button asChild variant="ghost" className="hidden sm:inline-flex"><Link href="/prestataires">Trouver un pro</Link></Button>
            {!roles.includes('provider') && !roles.includes('super_admin') && <Button asChild variant="ghost" className="hidden md:inline-flex"><Link href="/client/demandes/nouvelle">Déposer une demande</Link></Button>}
            {session ? (
              <Button asChild><Link href={space}>Mon espace</Link></Button>
            ) : (
              <>
                <Button asChild variant="ghost"><Link href="/connexion">Connexion</Link></Button>
                <Button asChild><Link href="/inscription">S&apos;inscrire</Link></Button>
              </>
            )}
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <RegisterSW />
      {children}
      <footer className="mt-16 border-t pb-24 pt-8 text-sm text-muted-foreground sm:pb-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 sm:flex-row sm:justify-between">
          <p><span className="font-semibold text-foreground">FrigoConnect</span> · Froid, climatisation, chauffage, ventilation</p>
          <nav aria-label="Pied de page" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
            <Link href="/prestataires" className="hover:text-foreground hover:underline">Trouver un pro</Link>
            <Link href="/client/demandes/nouvelle" className="hover:text-foreground hover:underline">Déposer une demande</Link>
            <Link href="/inscription" className="hover:text-foreground hover:underline">Devenir prestataire</Link>
          </nav>
        </div>
        <p className="mt-6 text-center text-xs">© {new Date().getFullYear()} FrigoConnect · CGU · Confidentialité · Mentions légales</p>
      </footer>
      <BottomNav space={session ? space : "/connexion"} />
    </>
  );
}
