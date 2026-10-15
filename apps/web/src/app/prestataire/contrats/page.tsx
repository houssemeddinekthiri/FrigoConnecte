'use client';

import { ContractPanel, useContracts } from '@/components/contract-panel';
import { Skeleton } from '@/components/ui/skeleton';

export default function ProviderContractsPage() {
  const { data, isPending, isError } = useContracts('provider');
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">Mes contrats</h1>
      {isPending && <Skeleton className="h-32" />}
      {isError && <p role="alert" className="text-destructive">Impossible de charger vos contrats.</p>}
      {data?.length === 0 && <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Aucun contrat. Il est créé dès qu&apos;un client signe votre devis.</p>}
      <div className="grid gap-3">{data?.map((c) => <ContractPanel key={c.id} contract={c} role="provider" />)}</div>
    </>
  );
}
