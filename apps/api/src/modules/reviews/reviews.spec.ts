import { needsModeration } from './reviews.module';

describe('needsModeration', () => {
  it('publie directement un avis ordinaire ou une note seule', () => {
    expect(needsModeration(undefined)).toBe(false);
    expect(needsModeration('Intervention rapide, technicien très professionnel.')).toBe(false);
    expect(needsModeration('Devis de 1500 euros respecté')).toBe(false);
  });

  it.each([
    'Appelez-le au 06 12 34 56 78, il est super',
    'contact : jean@exemple.fr',
    'Voir mon site https://exemple.fr pour moins cher',
    'moins cher sur www.exemple.fr',
  ])('envoie en modération : %s', (c) => {
    expect(needsModeration(c)).toBe(true);
  });
});
