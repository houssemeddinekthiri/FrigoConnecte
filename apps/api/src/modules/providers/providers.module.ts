import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Put, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import {
  addCertificationSchema, MAX_PROVIDER_PHOTOS, MAX_PUBLIC_IMAGE_BYTES, providerAvailabilitySchema, providerLogoSchema, providerPhotoSchema, providerProfileSchema,
  type AddCertificationInput, type CertificationType, type ProviderProfileInput, type Trade,
} from '@frigoconnect/contracts';
import { AuthUser, CurrentUser, Public, Roles } from '../../shared/auth/auth';
import { Database } from '../../shared/infrastructure/database/database.service';
import { writeOutbox } from '../../shared/infrastructure/outbox/outbox';
import { InvalidStateError, NotFoundError } from '../../shared/kernel/errors';
import { ZodValidationPipe } from '../../shared/presentation/zod-validation.pipe';
import { FilesModule, FilesService } from '../files/files.module';
import { assertSubmittable, CertView, expiryBucket, ProviderStatus } from './provider-rules';

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const BAD_IMAGE = 'Image invalide : JPEG, PNG ou WebP, 8 Mo maximum';

@Injectable()
export class ProvidersRepo {
  constructor(private readonly db: Database) {}

  async mine(id: string) {
    const [p] = await this.db.query(
      `SELECT p.*, p.trades::text[] AS trades, p.services::text[] AS services, ST_Y(base_location::geometry) AS lat, ST_X(base_location::geometry) AS lng FROM providers p WHERE p.user_id = $1`,
      [id],
    );
    if (!p) return null;
    const certs = await this.db.query('SELECT * FROM provider_certifications WHERE provider_id = $1 ORDER BY created_at DESC', [id]);
    const [u] = await this.db.query('SELECT avatar_file_id FROM users WHERE id = $1', [id]);
    const photos = await this.db.query('SELECT id, file_id FROM provider_photos WHERE provider_id = $1 ORDER BY created_at', [id]);
    return {
      logoFileId: (u?.avatar_file_id ?? null) as string | null,
      photos: photos.map((x) => ({ id: x.id as string, fileId: x.file_id as string })),
      availableUntil: p.available_until && p.available_until > new Date() ? (p.available_until as Date).toISOString() : null,
      status: p.status as ProviderStatus, rejectionReason: p.rejection_reason, slug: p.slug, companyName: p.company_name, siret: p.siret,
      headline: p.headline, bio: p.bio, trades: p.trades as Trade[], services: p.services, yearsExperience: p.years_experience,
      emergencyAvailable: p.emergency_available, address: p.address, postalCode: p.postal_code, city: p.city,
      location: { lat: p.lat, lng: p.lng }, serviceRadiusKm: p.service_radius_km, payoutsReady: p.stripe_transfers_enabled,
      certifications: certs.map((c) => ({
        id: c.id, type: c.type as CertificationType, label: c.label, number: c.number, issuer: c.issuer, issuedOn: iso(c.issued_on), expiresOn: iso(c.expires_on),
        reviewStatus: c.review_status as CertView['reviewStatus'], rejectionReason: c.rejection_reason,
      })),
    };
  }

