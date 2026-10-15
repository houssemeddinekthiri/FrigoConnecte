import type { CertificationType, ServiceType, Trade, Urgency } from '@frigoconnect/contracts';

/**
 * Score de matching : 0-100. Fonction PURE (aucun accès base) => testable et rejouable.
 * Deux temps : 1) exclusions strictes (pas de score), 2) somme pondérée de sous-scores 0..1.
 */

export interface MatchTarget {
  serviceType?: ServiceType;
  trade?: Trade;
  urgency: Urgency;
  at: Date; // moment visé : date souhaitée ou maintenant
}

export interface Slot { weekday: number; start: string; end: string } // weekday ISO 1=lundi, "HH:MM", heure de Paris

export interface Candidate {
  providerId: string;
  distanceKm: number;
  radiusKm: number;
  emergencyAvailable: boolean;
  avgRating: number;
  reviewsCount: number;
  avgResponseMinutes: number | null;
  yearsExperience: number;
  completedMissions: number;
  certifications: CertificationType[]; // validées et non expirées uniquement
  slots: Slot[];
  onTimeOff: boolean; // en congés au moment visé
  availableNow?: boolean; // a activé « disponible maintenant » et le moment visé est dans la fenêtre
}

export type Exclusion = 'out_of_range' | 'missing_certification';
export interface Weights { distance: number; availability: number; certifications: number; rating: number; response: number; experience: number }
export type Evaluation = { excluded: Exclusion } | { score: number; details: { weights: Weights; subscores: Weights } };

// Chaque ligne somme à 1. En urgence, distance + disponibilité = 60 %.
export const WEIGHTS: Record<Urgency, Weights> = {
  low:       { distance: 0.30, availability: 0.20, certifications: 0.15, rating: 0.15, response: 0.10, experience: 0.10 },
  normal:    { distance: 0.30, availability: 0.20, certifications: 0.15, rating: 0.15, response: 0.10, experience: 0.10 },
  high:      { distance: 0.30, availability: 0.25, certifications: 0.13, rating: 0.12, response: 0.12, experience: 0.08 },
  emergency: { distance: 0.30, availability: 0.30, certifications: 0.10, rating: 0.10, response: 0.15, experience: 0.05 },
};

// --- Règles métier à faire valider juridiquement avant la mise en production ---
export const FLUID_CERTS: CertificationType[] = ['fluid_handling_cat1', 'fluid_handling_cat2', 'fluid_handling_cat3', 'fluid_handling_cat4'];
export const FLUID_TRADES: Trade[] = ['refrigeration', 'air_conditioning', 'heat_pump'];

export function requirementsMet(t: MatchTarget, certs: CertificationType[]): boolean {
  const handlesFluids = !!t.trade && FLUID_TRADES.includes(t.trade) && t.serviceType !== 'audit';
  if (handlesFluids && !certs.some((c) => FLUID_CERTS.includes(c))) return false;
  if (t.serviceType === 'installation' && !certs.includes('insurance_decennale')) return false;
  return true;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

const DAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const parisFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Jour et heure à Paris (les créneaux des prestataires sont en heure locale, pas en UTC). */
export function parisClock(d: Date): { weekday: number; minutes: number } {
  const p = Object.fromEntries(parisFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { weekday: DAYS[p.weekday], minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function availability(c: Candidate, t: MatchTarget): number {
  if (c.onTimeOff) return 0;
  if (c.availableNow) return 1;
  const { weekday, minutes } = parisClock(t.at);
  if (c.slots.some((s) => s.weekday === weekday && minutes >= toMin(s.start) && minutes < toMin(s.end))) return 1;
  const urgent = t.urgency === 'emergency' || t.urgency === 'high';
  if (urgent) return c.emergencyAvailable ? 0.6 : 0; // hors créneaux : seulement s'il accepte les urgences
  return c.slots.length > 0 ? 0.5 : 0.2; // pas pressé : peut planifier sur ses créneaux habituels
}

// Note moyenne "bayésienne" : un 5/5 avec 1 avis ne bat pas un 4,8 avec 100 avis.
const PRIOR_RATING = 4.0;
const PRIOR_WEIGHT = 5;
const rating = (c: Candidate) => ((c.reviewsCount * c.avgRating + PRIOR_WEIGHT * PRIOR_RATING) / (c.reviewsCount + PRIOR_WEIGHT)) / 5;

// <= 15 min : 1 ; >= 4 h : 0 ; inconnu : neutre
const response = (c: Candidate) => (c.avgResponseMinutes === null ? 0.5 : clamp01(1 - (c.avgResponseMinutes - 15) / (240 - 15)));

const experience = (c: Candidate) => 0.5 * clamp01(c.yearsExperience / 15) + 0.5 * clamp01(c.completedMissions / 50);

// Le minimum légal est déjà garanti par requirementsMet ; ici on valorise la diversité des certifications.
const certifications = (c: Candidate) => {
  const distinct = new Set(c.certifications.map((x) => (FLUID_CERTS.includes(x) ? 'fluid' : x)));
  return clamp01(0.5 + 0.15 * distinct.size);
};

export function evaluate(c: Candidate, t: MatchTarget): Evaluation {
  if (c.distanceKm > c.radiusKm) return { excluded: 'out_of_range' };
  if (!requirementsMet(t, c.certifications)) return { excluded: 'missing_certification' };

  const sub: Weights = {
    distance: clamp01(1 - c.distanceKm / c.radiusKm),
    availability: availability(c, t),
    certifications: certifications(c),
    rating: rating(c),
    response: response(c),
    experience: experience(c),
  };
  const w = WEIGHTS[t.urgency];
  const total = (Object.keys(w) as (keyof Weights)[]).reduce((s, k) => s + w[k] * sub[k], 0);
  return {
    score: round(total * 100, 1),
    details: { weights: w, subscores: Object.fromEntries(Object.entries(sub).map(([k, v]) => [k, round(v)])) as unknown as Weights },
  };
}

export interface Scored<T extends Candidate> { candidate: T; score: number; details: { weights: Weights; subscores: Weights } }

/** Évalue, exclut, trie (score desc, puis distance) et garde les `limit` meilleurs. */
export function rank<T extends Candidate>(candidates: T[], t: MatchTarget, limit: number): Scored<T>[] {
  const out: Scored<T>[] = [];
  for (const candidate of candidates) {
    const e = evaluate(candidate, t);
    if ('score' in e) out.push({ candidate, ...e });
  }
  return out.sort((a, b) => b.score - a.score || a.candidate.distanceKm - b.candidate.distanceKm).slice(0, limit);
}
