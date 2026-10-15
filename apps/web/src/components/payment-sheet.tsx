'use client';

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { PaymentIntentResult } from '@frigoconnect/contracts';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ApiError, api } from '@/lib/api';
import { eur } from '@/lib/format';

const stripeCache = new Map<string, Promise<Stripe | null>>();
const stripeFor = (pk: string) => stripeCache.get(pk) ?? (stripeCache.set(pk, loadStripe(pk)), stripeCache.get(pk)!);

/**
 * Paiement par Stripe Elements : les données de carte vont directement à Stripe (jamais chez nous, jamais dans notre JS).
 * Le MONTANT n'est pas choisi ici : il est fixé par le serveur à la création de l'intention.
 */
export function PaymentSheet({ contractId, kind, onClose, onPaid }: { contractId: string | null; kind: 'deposit' | 'balance'; onClose: () => void; onPaid: () => void }) {
  const [intent, setIntent] = useState<PaymentIntentResult | null>(null);
  const [paid, setPaid] = useState(false);

  const start = useMutation({
    mutationFn: () => api<PaymentIntentResult>(`contracts/${contractId}/payments`, { method: 'POST', body: JSON.stringify({ kind }) }),
    onSuccess: setIntent,
  });
  const close = () => { setIntent(null); setPaid(false); start.reset(); onClose(); };

  return (
    <Sheet open={!!contractId} onOpenChange={(o) => !o && close()}>
      <SheetContent title={kind === 'deposit' ? 'Régler l\'acompte' : 'Régler le solde'}>
        {paid ? (
          <div className="grid gap-4">
            <p role="status" className="rounded-lg bg-success/10 p-4 text-success">Paiement reçu. Votre banque confirme l&apos;opération ; la page se met à jour dans un instant.</p>
            <Button onClick={close}>Fermer</Button>
          </div>
        ) : !intent ? (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Les fonds sont conservés par FrigoConnect et ne sont versés au prestataire qu&apos;après votre validation de l&apos;intervention.
            </p>
            {start.isError && <p role="alert" className="text-sm text-destructive">{start.error instanceof ApiError ? ((start.error.body as { message?: string })?.message ?? 'Paiement impossible') : 'Paiement impossible'}</p>}
            <Button size="lg" disabled={start.isPending} onClick={() => start.mutate()}>{start.isPending ? 'Préparation…' : 'Continuer vers le paiement'}</Button>
          </div>
        ) : (
          <Elements stripe={stripeFor(intent.publishableKey)} options={{ clientSecret: intent.clientSecret, locale: 'fr' }}>
            <PayForm amountCents={intent.amountCents} onPaid={() => { setPaid(true); onPaid(); }} />
          </Elements>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PayForm({ amountCents, onPaid }: { amountCents: number; onPaid: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        setBusy(true);
        setError(null);
        // redirect: 'if_required' : 3-D Secure s'ouvre en fenêtre ; on ne redirige que pour les moyens de paiement qui l'exigent
        const { error: err, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required', confirmParams: { return_url: window.location.href } });
        setBusy(false);
        if (err) return setError(err.message ?? 'Paiement refusé');
        if (paymentIntent && ['succeeded', 'processing'].includes(paymentIntent.status)) onPaid();
      }}
    >
      <PaymentElement />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button size="lg" disabled={!stripe || busy}>{busy ? 'Paiement…' : `Payer ${eur(amountCents)}`}</Button>
    </form>
  );
}
