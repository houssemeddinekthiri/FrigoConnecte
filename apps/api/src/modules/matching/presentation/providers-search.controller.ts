import { Controller, Get, Inject, Query } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { providersMapSchema, searchProvidersSchema, type ProvidersMapInput, type SearchProvidersInput } from '@frigoconnect/contracts';
import { AuthUser, CurrentUser, Public, Roles } from '../../../shared/auth/auth';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import { ProviderInboxQuery, SearchProvidersQuery } from '../application/handlers';
import { MATCHING_REPOSITORY, type MatchingRepository } from '../domain/ports';

@Controller('providers')
export class ProvidersSearchController {
  constructor(private readonly queries: QueryBus, @Inject(MATCHING_REPOSITORY) private readonly repo: MatchingRepository) {}

  /** Publique (SEO, visiteurs). Déclarée avant `providers/:slug` quand ce module existera. */
  @Public()
  @Get('search')
  search(@Query(new ZodValidationPipe(searchProvidersSchema)) q: SearchProvidersInput) {
    return this.queries.execute(new SearchProvidersQuery(q));
  }

  /** Publique : tous les prestataires approuvés, pour la carte (lecture simple, sans scoring). */
  @Public()
  @Get('map')
  map(@Query(new ZodValidationPipe(providersMapSchema)) q: ProvidersMapInput) {
    return this.repo.mapPoints(q.service, new Date());
  }
}

@Controller('provider')
export class ProviderInboxController {
  constructor(private readonly queries: QueryBus) {}

  /** Demandes proposées au prestataire connecté (résultat du matching). */
  @Roles('provider')
  @Get('requests')
  inbox(@CurrentUser() user: AuthUser) {
    return this.queries.execute(new ProviderInboxQuery(user.id));
  }
}
