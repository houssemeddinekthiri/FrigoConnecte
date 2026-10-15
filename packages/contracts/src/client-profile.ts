import { z } from 'zod';
import { CLIENT_TYPES } from './auth';

/** Téléphone saisi librement : « 06 12 34 56 78 » devient +33612345678. */
const phone = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v;
    const s = v.replace(/[\s.\-()]/g, '');
    return s === '' ? null : /^0\d{9}$/.test(s) ? `+33${s.slice(1)}` : s;
  },
  z.string().regex(/^\+[1-9]\d{7,14}$/, 'Format invalide (ex : 06 12 34 56 78)').nullable(),
);
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

export const updateClientProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    phone,
    clientType: z.enum(CLIENT_TYPES),
    companyName: optionalText(150),
    siret: z.preprocess((v) => (typeof v === 'string' ? v.replace(/\s/g, '') || null : v), z.string().regex(/^\d{14}$/, 'Le SIRET compte 14 chiffres').nullable()),
    vatNumber: optionalText(20),
    billingAddress: optionalText(255),
    billingPostalCode: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{5}$/, 'Code postal invalide').nullable()),
    billingCity: optionalText(100),
    logoFileId: z.string().uuid().nullable(), // image déjà envoyée, ou null pour retirer le logo
  })
  .refine((v) => v.clientType === 'individual' || !!v.companyName, { path: ['companyName'], message: 'Raison sociale requise pour un client professionnel' });
export type UpdateClientProfileInput = z.output<typeof updateClientProfileSchema>;

export interface ClientProfileDto {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  clientType: (typeof CLIENT_TYPES)[number];
  companyName: string | null;
  siret: string | null;
  vatNumber: string | null;
  billingAddress: string | null;
  billingPostalCode: string | null;
  billingCity: string | null;
  logoFileId: string | null;
  memberSince: string;
}
