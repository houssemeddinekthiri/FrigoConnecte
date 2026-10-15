import { CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Database } from '../infrastructure/database/database.service';
import { ForbiddenError } from '../kernel/errors';
import { permissionsOf } from './permissions';

export type Role = 'super_admin' | 'provider' | 'client';
const ROLES: Role[] = ['super_admin', 'provider', 'client'];

/** users.id == sub Keycloak : l'inscription (module identity) crée les deux avec le même UUID. */
export interface AuthUser {
  id: string;
  roles: Role[];
}

export const Public = () => SetMetadata('public', true);
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
export const Permissions = (...perms: string[]) => SetMetadata('permissions', perms);
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

const issuer = () => process.env.KEYCLOAK_ISSUER ?? '';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly jwks = createRemoteJWKSet(new URL(process.env.KEYCLOAK_JWKS_URL ?? `${issuer()}/protocol/openid-connect/certs`));

  // statut des utilisateurs, mis en cache 30 s : fenêtre maximale d'accès après une suspension
  private readonly status = new Map<string, { blocked: boolean; until: number }>();

  constructor(private readonly reflector: Reflector, private readonly db: Database) {}

  private async isBlocked(userId: string): Promise<boolean> {
    const hit = this.status.get(userId);
    if (hit && hit.until > Date.now()) return hit.blocked;
    const [u] = await this.db.query('SELECT status FROM users WHERE id = $1', [userId]);
    const blocked = !!u && (u.status === 'suspended' || u.status === 'deleted');
    if (this.status.size > 10_000) this.status.clear();
    this.status.set(userId, { blocked, until: Date.now() + 30_000 });
    return blocked;
  }

  async canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>('public', [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException();
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: issuer(),
        audience: 'frigoconnect-api', // refuse tout jeton émis pour une autre application
        algorithms: ['RS256'],
      });
      const realmRoles = ((payload.realm_access as { roles?: string[] } | undefined)?.roles ?? []) as Role[];
      if (await this.isBlocked(payload.sub!)) throw new UnauthorizedException();
      req.user = { id: payload.sub!, roles: realmRoles.filter((r) => ROLES.includes(r)) } satisfies AuthUser;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext) {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('public', targets)) return true;
    const required = this.reflector.getAllAndOverride<Role[] | undefined>('roles', targets);
    if (!required?.length) return true; // authentifié suffit
    const user: AuthUser = ctx.switchToHttp().getRequest().user;
    if (!user.roles.some((r) => required.includes(r))) throw new ForbiddenError();
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[] | undefined>('permissions', [ctx.getHandler(), ctx.getClass()]);
    if (!required?.length) return true;
    const granted = permissionsOf(ctx.switchToHttp().getRequest<{ user: AuthUser }>().user.roles);
    if (!required.every((p) => granted.has(p))) throw new ForbiddenError();
    return true;
  }
}
