import { InvalidStateError } from '../../../shared/kernel/errors';

export const AUTO_VALIDATE_DAYS = 7;

export interface ContractState {
  status: string;
  totalCents: number;
  depositCents: number;
  workDoneAt: Date | null;
  depositPaid: boolean;
  balancePaid: boolean;
}

export type Party = 'client' | 'provider';
export const PAID_STATUSES = ['held', 'authorized', 'released', 'partially_refunded'];

const balanceOf = (c: ContractState) => c.totalCents - c.depositCents;
const depositSettled = (c: ContractState) => c.depositCents === 0 || c.depositPaid;
const balanceSettled = (c: ContractState) => balanceOf(c) === 0 || c.balancePaid;

/** Le prestataire ne peut déclarer la fin qu'une fois l'acompte reçu (il ne travaille pas « à crédit »). */
export function assertCanDeclareDone(c: ContractState) {
  if (c.status !== 'active') throw new InvalidStateError('Ce contrat n\'est plus actif');
  if (c.workDoneAt) throw new InvalidStateError('Intervention déjà déclarée terminée');
  if (!depositSettled(c)) throw new InvalidStateError('L\'acompte n\'a pas encore été réglé par le client');
}

/** Le client valide quand l'intervention est déclarée terminée ET le solde réglé : la validation déclenche le versement. */
export function assertCanValidate(c: ContractState) {
  if (c.status !== 'active') throw new InvalidStateError('Ce contrat n\'est plus actif');
  if (!c.workDoneAt) throw new InvalidStateError('Le prestataire n\'a pas encore déclaré l\'intervention terminée');
  if (!balanceSettled(c)) throw new InvalidStateError('Réglez d\'abord le solde');
}

/**
 * J+7 sans réponse du client : si tout est payé, le contrat est validé d'office ;
 * sinon il passe en litige (le prestataire a travaillé, le solde n'est pas réglé) pour traitement par l'administration.
 */
export const autoValidationOutcome = (c: ContractState): 'validate' | 'dispute' => (balanceSettled(c) ? 'validate' : 'dispute');

/** Ce que l'utilisateur peut faire maintenant : calculé ici, l'interface n'a aucune règle à recopier. */
export function actionsFor(c: ContractState, party: Party) {
  const active = c.status === 'active';
  return {
    payDeposit: party === 'client' && active && c.depositCents > 0 && !c.depositPaid,
    payBalance: party === 'client' && active && !!c.workDoneAt && balanceOf(c) > 0 && !c.balancePaid && depositSettled(c),
    declareDone: party === 'provider' && active && !c.workDoneAt && depositSettled(c),
    validate: party === 'client' && active && !!c.workDoneAt && balanceSettled(c),
    // litige : dès qu'il y a de l'argent ou du travail en jeu (sinon, on annule simplement)
    dispute: active && (c.depositPaid || !!c.workDoneAt),
  };
}

export const balanceCents = balanceOf;
