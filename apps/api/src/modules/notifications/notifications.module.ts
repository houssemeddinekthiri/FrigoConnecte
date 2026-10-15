import { Body, Controller, Get, HttpCode, Injectable, Logger, Module, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../shared/presentation/zod-validation.pipe';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import type { NotificationDto } from '@frigoconnect/contracts';
import type { QueryResultRow } from 'pg';
import { AuthUser, CurrentUser } from '../../shared/auth/auth';
import { EmailSender } from '../../shared/email/email';
import { Database } from '../../shared/infrastructure/database/database.service';
import { IntegrationEvent } from '../../shared/infrastructure/outbox/outbox';
import { RealtimeGateway } from '../../shared/realtime/realtime';

const toDto = (r: QueryResultRow): NotificationDto => ({
  id: r.id, type: r.type, title: r.title, body: r.body, data: r.data,
  readAt: r.read_at?.toISOString() ?? null, createdAt: r.created_at.toISOString(),
});

const eur = (cents: number) => `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

interface Draft { userId: string; type: string; title: string; body: string | null; data: Record<string, unknown> }

/** Un événement métier -> 0..n notifications. Ajouter un cas ici suffit pour notifier un nouvel événement. */
function draftsFor(e: IntegrationEvent): Draft[] {
  const p = e.payload as Record<string, any>;
  switch (e.type) {
    case 'quote.sent':
      return [{ userId: p.clientId, type: 'quote.sent', title: 'Nouveau devis reçu', body: `${p.providerName} — ${eur(p.totalCents)} TTC`, data: { quoteId: p.quoteId, requestId: p.requestId } }];
    case 'quote.accepted':
      return [{ userId: p.providerId, type: 'quote.accepted', title: 'Votre devis a été accepté', body: `Devis ${p.number} signé — ${eur(p.totalCents)} TTC`, data: { quoteId: p.quoteId, requestId: p.requestId } }];
    case 'quote.rejected':
      return [{ userId: p.providerId, type: 'quote.rejected', title: 'Votre devis a été refusé', body: p.reason ?? null, data: { quoteId: p.quoteId, requestId: p.requestId } }];
    case 'payment.paid':
      return [{ userId: p.providerId, type: `payment.${p.kind}_paid`, title: p.kind === 'deposit' ? 'Acompte reçu' : 'Solde reçu',
        body: `${eur(p.amountCents)} conservés en séquestre${p.kind === 'deposit' ? ' : vous pouvez planifier l\'intervention' : ' jusqu\'à la validation'}`,
        data: { contractId: p.contractId, dedupeKey: `payment.paid:${p.paymentId}` } }];
    case 'contract.work_done':
      return [{ userId: p.clientId, type: 'contract.work_done', title: 'Intervention terminée', body: `Réglez le solde puis validez. Sans réponse, validation automatique sous ${p.autoValidateDays} jours.`,
        data: { contractId: p.contractId, dedupeKey: `contract.work_done:${p.contractId}` } }];
    case 'payment.released':
      return [{ userId: p.providerId, type: 'payment.released', title: 'Virement en route', body: `${eur(p.amountCents)} versés sur votre compte`, data: { dedupeKey: `payment.released:${p.paymentId}` } }];
    case 'payment.refunded':
      return [{ userId: p.clientId, type: 'payment.refunded', title: 'Remboursement effectué', body: eur(p.amountCents), data: { contractId: p.contractId, dedupeKey: `payment.refunded:${p.paymentId}:${p.amountCents}` } },
              { userId: p.providerId, type: 'payment.refunded', title: 'Un paiement a été remboursé au client', body: eur(p.amountCents), data: { contractId: p.contractId, dedupeKey: `payment.refunded.p:${p.paymentId}:${p.amountCents}` } }];
    case 'contract.disputed':
      return [p.clientId, p.providerId].map((userId: string) => ({ userId, type: 'contract.disputed', title: 'Contrat en litige', body: 'Notre équipe examine le dossier et vous contactera.', data: { contractId: p.contractId, dedupeKey: `contract.disputed:${p.contractId}` } }));
    case 'provider.approved':
      return [{ userId: p.providerId, type: 'provider.approved', title: p.reinstated ? 'Votre profil est de nouveau actif' : 'Votre dossier est validé', body: 'Vous recevez désormais les demandes proches de chez vous.', data: { dedupeKey: `provider.approved:${p.providerId}:${e.type}` } }];
    case 'provider.rejected':
      return [{ userId: p.providerId, type: 'provider.rejected', title: 'Votre dossier doit être corrigé', body: p.reason, data: { dedupeKey: `provider.rejected:${p.providerId}:${p.reason}` } }];
    case 'provider.suspended':
      return [{ userId: p.providerId, type: 'provider.suspended', title: 'Votre profil est suspendu', body: p.reason, data: { dedupeKey: `provider.suspended:${p.providerId}:${p.reason}` } }];
    case 'certification.rejected':
      return [{ userId: p.providerId, type: 'certification.rejected', title: 'Un document a été refusé', body: p.reason, data: { dedupeKey: `certification.rejected:${p.certificationId}` } }];
    case 'certification.expiring':
      return [{ userId: p.providerId, type: 'certification.expiring',
        title: p.bucket === 0 ? 'Une certification a expiré' : `Une certification expire dans ${p.daysLeft} jour(s)`,
        body: `${p.label ?? p.certType}${p.bucket === 0 ? ' : vous n\'êtes plus proposé sur les demandes concernées tant qu\'une version à jour n\'est pas validée.' : ' : déposez la nouvelle version pour rester visible.'}`,
        data: { dedupeKey: `certification.expiring:${p.certificationId}:${p.bucket}` } }];
    case 'review.received':
      return [{ userId: p.targetId, type: 'review.received', title: 'Nouvel avis reçu', body: `${p.rating}/5`, data: { dedupeKey: `review.received:${p.reviewId}` } }];
    case 'contract.cancelled':
      return [p.clientId, p.providerId].map((userId: string) => ({ userId, type: 'contract.cancelled', title: 'Contrat annulé', body: 'Suite à l\'examen du litige par notre équipe.', data: { contractId: p.contractId, dedupeKey: `contract.cancelled:${p.contractId}` } }));
    default:
      return [];
  }
}

/** Types doublés d'un email (le reste, comme un nouvel avis, reste dans l'appli). Les demandes proches ne sont envoyées par email que si elles sont urgentes. */
const NO_EMAIL = new Set(['review.received']);
/** Préférence par famille (préfixe du type) : `quote.sent` -> `quote`. */
const GROUPS = ['quote', 'payment', 'contract', 'request', 'provider'] as const;
const preferenceSchema = z.object({ group: z.enum(GROUPS), email: z.boolean() });
const groupOf = (type: string) => type.split('.')[0];

/**
 * In-app (persistée + poussée en direct) + email (Resend, sauf préférence `notification_preferences.email = false`).
 * SMS (Twilio) et push (FCM) se brancheront ici, en lisant `notification_preferences`, sans toucher aux modules émetteurs.
 */
@EventsHandler(IntegrationEvent)
export class NotifyOnEvents implements IEventHandler<IntegrationEvent> {
  private readonly log = new Logger(NotifyOnEvents.name);
  constructor(private readonly db: Database, private readonly realtime: RealtimeGateway, private readonly mail: EmailSender) {}

  /** Email d'une notification : n'échoue jamais l'événement (la notification in-app est déjà enregistrée). */
  private async email(userId: string, type: string, title: string, body: string | null) {
    try {
      if (NO_EMAIL.has(type)) return;
      const [u] = await this.db.query(
        `SELECT u.email, COALESCE((SELECT email FROM notification_preferences WHERE user_id = u.id AND type = $2), true) AS wanted FROM users u WHERE u.id = $1`,
        [userId, groupOf(type)],
      );
      if (!u?.wanted || !u.email) return;
      const url = process.env.APP_URL ?? 'http://localhost:3000';
      await this.mail.send({ to: u.email, subject: `FrigoConnect : ${title}`, text: `${title}${body ? `

${body}` : ''}

Ouvrir FrigoConnect : ${url}/connexion

Vous recevez cet email car il concerne votre compte FrigoConnect.` });
    } catch (err) {
      this.log.warn(`email non envoyé (${type}) : ${(err as Error).message}`);
    }
  }

  async handle(e: IntegrationEvent) {
    try {
      if (e.type === 'matching.provider_matched') return await this.notifyMatch(e);
      for (const d of draftsFor(e)) {
        // idempotent (outbox au moins une fois) : index unique partiel sur la clé de déduplication
        const data = { ...d.data, dedupeKey: d.data.dedupeKey ?? `${e.type}:${String(d.data.quoteId)}` };
        const [row] = await this.db.query(
          `INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (user_id, type, (data->>'dedupeKey')) WHERE (data->>'dedupeKey') IS NOT NULL DO NOTHING RETURNING *`,
          [d.userId, d.type, d.title, d.body, JSON.stringify(data)],
        );
        if (row) {
          this.realtime.emitToUser(d.userId, 'notification', toDto(row));
          void this.email(d.userId, d.type, d.title, d.body);
        }
      }
    } catch (err) {
      this.log.error(`notification échouée (${e.type})`, err as Error);
    }
  }

  private async notifyMatch(e: IntegrationEvent) {
    const { requestId, providerId, score } = e.payload as { requestId: string; providerId: string; score: number };
    const [row] = await this.db.query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       SELECT $1, 'request.matched', 'Nouvelle demande près de chez vous', r.title,
              jsonb_build_object('requestId', r.id::text, 'score', $3::numeric, 'urgency', r.urgency)
         FROM service_requests r WHERE r.id = $2
       ON CONFLICT (user_id, type, (data->>'requestId')) WHERE type = 'request.matched' DO NOTHING
       RETURNING *`,
      [providerId, requestId, score],
    );
    if (row) { // doublon rejoué : rien n'est renvoyé
      this.realtime.emitToUser(providerId, 'notification', toDto(row));
      if (['high', 'emergency'].includes(row.data?.urgency)) void this.email(providerId, 'request.matched', row.title, row.body);
    }
  }
}

