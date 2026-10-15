import { InvalidStateError } from '../../../shared/kernel/errors';
import { actionsFor, assertCanDeclareDone, assertCanValidate, autoValidationOutcome, ContractState } from './contract-rules';

const base: ContractState = { status: 'active', totalCents: 100_000, depositCents: 30_000, workDoneAt: null, depositPaid: false, balancePaid: false };
const done = new Date();

describe('contract rules', () => {
  it('le prestataire ne déclare la fin qu\'après réception de l\'acompte', () => {
    expect(() => assertCanDeclareDone(base)).toThrow(/acompte/);
    expect(() => assertCanDeclareDone({ ...base, depositPaid: true })).not.toThrow();
    expect(() => assertCanDeclareDone({ ...base, depositCents: 0 })).not.toThrow(); // pas d'acompte prévu
    expect(() => assertCanDeclareDone({ ...base, depositPaid: true, workDoneAt: done })).toThrow(InvalidStateError);
  });

  it('le client ne valide qu\'après déclaration ET paiement du solde', () => {
    const s = { ...base, depositPaid: true };
    expect(() => assertCanValidate(s)).toThrow(/pas encore déclaré/);
    expect(() => assertCanValidate({ ...s, workDoneAt: done })).toThrow(/solde/);
    expect(() => assertCanValidate({ ...s, workDoneAt: done, balancePaid: true })).not.toThrow();
    expect(() => assertCanValidate({ ...s, workDoneAt: done, depositCents: 100_000 })).not.toThrow(); // acompte 100 % : pas de solde
  });

  it('un contrat non actif (litige, terminé) bloque tout', () => {
    for (const status of ['disputed', 'completed', 'cancelled']) {
      expect(() => assertCanDeclareDone({ ...base, status, depositPaid: true })).toThrow(InvalidStateError);
      expect(() => assertCanValidate({ ...base, status, workDoneAt: done, depositPaid: true, balancePaid: true })).toThrow(InvalidStateError);
    }
  });

  it('J+7 : validé d\'office si tout est payé, sinon litige', () => {
    expect(autoValidationOutcome({ ...base, depositPaid: true, balancePaid: true, workDoneAt: done })).toBe('validate');
    expect(autoValidationOutcome({ ...base, depositPaid: true, workDoneAt: done })).toBe('dispute');
  });

  it('actions proposées à chaque partie, de la signature à la validation', () => {
    expect(actionsFor(base, 'client')).toMatchObject({ payDeposit: true, payBalance: false, declareDone: false, validate: false });
    expect(actionsFor(base, 'provider')).toEqual({ payDeposit: false, payBalance: false, declareDone: false, validate: false, dispute: false });

    const funded = { ...base, depositPaid: true };
    expect(actionsFor(funded, 'provider').declareDone).toBe(true);
    expect(actionsFor(funded, 'client').payDeposit).toBe(false);

    const finished = { ...funded, workDoneAt: done };
    expect(actionsFor(finished, 'client')).toEqual({ payDeposit: false, payBalance: true, declareDone: false, validate: false, dispute: true });
    expect(actionsFor({ ...finished, balancePaid: true }, 'client')).toEqual({ payDeposit: false, payBalance: false, declareDone: false, validate: true, dispute: true });
    expect(actionsFor({ ...finished, status: 'disputed' }, 'client')).toEqual({ payDeposit: false, payBalance: false, declareDone: false, validate: false, dispute: false });
  });
});
