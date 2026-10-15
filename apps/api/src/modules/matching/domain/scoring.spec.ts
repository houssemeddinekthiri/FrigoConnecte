import { Candidate, evaluate, MatchTarget, parisClock, rank, WEIGHTS } from './scoring';

const base: Candidate = {
  providerId: 'p', distanceKm: 10, radiusKm: 50, emergencyAvailable: false, avgRating: 4.5, reviewsCount: 20,
  avgResponseMinutes: 30, yearsExperience: 8, completedMissions: 30, certifications: ['fluid_handling_cat1'],
  slots: [{ weekday: 1, start: '08:00', end: '18:00' }], onTimeOff: false,
};
// lundi 5 janvier 2026, 08:30 à Paris (07:30 UTC)
const monday: MatchTarget = { serviceType: 'breakdown', trade: 'refrigeration', urgency: 'normal', at: new Date('2026-01-05T07:30:00Z') };
const score = (c: Partial<Candidate>, t: Partial<MatchTarget> = {}) => {
  const e = evaluate({ ...base, ...c }, { ...monday, ...t });
  if (!('score' in e)) throw new Error(e.excluded);
  return e.score;
};

describe('matching score', () => {
  it('chaque jeu de poids somme à 1', () => {
    for (const w of Object.values(WEIGHTS)) expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('exclut hors rayon et sans attestation de capacité (froid)', () => {
    expect(evaluate({ ...base, distanceKm: 51 }, monday)).toEqual({ excluded: 'out_of_range' });
    expect(evaluate({ ...base, certifications: ['rge'] }, monday)).toEqual({ excluded: 'missing_certification' });
    // chauffage : pas d'attestation fluides exigée
    expect(evaluate({ ...base, certifications: [] }, { ...monday, trade: 'heating' })).toHaveProperty('score');
  });

  it('installation : décennale obligatoire', () => {
    expect(evaluate(base, { ...monday, serviceType: 'installation' })).toEqual({ excluded: 'missing_certification' });
  });

  it('lit les créneaux en heure de Paris, pas en UTC', () => {
    expect(parisClock(monday.at)).toEqual({ weekday: 1, minutes: 8 * 60 + 30 });
    // 07:30 UTC = 08:30 Paris : dans le créneau 08-18 ; à 06:30 UTC = 07:30 Paris : hors créneau
    expect(score({})).toBeGreaterThan(score({}, { at: new Date('2026-01-05T06:30:00Z') }));
  });

  it('en urgence, proche + disponible bat mieux noté mais loin et indisponible', () => {
    const near = { distanceKm: 3, avgRating: 4.0, reviewsCount: 20 };
    const far = { distanceKm: 45, avgRating: 5, reviewsCount: 200, onTimeOff: true };
    expect(score(near, { urgency: 'emergency' })).toBeGreaterThan(score(far, { urgency: 'emergency' }));
  });

  it('« disponible maintenant » vaut une disponibilité pleine, sauf en congés', () => {
    const offHours = { at: new Date('2026-01-05T06:30:00Z'), urgency: 'emergency' as const }; // 07:30 Paris : hors créneau, urgence non acceptée
    expect(score({ availableNow: true }, offHours)).toBeGreaterThan(score({}, offHours));
    expect(score({ availableNow: true, onTimeOff: true }, offHours)).toBeLessThan(score({ availableNow: true }, offHours));
  });

  it('note bayésienne : 1 avis 5/5 < 100 avis 4,8/5', () => {
    expect(score({ avgRating: 5, reviewsCount: 1 })).toBeLessThan(score({ avgRating: 4.8, reviewsCount: 100 }));
  });

  it('rank trie par score, écarte les exclus et limite', () => {
    const list = [
      { ...base, providerId: 'loin', distanceKm: 40 },
      { ...base, providerId: 'proche', distanceKm: 2 },
      { ...base, providerId: 'hors', distanceKm: 99 },
    ];
    expect(rank(list, monday, 5).map((s) => s.candidate.providerId)).toEqual(['proche', 'loin']);
    expect(rank(list, monday, 1)).toHaveLength(1);
  });
});