  async upsertProfile(userId: string, v: ProviderProfileInput) {
    const [cur] = await this.db.query('SELECT status, siret, trades::text[] AS trades FROM providers WHERE user_id = $1', [userId]);
    const point = 'ST_SetSRID(ST_MakePoint($14,$15),4326)::geography';
    const args = [v.companyName, v.siret, v.headline ?? null, v.bio ?? null, v.trades, v.services, v.yearsExperience, v.emergencyAvailable, v.address, v.postalCode, v.city, v.serviceRadiusKm, userId];
    try {
      if (!cur) {
        const slug = `${slugify(v.companyName) || 'prestataire'}-${randomBytes(2).toString('hex')}`;
        await this.db.query(
          `INSERT INTO providers (company_name, siret, headline, bio, trades, services, years_experience, emergency_available, address, postal_code, city, service_radius_km, user_id, base_location, slug, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, ${point}, $16, 'draft')`,
          [...args, v.location.lng, v.location.lat, slug],
        );
        return;
      }
      // SIRET et métiers déterminent ce que l'administration a vérifié : modifiables seulement avant soumission ou après un refus
      const locked = !['draft', 'rejected'].includes(cur.status);
      const sameTrades = [...cur.trades].sort().join() === [...v.trades].sort().join();
      if (locked && (cur.siret !== v.siret || !sameTrades)) throw new InvalidStateError('SIRET et métiers ne peuvent plus être modifiés une fois le dossier soumis : contactez le support');
      await this.db.query(
        `UPDATE providers SET company_name=$1, siret=$2, headline=$3, bio=$4, trades=$5, services=$6, years_experience=$7, emergency_available=$8,
                address=$9, postal_code=$10, city=$11, service_radius_km=$12, base_location=${point} WHERE user_id=$13`,
        [...args, v.location.lng, v.location.lat],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new InvalidStateError('Ce SIRET est déjà enregistré');
      throw e;
    }
  }

  async addCertification(userId: string, c: AddCertificationInput) {
    await this.db.tx(async (tx) => {
      const { rows: [f] } = await tx.query(`SELECT 1 AS ok FROM files WHERE id = $1 AND uploaded_by = $2 AND status IN ('uploaded','scanned_ok') AND entity_id IS NULL FOR UPDATE`, [c.fileId, userId]);
      if (!f) throw new InvalidStateError('Document invalide ou déjà utilisé');
      const { rows: [prov] } = await tx.query('SELECT 1 AS ok FROM providers WHERE user_id = $1', [userId]);
      if (!prov) throw new InvalidStateError('Renseignez d\'abord votre profil');
      const { rows: [cert] } = await tx.query(
        `INSERT INTO provider_certifications (provider_id, type, label, number, issuer, issued_on, expires_on, file_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [userId, c.type, c.label ?? null, c.number ?? null, c.issuer ?? null, c.issuedOn ?? null, c.expiresOn ?? null, c.fileId],
      );
      await tx.query(`UPDATE files SET entity_type = 'certification', entity_id = $2 WHERE id = $1`, [c.fileId, cert.id]);
    });
  }

  async submit(userId: string) {
    const p = await this.mine(userId);
    if (!p) throw new NotFoundError('Profil prestataire');
    assertSubmittable(p, p.certifications);
    await this.db.tx(async (tx) => {
      await tx.query(`UPDATE providers SET status = 'pending_review', rejection_reason = NULL WHERE user_id = $1`, [userId]);
      await writeOutbox(tx, 'provider', userId, [{ type: 'provider.submitted', payload: { providerId: userId, companyName: p.companyName } }]);
    });
  }

  /** Fiche publique : uniquement les prestataires approuvés, et uniquement des données publiques. */
  async publicBySlug(slug: string) {
    const [p] = await this.db.query(
      `SELECT p.user_id, p.slug, p.company_name, p.headline, p.bio, p.city, p.trades::text[] AS trades, p.services::text[] AS services, p.years_experience, p.avg_rating, p.reviews_count, p.completed_missions, p.avg_response_minutes, p.emergency_available,
              u.avatar_file_id, (p.available_until IS NOT NULL AND p.available_until > now()) AS available_now
         FROM providers p JOIN users u ON u.id = p.user_id WHERE p.slug = $1 AND p.status = 'approved'`,
      [slug],
    );
    if (!p) return null;
    const certs = await this.db.query(
      `SELECT type, label FROM provider_certifications WHERE provider_id = $1 AND review_status = 'approved' AND (expires_on IS NULL OR expires_on >= current_date)`,
      [p.user_id],
    );
    const photos = await this.db.query('SELECT file_id FROM provider_photos WHERE provider_id = $1 ORDER BY created_at', [p.user_id]);
    const reviews = await this.db.query(
      `SELECT r.rating, r.comment, r.response, r.created_at, u.first_name || ' ' || left(u.last_name, 1) || '.' AS author
         FROM reviews r JOIN users u ON u.id = r.author_id WHERE r.target_id = $1 AND r.status = 'published' ORDER BY r.created_at DESC LIMIT 10`,
      [p.user_id],
    );
    return {
      providerId: p.user_id, slug: p.slug, companyName: p.company_name, headline: p.headline, bio: p.bio, city: p.city, trades: p.trades, services: p.services,
      yearsExperience: p.years_experience, avgRating: Number(p.avg_rating), reviewsCount: p.reviews_count, completedMissions: p.completed_missions,
      avgResponseMinutes: p.avg_response_minutes, emergencyAvailable: p.emergency_available,
      availableNow: p.available_now as boolean, logoFileId: (p.avatar_file_id ?? null) as string | null, photoFileIds: photos.map((x) => x.file_id as string),
      certifications: certs.map((c) => ({ type: c.type, label: c.label })),
      reviews: reviews.map((r: QueryResultRow) => ({ rating: r.rating, comment: r.comment, response: r.response, createdAt: r.created_at.toISOString(), author: r.author })),
    };
  }

  /** Image envoyée par ce prestataire, confirmée, de type et de poids acceptables pour un affichage public. */
  private async assertOwnImage(run: (sql: string, args: unknown[]) => Promise<unknown[]>, userId: string, fileId: string, unclaimed: boolean) {
    const rows = await run(
      `SELECT 1 FROM files WHERE id = $1 AND uploaded_by = $2 AND status IN ('uploaded','scanned_ok') AND mime_type = ANY($3) AND size_bytes <= $4 ${unclaimed ? 'AND entity_id IS NULL' : ''} FOR UPDATE`,
      [fileId, userId, IMAGE_MIMES, MAX_PUBLIC_IMAGE_BYTES],
    );
    if (!rows.length) throw new InvalidStateError(BAD_IMAGE);
  }

  /** Logo = avatar du compte (même champ que le logo d'un client). `null` le retire. */
  async setLogo(userId: string, fileId: string | null) {
    if (fileId) await this.assertOwnImage((sql, args) => this.db.query(sql, args), userId, fileId, false);
    await this.db.query('UPDATE users SET avatar_file_id = $2 WHERE id = $1', [userId, fileId]);
  }

  async addPhoto(userId: string, fileId: string) {
    await this.db.tx(async (tx) => {
      const { rows: [prov] } = await tx.query('SELECT 1 AS ok FROM providers WHERE user_id = $1 FOR UPDATE', [userId]);
      if (!prov) throw new InvalidStateError("Renseignez d'abord votre profil");
      const { rows: [{ n }] } = await tx.query('SELECT count(*)::int AS n FROM provider_photos WHERE provider_id = $1', [userId]);
      if (n >= MAX_PROVIDER_PHOTOS) throw new InvalidStateError(`${MAX_PROVIDER_PHOTOS} photos maximum : supprimez-en une avant d'en ajouter`);
      await this.assertOwnImage(async (sql, args) => (await tx.query(sql, args)).rows, userId, fileId, true);
      const { rows: [ph] } = await tx.query('INSERT INTO provider_photos (provider_id, file_id) VALUES ($1, $2) RETURNING id', [userId, fileId]);
      await tx.query(`UPDATE files SET entity_type = 'provider_photo', entity_id = $2 WHERE id = $1`, [fileId, ph.id]);
    });
  }

  // ponytail: le fichier reste dans le stockage (pas de nettoyage des orphelins) ; à purger avec les autres fichiers non rattachés
  async removePhoto(userId: string, id: string) {
    await this.db.query('DELETE FROM provider_photos WHERE id = $1 AND provider_id = $2', [id, userId]);
  }

  /** « Disponible maintenant » : 4 h puis retour automatique à la normale. Réservé aux prestataires approuvés (les seuls visibles). */
  async setAvailableNow(userId: string, on: boolean) {
    const rows = await this.db.query(
      `UPDATE providers SET available_until = CASE WHEN $2::boolean THEN now() + interval '4 hours' END WHERE user_id = $1 AND status = 'approved' RETURNING available_until`,
      [userId, on],
    );
    if (!rows.length) throw new InvalidStateError('Disponible après la validation de votre dossier');
    return { availableUntil: rows[0].available_until ? (rows[0].available_until as Date).toISOString() : null };
  }

  /** Alertes d'expiration : un message par palier (30 j, 7 j, expirée). Le palier déjà notifié est mémorisé. */
  async alertExpiringCertifications(): Promise<number> {
    const due = await this.db.query(
      `SELECT c.id, c.provider_id, c.type, c.label, c.last_alert_days, (c.expires_on - current_date) AS days_left
         FROM provider_certifications c JOIN providers p ON p.user_id = c.provider_id
        WHERE c.review_status = 'approved' AND c.expires_on IS NOT NULL AND c.expires_on <= current_date + 30 AND p.status IN ('approved','pending_review')`,
    );
    let sent = 0;
    for (const c of due) {
      const bucket = expiryBucket(c.days_left);
      if (bucket === null || (c.last_alert_days !== null && bucket >= c.last_alert_days)) continue;
      await this.db.tx(async (tx) => {
        // conditionnel : deux instances ne notifient pas deux fois
        const { rowCount } = await tx.query('UPDATE provider_certifications SET last_alert_days = $2 WHERE id = $1 AND (last_alert_days IS NULL OR last_alert_days > $2)', [c.id, bucket]);
        if (!rowCount) return;
        await writeOutbox(tx, 'provider', c.provider_id, [{ type: 'certification.expiring', payload: { providerId: c.provider_id, certificationId: c.id, certType: c.type, label: c.label, daysLeft: c.days_left, bucket } }]);
        sent++;
      });
    }
    return sent;
  }
}

@Controller('providers')
class ProvidersController {
  constructor(private readonly repo: ProvidersRepo, private readonly files: FilesService) {}

  // `me` avant tout paramètre : ne pas être capturé par une route dynamique
  @Get('me')
  @Roles('provider')
  async me(@CurrentUser() user: AuthUser) {
    return (await this.repo.mine(user.id)) ?? { status: null };
  }

  @Put('me')
  @Roles('provider')
  @HttpCode(204)
  async save(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(providerProfileSchema)) body: ProviderProfileInput) {
    await this.repo.upsertProfile(user.id, body);
  }

  @Post('me/certifications')
  @Roles('provider')
  @HttpCode(204)
  async addCert(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(addCertificationSchema)) body: AddCertificationInput) {
    await this.repo.addCertification(user.id, body);
  }

