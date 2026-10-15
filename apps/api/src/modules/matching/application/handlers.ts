import { Inject, Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler, IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { ProviderSearchResult, SearchProvidersInput } from '@frigoconnect/contracts';
import { IntegrationEvent } from '../../../shared/infrastructure/outbox/outbox';
import { InboxItem, MATCHING_REPOSITORY, MatchingRepository } from '../domain/ports';
import { rank } from '../domain/scoring';

const MAX_MATCHES = 10; // prestataires notifiés par demande
const CANDIDATE_POOL = 200;

/** Réagit à la création d'une demande : score les prestataires et enregistre les meilleurs. */
@EventsHandler(IntegrationEvent)
export class RunMatchingOnRequestCreated implements IEventHandler<IntegrationEvent> {
  private readonly log = new Logger(RunMatchingOnRequestCreated.name);

  constructor(@Inject(MATCHING_REPOSITORY) private readonly repo: MatchingRepository) {}

  // ponytail: l'outbox marque l'événement publié sans attendre ce handler ; une erreur ici est journalisée mais pas rejouée.
  // Passer à une file BullMQ (retries) quand elle sera introduite (messagerie/paiements).
  async handle(e: IntegrationEvent) {
    if (e.type !== 'service_request.created') return;
    try {
      const req = await this.repo.getRequest(e.payload.requestId as string);
      if (!req || req.status !== 'open') return;
      const at = req.desiredFrom && req.desiredFrom > new Date() ? req.desiredFrom : new Date();
      const candidates = await this.repo.findCandidates(req.location, { serviceType: req.serviceType, trade: req.trade }, at, CANDIDATE_POOL);
      const ranked = rank(candidates, { serviceType: req.serviceType, trade: req.trade, urgency: req.urgency, at }, MAX_MATCHES);
      await this.repo.saveMatches(req.id, ranked);
      if (typeof e.payload.preferredProviderId === 'string') await this.repo.addPreferredMatch(req.id, e.payload.preferredProviderId);
      this.log.log(`demande ${req.id}: ${candidates.length} candidats, ${ranked.length} retenus`);
    } catch (err) {
      this.log.error(`matching échoué pour ${String(e.payload.requestId)}`, err as Error);
    }
  }
}

export class ProviderInboxQuery {
  constructor(readonly providerId: string) {}
}

@QueryHandler(ProviderInboxQuery)
export class ProviderInboxHandler implements IQueryHandler<ProviderInboxQuery, InboxItem[]> {
  constructor(@Inject(MATCHING_REPOSITORY) private readonly repo: MatchingRepository) {}
  execute({ providerId }: ProviderInboxQuery) {
    return this.repo.inbox(providerId);
  }
}

export class SearchProvidersQuery {
  constructor(readonly params: SearchProvidersInput) {}
}

/** Recherche publique : même moteur, cible = « maintenant ». */
@QueryHandler(SearchProvidersQuery)
export class SearchProvidersHandler implements IQueryHandler<SearchProvidersQuery, ProviderSearchResult[]> {
  constructor(@Inject(MATCHING_REPOSITORY) private readonly repo: MatchingRepository) {}

  async execute({ params }: SearchProvidersQuery): Promise<ProviderSearchResult[]> {
    const at = new Date();
    const candidates = (await this.repo.findCandidates({ lat: params.lat, lng: params.lng }, { serviceType: params.service, trade: params.trade }, at, CANDIDATE_POOL))
      .filter((c) => (!params.emergency || c.emergencyAvailable) && (!params.availableNow || c.availableNow));
    const ranked = rank(candidates, { serviceType: params.service, trade: params.trade, urgency: params.urgency, at }, CANDIDATE_POOL);
    if (params.sort === 'rating') ranked.sort((a, b) => b.candidate.avgRating - a.candidate.avgRating || b.candidate.reviewsCount - a.candidate.reviewsCount);
    if (params.sort === 'distance') ranked.sort((a, b) => a.candidate.distanceKm - b.candidate.distanceKm);
    return ranked.slice(0, params.limit).map(({ candidate: c, score }) => ({
      providerId: c.providerId, slug: c.slug, companyName: c.companyName, headline: c.headline, city: c.city,
      services: c.services, trades: c.trades, avgRating: c.avgRating, reviewsCount: c.reviewsCount,
      avgResponseMinutes: c.avgResponseMinutes, distanceKm: Math.round(c.distanceKm * 10) / 10, score,
      emergencyAvailable: c.emergencyAvailable, availableNow: !!c.availableNow, logoFileId: c.logoFileId,
    }));
  }
}
