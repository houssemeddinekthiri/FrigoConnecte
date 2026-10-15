import { z } from 'zod';

export const CLIENT_TYPES = ['individual', 'company', 'shop', 'hotel', 'restaurant', 'syndic', 'public_body'] as const;

export const registerSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(10).max(128),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Format international requis (+33...)').optional(),
    accountType: z.enum(['client', 'provider']), // super_admin n'est JAMAIS auto-attribuable
    clientType: z.enum(CLIENT_TYPES).default('individual'),
    companyName: z.string().trim().min(1).max(150).optional(),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Acceptation des CGU requise' }) }),
  })
  .refine((v) => v.accountType !== 'client' || v.clientType === 'individual' || !!v.companyName, {
    path: ['companyName'],
    message: 'Raison sociale requise pour un client professionnel',
  });

export type RegisterInput = z.output<typeof registerSchema>;
