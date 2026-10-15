import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { StripeEvent, StripeGateway } from '../domain/ports';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} manquant`);
  return v;
};

/**
 * Adaptateur Stripe : tout ce que le métier sait de Stripe passe par l'interface `StripeGateway`.
 * Chaque appel qui crée quelque chose porte une clé d'idempotence : un rejeu (timeout, relance) ne crée jamais de doublon.
 */
@Injectable()
export class StripeSdkGateway implements StripeGateway {
  private readonly stripe = new Stripe(env('STRIPE_SECRET_KEY'));

  publishableKey() {
    return env('STRIPE_PUBLISHABLE_KEY');
  }

  async ensureCustomer(clientId: string, email: string, name: string) {
    const c = await this.stripe.customers.create({ email, name, metadata: { clientId } }, { idempotencyKey: `customer:${clientId}` });
    return c.id;
  }

  async createPaymentIntent(a: { amountCents: number; customerId: string; transferGroup: string; metadata: Record<string, string>; idempotencyKey: string }) {
    const pi = await this.stripe.paymentIntents.create(
      {
        amount: a.amountCents,
        currency: 'eur',
        customer: a.customerId,
        transfer_group: a.transferGroup, // relie paiements et versements d'un même contrat
        metadata: a.metadata,
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: a.idempotencyKey },
    );
    return { id: pi.id, clientSecret: pi.client_secret! };
  }

  async retrievePaymentIntent(id: string) {
    const pi = await this.stripe.paymentIntents.retrieve(id);
    return { status: pi.status, clientSecret: pi.client_secret };
  }

  async createExpressAccount(providerId: string, email: string) {
    const acct = await this.stripe.accounts.create(
      { type: 'express', country: 'FR', email, capabilities: { card_payments: { requested: true }, transfers: { requested: true } }, metadata: { providerId } },
      { idempotencyKey: `account:${providerId}` },
    );
    return acct.id;
  }

  async accountLink(accountId: string, returnUrl: string, refreshUrl: string) {
    return (await this.stripe.accountLinks.create({ account: accountId, type: 'account_onboarding', return_url: returnUrl, refresh_url: refreshUrl })).url;
  }

  async accountReady(accountId: string) {
    const a = await this.stripe.accounts.retrieve(accountId);
    return a.capabilities?.transfers === 'active' && !!a.payouts_enabled;
  }

  async createTransfer(a: { amountCents: number; destination: string; transferGroup: string; sourceCharge: string; metadata: Record<string, string>; idempotencyKey: string }) {
    const t = await this.stripe.transfers.create(
      { amount: a.amountCents, currency: 'eur', destination: a.destination, transfer_group: a.transferGroup, source_transaction: a.sourceCharge, metadata: a.metadata },
      { idempotencyKey: a.idempotencyKey },
    );
    return t.id;
  }

  async refund(a: { paymentIntentId: string; amountCents: number; idempotencyKey: string }) {
    return (await this.stripe.refunds.create({ payment_intent: a.paymentIntentId, amount: a.amountCents }, { idempotencyKey: a.idempotencyKey })).id;
  }

  /** Vérifie la signature (secret du webhook) sur le corps BRUT, puis réduit l'événement à ce dont le métier a besoin. */
  verifyWebhook(rawBody: Buffer, signature: string): StripeEvent {
    const e = this.stripe.webhooks.constructEvent(rawBody, signature, env('STRIPE_WEBHOOK_SECRET'));
    switch (e.type) {
      case 'payment_intent.succeeded': {
        const pi = e.data.object as Stripe.PaymentIntent;
        const charge = pi.latest_charge;
        return { id: e.id, type: e.type, intentId: pi.id, chargeId: typeof charge === 'string' ? charge : charge!.id };
      }
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled': {
        const pi = e.data.object as Stripe.PaymentIntent;
        return { id: e.id, type: e.type, intentId: pi.id, reason: pi.last_payment_error?.message ?? e.type };
      }
      case 'account.updated': {
        const a = e.data.object as Stripe.Account;
        return { id: e.id, type: e.type, accountId: a.id, ready: a.capabilities?.transfers === 'active' && !!a.payouts_enabled };
      }
      case 'charge.dispute.created': {
        const d = e.data.object as Stripe.Dispute;
        return { id: e.id, type: e.type, chargeId: typeof d.charge === 'string' ? d.charge : d.charge.id };
      }
      default:
        return { id: e.id, type: 'ignored' };
    }
  }
}
