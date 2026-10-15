import { randomBytes } from 'node:crypto';
import { Client } from 'pg';

/**
 * Jeu de données de DÉMONSTRATION pour tester en local : un client et un prestataire à Lyon déjà validé (attestation de capacité,
 * horaires, rayon de 40 km), emails vérifiés (aucun serveur d'emails en local). Idempotent.
 *   docker compose exec -e ALLOW_DEMO_SEED=1 api node apps/api/dist/scripts/seed-demo.js
 * Refuse de tourner sans ALLOW_DEMO_SEED=1 : ces comptes ne doivent JAMAIS exister en production.
 */
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} manquant`);
  return v;
};

interface Demo { email: string; firstName: string; lastName: string; role: 'client' | 'provider' }
export const DEMO_USERS: Demo[] = [
  { email: 'client@demo.test', firstName: 'Karim', lastName: 'Benali', role: 'client' },
  { email: 'prestataire@demo.test', firstName: 'Paul', lastName: 'Martin', role: 'provider' },
];

async function main() {
  if (process.env.ALLOW_DEMO_SEED !== '1') throw new Error('Refus : définir ALLOW_DEMO_SEED=1 (jamais en production)');
  const kcBase = env('KEYCLOAK_URL');
  const realm = env('KEYCLOAK_REALM');
  const kc = `${kcBase}/admin/realms/${realm}`;

  const tokenRes = await fetch(`${kcBase}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env('KEYCLOAK_BACKEND_CLIENT_ID'), client_secret: env('KEYCLOAK_BACKEND_SECRET') }),
  });
  if (!tokenRes.ok) throw new Error(`Keycloak (jeton) : ${tokenRes.status}`);
  const h = { Authorization: `Bearer ${((await tokenRes.json()) as { access_token: string }).access_token}`, 'Content-Type': 'application/json' };

  const db = new Client({ connectionString: env('DATABASE_URL') });
  await db.connect();
  try {
    const ids: Record<string, string> = {};
    for (const u of DEMO_USERS) {
      const password = randomBytes(9).toString('base64url');
      const res = await fetch(`${kc}/users`, {
        method: 'POST', headers: h,
        body: JSON.stringify({
          username: u.email, email: u.email, firstName: u.firstName, lastName: u.lastName, enabled: true, emailVerified: true,
          credentials: [{ type: 'password', value: password, temporary: false }], requiredActions: [],
        }),
      });
      if (res.status === 409) {
        console.log(`= ${u.email} existe déjà (mot de passe inchangé)`);
        const [found] = (await (await fetch(`${kc}/users?email=${encodeURIComponent(u.email)}&exact=true`, { headers: h })).json()) as { id: string }[];
        ids[u.role] = found.id;
        continue;
      }
      if (res.status !== 201) throw new Error(`Keycloak (création ${u.email}) : ${res.status}`);
      const id = res.headers.get('location')!.split('/').pop()!;
      const role = await fetch(`${kc}/roles/${u.role}`, { headers: h });
      const map = await fetch(`${kc}/users/${id}/role-mappings/realm`, { method: 'POST', headers: h, body: JSON.stringify([await role.json()]) });
      if (!role.ok || !map.ok) throw new Error(`Keycloak (rôle ${u.role}) : ${role.status}/${map.status}`);
      await db.query(
        `INSERT INTO users (id, keycloak_id, email, first_name, last_name, role_code, status) VALUES ($1,$1,$2,$3,$4,$5,'active') ON CONFLICT DO NOTHING`,
        [id, u.email, u.firstName, u.lastName, u.role],
      );
      if (u.role === 'client') await db.query(`INSERT INTO clients (user_id, client_type) VALUES ($1,'individual') ON CONFLICT DO NOTHING`, [id]);
      ids[u.role] = id;
      console.log(`+ ${u.role.padEnd(9)} ${u.email}  mot de passe : ${password}`);
    }

    // Prestataire validé : Lyon, rayon 40 km, froid et climatisation, urgences acceptées
    const p = ids.provider;
    await db.query(
      `INSERT INTO providers (user_id, company_name, siret, slug, headline, bio, trades, services, years_experience, emergency_available,
                              address, postal_code, city, base_location, service_radius_km, status, validated_at, stripe_transfers_enabled, avg_response_minutes)
       VALUES ($1,'Froid Express Lyon','12345678901234','froid-express-lyon','Dépannage froid commercial 7j/7',
               'Frigoriste certifié, intervention rapide sur chambres froides, vitrines réfrigérées et climatisation.',
               $2::trade_type[], $3::service_type[], 12, true, '12 rue de la République', '69002', 'Lyon',
               ST_SetSRID(ST_MakePoint(4.8357, 45.7640), 4326)::geography, 40, 'approved', now(), true, 20)
       ON CONFLICT (user_id) DO NOTHING`,
      [p, ['refrigeration', 'air_conditioning'], ['breakdown', 'maintenance', 'installation']],
    );
    const { rows: has } = await db.query('SELECT 1 FROM provider_certifications WHERE provider_id = $1', [p]);
    if (!has.length) {
      const f = (await db.query(
        `INSERT INTO files (uploaded_by, bucket, object_key, original_name, mime_type, size_bytes, status)
         VALUES ($1,'demo','demo/attestation.pdf','attestation-de-capacite.pdf','application/pdf',1000,'uploaded') RETURNING id`, [p])).rows[0].id;
      await db.query(
        `INSERT INTO provider_certifications (provider_id, type, number, issuer, issued_on, expires_on, file_id, review_status, reviewed_at)
         VALUES ($1,'fluid_handling_cat1','DEMO-0001','Organisme certificateur (démo)','2024-01-15','2029-01-15',$2,'approved',now())`, [p, f]);
      for (let d = 1; d <= 5; d++) await db.query('INSERT INTO provider_availability_rules (provider_id, weekday, start_time, end_time) VALUES ($1,$2,$3,$4)', [p, d, '08:00', '18:00']);
    }
    console.log('✓ données de démonstration prêtes (prestataire « Froid Express Lyon », Lyon, rayon 40 km)');
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
