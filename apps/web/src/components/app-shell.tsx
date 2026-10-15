'use client';

import {
  Bell, CreditCard, FolderOpen, Snowflake, FilePlus, FileSignature, FileText, Inbox, LayoutDashboard, LogOut, Menu, MessageSquare, PanelLeftClose, PanelLeftOpen, Percent, Scale, ScrollText, ShieldCheck, Star, UserCog, Users, Wrench,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { NotificationBell } from '@/components/notification-bell';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { RealtimeProvider } from '@/lib/realtime';
import { cn } from '@/lib/utils';

const ICONS = {
  dashboard: LayoutDashboard, new: FilePlus, messages: MessageSquare, payments: CreditCard, inbox: Inbox, quotes: FileText, contracts: FileSignature,
  validate: ShieldCheck, moderation: Star, users: Users, disputes: Scale, commissions: Percent, audit: ScrollText, profile: UserCog, bell: Bell, equipment: Wrench, documents: FolderOpen,
} satisfies Record<string, LucideIcon>;

export interface NavItem {
  href: string;
  label: string;
  badge?: number; // compteur « à traiter », masqué à 0
  icon: keyof typeof ICONS; // clé et non composant : les props serveur -> client doivent être sérialisables
}

const MOBILE_TABS = 4; // au-delà de 5 rubriques : 4 onglets + « Plus »

/**
 * Navigation mobile first, une seule liste d'items :
 *  - < md  : barre du haut (logo, thème) + barre d'onglets en bas (zone du pouce, safe area iPhone) ; le surplus va dans « Plus »
 *  - >= md : barre latérale fixe
 */
export function AppShell({ title, nav, withLogo, children }: { title: string; nav: NavItem[]; withLogo?: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  // menu latéral réductible : choix mémorisé dans ce navigateur (lu après l'affichage pour éviter tout écart serveur/client)
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem('menu-collapsed') === '1'); } catch {} }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('menu-collapsed', c ? '0' : '1'); } catch {} return !c; });
  const name = session?.user?.name ?? session?.user?.email ?? '';
  const active = (href: string) => (href === nav[0].href ? pathname === href : pathname.startsWith(href));
  const overflow = nav.length > 5;
  const tabs = overflow ? nav.slice(0, MOBILE_TABS) : nav;
  const more = overflow ? nav.slice(MOBILE_TABS) : [];

  return (
    <RealtimeProvider>
      <div className={cn('min-h-dvh md:grid md:transition-[grid-template-columns] md:duration-200', collapsed ? 'md:grid-cols-[4.5rem_1fr]' : 'md:grid-cols-[15.5rem_1fr]')}>
        <aside className={cn('sticky top-0 hidden h-dvh flex-col border-r bg-card/60 py-4 md:flex', collapsed ? 'items-center px-2' : 'px-3')}>
          <div className={cn('mb-6 flex items-center', collapsed ? 'flex-col gap-3' : 'justify-between pl-1')}>
            <Link href="/" className="flex items-center gap-2 text-lg font-bold text-primary" aria-label="FrigoConnect">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm"><Snowflake className="size-5" /></span>
              {!collapsed && 'FrigoConnect'}
            </Link>
            <button type="button" onClick={toggle} aria-label={collapsed ? 'Ouvrir le menu' : 'Réduire le menu'} aria-expanded={!collapsed} title={collapsed ? 'Ouvrir le menu' : 'Réduire le menu'}
              className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
            </button>
          </div>
          {!collapsed && <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>}
          <nav className="grid w-full gap-1" aria-label={title}>
            {nav.map((i) => <NavLink key={i.href} item={i} on={active(i.href)} collapsed={collapsed} />)}
          </nav>
          <div className={cn('mt-auto grid w-full gap-2', collapsed && 'justify-items-center')}>
            {name && (
              <div className={cn('flex items-center gap-3 rounded-xl bg-secondary', collapsed ? 'p-1.5' : 'p-3')} title={name}>
                <UserAvatar name={name} withLogo={withLogo} />
                {!collapsed && <span className="min-w-0"><span className="block truncate text-sm font-medium">{name}</span><span className="block text-xs text-muted-foreground">{title}</span></span>}
              </div>
            )}
            <div className={cn('flex items-center', collapsed ? 'flex-col' : 'justify-between')}>
              <LogoutButton iconOnly={collapsed} />
              <span className={cn('flex', collapsed && 'flex-col')}><NotificationBell /><ThemeToggle /></span>
            </div>
          </div>
        </aside>

        <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/95 px-4 py-1 backdrop-blur md:hidden">
          <Link href="/" className="font-bold text-primary">FrigoConnect</Link>
          <div className="flex items-center"><NotificationBell /><ThemeToggle /><LogoutButton iconOnly /></div>
        </header>

        <main className="mx-auto w-full max-w-7xl p-4 pb-24 md:p-8 lg:px-10">{children}</main>

        <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden" aria-label={title}>
          {tabs.map((i) => <Tab key={i.href} item={i} on={active(i.href)} />)}
          {more.length > 0 && (
            <Sheet>
              <SheetTrigger className={cn('flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]', more.some((i) => active(i.href)) ? 'font-semibold text-primary' : 'text-muted-foreground')}>
                <Menu className="size-5" />
                Plus
              </SheetTrigger>
              <SheetContent title="Plus">
                <nav className="grid gap-1">{more.map((i) => <NavLink key={i.href} item={i} on={active(i.href)} />)}</nav>
              </SheetContent>
            </Sheet>
          )}
        </nav>
      </div>
    </RealtimeProvider>
  );
}

function Tab({ item, on }: { item: NavItem; on: boolean }) {
  const Icon = ICONS[item.icon];
  return (
    <Link href={item.href} aria-current={on ? 'page' : undefined} className={cn('flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]', on ? 'font-semibold text-primary' : 'text-muted-foreground')}>
      <span className="relative"><Icon className="size-5" />{!!item.badge && <span className="absolute -right-2 -top-1.5 rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground" aria-label={`${item.badge} à traiter`}>{item.badge}</span>}</span>
      {item.label}
    </Link>
  );
}

function NavLink({ item, on, collapsed }: { item: NavItem; on: boolean; collapsed?: boolean }) {
  const Icon = ICONS[item.icon];
  return (
    <Link href={item.href} aria-current={on ? 'page' : undefined} title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined} className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors', collapsed && 'justify-center px-0', on ? 'bg-primary font-medium text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
      <Icon className="size-[18px] shrink-0" />
      {!collapsed && item.label}
      {!collapsed && !!item.badge && <span className="ml-auto rounded-full bg-destructive px-1.5 text-[11px] font-semibold text-destructive-foreground" aria-label={`${item.badge} à traiter`}>{item.badge}</span>}
    </Link>
  );
}

/** POST (pas un lien GET) : évite la déconnexion forcée par une image ou un lien piégé. */
function LogoutButton({ iconOnly }: { iconOnly?: boolean }) {
  return (
    <form action="/deconnexion" method="post">
      <Button variant="ghost" size={iconOnly ? 'icon' : 'sm'} aria-label="Se déconnecter">
        <LogOut />
        {!iconOnly && 'Déconnexion'}
      </Button>
    </form>
  );
}
