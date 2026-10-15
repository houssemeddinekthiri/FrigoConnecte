import { Inject, Injectable, Logger } from '@nestjs/common';
import { CommandHandler, EventsHandler, ICommandHandler, IEventHandler } from '@nestjs/cqrs';
import { randomUUID } from 'node:crypto';
import type { ConnectStatus, PaymentIntentResult } from '@frigoconnect/contracts';
import { AuthUser } from '../../../shared/auth/auth';
import { IntegrationEvent } from '../../../shared/infrastructure/outbox/outbox';
import { InvalidStateError, NotFoundError } from '../../../shared/kernel/errors';
import { assertChargeable, planPayments, refundSplit } from '../domain/payment-plan';
import { PAYMENT_REPOSITORY, PaymentRepository, ReleasablePayment, STRIPE_GATEWAY, StripeGateway } from '../domain/ports';

// ---------- Créer un paiement (acompte / solde) ----------
export class CreateContractPaymentCommand {
  constructor(readonly user: AuthUser, readonly contractId: string, readonly kind: 'deposit' | 'balance') {}
}

@CommandHandler(CreateContractPaymentCommand)
export class CreateContractPaymentHandler implements ICommandHandler<CreateContractPaymentCommand, PaymentIntentResult> {
  constructor(@Inject(PAYMENT_REPOSITORY) private readonly repo: PaymentRepository, @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway) {}

  async execute({ user, contractId, kind }: CreateContractPaymentCommand): Promise<PaymentIntentResult> {
    const c = await this.repo.findPayable(contractId);
    if (!c || c.clientId !== user.id) throw new NotFoundError('Contrat'); // 404 : pas d'indice sur l'existence
    if (c.status !== 'active') throw new InvalidStateError('Ce contrat n\'est plus payable');
    if (!c.providerTransfersReady) throw new InvalidStateError('Le prestataire n\'a pas finalisé son compte de paiement');

    const deposit = c.payments.find((p) => p.kind === 'deposit' && p.status !== 'failed');
    // Taux figé au premier paiement : un changement de barème en cours de contrat ne touche pas ce contrat
    const rate = deposit?.commissionRateBps ?? (await this.repo.commissionRateBps(c.providerId));
    const planned = planPayments(c, rate).find((p) => p.kind === kind);
    if (!planned) throw new InvalidStateError('Ce contrat ne prévoit pas de paiement de ce type');
    assertChargeable(planned.amountCents);

    if (kind === 'balance') {
      if (!c.workDoneAt) throw new InvalidStateError('Le solde est dû une fois l\'intervention terminée');
      if (c.depositCents > 0 && !deposit?.stripeChargeId) throw new InvalidStateError('L\'acompte doit être réglé avant le solde');
    }

    const same = c.payments.filter((p) => p.kind === kind);
    if (same.some((p) => ['held', 'authorized', 'released', 'partially_refunded', 'refunded'].includes(p.status))) throw new InvalidStateError('Déjà réglé');

    // Un paiement en attente (onglet fermé, 3-D Secure abandonné) est repris au lieu d'en créer un second
    const pending = same.find((p) => p.status === 'pending' && p.stripePaymentIntentId);
    if (pending) {
      const pi = await this.stripe.retrievePaymentIntent(pending.stripePaymentIntentId!);
      if (pi.clientSecret && ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(pi.status)) {
        return { paymentId: pending.id, clientSecret: pi.clientSecret, publishableKey: this.stripe.publishableKey(), amountCents: pending.amountCents };
      }
      await this.repo.markFailed(pending.id, `abandonné (${pi.status})`);
    }

    let customerId = c.stripeCustomerId;
    if (!customerId) {
      customerId = await this.stripe.ensureCustomer(c.clientId, c.clientEmail, c.clientName);
      await this.repo.saveCustomerId(c.clientId, customerId);
    }

    const paymentId = randomUUID();
    await this.repo.insertPayment({
      id: paymentId, contractId, payerId: c.clientId, providerId: c.providerId, kind, amountCents: planned.amountCents,
      feeCents: planned.feeCents, providerCents: planned.providerCents, rateBps: rate, idempotencyKey: `pay:${paymentId}`,
    });
    try {
      const pi = await this.stripe.createPaymentIntent({
        amountCents: planned.amountCents, customerId, transferGroup: `contract_${contractId}`,
        metadata: { paymentId, contractId, kind }, idempotencyKey: `pi:${paymentId}`,
      });
      await this.repo.attachIntent(paymentId, pi.id);
      return { paymentId, clientSecret: pi.clientSecret, publishableKey: this.stripe.publishableKey(), amountCents: planned.amountCents };
    } catch (e) {
      await this.repo.markFailed(paymentId, 'création Stripe échouée'); // libère l'emplacement unique : le client peut réessayer
      throw e;
    }
  }
}

