import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, RawBodyRequest, Req } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { createPaymentSchema, refundPaymentSchema, type CreatePaymentInput, type RefundPaymentInput } from '@frigoconnect/contracts';
import { AuthUser, CurrentUser, Permissions, Public, Roles } from '../../../shared/auth/auth';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import { CreateContractPaymentCommand, RefundPaymentCommand, StartConnectOnboardingCommand, StripeWebhookService, SyncConnectStatusCommand } from '../application/handlers';

@Controller()
export class PaymentsController {
  constructor(private readonly commands: CommandBus, private readonly webhooks: StripeWebhookService) {}

  /** Crée (ou reprend) l'intention de paiement ; le navigateur confirme avec Stripe Elements. Le montant vient TOUJOURS du serveur. */
  @Post('contracts/:id/payments')
  @Roles('client')
  @Permissions('payment:pay')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  pay(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(createPaymentSchema)) body: CreatePaymentInput) {
    return this.commands.execute(new CreateContractPaymentCommand(user, id, body.kind));
  }

  @Post('payments/connect/onboarding')
  @Roles('provider')
  @Permissions('payout:read')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  onboarding(@CurrentUser() user: AuthUser) {
    return this.commands.execute(new StartConnectOnboardingCommand(user));
  }

  @Get('payments/connect/status')
  @Roles('provider')
  @Permissions('payout:read')
  status(@CurrentUser() user: AuthUser) {
    return this.commands.execute(new SyncConnectStatusCommand(user));
  }

  @Post('payments/:id/refund')
  @Roles('super_admin')
  @Permissions('payment:refund')
  @HttpCode(200)
  refund(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(refundPaymentSchema)) body: RefundPaymentInput) {
    return this.commands.execute(new RefundPaymentCommand(user, id, body.amountCents, body.reason));
  }

  /** Public mais protégé par la signature Stripe sur le corps BRUT. 400 si invalide ; 500 si traitement échoué (Stripe réessaiera). */
  @Public()
  @SkipThrottle()
  @Post('webhooks/stripe')
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    if (!req.rawBody || !signature) throw new BadRequestException('Signature manquante');
    try {
      await this.webhooks.handle(req.rawBody, signature);
    } catch (e) {
      if ((e as { type?: string }).type === 'StripeSignatureVerificationError') throw new BadRequestException('Signature invalide');
      throw e;
    }
    return { received: true };
  }
}
