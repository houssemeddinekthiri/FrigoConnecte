import { randomBytes } from 'node:crypto';
import { Client } from 'pg';

/**
 * Crée le premier super_admin : utilisateur Keycloak (rôle super_admin) + ligne `users` avec le MÊME identifiant.
 *   docker compose exec api node apps/api/dist/scripts/seed-admin.js admin@exemple.fr Prénom Nom
 * Le mot de passe provisoire s'affiche UNE fois. À la première connexion : changement de mot de passe, puis configuration
 * obligatoire de l'application d'authentification (OTP) : exigence du realm pour ce rôle.
 */
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} manquant`);
  return v;
};

export function parseArgs(argv: string[]) {
  const [email, firstName, ...rest] = argv;
  const lastName = rest.join(' ');
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !firstName || !lastName) {
    throw new Error('Usage : seed-admin <email> <prénom> <nom>');
  }
  return { email: email.toLowerCase(), firstName, lastName };
}

async function main() {
  const { email, firstName, lastName } = parseArgs(process.argv.slice(2));
  const kc = `${env('KEYCLOAK_URL')}/admin/realms/${env('KEYCLOAK_REALM')}`;

  const tokenRes = await fetch(`${env('KEYCLOAK_URL')}/realms/${env('KEYCLOAK_REALM')}/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env('KEYCLOAK_BACKEND_CLIENT_ID'), client_secret: env('KEYCLOAK_BACKEND_SECRET') }),
  });
  if (!tokenRes.ok) throw new Error(`Keycloak (jeton) : ${tokenRes.status}`);
  const h = { Authorization: `Bearer ${((await tokenRes.json()) as { access_token: string }).access_token}`, 'Content-Type': 'application/json' };

  const password = randomBytes(12).toString('base64url');
  const create = await fetch(`${kc}/users`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      username: email, email, firstName, lastName, enabled: true, emailVerified: true,
      credentials: [{ type: 'password', value: password, temporary: true }],
      requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
    }),
  });
  if (create.status === 409) throw new Error(`${email} existe déjà dans Keycloak`);
  if (create.status !== 201) throw new Error(`Keycloak (création) : ${create.status}`);
  const id = create.headers.get('location')!.split('/').pop()!;

  const db = new Client({ connectionString: env('DATABASE_URL') });
  await db.connect();
  try {
    const role = await fetch(`${kc}/roles/super_admin`, { headers: h });
    if (!role.ok) throw new Error(`rôle super_admin introuvable (${role.status}) : le realm est-il importé ?`);
    const map = await fetch(`${kc}/users/${id}/role-mappings/realm`, { method: 'POST', headers: h, body: JSON.stringify([await role.json()]) });
    if (!map.ok) throw new Error(`Keycloak (rôle) : ${map.status}`);
    await db.query(
      `INSERT INTO users (id, keycloak_id, email, first_name, last_name, role_code, status) VALUES ($1, $1, $2, $3, $4, 'super_admin', 'active')`,
      [id, email, firstName, lastName],
    );
  } catch (e) {
    await fetch(`${kc}/users/${id}`, { method: 'DELETE', headers: h }).catch(() => undefined); // pas de compte orphelin
    throw e;
  } finally {
    await db.end();
  }
  console.log(`Administrateur créé : ${email}\nMot de passe provisoire (à changer à la première connexion) : ${password}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
