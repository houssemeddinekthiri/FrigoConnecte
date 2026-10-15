import type { Role } from '../../../shared/auth/auth';
import { DomainError } from '../../../shared/kernel/errors';

export class EmailTakenError extends DomainError {
  constructor() {
    super('Email déjà utilisé', 'EMAIL_TAKEN');
  }
}

export interface NewIdentity {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: Exclude<Role, 'super_admin'>;
}

/** Fournisseur d'identité (Keycloak). Mot de passe : transmis une fois, jamais stocké chez nous. */
export interface IdentityProvider {
  /** Crée l'utilisateur avec son rôle. Lève EmailTakenError si l'email existe. Retourne son id (= sub). */
  createUser(u: NewIdentity): Promise<string>;
  deleteUser(id: string): Promise<void>;
  sendVerifyEmail(id: string): Promise<void>;
  /** Suspension : désactive la connexion. */
  setEnabled(id: string, enabled: boolean): Promise<void>;
  /** Ferme toutes les sessions ouvertes de l'utilisateur. */
  logout(id: string): Promise<void>;
}
export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

export interface NewUserRecord {
  id: string;
  email: string;
  phone?: string;
  firstName: string;
  lastName: string;
  role: Exclude<Role, 'super_admin'>;
  clientType: string;
  companyName?: string;
}
export interface UserRepository {
  /** users + profil client dans une seule transaction. Le profil prestataire est créé à l'onboarding. */
  createWithProfile(u: NewUserRecord): Promise<void>;
}
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
