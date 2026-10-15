import { Module } from '@nestjs/common';
import { ProviderInboxHandler, RunMatchingOnRequestCreated, SearchProvidersHandler } from './application/handlers';
import { MATCHING_REPOSITORY } from './domain/ports';
import { PgMatchingRepository } from './infrastructure/pg-matching-repository';
import { ProviderInboxController, ProvidersSearchController } from './presentation/providers-search.controller';

@Module({
  controllers: [ProvidersSearchController, ProviderInboxController],
  providers: [RunMatchingOnRequestCreated, SearchProvidersHandler, ProviderInboxHandler, { provide: MATCHING_REPOSITORY, useClass: PgMatchingRepository }],
})
export class MatchingModule {}
