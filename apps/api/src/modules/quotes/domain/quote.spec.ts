import { ForbiddenError, InvalidStateError } from '../../../shared/kernel/errors';
import { parisToday, Quote } from './quote';

const content = {
  items: [{ label: 'Remplacement compresseur', quantity: 1, unit: 'u', unitPriceCents: 85000, vatRateBps: 2000 as const }],
  depositPercent: 30,
  validUntil: '2026-02-15',
};
const NOW = new Date('2026-02-01T10:00:00Z');

describe('Quote', () => {
  it('brouillon -> envoyé : fige le contenu', () => {
    const q = Quote.draft('prov', 'req', content);
    q.send('prov', NOW);
    expect(q.status).toBe('sent');
    expect(() => q.replaceContent('prov', content)).toThrow(InvalidStateError);
  });

  it('seul le prestataire propriétaire modifie, envoie, retire', () => {
    const q = Quote.draft('prov', 'req', content);
    expect(() => q.send('autre', NOW)).toThrow(ForbiddenError);
    q.send('prov', NOW);
    expect(() => q.withdraw('autre')).toThrow(ForbiddenError);
  });

  it('refuse d\'envoyer un devis déjà périmé', () => {
    const q = Quote.draft('prov', 'req', { ...content, validUntil: '2026-01-31' });
    expect(() => q.send('prov', NOW)).toThrow(/validité/);
  });

  it('acceptation : seulement envoyé et non expiré (jour inclus, heure de Paris)', () => {
    const q = Quote.draft('prov', 'req', content);
    expect(() => q.accept(NOW)).toThrow(InvalidStateError); // brouillon
    q.send('prov', NOW);
    expect(() => q.accept(new Date('2026-02-16T12:00:00Z'))).toThrow(/expiré/);
    q.accept(new Date('2026-02-15T22:30:00Z')); // 23:30 à Paris le 15 : encore valide
    expect(q.status).toBe('accepted');
    expect(() => q.reject()).toThrow(InvalidStateError); // état final
  });

  it('parisToday bascule à minuit heure de Paris, pas UTC', () => {
    expect(parisToday(new Date('2026-02-15T23:30:00Z'))).toBe('2026-02-16');
    expect(parisToday(new Date('2026-02-15T22:30:00Z'))).toBe('2026-02-15');
  });

  it('totaux et acompte dérivés du contenu', () => {
    expect(Quote.draft('p', 'r', content).totals()).toMatchObject({ subtotalCents: 85000, vatCents: 17000, totalCents: 102000, depositCents: 30600 });
  });
});
