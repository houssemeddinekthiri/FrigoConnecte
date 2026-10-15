import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { Throttle } from '@nestjs/throttler';
import { registerSchema, type RegisterInput } from '@frigoconnect/contracts';
import { Public } from '../../../shared/auth/auth';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import { RegisterUserCommand } from '../application/register-user.handler';

@Controller('auth')
export class AuthController {
  constructor(private readonly commands: CommandBus) {}

  /** 202 identique que l'email existe déjà ou non. Login/refresh/logout : directement auprès de Keycloak (OIDC). */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(202)
  async register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput) {
    await this.commands.execute(new RegisterUserCommand(body));
    return { message: 'Si cette adresse est valide, un email de vérification a été envoyé.' };
  }
}
