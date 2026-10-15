import { NextResponse } from 'next/server';
import { signOut } from '@/auth';

/** POST uniquement. Efface la session Next puis ferme aussi la session SSO Keycloak (sinon la reconnexion serait silencieuse). */
export async function POST() {
  await signOut({ redirect: false });
  const url = new URL(`${process.env.KEYCLOAK_ISSUER}/protocol/openid-connect/logout`);
  url.searchParams.set('client_id', process.env.KEYCLOAK_CLIENT_ID!);
  url.searchParams.set('post_logout_redirect_uri', process.env.AUTH_URL ?? 'http://localhost:3000');
  return NextResponse.redirect(url, 303);
}
