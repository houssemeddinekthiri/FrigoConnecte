import type { ListServiceRequestsInput } from '@frigoconnect/contracts';
import { ServiceRequest } from './service-request';

/** Côté écriture : charge/sauve l'agrégat. */
export interface ServiceRequestRepository {
  save(request: ServiceRequest): Promise<void>;
  findById(id: string): Promise<ServiceRequest | null>;
  delete(id: string): Promise<void>;
  /** Rattache des fichiers déjà envoyés par ce client (et pas encore rattachés) à la demande. */
  attachFiles(requestId: string, clientId: string, fileIds: string[]): Promise<void>;
}
export const SERVICE_REQUEST_REPOSITORY = Symbol('SERVICE_REQUEST_REPOSITORY');

export interface ServiceRequestSummary {
  id: string;
  title: string;
  serviceType: string;
  urgency: string;
  status: string;
  city: string;
  quotesCount: number;
  createdAt: Date;
}
export interface ServiceRequestDetails extends ServiceRequestSummary {
  clientId: string;
  trade: string;
  description: string;
  equipment: string | null;
  address: string;
  postalCode: string;
  location: { lat: number; lng: number };
  desiredFrom: Date | null;
  desiredTo: Date | null;
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  expiresAt: Date;
}

/** Côté lecture (CQRS) : projections directes, sans passer par l'agrégat. */
export interface ServiceRequestReadModel {
  listByClient(clientId: string, q: ListServiceRequestsInput): Promise<ServiceRequestSummary[]>;
  getDetails(id: string): Promise<ServiceRequestDetails | null>;
}
export const SERVICE_REQUEST_READ_MODEL = Symbol('SERVICE_REQUEST_READ_MODEL');
