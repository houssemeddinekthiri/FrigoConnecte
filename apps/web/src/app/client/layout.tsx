import { AppShell, type NavItem } from '@/components/app-shell';

const NAV: NavItem[] = [
  { href: '/client', label: 'Demandes', icon: 'dashboard' },
  { href: '/client/demandes/nouvelle', label: 'Nouvelle', icon: 'new' },
  { href: '/client/equipements', label: 'Équipements', icon: 'equipment' },
  { href: '/client/prestataires', label: 'Prestataires', icon: 'users' },
  { href: '/client/messagerie', label: 'Messages', icon: 'messages' },
  { href: '/client/paiements', label: 'Paiements', icon: 'payments' },
  { href: '/client/documents', label: 'Documents', icon: 'documents' },
  { href: '/client/notifications', label: 'Notifications', icon: 'bell' },
  { href: '/client/compte', label: 'Mon compte', icon: 'profile' },
];

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return <AppShell title="Espace client" nav={NAV} withLogo>{children}</AppShell>;
}
