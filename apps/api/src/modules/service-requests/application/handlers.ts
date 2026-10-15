import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler, IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { CreateServiceRequestInput, ListServiceRequestsInput } from '@frigoconnect/contracts';
import { AuthUser } from '../../../shared/auth/auth';
import { ForbiddenError, NotFoundError } from '../../../shared/kernel/errors';
import {
  SERVICE_REQUEST_READ_MODEL,
  SERVICE_REQUEST_REPOSITORY,
  ServiceRequestDetails,
  ServiceRequestReadModel,
  ServiceRequestRepository,
  ServiceRequestSummary,
} from '../domain/ports';
import { ServiceRequest } from '../domain/service-request';

// ---------- Commands ----------
export class CreateServiceRequestCommand {
  constructor(readonly clientId: string, readonly input: CreateServiceRequestInput) {}
}
export class EditServiceRequestCommand {
  constructor(readonly requestId: string, readonly userId: string, readonly input: CreateServiceRequestInput) {}
}
export class PublishServiceRequestCommand {
  constructor(readonly requestId: string, readonly userId: string) {}
}
export class DeleteServiceRequestCommand {
  constructor(readonly requestId: string, readonly userId: string) {}
}
export class CancelServiceRequestCommand {
  constructor(readonly requestId: string, readonly userId: string) {}
}

@CommandHandler(CreateServiceRequestCommand)
export class CreateServiceRequestHandler implements ICommandHandler<CreateServiceRequestCommand, string> {
  constructor(@Inject(SERVICE_REQUEST_REPOSITORY) private readonly repo: ServiceRequestRepository) {}

  async execute({ clientId, input }: CreateServiceRequestCommand) {
    const { draft, attachmentIds, ...fields } = input;
    const request = ServiceRequest.create(clientId, fields, draft);
    await this.repo.save(request);
    await this.repo.attachFiles(request.id, clientId, attachmentIds ?? []);
    return request.id;
  }
}

async function load(repo: ServiceRequestRepository, id: string) {
  const request = await repo.findById(id);
  if (!request) throw new NotFoundError('Demande');
  return request;
}

@CommandHandler(EditServiceRequestCommand)
export class EditServiceRequestHandler implements ICommandHandler<EditServiceRequestCommand, void> {
  constructor(@Inject(SERVICE_REQUEST_REPOSITORY) private readonly repo: ServiceRequestRepository) {}

  async execute({ requestId, userId, input }: EditServiceRequestCommand) {
    const request = await load(this.repo, requestId);
    const { draft: _draft, attachmentIds, ...fields } = input;
    request.edit(userId, fields);
    await this.repo.save(request);
    await this.repo.attachFiles(requestId, userId, attachmentIds ?? []);
  }
}

@CommandHandler(PublishServiceRequestCommand)
export class PublishServiceRequestHandler implements ICommandHandler<PublishServiceRequestCommand, void> {
  constructor(@Inject(SERVICE_REQUEST_REPOSITORY) private readonly repo: ServiceRequestRepository) {}

  async execute({ requestId, userId }: PublishServiceRequestCommand) {
    const request = await load(this.repo, requestId);
    request.publish(userId);
    await this.repo.save(request);
  }
}

@CommandHandler(DeleteServiceRequestCommand)
export class DeleteServiceRequestHandler implements ICommandHandler<DeleteServiceRequestCommand, void> {
  constructor(@Inject(SERVICE_REQUEST_REPOSITORY) private readonly repo: ServiceRequestRepository) {}

  async execute({ requestId, userId }: DeleteServiceRequestCommand) {
    const request = await load(this.repo, requestId);
    request.assertDeletable(userId);
    await this.repo.delete(requestId);
  }
}

@CommandHandler(CancelServiceRequestCommand)
export class CancelServiceRequestHandler implements ICommandHandler<CancelServiceRequestCommand, void> {
  constructor(@Inject(SERVICE_REQUEST_REPOSITORY) private readonly repo: ServiceRequestRepository) {}

  async execute({ requestId, userId }: CancelServiceRequestCommand) {
    const request = await this.repo.findById(requestId);
    if (!request) throw new NotFoundError('Demande');
    request.cancel(userId);
    await this.repo.save(request);
  }
}

// ---------- Queries ----------
export class ListMyServiceRequestsQuery {
  constructor(readonly clientId: string, readonly params: ListServiceRequestsInput) {}
}
export class GetServiceRequestQuery {
  constructor(readonly requestId: string, readonly user: AuthUser) {}
}

@QueryHandler(ListMyServiceRequestsQuery)
export class ListMyServiceRequestsHandler implements IQueryHandler<ListMyServiceRequestsQuery, ServiceRequestSummary[]> {
  constructor(@Inject(SERVICE_REQUEST_READ_MODEL) private readonly read: ServiceRequestReadModel) {}

  execute({ clientId, params }: ListMyServiceRequestsQuery) {
    return this.read.listByClient(clientId, params);
  }
}

@QueryHandler(GetServiceRequestQuery)
export class GetServiceRequestHandler implements IQueryHandler<GetServiceRequestQuery, ServiceRequestDetails> {
  constructor(@Inject(SERVICE_REQUEST_READ_MODEL) private readonly read: ServiceRequestReadModel) {}

  async execute({ requestId, user }: GetServiceRequestQuery) {
    const details = await this.read.getDetails(requestId);
    if (!details) throw new NotFoundError('Demande');
    // rôle = accès à la fonctionnalité ; propriété = accès à la donnée
    // (accès prestataire via request_matches : ajouté avec le module matching)
    if (details.clientId !== user.id && !user.roles.includes('super_admin')) throw new ForbiddenError();
    return details;
  }
}

export const commandHandlers = [CreateServiceRequestHandler, EditServiceRequestHandler, PublishServiceRequestHandler, DeleteServiceRequestHandler, CancelServiceRequestHandler];
export const queryHandlers = [ListMyServiceRequestsHandler, GetServiceRequestHandler];
