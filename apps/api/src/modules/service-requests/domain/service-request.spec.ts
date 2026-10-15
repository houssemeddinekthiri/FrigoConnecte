import { ForbiddenError, InvalidStateError } from '../../../shared/kernel/errors';
import { ServiceRequest, ServiceRequestDraft } from './service-request';

const draft: ServiceRequestDraft = {
  serviceType: 'breakdown',
  trade: 'refrigeration',
  title: 'Chambre froide en panne',
  description: 'Température qui monte, compresseur à l\'arrêt',
  urgency: 'emergency',
  address: '1 rue du Froid',
  postalCode: '69001',
  city: 'Lyon',
  location: { lat: 45.76, lng: 4.83 },
};

describe('ServiceRequest', () => {
  it('s\'ouvre, émet un événement et expire en 24 h en urgence', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const r = ServiceRequest.create('client-1', draft, false, now);
    expect(r.status).toBe('open');
    expect(r.toSnapshot().expiresAt.getTime() - now.getTime()).toBe(24 * 3_600_000);
    expect(r.pullEvents().map((e) => e.type)).toEqual(['service_request.created']);
  });

  it('seul le client propriétaire peut annuler, et une fois seulement', () => {
    const r = ServiceRequest.create('client-1', draft);
    expect(() => r.cancel('autre')).toThrow(ForbiddenError);
    r.cancel('client-1');
    expect(r.status).toBe('cancelled');
    expect(() => r.cancel('client-1')).toThrow(InvalidStateError);
  });

  it('open -> quoted -> awarded, refuse un devis après annulation', () => {
    const r = ServiceRequest.create('client-1', draft);
    r.registerQuote();
    r.registerQuote();
    expect(r.toSnapshot().quotesCount).toBe(2);
    r.award('quote-1');
    expect(r.status).toBe('awarded');
    expect(() => r.registerQuote()).toThrow(InvalidStateError);
  });

  it("brouillon : aucun événement avant publication, modifiable, supprimable", () => {
    const r = ServiceRequest.create('client-1', draft, true);
    expect(r.status).toBe('draft');
    expect(r.pullEvents()).toEqual([]);
    r.edit('client-1', { ...draft, title: 'Nouveau titre' });
    expect(r.toSnapshot().title).toBe('Nouveau titre');
    expect(() => r.assertDeletable('autre')).toThrow(ForbiddenError);
    expect(() => r.assertDeletable('client-1')).not.toThrow();
    r.publish('client-1');
    expect(r.status).toBe('open');
    expect(r.pullEvents().map((e) => e.type)).toEqual(['service_request.created']);
    expect(() => r.assertDeletable('client-1')).toThrow(InvalidStateError);
  });

  it("plus modifiable dès qu'un devis est arrivé", () => {
    const r = ServiceRequest.create('client-1', draft);
    r.edit('client-1', draft);
    r.registerQuote();
    expect(() => r.edit('client-1', draft)).toThrow(InvalidStateError);
  });
});
