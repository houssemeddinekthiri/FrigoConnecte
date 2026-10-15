import { Module } from '@nestjs/common';
import { commandHandlers, PostQuoteInConversation, queryHandlers } from './application/handlers';
import { MESSAGING_REPOSITORY } from './domain/ports';
import { PgMessagingRepository } from './infrastructure/pg-messaging-repository';
import { MessagingController } from './presentation/messaging.controller';

@Module({
  controllers: [MessagingController],
  providers: [...commandHandlers, ...queryHandlers, PostQuoteInConversation, { provide: MESSAGING_REPOSITORY, useClass: PgMessagingRepository }],
})
export class MessagingModule {}
