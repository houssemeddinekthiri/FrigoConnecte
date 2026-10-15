import 'next-auth';
import 'next-auth/jwt';

export type Role = 'super_admin' | 'provider' | 'client';

declare module 'next-auth' {
  // Session = ce que le navigateur voit : JAMAIS de jeton ici.
  interface Session {
    error?: 'RefreshTokenError';
    user: { id: string; roles: Role[]; name?: string | null; email?: string | null };
  }
}

declare module 'next-auth/jwt' {
  // JWT = cookie chiffré httpOnly, lisible uniquement côté serveur.
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number; // secondes epoch
    roles?: Role[];
    error?: 'RefreshTokenError';
  }
}
