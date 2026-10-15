'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, Siren, User } from 'lucide-react';
import { cn } from '@/lib/utils';

// Barre d'onglets en bas de l'écran (mobile uniquement), comme une application native
export function BottomNav({ space }: { space: string }) {
  const path = usePathname();
  const items = [
    { href: '/', label: 'Accueil', icon: Home },
    { href: '/prestataires', label: 'Trouver', icon: Search },
    { href: '/client/demandes/nouvelle', label: 'Urgence', icon: Siren },
    { href: space, label: 'Mon espace', icon: User },
  ];
  return (
    <nav aria-label="Navigation mobile" className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
      <ul className="grid grid-cols-4">
        {items.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? path === '/' : path.startsWith(href);
          return (
            <li key={href}>
              <Link href={href} aria-current={active ? 'page' : undefined} className={cn('flex h-16 flex-col items-center justify-center gap-1 text-xs', active ? 'font-semibold text-primary' : 'text-muted-foreground')}>
                <Icon className="size-6" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
