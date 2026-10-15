import { AppShell, type NavItem } from '@/components/app-shell';

const NAV: NavItem[] = [
  { href: '/prestataire', label: 'Accueil', icon: 'dashboard' },
  { href: '/prestataire/demandes', label: 'Demandes', icon: 'inbox' },
  { href: '/prestataire/devis', label: 'Devis', icon: 'quotes' },
  { href: '/prestataire/contrats', label: 'Contrats', icon: 'contracts' },
  { href: '/prestataire/factures', label: 'Factures', icon: 'documents' },
  { href: '/prestataire/messagerie', label: 'Messages', icon: 'messages' },
  { href: '/prestataire/profil', label: 'Mon profil', icon: 'profile' },
];

export default function ProviderLayout({ children }: { children: React.ReactNode }) {
  return <AppShell title="Espace prestataire" nav={NAV}>{children}</AppShell>;
}
