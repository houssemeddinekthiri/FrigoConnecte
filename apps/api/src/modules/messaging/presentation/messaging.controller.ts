import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { Throttle } from '@nestjs/throttler';
import {
  listMessagesSchema, openConversationSchema, sendMessageSchema,
  type ListMessagesInput, type OpenConversationInput, type SendMessageInput,
} from '@frigoconnect/contracts';
import { AuthUser, CurrentUser, Roles } from '../../../shared/auth/auth';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import { ListConversationsQuery, ListMessagesQuery, MarkReadCommand, OpenConversationCommand, SendMessageCommand } from '../application/handlers';

@Controller('conversations')
export class MessagingController {
  constructor(private readonly commands: CommandBus, private readonly queries: QueryBus) {}

  @Post()
  @Roles('client', 'provider')
  async open(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(openConversationSchema)) body: OpenConversationInput) {
    return { id: await this.commands.execute(new OpenConversationCommand(user, body)) };
  }

  @Get()
  @Roles('client', 'provider')
  list(@CurrentUser() user: AuthUser) {
    return this.queries.execute(new ListConversationsQuery(user.id));
  }

  @Get(':id/messages')
  @Roles('client', 'provider', 'super_admin')
  messages(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(listMessagesSchema)) q: ListMessagesInput) {
    return this.queries.execute(new ListMessagesQuery(user, id, q));
  }

  @Post(':id/messages')
  @Roles('client', 'provider')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  send(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput) {
    return this.commands.execute(new SendMessageCommand(user, id, body));
  }

  @Post(':id/read')
  @Roles('client', 'provider')
  @HttpCode(204)
  async read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.commands.execute(new MarkReadCommand(user, id));
  }
}
