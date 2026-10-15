import { z } from 'zod';
import { CERTIFICATION_TYPES } from './providers';
import { SERVICE_TYPES, TRADES } from './service-requests';

const reason = z.string().trim().min(5, 'Précisez le motif (5 caractères minimum)').max(500);

// ---------- Prestataire : profil et dossier ----------
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ');

export const providerProfileSchema = z.object({
  companyName: z.string().trim().min(2).max(150),
  siret: z.string().regex(/^\d{14}$/, 'SIRET : 14 chiffres'),
  headline: z.string().trim().max(150).optional(),
  bio: z.string().trim().max(3000).optional(),
  trades: z.array(z.enum(TRADES)).min(1).max(6),
  services: z.array(z.enum(SERVICE_TYPES)).min(1).max(6),
  yearsExperience: z.number().int().min(0).max(60),
  emergencyAvailable: z.boolean().default(false),
  address: z.string().trim().min(3).max(255),
  postalCode: z.string().regex(/^\d{5}$/, 'Code postal invalide'),
  city: z.string().trim().min(1).max(100),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  serviceRadiusKm: z.number().int().min(1).max(500).default(30),
});
export type ProviderProfileInput = z.output<typeof providerProfileSchema>;

export const addCertificationSchema = z
  .object({
    type: z.enum(CERTIFICATION_TYPES),
    label: z.string().trim().max(150).optional(),
    number: z.string().trim().max(60).optional(),
    issuer: z.string().trim().max(150).optional(),
    issuedOn: isoDate.optional(),
    expiresOn: isoDate.optional(),
    fileId: z.string().uuid(),
  })
  .refine((v) => !v.issuedOn || !v.expiresOn || v.expiresOn > v.issuedOn, { path: ['expiresOn'], message: 'L\'expiration doit suivre la délivrance' });
export type AddCertificationInput = z.output<typeof addCertificationSchema>;

// ---------- Administration ----------
export const rejectSchema = z.object({ reason });
export const reviewCertificationSchema = z
  .object({ decision: z.enum(['approve', 'reject']), reason: reason.optional() })
  .refine((v) => v.decision === 'approve' || !!v.reason, { path: ['reason'], message: 'Motif obligatoire pour un refus' });
export const suspendSchema = z.object({ reason });
export const commissionSchema = z.object({
  providerId: z.string().uuid().optional(), // absent = barème par défaut
  rateBps: z.number().int().min(0).max(3000), // 1000 = 10 %
  validFrom: z.string().datetime().optional(),
  reason,
});
export const listUsersSchema = z.object({
  role: z.enum(['client', 'provider', 'super_admin']).optional(),
  status: z.enum(['pending', 'active', 'suspended']).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});
export const resolveDisputeSchema = z.object({ resolution: z.enum(['complete', 'cancel']), note: reason });
export const statsSchema = z.object({ days: z.coerce.number().refine((n) => [7, 30, 90].includes(n), '7, 30 ou 90').default(30) });
export const listAuditSchema = z.object({
  entityType: z.string().max(40).optional(),
  actorId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(),
});

export const createReviewSchema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(2000).optional() });

// ---------- DTO ----------
export interface ProviderApplication {
  providerId: string;
  companyName: string;
  siret: string;
  email: string;
  city: string | null;
  trades: string[];
  services: string[];
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'suspended';
  rejectionReason: string | null;
  submittedAt: string | null;
  certifications: {
    id: string; type: string; label: string | null; number: string | null; issuer: string | null; issuedOn: string | null; expiresOn: string | null;
    reviewStatus: 'pending' | 'approved' | 'rejected' | 'not_applicable'; rejectionReason: string | null; fileId: string;
  }[];
  blockers: string[]; // ce qui empêche l'approbation (calculé par le serveur)
}

export interface AdminStats {
  days: number;
  kpis: {
    gmvCents: number; commissionCents: number; takeRateBps: number; escrowCents: number;
    requests: number; quotedRate: number | null; acceptanceRate: number | null; medianFirstQuoteMinutes: number | null;
    contractsCompleted: number; disputes: number; newUsers: number; activeProviders: number; pendingValidations: number; avgRating: number | null;
  };
  gmvByDay: { day: string; cents: number }[];
}
