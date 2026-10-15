import { randomUUID } from 'node:crypto';
import type { RequestStatus, ServiceType, Trade, Urgency } from '@frigoconnect/contracts'; // types seuls : pas de dépendance runtime
import { AggregateRoot } from '../../../shared/kernel/aggregate-root';
import { ForbiddenError, InvalidStateError } from '../../../shared/kernel/errors';

export interface ServiceRequestDraft {
  serviceType: ServiceType;
  trade: Trade;
  title: string;
  description: string;
  equipment?: string | null;
  equipmentId?: string | null;
  preferredProviderId?: string | null;
  urgency: Urgency;
  address: string;
  postalCode: string;
  city: string;
  location: { lat: number; lng: number };
  desiredFrom?: Date | null;
  desiredTo?: Date | null;
  budgetMinCents?: number | null;
  budgetMaxCents?: number | null;
}

export interface ServiceRequestSnapshot extends ServiceRequestDraft {
  id: string;
  clientId: string;
  status: RequestStatus;
  quotesCount: number;
  acceptedQuoteId: string | null;
  expiresAt: Date;
}

const TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  draft: ['open', 'cancelled'],
  open: ['quoted', 'cancelled', 'expired'],
  quoted: ['awarded', 'cancelled', 'expired'],
  awarded: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  expired: [],
};

const HOUR = 3_600_000;

export class ServiceRequest extends AggregateRoot {
  private constructor(private s: ServiceRequestSnapshot) {
    super();
  }

  static create(clientId: string, draft: ServiceRequestDraft, asDraft = false, now = new Date()): ServiceRequest {
    const r = new ServiceRequest({
      ...draft,
      id: randomUUID(),
      clientId,
      status: asDraft ? 'draft' : 'open',
      quotesCount: 0,
      acceptedQuoteId: null,
      expiresAt: ServiceRequest.expiry(draft.urgency, now),
    });
    if (!asDraft) r.announce();
    return r;
  }

  private static expiry(urgency: Urgency, now: Date) {
    return new Date(now.getTime() + (urgency === 'emergency' ? 24 : 14 * 24) * HOUR);
  }

  /** Visible des prestataires : déclenche le matching. */
  private announce() {
    this.record({ type: 'service_request.created', payload: { requestId: this.s.id, clientId: this.s.clientId, urgency: this.s.urgency, preferredProviderId: this.s.preferredProviderId ?? null } });
  }

  static rehydrate(snapshot: ServiceRequestSnapshot): ServiceRequest {
    return new ServiceRequest(snapshot);
  }

  get id() {
    return this.s.id;
  }
  get clientId() {
    return this.s.clientId;
  }
  get status() {
    return this.s.status;
  }
  toSnapshot(): Readonly<ServiceRequestSnapshot> {
    return this.s;
  }

  /** Modifiable tant qu'aucun devis n'est arrivé (brouillon ou publiée sans devis). */
  edit(byUserId: string, draft: ServiceRequestDraft): void {
    this.assertOwner(byUserId);
    if (this.s.quotesCount > 0 || (this.s.status !== 'draft' && this.s.status !== 'open')) {
      throw new InvalidStateError('Cette demande ne peut plus être modifiée');
    }
    this.s = { ...this.s, ...draft, expiresAt: ServiceRequest.expiry(draft.urgency, new Date()) };
  }

  publish(byUserId: string): void {
    this.assertOwner(byUserId);
    this.transition('open');
    this.s.expiresAt = ServiceRequest.expiry(this.s.urgency, new Date());
    this.announce();
  }

  /** Seul un brouillon peut être supprimé pour de bon ; une demande publiée s'annule. */
  assertDeletable(byUserId: string): void {
    this.assertOwner(byUserId);
    if (this.s.status !== 'draft') throw new InvalidStateError('Seul un brouillon peut être supprimé');
  }

  private assertOwner(userId: string) {
    if (userId !== this.s.clientId) throw new ForbiddenError();
  }

  cancel(byUserId: string): void {
    this.assertOwner(byUserId);
    this.transition('cancelled');
    this.record({ type: 'service_request.cancelled', payload: { requestId: this.s.id } });
  }

  /** Appelé par le module quotes quand un devis est envoyé. */
  registerQuote(): void {
    if (this.s.status === 'open') this.transition('quoted');
    else if (this.s.status !== 'quoted') throw new InvalidStateError('Cette demande n\'accepte plus de devis');
    this.s.quotesCount += 1;
  }

  award(quoteId: string): void {
    this.transition('awarded');
    this.s.acceptedQuoteId = quoteId;
    this.record({ type: 'service_request.awarded', payload: { requestId: this.s.id, quoteId } });
  }

  private transition(to: RequestStatus): void {
    if (!TRANSITIONS[this.s.status].includes(to)) {
      throw new InvalidStateError(`Transition impossible : ${this.s.status} -> ${to}`);
    }
    this.s.status = to;
  }
}
