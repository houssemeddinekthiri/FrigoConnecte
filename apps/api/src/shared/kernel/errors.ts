export class DomainError extends Error {
  constructor(message: string, readonly code: string = 'DOMAIN_ERROR') {
    super(message);
  }
}
export class NotFoundError extends DomainError {
  constructor(what: string) {
    super(`${what} introuvable`, 'NOT_FOUND');
  }
}
export class ForbiddenError extends DomainError {
  constructor(message = 'Accès refusé') {
    super(message, 'FORBIDDEN');
  }
}
export class InvalidStateError extends DomainError {
  constructor(message: string) {
    super(message, 'INVALID_STATE');
  }
}
