import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Migration, loadMigrations, migrate } from './migrate';

const mig = (version: string, sql: string): Migration => ({ version, sql, checksum: createHash('sha256').update(sql).digest('hex') });

/** Base simulée : mémorise ce qui a été « appliqué » et peut faire échouer un SQL donné. */
function fakeDb(applied: Record<string, string> = {}, failOn?: string) {
  const log: string[] = [];
  const db = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      log.push(sql.trim().split('\n')[0].slice(0, 40));
      if (sql.startsWith('SELECT version, checksum')) return { rows: Object.entries(applied).map(([version, checksum]) => ({ version, checksum })) };
      if (failOn && sql.includes(failOn)) throw new Error('syntax error');
      if (sql.startsWith('INSERT INTO schema_migrations')) applied[params![0] as string] = params![1] as string;
      return { rows: [] };
    }),
  };
  return { db: db as never, log, applied };
}

describe('loadMigrations', () => {
  it('même empreinte pour CRLF et LF (poste Windows vs Linux), mais pas si le contenu change', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    const checksum = (content: string) => {
      writeFileSync(path.join(dir, '001_a.sql'), content);
      return loadMigrations(dir)[0].checksum;
    };
    const lf = checksum('CREATE TABLE a();\n-- x\n');
    expect(checksum('CREATE TABLE a();\r\n-- x\r\n')).toBe(lf);
    expect(checksum('CREATE TABLE a2();\n-- x\n')).not.toBe(lf);
  });
});

describe('migrate', () => {
  it('applique dans l\'ordre, chaque migration dans sa transaction', async () => {
    const { db, log } = fakeDb();
    const out = await migrate(db, [mig('001_a', 'CREATE TABLE a()'), mig('002_b', 'CREATE TABLE b()')], () => undefined);
    expect(out).toEqual(['001_a', '002_b']);
    expect(log.filter((l) => l === 'BEGIN')).toHaveLength(2);
    expect(log.filter((l) => l === 'COMMIT')).toHaveLength(2);
  });

  it('relance : ne réapplique rien (idempotent)', async () => {
    const m = [mig('001_a', 'CREATE TABLE a()')];
    const { db, applied } = fakeDb();
    await migrate(db, m, () => undefined);
    const second = await migrate(fakeDb({ ...applied }).db, m, () => undefined);
    expect(second).toEqual([]);
  });

  it('une migration déjà appliquée puis modifiée bloque le démarrage', async () => {
    const { db } = fakeDb({ '001_a': 'ancienne-empreinte' });
    await expect(migrate(db, [mig('001_a', 'CREATE TABLE a(modifie int)')], () => undefined)).rejects.toThrow(/modifiée après son application/);
  });

  it('échec : ROLLBACK, rien n\'est enregistré, la suite n\'est pas tentée, le verrou est relâché', async () => {
    const { db, log, applied } = fakeDb({}, 'BROKEN');
    await expect(migrate(db, [mig('001_a', 'CREATE TABLE a()'), mig('002_b', 'BROKEN SQL'), mig('003_c', 'CREATE TABLE c()')], () => undefined)).rejects.toThrow(/002_b échouée/);
    expect(Object.keys(applied)).toEqual(['001_a']);
    expect(log).toContain('ROLLBACK');
    expect(log[log.length - 1]).toContain('pg_advisory_unlock');
  });
});
