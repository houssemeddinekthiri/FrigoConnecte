'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

const GROUPS = [
  ['quote', 'Devis', 'Un prestataire vous envoie un devis, ou répond à votre décision.'],
  ['payment', 'Paiements', 'Acompte, solde, versement et remboursement.'],
  ['contract', 'Interventions et litiges', 'Intervention terminée, validation, litige ou annulation.'],
] as const;

export function NotificationPreferences() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api<Record<string, boolean>>('notifications/preferences') });
  const set = useMutation({
    mutationFn: (v: { group: string; email: boolean }) => api('notifications/preferences', { method: 'PUT', body: JSON.stringify(v) }),
    onMutate: async (v) => { qc.setQueryData(['notification-prefs'], (old: Record<string, boolean> | undefined) => ({ ...old, [v.group]: v.email })); },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['notification-prefs'] }),
  });
  if (prefs.isPending) return <Skeleton className="h-40" />;
  if (prefs.isError) return <p role="alert" className="text-destructive">Impossible de charger vos préférences.</p>;

  return (
    <ul className="divide-y rounded-2xl border bg-card shadow-sm">
      {GROUPS.map(([group, label, help]) => (
        <li key={group}>
          <label className="flex cursor-pointer items-center justify-between gap-4 p-5">
            <span><span className="block font-medium">{label}</span><span className="block text-sm text-muted-foreground">{help}</span></span>
            <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
              Email
              <input type="checkbox" role="switch" className="size-5 accent-primary" checked={prefs.data[group] ?? true} onChange={(e) => set.mutate({ group, email: e.target.checked })} />
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}