// ---------- Onboarding Stripe Connect (prestataire) ----------
export class StartConnectOnboardingCommand { constructor(readonly user: AuthUser) {} }
export class SyncConnectStatusCommand { constructor(readonly user: AuthUser) {} }

@CommandHandler(StartConnectOnboardingCommand)
export class StartConnectOnboardingHandler implements ICommandHandler<StartConnectOnboardingCommand, { url: string }> {
  constructor(@Inject(PAYMENT_REPOSITORY) private readonly repo: PaymentRepository, @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway) {}

  async execute({ user }: StartConnectOnboardingCommand) {
    const p = await this.repo.getProviderStripe(user.id);
    if (!p) throw new NotFoundError('Profil prestataire');
    let accountId = p.accountId;
    if (!accountId) {
      accountId = await this.stripe.createExpressAccount(user.id, p.email);
      await this.repo.saveAccountId(user.id, accountId);
    }
    const app = process.env.APP_URL ?? 'http://localhost:3000';
    return { url: await this.stripe.accountLink(accountId, `${app}/prestataire?stripe=return`, `${app}/prestataire?stripe=refresh`) };
  }
}

/** Au retour de Stripe on relit l'état réel (le webhook peut arriver après la redirection). */
@CommandHandler(SyncConnectStatusCommand)
export class SyncConnectStatusHandler implements ICommandHandler<SyncConnectStatusCommand, ConnectStatus> {
  constructor(@Inject(PAYMENT_REPOSITORY) private readonly repo: PaymentRepository, @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway) {}

  async execute({ user }: SyncConnectStatusCommand): Promise<ConnectStatus> {
    const p = await this.repo.getProviderStripe(user.id);
    if (!p?.accountId) return { ready: false, hasAccount: false };
    const ready = await this.stripe.accountReady(p.accountId);
    if (ready !== p.ready) await this.repo.setTransfersReady(user.id, ready);
    return { ready, hasAccount: true };
  }
}

// ---------- Libération des fonds ----------
@Injectable()
export class FundsReleaser {
  private readonly log = new Logger(FundsReleaser.name);
  constructor(@Inject(PAYMENT_REPOSITORY) private readonly repo: PaymentRepository, @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway) {}

  /** Verse au prestataire sa part de chaque paiement conservé du contrat. Rejouable sans risque de double versement. */
  async releaseContract(contractId: string) {
    await this.transfer(await this.repo.claimForRelease(contractId));
  }

  async retryStale() {
    await this.transfer(await this.repo.staleClaims());
  }

  private async transfer(items: ReleasablePayment[]) {
    for (const p of items) {
      try {
        // source_transaction : le versement s'appuie sur les fonds de CE paiement. Clé d'idempotence stable : un rejeu renvoie le même transfert.
        const transferId = await this.stripe.createTransfer({
          amountCents: p.netProviderCents, destination: p.stripeAccountId, transferGroup: `contract_${p.contractId}`,
          sourceCharge: p.stripeChargeId, metadata: { paymentId: p.id, contractId: p.contractId }, idempotencyKey: `transfer:${p.id}`,
        });
        await this.repo.markReleased(p.id, transferId, p.providerId, p.netProviderCents);
      } catch (e) {
        this.log.error(`versement échoué (paiement ${p.id}) : ${(e as Error).message}`);
        await this.repo.unclaim(p.id); // reste « conservé » ; le balayage horaire réessaiera
      }
    }
  }
}

