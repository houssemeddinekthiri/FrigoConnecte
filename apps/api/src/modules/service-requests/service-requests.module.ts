import { Module } from '@nestjs/common';
import { commandHandlers, queryHandlers } from './application/handlers';
import { SERVICE_REQUEST_READ_MODEL, SERVICE_REQUEST_REPOSITORY } from './domain/ports';
import { PgServiceRequestReadModel, PgServiceRequestRepository } from './infrastructure/pg-repositories';
import { ServiceRequestsController } from './presentation/service-requests.controller';

@Module({
  controllers: [ServiceRequestsController],
  providers: [
    ...commandHandlers,
    ...queryHandlers,
    { provide: SERVICE_REQUEST_REPOSITORY, useClass: PgServiceRequestRepository },
    { provide: SERVICE_REQUEST_READ_MODEL, useClass: PgServiceRequestReadModel },
  ],
})
export class ServiceRequestsModule {}