  @Post('me/submit')
  @Roles('provider')
  @HttpCode(204)
  async submit(@CurrentUser() user: AuthUser) {
    await this.repo.submit(user.id);
  }

  @Put('me/logo')
  @Roles('provider')
  @HttpCode(204)
  async logo(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(providerLogoSchema)) body: { fileId: string | null }) {
    await this.repo.setLogo(user.id, body.fileId);
  }

  @Post('me/photos')
  @Roles('provider')
  @HttpCode(204)
  async addPhoto(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(providerPhotoSchema)) body: { fileId: string }) {
    await this.repo.addPhoto(user.id, body.fileId);
  }

  @Delete('me/photos/:id')
  @Roles('provider')
  @HttpCode(204)
  async removePhoto(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.repo.removePhoto(user.id, id);
  }

  @Put('me/availability')
  @Roles('provider')
  setAvailability(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(providerAvailabilitySchema)) body: { availableNow: boolean }) {
    return this.repo.setAvailableNow(user.id, body.availableNow);
  }

  /** Publique : logo et photos des prestataires approuvés (le navigateur passe par le BFF, qui n'expose pas MinIO). */
  @Public()
  @Get('images/:fileId')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Header('Cache-Control', 'public, max-age=3600')
  async image(@Param('fileId', ParseUUIDPipe) fileId: string) {
    const { body, mime } = await this.files.publicImage(fileId);
    return new StreamableFile(body, { type: mime, disposition: 'inline' });
  }

  /** Publique (SEO). Chemin `by-slug/` : aucun conflit possible avec `search` ni `me`. */
  @Public()
  @Get('by-slug/:slug')
  async bySlug(@Param('slug') slug: string) {
    const p = await this.repo.publicBySlug(slug.slice(0, 80));
    if (!p) throw new NotFoundError('Prestataire');
    return p;
  }
}

@Injectable()
class CertificationExpiryJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CertificationExpiryJob.name);
  private timer?: NodeJS.Timeout;
  constructor(@Inject(ProvidersRepo) private readonly repo: ProvidersRepo) {}

  onModuleInit() {
    // ponytail: toutes les 6 h via setInterval (idempotent grâce au palier mémorisé) ; BullMQ avec les autres tâches planifiées
    this.timer = setInterval(() => void this.run(), 6 * 3_600_000);
    setTimeout(() => void this.run(), 60_000).unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  private async run() {
    try {
      const n = await this.repo.alertExpiringCertifications();
      if (n) this.log.log(`${n} alerte(s) d'expiration émise(s)`);
    } catch (e) {
      this.log.error(e);
    }
  }
}

@Module({ imports: [FilesModule], controllers: [ProvidersController], providers: [ProvidersRepo, CertificationExpiryJob], exports: [ProvidersRepo] })
export class ProvidersModule {}
