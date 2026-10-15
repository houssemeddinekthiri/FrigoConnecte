import type { ClientTrustDto, TrustLevel } from '@frigoconnect/contracts';

export interface TrustFacts {
  completedMissions: number;
  disputes: number;
  failedPayments: number;
  memberMonths: number;
  hasPhone: boolean;
  hasCompany: boolean; // raison sociale + SIRET renseignés
}

export const TRUSTED_AT = 70;
export const REGULAR_AT = 35;

/**
 * Score 0-100 reposant uniquement sur des faits : identité (téléphone, société), ancienneté, missions menées à terme,
 * absence de litige ou d'impayé. Les litiges pèsent plus que tout le reste : un client trop litigieux n'est jamais « de confiance ».
 */
export function clientTrust(f: TrustFacts): ClientTrustDto {
  let score = 0;
  const tips: string[] = [];
  if (f.hasPhone) score += 10; else tips.push('Ajoutez votre numéro de téléphone (+10)');
  if (f.hasCompany) score += 15; else tips.push('Renseignez votre société et votre SIRET (+15)');
  score += Math.min(f.memberMonths, 10) * 2; // jusqu'à 20 points pour 10 mois d'ancienneté
  score += f.completedMissions >= 1 ? 25 : 0;
  score += f.completedMissions >= 3 ? 15 : 0;
  if (f.completedMissions === 0) tips.push('Menez une première intervention jusqu\'à sa validation (+25)');
  else if (f.completedMissions < 3) tips.push('Validez 3 interventions pour atteindre le niveau « de confiance » (+15)');
  if (f.disputes === 0 && f.failedPayments === 0) score += 15; else tips.push('Évitez les litiges et réglez vos paiements du premier coup');
  score -= f.disputes * 20 + f.failedPayments * 5;
  score = Math.max(0, Math.min(100, score));

  const level: TrustLevel = f.disputes > 1 ? 'new' : score >= TRUSTED_AT && f.completedMissions >= 3 ? 'trusted' : score >= REGULAR_AT && f.completedMissions >= 1 ? 'regular' : 'new';
  return { level, score, completedMissions: f.completedMissions, disputes: f.disputes, memberMonths: f.memberMonths, verified: { phone: f.hasPhone, company: f.hasCompany }, tips };
}
