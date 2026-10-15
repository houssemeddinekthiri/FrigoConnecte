import type { ProviderCandidate } from '../domain/ports';
import { SearchProvidersHandler, SearchProvidersQuery } from './handlers';

const cand = (id: string, o: Partial<ProviderCandidate> = {}): ProviderCandidate => ({
  providerId: id, slug: id, companyName: id, headline: null, city: null, services: [], trades: [], logoFileId: null,
  distanceKm: 10, radiusKm: 50, emergencyAvailable: false, avgRating: 4, reviewsCount: 10, avgResponseMinutes: 30,
  yearsExperience: 5, completedMissions: 10, certifications: ['fluid_handling_cat1'], slots: [], onTimeOff: false, ...o,
});

const pool = [
  cand('proche', { distanceKm: 2, avgRating: 3.5 }),
  cand('loin-top', { distanceKm: 30, avgRating: 5, emergencyAvailable: true }),
  cand('dispo', { distanceKm: 15, avgRating: 4.2, availableNow: true, emergencyAvailable: true }),
];
const run = (p: Partial<ConstructorParameters<typeof SearchProvidersQuery>[0]>) =>
  new SearchProvidersHandler({ findCandidates: async () => pool } as never)
    .execute(new SearchProvidersQuery({ lat: 0, lng: 0, urgency: 'normal', limit: 20, emergency: false, availableNow: false, sort: 'relevance', ...p }))
    .then((r) => r.map((x) => x.providerId));

describe('recherche publique : filtres et tri', () => {
  it('filtre avant le classement', async () => {
    expect(await run({ availableNow: true })).toEqual(['dispo']);
    expect((await run({ emergency: true })).sort()).toEqual(['dispo', 'loin-top']);
  });

  it('trie par note ou par distance, puis applique la limite', async () => {
    expect(await run({ sort: 'rating' })).toEqual(['loin-top', 'dispo', 'proche']);
    expect(await run({ sort: 'distance' })).toEqual(['proche', 'dispo', 'loin-top']);
    // la limite s'applique APRÈS le tri : le mieux noté reste premier même s'il n'est pas le plus pertinent
    expect(await run({ sort: 'rating', limit: 1 })).toEqual(['loin-top']);
  });
});
