import { Body, Controller, Delete, Get, HttpCode, Param, Patch, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  createServiceRequestSchema,
  SERVICE_TYPES,
  TRADES,
  listServiceRequestsSchema,
  type CreateServiceRequestInput,
  type ListServiceRequestsInput,
} from '@frigoconnect/contracts';
import { AuthUser, CurrentUser, Roles } from '../../../shared/auth/auth';
import { Database } from '../../../shared/infrastructure/database/database.service';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import {
  CancelServiceRequestCommand,
  CreateServiceRequestCommand,
  DeleteServiceRequestCommand,
  EditServiceRequestCommand,
  PublishServiceRequestCommand,
  GetServiceRequestQuery,
  ListMyServiceRequestsQuery,
} from '../application/handlers';

@Controller('service-requests')
export class ServiceRequestsController {
  constructor(private readonly commands: CommandBus, private readonly queries: QueryBus, private readonly db: Database) {}

  @Post()
  @Roles('client')
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createServiceRequestSchema)) body: CreateServiceRequestInput,
  ) {
    const id = await this.commands.execute<CreateServiceRequestCommand, string>(new CreateServiceRequestCommand(user.id, body));
    return { id };
  }

  @Get()
  @Roles('client')
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(listServiceRequestsSchema)) q: ListServiceRequestsInput) {
    return this.queries.execute(new ListMyServiceRequestsQuery(user.id, q));
  }

  /** Fourchette indicative (25e–75e centile des devis envoyés ou acceptés), seulement si l'échantillon est assez large pour être anonyme. */
  @Get('estimate')
  @Roles('client')
  async estimate(@Query('serviceType') serviceType = '', @Query('trade') trade = '') {
    if (!(SERVICE_TYPES as readonly string[]).includes(serviceType) || !(TRADES as readonly string[]).includes(trade)) return null;
    const [r] = await this.db.query(
      `SELECT count(*)::int AS n, count(DISTINCT q.provider_id)::int AS providers,
              round(percentile_cont(0.25) WITHIN GROUP (ORDER BY q.total_cents))::bigint AS "lowCents",
              round(percentile_cont(0.75) WITHIN GROUP (ORDER BY q.total_cents))::bigint AS "highCents"
         FROM quotes q JOIN service_requests r ON r.id = q.request_id
        WHERE q.status IN ('sent','accepted') AND r.service_type = $1 AND r.trade = $2`,
      [serviceType, trade],
    );
    return r.n >= 3 && r.providers >= 2 ? { count: r.n, lowCents: r.lowCents, highCents: r.highCents } : null;
  }

  @Get(':id')
  @Roles('client', 'super_admin')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.queries.execute(new GetServiceRequestQuery(id, user));
  }

  /** Pièces jointes : le client propriétaire, un prestataire mis en relation, ou un admin. */
  @Get(':id/attachments')
  @Roles('client', 'provider', 'super_admin')
  attachments(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.query(
      `SELECT f.id, f.original_name AS name, f.mime_type AS "mimeType"
         FROM files f JOIN service_requests r ON r.id = f.entity_id
        WHERE f.entity_type = 'service_request' AND r.id = $1 AND f.status = 'uploaded'
          AND (r.client_id = $2 OR $3::boolean OR EXISTS (SELECT 1 FROM request_matches m WHERE m.request_id = r.id AND m.provider_id = $2))
        ORDER BY f.created_at`,
      [id, user.id, user.roles.includes('super_admin')],
    );
  }

  /** Prestataires prévenus par le matching, du plus proche au plus loin. Données publiques seulement (ville, distance, position approximative), jamais l'adresse. */
  @Get(':id/matches')
  @Roles('client', 'super_admin')
  matches(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.db.query(
      `SELECT p.user_id AS "providerId", p.slug, p.company_name AS "companyName", p.city,
              round((ST_Distance(p.base_location, r.location) / 1000)::numeric, 1)::float AS "distanceKm",
              -- position arrondie (~1 km) pour la carte : ne révèle pas l'adresse du prestataire
              round(ST_Y(p.base_location::geometry)::numeric, 2)::float AS lat, round(ST_X(p.base_location::geometry)::numeric, 2)::float AS lng,
              p.avg_response_minutes AS "avgResponseMinutes",
              (p.available_until IS NOT NULL AND p.available_until > now()) AS "availableNow"
         FROM request_matches m
         JOIN service_requests r ON r.id = m.request_id
         JOIN providers p ON p.user_id = m.provider_id
        WHERE r.id = $1 AND (r.client_id = $2 OR $3::boolean) AND m.declined_at IS NULL
        ORDER BY "distanceKm"`,
      [id, user.id, user.roles.includes('super_admin')],
    );
  }

  @Patch(':id')
  @Roles('client')
  @HttpCode(204)
  async edit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createServiceRequestSchema)) body: CreateServiceRequestInput,
  ) {
    await this.commands.execute(new EditServiceRequestCommand(id, user.id, body));
  }

  @Post(':id/publish')
  @Roles('client')
  @HttpCode(204)
  async publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.commands.execute(new PublishServiceRequestCommand(id, user.id));
  }

  @Delete(':id')
  @Roles('client')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.commands.execute(new DeleteServiceRequestCommand(id, user.id));
  }

  @Post(':id/cancel')
  @Roles('client')
  @HttpCode(204)
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.commands.execute(new CancelServiceRequestCommand(id, user.id));
  }
}
