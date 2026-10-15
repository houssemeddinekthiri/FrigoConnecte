import type { Role } from './auth';

/**
 * Permissions fines, limitées aux actions sensibles (argent, modération, administration).
 * Les actions courantes (créer sa demande, écrire un message) sont gardées par le rôle + la propriété.
 * Source de vérité = ce fichier (versionné, relu en PR) ; pas de table en base.
 */
export const ROLE_PERMISSIONS = {
  client: ['payment:pay', 'review:create'],
  provider: ['quote:send', 'payout:read', 'review:create'],
  super_admin: [
    'provider:validate',
    'provider:suspend',
    'user:manage',
    'commission:manage',
    'review:moderate',
    'payment:refund',
    'dispute:resolve',
    'stats:read',
    'audit:read',
  ],
} as const satisfies Record<Role, readonly string[]>;

export type Permission = (typeof ROLE_PERMISSIONS)[Role][number];

export const permissionsOf = (roles: readonly Role[]): Set<string> =>
  new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] as readonly string[]));
