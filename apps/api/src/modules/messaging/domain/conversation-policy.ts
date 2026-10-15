export type Party = 'client' | 'provider';

export interface OpenContext {
  requestClientId: string;
  requestStatus: string;
  providerMatched: boolean; // le prestataire figure dans request_matches
  providerHasQuote: boolean; // le prestataire a envoyé un devis sur la demande
}

const OPEN_STATUSES = ['open', 'quoted', 'awarded', 'in_progress'];

/**
 * Qui peut OUVRIR une conversation (anti-spam, anti-démarchage) :
 *  - le prestataire, seulement si la demande lui a été proposée (matching) ;
 *  - le client, seulement après avoir reçu un devis de ce prestataire.
 */
export function checkOpen(ctx: OpenContext, caller: { userId: string; party: Party }): 'ok' | 'request_closed' | 'not_allowed' {
  if (!OPEN_STATUSES.includes(ctx.requestStatus)) return 'request_closed';
  if (caller.party === 'provider') return ctx.providerMatched ? 'ok' : 'not_allowed';
  return caller.userId === ctx.requestClientId && ctx.providerHasQuote ? 'ok' : 'not_allowed';
}

export function partyOf(conv: { clientId: string; providerId: string }, userId: string): Party | null {
  return conv.clientId === userId ? 'client' : conv.providerId === userId ? 'provider' : null;
}
