'use client';

import { useQuery } from '@tanstack/react-query';
import type { AdminStats } from '@frigoconnect/contracts';
import { AppShell, type NavItem } from '@/components/app-shell';
import { api } from '@/lib/api';

/** Compteurs « à traiter » dans la navigation ; même clé que le tableau de bord (30 j) : une seule requête partagée. */
export function AdminShell({ nav, children }: { nav: NavItem[]; children: React.ReactNode }) {
  const { data } = useQuery({ queryKey: ['admin-stats', 30], queryFn: () => api<AdminStats>('admin/stats?days=30'), refetchInterval: 60_000 });
  const k = data?.kpis;
  const badges: Record<string, number | undefined> = { '/admin/prestataires': k?.pendingValidations, '/admin/litiges': k?.disputes };
  return <AppShell title="Administration" nav={nav.map((i) => ({ ...i, badge: badges[i.href] }))}>{children}</AppShell>;
}
