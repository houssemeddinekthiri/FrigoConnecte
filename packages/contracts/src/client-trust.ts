/** Profil de confiance d'un client : calculé côté serveur à partir de faits vérifiables, jamais saisi. */
export type TrustLevel = 'new' | 'regular' | 'trusted';

export interface ClientTrustDto {
  level: TrustLevel;
  score: number; // 0-100 (affiché au client ; les prestataires voient le niveau)
  completedMissions: number;
  disputes: number;
  memberMonths: number;
  verified: { phone: boolean; company: boolean };
  tips: string[]; // ce que le client peut faire pour monter de niveau
}

export interface RequestContextDto {
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  trust: Pick<ClientTrustDto, 'level' | 'completedMissions' | 'disputes' | 'memberMonths' | 'verified'>;
}
