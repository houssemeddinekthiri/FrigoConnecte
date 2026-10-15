import { randomUUID } from 'node:crypto';
import type { QuoteContentInput } from '@frigoconnect/contracts';
import { AggregateRoot } from '../../../shared/kernel/aggregate-root';
import { ForbiddenError, InvalidStateError } from '../../../shared/kernel/errors';
import { computeTotals, depositCents, Totals } from './totals';

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'withdrawn';

export interface QuoteSnapshot extends QuoteContentInput {
  id: string;
  number: string | null; // attribué par la base à la première sauvegarde
  requestId: string;
  providerId: string;
  status: QuoteStatus;
  sentAt: Date | null;
}

/** Date du jour à Paris au format AAAA-MM-JJ (valid_until est une date calendaire française). */
export const parisToday = (now = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(now);

const FINAL: QuoteStatus[] = ['accepted', 'rejected', 'expired', 'withdrawn'];

export class Quote extends AggregateRoot {
  private constructor(private s: QuoteSnapshot) {
    super();
  }

  static draft(providerId: string, requestId: string, content: QuoteContentInput): Quote {
    return new Quote({ ...content, id: randomUUID(), number: null, requestId, providerId, status: 'draft', sentAt: null });
  }

  static rehydrate(snapshot: QuoteSnapshot): Quote {
    return new Quote(snapshot);
  }

  get id() { return this.s.id; }
  get status() { return this.s.status; }
  toSnapshot(): Readonly<QuoteSnapshot> { return this.s; }
  totals(): Totals & { depositCents: number } {
    const t = computeTotals(this.s.items);
    return { ...t, depositCents: depositCents(t.totalCents, this.s.depositPercent) };
  }

  /** Le contenu n'est modifiable qu'en brouillon : un devis envoyé est un engagement figé (PDF + empreinte). */
  replaceContent(byProviderId: string, content: QuoteContentInput): void {
    this.ownedBy(byProviderId);
    if (this.s.status !== 'draft') throw new InvalidStateError('Un devis envoyé ne peut plus être modifié : retirez-le et créez-en un nouveau');
    this.s = { ...this.s, ...content };
  }

  send(byProviderId: string, now = new Date()): void {
    this.ownedBy(byProviderId);
    if (this.s.status !== 'draft') throw new InvalidStateError('Devis déjà envoyé');
    if (this.s.validUntil < parisToday(now)) throw new InvalidStateError('La date de validité est dépassée');
    this.s.status = 'sent';
    this.s.sentAt = now;
  }

  withdraw(byProviderId: string): void {
    this.ownedBy(byProviderId);
    if (this.s.status !== 'sent' && this.s.status !== 'draft') throw new InvalidStateError('Ce devis ne peut plus être retiré');
    this.s.status = 'withdrawn';
  }

  reject(): void {
    if (this.s.status !== 'sent') throw new InvalidStateError('Ce devis ne peut plus être refusé');
    this.s.status = 'rejected';
  }

  /** Vérifie qu'une acceptation est possible maintenant (utilisé avant le code ET dans la transaction finale). */
  assertAcceptable(now = new Date()): void {
    if (FINAL.includes(this.s.status) || this.s.status === 'draft') throw new InvalidStateError('Ce devis ne peut plus être accepté');
    if (this.s.validUntil < parisToday(now)) throw new InvalidStateError('Ce devis a expiré');
  }

  accept(now = new Date()): void {
    this.assertAcceptable(now);
    this.s.status = 'accepted';
  }

  private ownedBy(providerId: string) {
    if (providerId !== this.s.providerId) throw new ForbiddenError();
  }
}
