// Lance les tests d'intégration contre UNE base PostgreSQL de test (PostGIS réel en CI).
//   TEST_DATABASE_URL=postgres://user:pw@localhost:5432/frigo_test npm run test:integration -w @frigoconnect/api
// ATTENTION : les scénarios ÉCRIVENT des données. Par sécurité, la base doit s'appeler « *test* ».
const path = require('node:path');
const { Client, types } = require('pg');
types.setTypeParser(20, Number); // même décodage des entiers 64 bits que l'application
const { loadMigrations, migrate } = require('../../dist/migrate.js');

(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) { console.error('TEST_DATABASE_URL manquant'); process.exit(2); }
  const client = new Client({ connectionString: url });
  await client.connect();
  const { current_database: name } = (await client.query('SELECT current_database()')).rows[0];
  if (!/test/i.test(name)) { console.error(`Refus : la base « ${name} » ne ressemble pas à une base de test`); process.exit(2); }

  const results = [];
  const check = async (title, fn) => {
    try { await fn(); results.push(['OK  ', title]); } catch (e) { results.push(['FAIL', `${title} -> ${String(e.message).split('\n').slice(0, 3).join(' | ')}`]); }
  };
  const dir = process.env.MIGRATIONS_DIR ?? path.resolve(__dirname, '../../../../db');
  const migrations = loadMigrations(dir);
  await check(`${migrations.length} migrations appliquées`, async () => { if ((await migrate(client, migrations, () => undefined)).length !== migrations.length) throw new Error('migrations manquantes'); });
  await check('relance idempotente', async () => { if ((await migrate(client, migrations, () => undefined)).length) throw new Error('réappliquées'); });
  await require('./checks.cjs')(client, check);

  for (const [s, t] of results) console.log(s, t);
  const ok = results.filter((r) => r[0] === 'OK  ').length;
  console.log(`\n${ok}/${results.length} vérifications réussies`);
  await client.end();
  process.exit(ok === results.length ? 0 : 1);
})().catch((e) => { console.error('Erreur du banc d\'essai :', e); process.exit(2); });
