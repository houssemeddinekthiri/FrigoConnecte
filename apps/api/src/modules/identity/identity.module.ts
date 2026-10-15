import { Module } from '@nestjs/common';
import { RegisterUserHandler } from './application/register-user.handler';
import { IDENTITY_PROVIDER, USER_REPOSITORY } from './domain/ports';
import { KeycloakIdentityProvider } from './infrastructure/keycloak-identity-provider';
import { PgUserRepository } from './infrastructure/pg-user-repository';
import { AuthController } from './presentation/auth.controller';

@Module({
  exports: [IDENTITY_PROVIDER],
  controllers: [AuthController],
  providers: [
    RegisterUserHandler,
    { provide: IDENTITY_PROVIDER, useClass: KeycloakIdentityProvider },
    { provide: USER_REPOSITORY, useClass: PgUserRepository },
  ],
})
export class IdentityModule {}
