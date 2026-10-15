import { z } from 'zod';
import { TRADES } from './service-requests';

export const createEquipmentSchema = z.object({
  label: z.string().trim().min(2).max(100),
  trade: z.enum(TRADES),
  details: z.string().trim().max(200).optional(),
  address: z.string().trim().min(3).max(255),
  postalCode: z.string().regex(/^\d{5}$/, 'Code postal invalide'),
  city: z.string().trim().min(1).max(100),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
});
export type CreateEquipmentInput = z.output<typeof createEquipmentSchema>;

export interface EquipmentDto {
  id: string;
  label: string;
  trade: (typeof TRADES)[number];
  details: string | null;
  address: string;
  postalCode: string;
  city: string;
  createdAt: string;
  lastServiceAt: string | null; // dernière intervention terminée sur cet équipement
}
