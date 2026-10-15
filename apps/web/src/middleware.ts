import { auth } from '@/auth';

const AREAS = [
  { prefix: '/admin', role: 'super_admin' },
  { prefix: '/prestataire', role: 'provider' },
  { prefix: '/client', role: 'client' },
] as const;

// Dans Docker le serveur écoute sur 0.0.0.0 : `req.url` donnerait « http://0.0.0.0:3000/… », injoignable depuis le navigateur.
// On redirige donc vers l'adresse publique du site (AUTH_URL).
const base = (fallback: string) => process.env.AUTH_URL || fallback;

// Garde de confort (UX). La vraie sécurité reste dans l'API : rôle + propriété.
export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const area = AREAS.find((a) => pathname.startsWith(a.prefix));
  if (!area) return;
  if (!req.auth || req.auth.error) {
    return Response.redirect(new URL(`/connexion?callbackUrl=${encodeURIComponent(pathname + search)}`, base(req.url)));
  }
  if (!req.auth.user.roles.includes(area.role)) return Response.redirect(new URL('/', base(req.url)));
});

export const config = { matcher: ['/client/:path*', '/prestataire/:path*', '/admin/:path*'] };
