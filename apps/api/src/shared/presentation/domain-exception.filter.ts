import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { DomainError, ForbiddenError, InvalidStateError, NotFoundError } from '../kernel/errors';

@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(e: DomainError, host: ArgumentsHost) {
    const status = e instanceof NotFoundError ? 404 : e instanceof ForbiddenError ? 403 : e instanceof InvalidStateError ? 409 : 400;
    host.switchToHttp().getResponse<Response>().status(status).json({ code: e.code, message: e.message });
  }
}
