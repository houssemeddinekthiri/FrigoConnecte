import type { ServiceType, Trade, Urgency } from '@frigoconnect/contracts';
import { Candidate, Scored } from './scoring';

export interface ProviderCandidate extends Candidate {
  slug: string;
  companyName: string;
  headline: string | null;
  city: string | null;
  services: string[];
  trades: string[];
  logoFileId: string | null;
}

export interface RequestForMatching {
  id: string;
  status: string;
  location: { lat: number; lng: number };
  serviceType: ServiceType;
  trade: Trade;
  urgency: Urgency;
  desiredFrom: Date | null;
}

export interface InboxItem {
  requestId: string;
  title: string;
  serviceType: string;
  urgency: string;
  city: string;
  requestStatus: string;
  score: number;
  receivedAt: string;
  quote: { id: string; status: string } | null; // mon devis sur cette demande, s'il existe
}

export interface MatchingRepository {
  /** Demandes proposées à ce prestataire, récentes d'abord. */
  inbox(providerId: string): Promise<InboxItem[]>;
  getRequest(id: string): Promise<RequestForMatching | null>;
  /** Prestataires approuvés, actifs, dont le rayon couvre `location`, filtrés par service/métier. Triés par distance. */
  findCandidates(location: { lat: number; lng: number }, filter: { serviceType?: ServiceType; trade?: Trade }, at: Date, limit: number): Promise<ProviderCandidate[]>;
  /** Idempotent (rejouable) : n'émet l'événement `matching.provider_matched` que pour les nouvelles lignes. */
  saveMatches(requestId: string, matches: Scored<ProviderCandidate>[]): Promise<void>;
  /** « Re-solliciter » : le prestataire choisi par le client reçoit la demande même hors des 10 meilleurs (s'il est approuvé). */
  addPreferredMatch(requestId: string, providerId: string): Promise<void>;
}
export const MATCHING_REPOSITORY = Symbol('MATCHING_REPOSITORY');
