import { z } from 'zod';

// Partage API <-> web (React Hook Form) : une seule source de validation.
export const SERVICE_TYPES = ['breakdown', 'maintenance', 'installation', 'audit', 'compliance', 'annual_contract'] as const;
export const TRADES = ['refrigeration', 'heating', 'air_conditioning', 'ventilation', 'heat_pump', 'maintenance_company'] as const;
export const URGENCIES = ['low', 'normal', 'high', 'emergency'] as const;
export const REQUEST_STATUSES = ['draft', 'open', 'quoted', 'awarded', 'in_progress', 'completed', 'cancelled', 'expired'] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];
export type Trade = (typeof TRADES)[number];
export type Urgency = (typeof URGENCIES)[number];
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const createServiceRequestSchema = z
  .object({
    serviceType: z.enum(SERVICE_TYPES),
    trade: z.enum(TRADES),
    title: z.string().trim().min(5).max(150),
    description: z.string().trim().min(10).max(5000),
    equipment: z.string().trim().max(200).optional(),
    urgency: z.enum(URGENCIES).default('normal'),
    address: z.string().trim().min(3).max(255),
    postalCode: z.string().regex(/^\d{5}$/, 'Code postal invalide'),
    city: z.string().trim().min(1).max(100),
    preferredProviderId: z.string().uuid().optional(), // « re-solliciter » : ce prestataire reçoit la demande en priorité
    equipmentId: z.string().uuid().optional(), // équipement enregistré concerné (rappels d'entretien)
    attachmentIds: z.array(z.string().uuid()).max(6).optional(), // fichiers déjà envoyés (photos, PDF)
    draft: z.boolean().optional(), // true = enregistré sans être publié aux prestataires
    location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
    desiredFrom: z.coerce.date().optional(),
    desiredTo: z.coerce.date().optional(),
    budgetMinCents: z.number().int().nonnegative().nullish(),
    budgetMaxCents: z.number().int().positive().nullish(), // budget maximum du client (null = effacé)
  })
  .refine((v) => !v.desiredFrom || !v.desiredTo || v.desiredTo >= v.desiredFrom, { path: ['desiredTo'], message: 'Date de fin avant le début' })
  .refine((v) => v.budgetMaxCents == null || v.budgetMinCents == null || v.budgetMaxCents >= v.budgetMinCents, {
    path: ['budgetMaxCents'],
    message: 'Budget max inférieur au min',
  });

export type CreateServiceRequestInput = z.output<typeof createServiceRequestSchema>;

export const listServiceRequestsSchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListServiceRequestsInput = z.output<typeof listServiceRequestsSchema>;
