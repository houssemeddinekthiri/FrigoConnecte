import { clientTrust, TrustFacts } from './client-trust';

const base: TrustFacts = { completedMissions: 0, disputes: 0, failedPayments: 0, memberMonths: 0, hasPhone: false, hasCompany: false };

describe('profil de confiance client', () => {
  it('nouveau client : niveau « new » et conseils pour progresser', () => {
    const t = clientTrust(base);
    expect(t.level).toBe('new');
    expect(t.tips.length).toBeGreaterThanOrEqual(3);
  });

  it('régulier après une mission, de confiance après trois et un dossier complet', () => {
    expect(clientTrust({ ...base, completedMissions: 1, hasPhone: true, memberMonths: 2 }).level).toBe('regular');
    const trusted = clientTrust({ ...base, completedMissions: 3, hasPhone: true, hasCompany: true, memberMonths: 10 });
    expect(trusted).toMatchObject({ level: 'trusted', score: 100 });
    expect(trusted.tips).toEqual([]);
  });

  it('les litiges font redescendre, même avec un bon historique', () => {
    const good = { ...base, completedMissions: 5, hasPhone: true, hasCompany: true, memberMonths: 12 };
    expect(clientTrust(good).level).toBe('trusted');
    expect(clientTrust({ ...good, disputes: 1 }).level).toBe('regular');
    expect(clientTrust({ ...good, disputes: 2 }).level).toBe('new');
  });
});
