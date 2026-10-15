import { updateClientProfileSchema } from '@frigoconnect/contracts';

const base = { firstName: 'Karim', lastName: 'Benali', phone: '06 12 34 56 78', clientType: 'restaurant', companyName: 'Chez Karim', siret: '123 456 789 01234', vatNumber: '', billingAddress: '', billingPostalCode: '', billingCity: '', logoFileId: null };

describe('profil client', () => {
  it('normalise téléphone, SIRET et champs vides', () => {
    const r = updateClientProfileSchema.parse(base);
    expect(r).toMatchObject({ phone: '+33612345678', siret: '12345678901234', vatNumber: null, billingPostalCode: null });
  });

  it('exige une raison sociale pour un professionnel, un SIRET à 14 chiffres', () => {
    expect(updateClientProfileSchema.safeParse({ ...base, companyName: '' }).success).toBe(false);
    expect(updateClientProfileSchema.safeParse({ ...base, clientType: 'individual', companyName: '', siret: '' }).success).toBe(true);
    expect(updateClientProfileSchema.safeParse({ ...base, siret: '123' }).success).toBe(false);
  });
});
