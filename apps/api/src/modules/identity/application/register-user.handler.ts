import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { RegisterInput } from '@frigoconnect/contracts';
import { EmailTakenError, IDENTITY_PROVIDER, IdentityProvider, USER_REPOSITORY, UserRepository } from '../domain/ports';

export class RegisterUserCommand {
  constructor(readonly input: RegisterInput) {}
}

@CommandHandler(RegisterUserCommand)
export class RegisterUserHandler implements ICommandHandler<RegisterUserCommand, void> {
  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly idp: IdentityProvider,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async execute({ input }: RegisterUserCommand) {
    let id: string;
    try {
      id = await this.idp.createUser({
        email: input.email,
        password: input.password,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.accountType,
      });
    } catch (e) {
      if (e instanceof EmailTakenError) return; // réponse identique : pas d'énumération de comptes
      throw e;
    }

    try {
      await this.users.createWithProfile({
        id,
        email: input.email,
        phone: input.phone,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.accountType,
        clientType: input.clientType,
        companyName: input.companyName,
      });
    } catch (e) {
      await this.idp.deleteUser(id); // compensation : pas de compte Keycloak orphelin
      throw e;
    }

    await this.idp.sendVerifyEmail(id).catch(() => undefined); // best effort : Keycloak le redemandera au login
  }
}
