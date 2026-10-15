import { Body, Controller, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { createReviewSchema } from '@frigoconnect/contracts';
import type { z } from 'zod';
import { AuthUser, CurrentUser, Permissions, Roles } from '../../shared/auth/auth';
import { Database } from '../../shared/infrastructure/database/database.service';
import { writeOutbox } from '../../shared/infrastructure/outbox/outbox';
import { InvalidStateError, NotFoundError } from '../../shared/kernel/errors';
import { ZodValidationPipe } from '../../shared/presentation/zod-validation.pipe';
import { maskContacts } from '../messaging/domain/contact-masking';

/**
 * Un avis suspect (coordonnées, lien) part en modération au lieu d'être publié : on ne laisse pas la section avis
 * servir à contourner la plateforme. Tous les autres avis sont publiés immédiatement.
 */
export const needsModeration = (comment: string | undefined) => !!comment && (maskContacts(comment).masked || /https?:\/\/|www\./i.test(comment));

/** Note moyenne et nombre d'avis d'un prestataire : recalculés à chaque changement de statut d'un avis (champs lus par le matching). */
export async function recomputeProviderRating(c: PoolClient, providerId: string) {
  await c.query(
    `UPDATE providers p SET avg_rating = COALESCE(s.avg, 0), reviews_count = s.n
       FROM (SELECT round(avg(rating)::numeric, 2) AS avg, count(*)::int AS n FROM reviews WHERE target_id = $1 AND status = 'published') s
      WHERE p.user_id = $1`,
    [providerId],
  );
}

@Injectable()
export class ReviewsRepo {
  constructor(private readonly db: Database) {}

  async create(user: AuthUser, contractId: string, rating: number, comment: string | undefined) {
    const [c] = await this.db.query('SELECT client_id, provider_id, status FROM contracts WHERE id = $1', [contractId]);
    const isParty = c && (c.client_id === user.id || c.provider_id === user.id);
    if (!isParty) throw new NotFoundError('Contrat');
    if (c.status !== 'completed') throw new InvalidStateError('Vous pourrez donner votre avis une fois le contrat terminé');
    const target = c.client_id === user.id ? c.provider_id : c.client_id;
    const status = needsModeration(comment) ? 'pending_moderation' : 'published';
    try {
      await this.db.tx(async (tx) => {
        const { rows: [r] } = await tx.query(
          `INSERT INTO reviews (contract_id, author_id, target_id, rating, comment, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [contractId, user.id, target, rating, comment ?? null, status],
        );
        if (status === 'published') {
          await recomputeProviderRating(tx, target);
          await writeOutbox(tx, 'review', r.id, [{ type: 'review.received', payload: { reviewId: r.id, targetId: target, rating } }]);
        }
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new InvalidStateError('Vous avez déjà donné votre avis sur ce contrat');
      throw e;
    }
    return { status };
  }
}

@Controller()
class ReviewsController {
  constructor(private readonly repo: ReviewsRepo, private readonly db: Database) {}

  @Post('contracts/:id/reviews')
  @Roles('client', 'provider')
  @Permissions('review:create')
  create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(createReviewSchema)) body: z.output<typeof createReviewSchema>) {
    return this.repo.create(user, id, body.rating, body.comment);
  }

  @Post('reviews/:id/response')
  @Roles('provider')
  @HttpCode(204)
  async respond(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: { text?: string }) {
    const text = String(body?.text ?? '').trim().slice(0, 1000);
    if (text.length < 2) throw new InvalidStateError('Réponse vide');
    const rows = await this.db.query('UPDATE reviews SET response = $3, response_at = now() WHERE id = $1 AND target_id = $2 AND response IS NULL AND status = \'published\' RETURNING id', [id, user.id, text]);
    if (!rows.length) throw new NotFoundError('Avis');
  }
}

@Module({ controllers: [ReviewsController], providers: [ReviewsRepo] })
export class ReviewsModule {}
