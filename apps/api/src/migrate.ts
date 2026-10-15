import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

export interface Migration { version: string; sql: string; checksum: string }
type Queryable = Pick<Client, 'query'>;

const LOCK_ID = 727_274; // verrou consultatif : plusieurs instances qui démarrent ensemble n'appliquent pas les migrations deux fois

/** Fichiers `NNN_nom.sql`, dans l'ordre. L'empreinte détecte toute modification d'une migration déjà appliquée. */
export function loadMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort()
    .map((f) => {
      const sql = readFileSync(path.join(dir, f), 'utf8');
      // fins de ligne normalisées : la même migration (poste Windows en CRLF, Linux en LF) garde la même empreinte
      const normalized = sql.replace(/\r\n/g, '\n');
      return { version: f.replace(/\.sql$/, ''), sql, checksum: createHash('sha256').update(normalized).digest('hex') };
    });
}

/**
 * Applique les migrations manquantes, chacune dans SA transaction (tout ou rien).
 * Une migration déjà appliquée ne doit JAMAIS être éditée : on en ajoute une nouvelle. Sinon, démarrage refusé.
 */
export async function migrate(db: Queryable, migrations: Migration[], log: (m: string) => void = console.log): Promise<string[]> {
  await db.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
  const applied: string[] = [];
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await db.query('SELECT version, checksum FROM schema_migrations');
    const done = new Map<string, string>(rows.map((r: { version: string; checksum: string }) => [r.version, r.checksum]));

    for (const m of migrations) {
      const prev = done.get(m.version);
      if (prev !== undefined) {
        if (prev !== m.checksum) throw new Error(`La migration ${m.version} a été modifiée après son application : créez une nouvelle migration au lieu de l'éditer.`);
        continue;
      }
      await db.query('BEGIN');
      try {
        await db.query(m.sql);
        await db.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [m.version, m.checksum]);
        await db.query('COMMIT');
      } catch (e) {
        await db.query('ROLLBACK');
        throw new Error(`Migration ${m.version} échouée : ${(e as Error).message}`);
      }
      applied.push(m.version);
      log(`migration appliquée : ${m.version}`);
    }
    if (!applied.length) log('base à jour');
    return applied;
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquant');
  const dir = process.env.MIGRATIONS_DIR ?? path.resolve(__dirname, '../../../db');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(client, loadMigrations(dir));
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1); // le conteneur ne démarre pas l'API sur un schéma incohérent
  });
}
