import { checkOpen, OpenContext, partyOf } from './conversation-policy';

const ctx: OpenContext = { requestClientId: 'c1', requestStatus: 'open', providerMatched: true, providerHasQuote: false };

describe('checkOpen', () => {
  it('prestataire matché : oui ; non matché : non', () => {
    expect(checkOpen(ctx, { userId: 'p1', party: 'provider' })).toBe('ok');
    expect(checkOpen({ ...ctx, providerMatched: false }, { userId: 'p1', party: 'provider' })).toBe('not_allowed');
  });

  it('client : seulement après un devis, et seulement sur sa propre demande', () => {
    expect(checkOpen(ctx, { userId: 'c1', party: 'client' })).toBe('not_allowed');
    expect(checkOpen({ ...ctx, providerHasQuote: true }, { userId: 'c1', party: 'client' })).toBe('ok');
    expect(checkOpen({ ...ctx, providerHasQuote: true }, { userId: 'autre', party: 'client' })).toBe('not_allowed');
  });

  it('demande annulée ou terminée : fermée', () => {
    expect(checkOpen({ ...ctx, requestStatus: 'cancelled' }, { userId: 'p1', party: 'provider' })).toBe('request_closed');
  });

  it('partyOf identifie les participants uniquement', () => {
    expect(partyOf({ clientId: 'c', providerId: 'p' }, 'p')).toBe('provider');
    expect(partyOf({ clientId: 'c', providerId: 'p' }, 'x')).toBeNull();
  });
});
