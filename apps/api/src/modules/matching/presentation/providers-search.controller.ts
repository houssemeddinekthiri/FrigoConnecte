import { Controller, Get, Query } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { searchProvidersSchema, type SearchProvidersInput } from '@frigoconnect/contracts';
import { AuthUser, CurrentUser, Public, Roles } from '../../../shared/auth/auth';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import { ProviderInboxQuery, SearchProvidersQuery } from '../application/handlers';

@Controller('providers')
export class ProvidersSearchController {
  constructor(private readonly queries: QueryBus) {}

  /** Publique (SEO, visiteurs). Déclarée avant `providers/:slug` quand ce module existera. */
  @Public()
  @Get('search')
  search(@Query(new ZodValidationPipe(searchProvidersSchema)) q: SearchProvidersInput) {
    return this.queries.execute(new SearchProvidersQuery(q));
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
