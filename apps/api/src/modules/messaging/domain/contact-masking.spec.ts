import { MASK, maskContacts } from './contact-masking';

describe('maskContacts', () => {
  it.each([
    'Appelez-moi au 06 12 34 56 78',
    'Mon numéro : 0612345678',
    'Joignable +33 6 12 34 56 78 le soir',
    'Tel 06.12.34.56.78',
    'ecrivez a jean.dupont@exemple.fr',
    'jean (at) exemple (dot) fr',
    'IBAN FR76 3000 6000 0112 3456 7890 189',
  ])('masque : %s', (input) => {
    const r = maskContacts(input);
    expect(r.masked).toBe(true);
    expect(r.text).toContain(MASK);
    expect(r.text).not.toMatch(/\d{2}[ .]\d{2}[ .]\d{2}|@|3456/);
  });

  it.each([
    'Budget 1500 euros pour une chambre froide de 20 m3',
    'Rendez-vous le 05/01/2026 à 10h30',
    'Devis DV-2026-000123 : 12 500 € HT',
    'Compresseur R404A, 3 kW',
  ])('laisse intact : %s', (input) => {
    expect(maskContacts(input)).toEqual({ text: input, masked: false });
  });
});
