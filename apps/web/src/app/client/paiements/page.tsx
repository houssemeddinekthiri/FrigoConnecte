'use client';

import { ContractPanel, useContracts } from '@/components/contract-panel';
import { Skeleton } from '@/components/ui/skeleton';

export default function ClientPaymentsPage() {
  const { data, isPending, isError } = useContracts('client');
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">Paiements</h1>
      {isPending && <Skeleton className="h-32" />}
      {isError && <p role="alert" className="text-destructive">Impossible de charger vos contrats.</p>}
      {data?.length === 0 && <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Aucun contrat pour le moment.</p>}
      <div className="grid gap-3">{data?.map((c) => <ContractPanel key={c.id} contract={c} role="client" />)}</div>
    </>
  );
}
