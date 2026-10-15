import { z } from 'zod';
import { SERVICE_TYPES, TRADES, URGENCIES } from './service-requests';

export const CERTIFICATION_TYPES = [
  'fluid_handling_cat1', 'fluid_handling_cat2', 'fluid_handling_cat3', 'fluid_handling_cat4',
  'qualipac', 'rge', 'qualibat', 'electrical_habilitation', 'insurance_decennale', 'other',
] as const;
export type CertificationType = (typeof CERTIFICATION_TYPES)[number];

export const searchProvidersSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  service: z.enum(SERVICE_TYPES).optional(),
  trade: z.enum(TRADES).optional(),
  urgency: z.enum(URGENCIES).default('normal'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** Filtres de la recherche publique (« true » dans l'URL : un booléen coercé accepterait aussi « false »). */
  emergency: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  availableNow: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  sort: z.enum(['relevance', 'rating', 'distance']).default('relevance'),
});
export type SearchProvidersInput = z.output<typeof searchProvidersSchema>;

/** Données publiques uniquement : ni adresse exacte, ni SIRET, ni contact. */
export interface ProviderSearchResult {
  providerId: string;
  slug: string;
  companyName: string;
  headline: string | null;
  city: string | null;
  services: string[];
  trades: string[];
  avgRating: number;
  reviewsCount: number;
  avgResponseMinutes: number | null;
  distanceKm: number;
  score: number;
  emergencyAvailable: boolean;
  availableNow: boolean;
  logoFileId: string | null;
}

/** Vitrine : logo (image envoyée par le prestataire ; null = le retirer), photos de réalisations, disponibilité immédiate. */
export const providerLogoSchema = z.object({ fileId: z.string().uuid().nullable() });
export const providerPhotoSchema = z.object({ fileId: z.string().uuid() });
export const providerAvailabilitySchema = z.object({ availableNow: z.boolean() });
export const MAX_PROVIDER_PHOTOS = 8;
export const MAX_PUBLIC_IMAGE_BYTES = 8 * 1024 * 1024; // affichées telles quelles (pas de miniature) : on limite le poids
