import type { CertificationType, Trade } from '@frigoconnect/contracts';
import { InvalidStateError } from '../../shared/kernel/errors';
import { FLUID_CERTS, FLUID_TRADES } from '../matching/domain/scoring';

export type ProviderStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'suspended';
export interface CertView { type: CertificationType; reviewStatus: 'pending' | 'approved' | 'rejected' | 'not_applicable'; expiresOn: string | null }

const handlesFluids = (trades: readonly Trade[]) => trades.some((t) => FLUID_TRADES.includes(t));
const today = () => new Date().toISOString().slice(0, 10);
const valid = (c: CertView) => c.reviewStatus === 'approved' && (!c.expiresOn || c.expiresOn >= today());

/** Un dossier se soumet depuis « brouillon » ou après un refus (correction). */
export function assertSubmittable(p: { status: ProviderStatus; trades: readonly Trade[] }, certs: CertView[]) {
  if (p.status !== 'draft' && p.status !== 'rejected') throw new InvalidStateError('Ce dossier est déjà soumis ou validé');
  if (handlesFluids(p.trades) && !certs.some((c) => FLUID_CERTS.includes(c.type) && c.reviewStatus !== 'rejected')) {
    throw new InvalidStateError('Ajoutez votre attestation de capacité (manipulation des fluides frigorigènes) pour soumettre votre dossier');
  }
}

/**
 * Ce qui empêche l'administrateur d'approuver (liste vide = approuvable). Même règle que le matching :
 * un prestataire « froid / clim / PAC » sans attestation VALIDE et non expirée serait de toute façon exclu de toutes les demandes.
 */
export function approvalBlockers(p: { status: ProviderStatus; trades: readonly Trade[] }, certs: CertView[]): string[] {
  const out: string[] = [];
  if (p.status !== 'pending_review') out.push('Le dossier n\'est pas en attente de validation');
  const pending = certs.filter((c) => c.reviewStatus === 'pending').length;
  if (pending) out.push(`${pending} document(s) restent à examiner`);
  if (handlesFluids(p.trades) && !certs.some((c) => FLUID_CERTS.includes(c.type) && valid(c))) out.push('Aucune attestation de capacité valide et non expirée');
  return out;
}

/** Palier d'alerte d'expiration : 30, 7 ou 0 jour(s). `null` = trop tôt pour alerter. */
export function expiryBucket(daysLeft: number): 30 | 7 | 0 | null {
  if (daysLeft <= 0) return 0;
  if (daysLeft <= 7) return 7;
  if (daysLeft <= 30) return 30;
  return null;
}
