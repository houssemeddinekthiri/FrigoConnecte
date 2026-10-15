import { Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../../shared/auth/auth';
import { Database } from '../../shared/infrastructure/database/database.service';
import { NotFoundError } from '../../shared/kernel/errors';

/** Prestataires favoris du client connecté. Lecture publique du profil limitée aux prestataires approuvés. */
@Controller('client/favorites')
@Roles('client')
class ClientFavoritesController {
  constructor(private readonly db: Database) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.db.query(
      `SELECT p.user_id AS "providerId", p.slug, p.company_name AS "companyName", p.headline, p.city,
              p.avg_rating::float AS "avgRating", p.reviews_count AS "reviewsCount", p.status = 'approved' AS available,
              (SELECT count(*)::int FROM contracts c WHERE c.client_id = $1 AND c.provider_id = p.user_id AND c.status = 'completed') AS "missionsWithMe"
         FROM client_favorite_providers f JOIN providers p ON p.user_id = f.provider_id
        WHERE f.client_id = $1 ORDER BY f.created_at DESC LIMIT 100`,
      [user.id],
    );
  }

  @Put(':providerId')
  @HttpCode(204)
  async add(@CurrentUser() user: AuthUser, @Param('providerId', ParseUUIDPipe) providerId: string) {
    await this.db.query(
      `INSERT INTO client_favorite_providers (client_id, provider_id) SELECT $1, user_id FROM providers WHERE user_id = $2 AND status = 'approved' ON CONFLICT DO NOTHING`,
      [user.id, providerId],
    );
    const [p] = await this.db.query('SELECT 1 FROM client_favorite_providers WHERE client_id = $1 AND provider_id = $2', [user.id, providerId]); // déjà favori = succès
    if (!p) throw new NotFoundError('Prestataire');
  }

  @Delete(':providerId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('providerId', ParseUUIDPipe) providerId: string) {
    await this.db.query('DELETE FROM client_favorite_providers WHERE client_id = $1 AND provider_id = $2', [user.id, providerId]);
  }
}

@Module({ controllers: [ClientFavoritesController] })
export class ClientFavoritesModule {}
