import NextAuth from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import Keycloak from 'next-auth/providers/keycloak';
import type { Role } from '@/types/next-auth';

const ROLES: Role[] = ['super_admin', 'provider', 'client'];
const issuer = process.env.KEYCLOAK_ISSUER!; // adresse PUBLIQUE (celle du navigateur et du champ « iss »)
// Dans Docker, le serveur Next joint Keycloak par son nom interne : on évite la découverte automatique (qui passerait par l'adresse publique)
const internal = process.env.KEYCLOAK_INTERNAL_ISSUER ?? issuer;
const clientId = process.env.KEYCLOAK_CLIENT_ID!;

// atob (et non Buffer) : ce fichier tourne aussi dans le middleware (Edge)
function rolesFrom(accessToken: string): Role[] {
  const b64 = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const claims = JSON.parse(atob(b64)) as { realm_access?: { roles?: string[] } };
  return (claims.realm_access?.roles ?? []).filter((r): r is Role => (ROLES as string[]).includes(r));
}

async function refresh(token: JWT): Promise<JWT> {
  try {
    const res = await fetch(`${internal}/protocol/openid-connect/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: token.refreshToken! }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const t = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
    // rotation : le refresh token précédent est invalidé, on garde le nouveau
    return {
      ...token,
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: Math.floor(Date.now() / 1000) + t.expires_in,
      roles: rolesFrom(t.access_token),
      error: undefined,
    };
  } catch {
    return { ...token, error: 'RefreshTokenError' };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    // Client public + PKCE : pas de secret
    Keycloak({
      clientId, clientSecret: 'unused', issuer, client: { token_endpoint_auth_method: 'none' }, checks: ['pkce', 'state'],
      ...(internal !== issuer && {
        authorization: { url: `${issuer}/protocol/openid-connect/auth`, params: { scope: 'openid email profile' } }, // le navigateur : adresse publique
        token: `${internal}/protocol/openid-connect/token`, // le serveur : adresse interne
        userinfo: `${internal}/protocol/openid-connect/userinfo`,
        jwks_endpoint: `${internal}/protocol/openid-connect/certs`,
      }),
    }),
  ],
  session: { strategy: 'jwt', maxAge: 7 * 24 * 3600 },
  callbacks: {
    async jwt({ token, account }) {
      if (account?.access_token) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
          roles: rolesFrom(account.access_token),
        };
      }
      if (token.expiresAt && Date.now() / 1000 < token.expiresAt - 30) return token;
      return token.refreshToken ? refresh(token) : token;
    },
    session({ session, token }) {
      session.user.id = token.sub!;
      session.user.roles = token.roles ?? [];
      session.error = token.error;
      return session;
    },
  },
  pages: { signIn: '/connexion' },
});
