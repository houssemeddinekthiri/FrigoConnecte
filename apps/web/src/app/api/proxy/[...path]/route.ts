import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';

// Auth.js choisit le nom du cookie (et son préfixe __Secure-) selon le PROTOCOLE de AUTH_URL, pas selon NODE_ENV :
// en production derrière HTTPS le cookie est « __Secure-authjs.session-token », en HTTP local (Docker) il ne l'est pas.
const secure = (process.env.AUTH_URL ?? '').startsWith('https://');

/**
 * BFF : le navigateur parle à /api/proxy/*, ce handler lit le jeton dans le cookie chiffré
 * et appelle l'API NestJS avec `Authorization: Bearer`. Le jeton n'atteint jamais le JavaScript du navigateur.
 * Jeton expiré => on n'envoie rien => l'API répond 401 => le client rafraîchit la session (voir providers.tsx).
 */
async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET!,
    secureCookie: secure,
    salt: secure ? '__Secure-authjs.session-token' : 'authjs.session-token',
  });

  const headers = new Headers();
  headers.set('content-type', req.headers.get('content-type') ?? 'application/json');
  const ip = req.headers.get('x-forwarded-for');
  if (ip) headers.set('x-forwarded-for', ip); // rate limiting par vraie IP côté API
  if (token?.accessToken && (token.expiresAt ?? 0) > Date.now() / 1000) headers.set('authorization', `Bearer ${token.accessToken}`);

  const res = await fetch(`${process.env.API_URL}/api/v1/${path.join('/')}${req.nextUrl.search}`, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
  });
  return new NextResponse(res.status === 204 ? null : res.body, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json', ...(res.headers.has('cache-control') && { 'cache-control': res.headers.get('cache-control')! }) },
  });
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
