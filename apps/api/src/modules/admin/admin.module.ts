import { Body, Controller, Get, HttpCode, Ip, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import {
  commissionSchema, listAuditSchema, listUsersSchema, rejectSchema, resolveDisputeSchema, reviewCertificationSchema, statsSchema, suspendSchema,
} from '@frigoconnect/contracts';
import { AuthUser, CurrentUser, Permissions, Roles } from '../../shared/auth/auth';
import { ZodValidationPipe } from '../../shared/presentation/zod-validation.pipe';
import { IdentityModule } from '../identity/identity.module';
import { AdminService } from './admin.service';

const uuid = new ParseUUIDPipe();
const body = <T extends z.ZodTypeAny>(s: T) => new ZodValidationPipe(s);

/** Tout est réservé au rôle `super_admin` ET à une permission précise : un futur rôle « modérateur » n'aurait que celles qu'on lui donne. */
@Controller('admin')
@Roles('super_admin')
@Throttle({ default: { limit: 120, ttl: 60_000 } })
class AdminController {
  constructor(private readonly admin: AdminService) {}

  // ----- Prestataires -----
  @Get('providers') @Permissions('provider:validate')
  providers(@Query('status') status?: string) {
    return this.admin.providers(status);
  }

  @Get('providers/:id') @Permissions('provider:validate')
  provider(@Param('id', uuid) id: string) {
    return this.admin.provider(id);
  }

  @Post('providers/:id/certifications/:certId/review') @Permissions('provider:validate') @HttpCode(204)
  async reviewCert(@CurrentUser() u: AuthUser, @Ip() ip: string, @Param('id', uuid) id: string, @Param('certId', uuid) certId: string, @Body(body(reviewCertificationSchema)) b: z.output<typeof reviewCertificationSchema>) {
    await this.admin.reviewCertification(u, id, certId, b.decision, b.reason, ip);
  }

  @Post('providers/:id/approve') @Permissions('provider:validate') @HttpCode(204)
  async approve(@CurrentUser() u: AuthUser, @Ip() ip: string, @Param('id', uuid) id: string) {
    await this.admin.approve(u, id, ip);
  }

  @Post('providers/:id/reject') @Permissions('provider:validate') @HttpCode(204)
  async reject(@CurrentUser() u: AuthUser, @Ip() ip: string, @Param('id', uuid) id: string, @Body(body(rejectSchema)) b: z.output<typeof rejectSchema>) {
    await this.admin.reject(u, id, b.reason, ip);
  }

  @Post('providers/:id/suspend') @Permissions('provider:suspend') @HttpCode(204)
  async suspend(@CurrentUser() u: AuthUser, @Ip() ip: string, @Param('id', uuid) id: string, @Body(body(suspendSchema)) b: z.output<typeof suspendSchema>) {
    await this.admin.suspendProvider(u, id, b.reason, ip);
  }

  @Post('providers/:id/reinstate') @Permissions('provider:suspend') @HttpCode(204)
  async reinstate(@CurrentUser() u: AuthUser, @Ip() ip: string, @Param('id', uuid) id: string) {
    await this.admin.reinstateProvider(u, id, ip);
  }

  // ----- Utilisateurs -----
  @Get('users') @Permissions('user:manage')
  users(@Query(body(listUsersSchema)) q: z.output<typeof listUsersSchema>) {
    return this.admin.users(q);
  }

  @Get('users/:id') @Permissions('user:manage')
  user(@Param('id', uuid) id: string) {
    return this.admin.userDetail(id);
  }

  @Post('users/:id/suspend') @Permissions('user:manage') @HttpCode(204)
  async suspendUser(@CurrentUser() u: AuthUser, @Ip() ip: string, @Param('id', uuid) id: string, @Body(body(suspendSchema)) b: z.output<typeof suspendSchema>) {
    await this.admin.setUserSuspended(u, id, true, b.reason, ip);
  }

  @Post('users/:id/reactivate') @Permissions('user:manage') @HttpCode(204)
  async reactivateUser(@CurrentUser() u: AuthUser, @Ip() ip: string, @Param('id', uuid) id: string) {
    await this.admin.setUserSuspended(u, id, false, undefined, ip);
  }

  // ----- Modération -----
  @Get('reviews') @Permissions('review:moderate')
  reviews(@Query('status') status?: string) {
    return this.admin.reviews(['published', 'hidden', 'pending_moderation'].includes(status ?? '') ? status : undefined);
  }

  @Post('reviews/:id/publish') @Permissions('review:moderate') @HttpCode(204)
  async publish(@CurrentUser() u: AuthUser, @Ip() ip: string, @Param('id', uuid) id: string) {
    await this.admin.moderateReview(u, id, 'publish', ip);
  }

  @Post('reviews/:id/hide') @Permissions('review:moderate') @HttpCode(204)
  async hide(@CurrentUser() u: AuthUser, @Ip() ip: string, @Param('id', uuid) id: string) {
    await this.admin.moderateReview(u, id, 'hide', ip);
  }

  // ----- Litiges -----
  @Get('disputes') @Permissions('dispute:resolve')
  disputes() {
    return this.admin.disputes();
  }

  @Post('disputes/:id/resolve') @Permissions('dispute:resolve') @HttpCode(204)
  async resolve(@CurrentUser() u: AuthUser, @Ip() ip: string, @Param('id', uuid) id: string, @Body(body(resolveDisputeSchema)) b: z.output<typeof resolveDisputeSchema>) {
    await this.admin.resolveDispute(u, id, b.resolution, b.note, ip);
  }

  // ----- Commissions, statistiques, audit -----
  @Get('commissions') @Permissions('commission:manage')
  commissions() {
    return this.admin.commissions();
  }

  @Post('commissions') @Permissions('commission:manage') @HttpCode(204)
  async setCommission(@CurrentUser() u: AuthUser, @Ip() ip: string, @Body(body(commissionSchema)) b: z.output<typeof commissionSchema>) {
    await this.admin.setCommission(u, b, ip);
  }

  @Get('stats') @Permissions('stats:read')
  stats(@Query(body(statsSchema)) q: z.output<typeof statsSchema>) {
    return this.admin.stats(q.days);
  }

  @Get('audit') @Permissions('audit:read')
  audit(@Query(body(listAuditSchema)) q: z.output<typeof listAuditSchema>) {
    return this.admin.audit(q);
  }
}

@Module({ imports: [IdentityModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