@EventsHandler(IntegrationEvent)
export class ReleaseOnContractValidated implements IEventHandler<IntegrationEvent> {
  constructor(private readonly releaser: FundsReleaser) {}

  async handle(e: IntegrationEvent) {
    if (e.type !== 'contract.validated') return;
    await this.releaser.releaseContract(e.payload.contractId as string);
  }
}

// ---------- Remboursement (admin, avant versement uniquement) ----------
export class RefundPaymentCommand {
  constructor(readonly user: AuthUser, readonly paymentId: string, readonly amountCents?: number, readonly reason?: string) {}
}

@CommandHandler(RefundPaymentCommand)
export class RefundPaymentHandler implements ICommandHandler<RefundPaymentCommand, { refundedCents: number }> {
  constructor(@Inject(PAYMENT_REPOSITORY) private readonly repo: PaymentRepository, @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway) {}

  async execute({ user, paymentId, amountCents, reason }: RefundPaymentCommand) {
    const rowId = randomUUID();
    // 1) réserve le montant sous verrou (aucun sur-remboursement possible), 2) appelle Stripe, 3) finalise
    const r = await this.repo.beginRefund(paymentId, amountCents, rowId, `refund:${rowId}`, (p, amount) => refundSplit(p, amount));
    try {
      const stripeRefundId = await this.stripe.refund({ paymentIntentId: r.payment.stripePaymentIntentId!, amountCents: r.amountCents, idempotencyKey: `refund:${rowId}` });
      await this.repo.completeRefund(rowId, paymentId, stripeRefundId, [
        { type: 'payment.refunded', payload: { paymentId, contractId: r.payment.contractId, clientId: r.payment.payerId, providerId: r.payment.providerId, amountCents: r.amountCents, reason: reason ?? null, byAdmin: user.id } },
      ]);
      return { refundedCents: r.amountCents };
    } catch (e) {
      await this.repo.failRefund(rowId, (e as Error).message); // libère le montant réservé
      throw e;
    }
  }
}

// ---------- Webhook Stripe ----------
@Injectable()
export class StripeWebhookService {
  private readonly log = new Logger(StripeWebhookService.name);
  constructor(@Inject(PAYMENT_REPOSITORY) private readonly repo: PaymentRepository, @Inject(STRIPE_GATEWAY) private readonly stripe: StripeGateway) {}

  /** Lève si la signature est invalide (=> 400). Le traitement est idempotent : un événement rejoué n'a aucun effet. */
  async handle(rawBody: Buffer, signature: string) {
    const e = this.stripe.verifyWebhook(rawBody, signature);
    if (await this.repo.isEventProcessed(e.id)) return;
    switch (e.type) {
      case 'payment_intent.succeeded':
        await this.repo.markPaid(e.intentId, e.chargeId);
        break;
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled':
        await this.repo.markPaymentFailed(e.intentId, e.reason);
        break;
      case 'account.updated':
        await this.repo.setTransfersReadyByAccount(e.accountId, e.ready);
        break;
      case 'charge.dispute.created':
        this.log.warn(`LITIGE bancaire sur la charge ${e.chargeId}`);
        await this.repo.flagDispute(e.chargeId);
        break;
    }
    await this.repo.markEventProcessed(e.id, e.type); // en dernier : si le traitement échoue, Stripe renvoie l'événement
  }
}

export const commandHandlers = [CreateContractPaymentHandler, StartConnectOnboardingHandler, SyncConnectStatusHandler, RefundPaymentHandler];
