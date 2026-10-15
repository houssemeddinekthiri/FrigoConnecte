import { AdminShell } from '@/components/admin/admin-shell';
import type { NavItem } from '@/components/app-shell';

const NAV: NavItem[] = [
  { href: '/admin', label: 'KPI', icon: 'dashboard' },
  { href: '/admin/prestataires', label: 'Validations', icon: 'validate' },
  { href: '/admin/litiges', label: 'Litiges', icon: 'disputes' },
  { href: '/admin/moderation', label: 'Modération', icon: 'moderation' },
  { href: '/admin/utilisateurs', label: 'Utilisateurs', icon: 'users' },
  { href: '/admin/commissions', label: 'Commissions', icon: 'commissions' },
  { href: '/admin/audit', label: 'Audit', icon: 'audit' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell nav={NAV}>{children}</AdminShell>;
}
