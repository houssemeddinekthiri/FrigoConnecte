import { Inject, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { commandHandlers, FundsReleaser, ReleaseOnContractValidated, StripeWebhookService } from './application/handlers';
import { PAYMENT_REPOSITORY, PaymentRepository, STRIPE_GATEWAY } from './domain/ports';
import { PgPaymentRepository } from './infrastructure/pg-payment-repository';
import { StripeSdkGateway } from './infrastructure/stripe-gateway';
import { PaymentsController } from './presentation/payments.controller';

/**
 * Filet de sécurité : l'événement « contrat validé » peut être perdu (crash, erreur Stripe). Chaque heure on reprend
 * les contrats terminés qui détiennent encore des fonds, et les versements restés « en cours ». Idempotent.
 */
@Injectable()
class ReleaseSweepJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ReleaseSweepJob.name);
  private timer?: NodeJS.Timeout;
  constructor(@Inject(PAYMENT_REPOSITORY) private readonly repo: PaymentRepository, private readonly releaser: FundsReleaser) {}

  onModuleInit() {
    // ponytail: setInterval simple ; à migrer vers BullMQ avec les autres tâches planifiées
    this.timer = setInterval(() => void this.run(), 3_600_000);
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  private async run() {
    try {
      await this.releaser.retryStale();
      for (const id of await this.repo.completedContractsWithHeldFunds()) await this.releaser.releaseContract(id);
    } catch (e) {
      this.log.error(e);
    }
  }
}

@Module({
  controllers: [PaymentsController],
  providers: [
    ...commandHandlers, FundsReleaser, ReleaseOnContractValidated, StripeWebhookService, ReleaseSweepJob,
    { provide: PAYMENT_REPOSITORY, useClass: PgPaymentRepository },
    { provide: STRIPE_GATEWAY, useClass: StripeSdkGateway },
  ],
})
export class PaymentsModule {}
