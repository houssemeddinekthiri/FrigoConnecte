import type { PoolClient } from 'pg';

export interface AuditEntry {
  actorId: string;
  action: string; // 'provider.approved', 'user.suspended', 'commission.changed', ...
  entityType: string;
  entityId: string | null;
  diff?: Record<string, unknown>;
  ip?: string;
}

/**
 * À appeler dans la MÊME transaction que l'action : si l'action est annulée, sa trace aussi ; si elle est validée, sa trace l'est.
 * La table est en ajout seul (déclencheurs SQL, migration 006) : aucune ligne ne peut être modifiée ou supprimée ensuite.
 */
export async function writeAudit(c: PoolClient, a: AuditEntry) {
  await c.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, diff, ip) VALUES ($1,$2,$3,$4,$5,$6::inet)', [
    a.actorId, a.action, a.entityType, a.entityId, a.diff ? JSON.stringify(a.diff) : null, a.ip ?? null,
  ]);
}
