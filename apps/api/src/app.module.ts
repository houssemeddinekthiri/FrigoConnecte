import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './modules/admin/admin.module';
import { ClientDocumentsModule } from './modules/client-documents/client-documents.module';
import { ClientFavoritesModule } from './modules/client-favorites/client-favorites.module';
import { ClientTrustModule } from './modules/client-trust/client-trust.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { ClientProfileModule } from './modules/client-profile/client-profile.module';
import { ClientEquipmentModule } from './modules/client-equipment/client-equipment.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { FilesModule } from './modules/files/files.module';
import { IdentityModule } from './modules/identity/identity.module';
import { MatchingModule } from './modules/matching/matching.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { ServiceRequestsModule } from './modules/service-requests/service-requests.module';
import { JwtAuthGuard, PermissionsGuard, RolesGuard } from './shared/auth/auth';
import { HealthController } from './shared/health';
import { DatabaseModule } from './shared/infrastructure/database/database.service';
import { OutboxModule } from './shared/infrastructure/outbox/outbox';
import { EmailModule } from './shared/email/email';
import { RealtimeModule } from './shared/realtime/realtime';
import { DomainExceptionFilter } from './shared/presentation/domain-exception.filter';

@Module({
  imports: [
    CqrsModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]), // ponytail: compteur en mémoire ; stockage Redis dès 2 instances API
    DatabaseModule,
    OutboxModule,
    IdentityModule,
    EmailModule,
    RealtimeModule,
    MatchingModule,
    MessagingModule,
    FilesModule,
    QuotesModule,
    ContractsModule,
    PaymentsModule,
    ProvidersModule,
    ReviewsModule,
    AdminModule,
    NotificationsModule,
    ServiceRequestsModule,
    ClientEquipmentModule,
    ClientDocumentsModule,
    ClientProfileModule,
    ClientFavoritesModule,
    InvoicesModule,
    TemplatesModule,
    ClientTrustModule,
  ],
  controllers: [HealthController],
  providers: [
    // Ordre d'exécution : anti-abus -> JWT valide (deny by default, @Public pour ouvrir) -> rôle -> permission
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}
