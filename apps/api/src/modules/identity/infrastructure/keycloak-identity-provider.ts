import { Injectable } from '@nestjs/common';
import { EmailTakenError, IdentityProvider, NewIdentity } from '../domain/ports';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} manquant`);
  return v;
};

/** Client minimal de l'API Admin Keycloak (compte de service `frigoconnect-backend`, droits users uniquement). */
@Injectable()
export class KeycloakIdentityProvider implements IdentityProvider {
  private get admin() {
    return `${env('KEYCLOAK_URL')}/admin/realms/${env('KEYCLOAK_REALM')}`;
  }

  // ponytail: jeton redemandé à chaque appel (inscriptions rares). Cacher jusqu'à expiration si le volume monte.
  private async headers() {
    const res = await fetch(`${env('KEYCLOAK_URL')}/realms/${env('KEYCLOAK_REALM')}/protocol/openid-connect/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env('KEYCLOAK_BACKEND_CLIENT_ID'),
        client_secret: env('KEYCLOAK_BACKEND_SECRET'),
      }),
    });
    if (!res.ok) throw new Error(`Keycloak token: ${res.status}`);
    const { access_token } = (await res.json()) as { access_token: string };
    return { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };
  }

  async createUser(u: NewIdentity): Promise<string> {
    const h = await this.headers();
    const res = await fetch(`${this.admin}/users`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        username: u.email,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        enabled: true,
        emailVerified: false,
        requiredActions: ['VERIFY_EMAIL'],
        credentials: [{ type: 'password', value: u.password, temporary: false }],
      }),
    });
    if (res.status === 409) throw new EmailTakenError();
    if (res.status !== 201) throw new Error(`Keycloak createUser: ${res.status}`);
    const id = res.headers.get('location')!.split('/').pop()!;

    try {
      const role = await fetch(`${this.admin}/roles/${u.role}`, { headers: h });
      if (!role.ok) throw new Error(`Keycloak role ${u.role}: ${role.status}`);
      const map = await fetch(`${this.admin}/users/${id}/role-mappings/realm`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify([await role.json()]),
      });
      if (!map.ok) throw new Error(`Keycloak role-mapping: ${map.status}`);
    } catch (e) {
      await this.deleteUser(id).catch(() => undefined);
      throw e;
    }
    return id;
  }

  async deleteUser(id: string): Promise<void> {
    await fetch(`${this.admin}/users/${id}`, { method: 'DELETE', headers: await this.headers() });
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const res = await fetch(`${this.admin}/users/${id}`, { method: 'PUT', headers: await this.headers(), body: JSON.stringify({ enabled }) });
    if (!res.ok) throw new Error(`Keycloak setEnabled: ${res.status}`);
  }

  async logout(id: string): Promise<void> {
    const res = await fetch(`${this.admin}/users/${id}/logout`, { method: 'POST', headers: await this.headers() });
    if (!res.ok) throw new Error(`Keycloak logout: ${res.status}`);
  }

  async sendVerifyEmail(id: string): Promise<void> {
    const res = await fetch(`${this.admin}/users/${id}/execute-actions-email`, {
      method: 'PUT',
      headers: await this.headers(),
      body: JSON.stringify(['VERIFY_EMAIL']),
    });
    if (!res.ok) throw new Error(`Keycloak verify email: ${res.status}`);
  }
}