@Injectable()
class NotificationsRepo {
  constructor(private readonly db: Database) {}

  async list(userId: string) {
    const rows = await this.db.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30', [userId]);
    const [{ n }] = await this.db.query('SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId]);
    return { items: rows.map(toDto), unread: n as number };
  }

  readOne(userId: string, id: string) {
    return this.db.query('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL', [id, userId]);
  }

  async preferences(userId: string) {
    const rows = await this.db.query('SELECT type, email FROM notification_preferences WHERE user_id = $1', [userId]);
    return Object.fromEntries(GROUPS.map((g) => [g, rows.find((r) => r.type === g)?.email ?? true])) as Record<string, boolean>;
  }

  setEmailPreference(userId: string, group: string, email: boolean) {
    return this.db.query(
      `INSERT INTO notification_preferences (user_id, type, email) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, type) DO UPDATE SET email = EXCLUDED.email`,
      [userId, group, email],
    );
  }

  readAll(userId: string) {
    return this.db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
  }
}

@Controller('notifications')
class NotificationsController {
  constructor(private readonly repo: NotificationsRepo) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.repo.list(user.id);
  }

  @Get('preferences')
  preferences(@CurrentUser() user: AuthUser) {
    return this.repo.preferences(user.id);
  }

  @Put('preferences')
  @HttpCode(204)
  async setPreference(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(preferenceSchema)) b: z.output<typeof preferenceSchema>) {
    await this.repo.setEmailPreference(user.id, b.group, b.email);
  }

  @Post('read-all')
  @HttpCode(204)
  async readAll(@CurrentUser() user: AuthUser) {
    await this.repo.readAll(user.id);
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.repo.readOne(user.id, id);
  }
}

@Module({ controllers: [NotificationsController], providers: [NotificationsRepo, NotifyOnEvents] })
export class NotificationsModule {}
