import { InvalidStateError } from '../../shared/kernel/errors';
import { approvalBlockers, assertSubmittable, CertView, expiryBucket } from './provider-rules';

const fluid = (over: Partial<CertView> = {}): CertView => ({ type: 'fluid_handling_cat1', reviewStatus: 'approved', expiresOn: null, ...over });

describe('assertSubmittable', () => {
  it('froid sans attestation : refusé ; avec (même en attente) : accepté', () => {
    const p = { status: 'draft' as const, trades: ['refrigeration' as const] };
    expect(() => assertSubmittable(p, [])).toThrow(/attestation de capacité/);
    expect(() => assertSubmittable(p, [{ ...fluid(), reviewStatus: 'rejected' }])).toThrow(/attestation/);
    expect(() => assertSubmittable(p, [fluid({ reviewStatus: 'pending' })])).not.toThrow();
  });

  it('chauffage seul : pas d\'attestation fluides exigée', () => {
    expect(() => assertSubmittable({ status: 'draft', trades: ['heating'] }, [])).not.toThrow();
  });

  it('seulement depuis brouillon ou refus', () => {
    for (const status of ['pending_review', 'approved', 'suspended'] as const) {
      expect(() => assertSubmittable({ status, trades: ['heating'] }, [])).toThrow(InvalidStateError);
    }
    expect(() => assertSubmittable({ status: 'rejected', trades: ['heating'] }, [])).not.toThrow();
  });
});

describe('approvalBlockers', () => {
  const p = { status: 'pending_review' as const, trades: ['refrigeration' as const] };

  it('dossier complet : aucun blocage', () => {
    expect(approvalBlockers(p, [fluid()])).toEqual([]);
  });

  it('documents non examinés, attestation absente ou expirée : bloque', () => {
    expect(approvalBlockers(p, [fluid(), fluid({ type: 'rge', reviewStatus: 'pending' })])).toEqual(['1 document(s) restent à examiner']);
    expect(approvalBlockers(p, [])).toEqual(['Aucune attestation de capacité valide et non expirée']);
    expect(approvalBlockers(p, [fluid({ expiresOn: '2000-01-01' })])).toHaveLength(1);
  });

  it('mauvais statut : bloque', () => {
    expect(approvalBlockers({ ...p, status: 'draft' }, [fluid()])).toContain('Le dossier n\'est pas en attente de validation');
  });
});

describe('expiryBucket', () => {
  it('paliers 30 / 7 / 0 jours', () => {
    expect([45, 31, 30, 15, 8, 7, 3, 1, 0, -5].map(expiryBucket)).toEqual([null, null, 30, 30, 30, 7, 7, 7, 0, 0]);
  });
});
