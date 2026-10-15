import { Body, Controller, Get, HttpCode, Headers, Ip, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { Throttle } from '@nestjs/throttler';
import {
  acceptQuoteSchema, createQuoteSchema, listQuotesSchema, quoteContentSchema, rejectQuoteSchema,
  type CreateQuoteInput, type QuoteContentInput,
} from '@frigoconnect/contracts';
import { z } from 'zod';
import { AuthUser, CurrentUser, Permissions, Roles } from '../../../shared/auth/auth';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import {
  AcceptQuoteCommand, CreateQuoteCommand, GetQuoteQuery, ImportQuotePdfCommand, ListMyQuotesQuery, ListQuotesQuery, RejectQuoteCommand,
  RequestAcceptanceCodeCommand, SendQuoteCommand, UpdateQuoteCommand, WithdrawQuoteCommand,
} from '../application/handlers';

const uuid = new ParseUUIDPipe();

@Controller('quotes')
export class QuotesController {
  constructor(private readonly commands: CommandBus, private readonly queries: QueryBus) {}

  // ----- Prestataire -----
  @Post()
  @Roles('provider')
  async create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(createQuoteSchema)) body: CreateQuoteInput) {
    return { id: await this.commands.execute(new CreateQuoteCommand(user, body)) };
  }

  @Get('mine') // déclarée avant ':id'
  @Roles('provider')
  mine(@CurrentUser() user: AuthUser) {
    return this.queries.execute(new ListMyQuotesQuery(user));
  }

  @Put(':id')
  @Roles('provider')
  @HttpCode(204)
  async update(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(quoteContentSchema)) body: QuoteContentInput) {
    await this.commands.execute(new UpdateQuoteCommand(user, id, body));
  }

  @Post(':id/import-pdf')
  @Roles('provider')
  @HttpCode(204)
  async importPdf(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(z.object({ fileId: z.string().uuid() }))) body: { fileId: string }) {
    await this.commands.execute(new ImportQuotePdfCommand(user, id, body.fileId));
  }

  @Post(':id/send')
  @Roles('provider')
  @Permissions('quote:send')
  @HttpCode(204)
  async send(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    await this.commands.execute(new SendQuoteCommand(user, id));
  }

  @Post(':id/withdraw')
  @Roles('provider')
  @HttpCode(204)
  async withdraw(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    await this.commands.execute(new WithdrawQuoteCommand(user, id));
  }

  // ----- Client -----
  @Post(':id/reject')
  @Roles('client')
  @HttpCode(204)
  async reject(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body(new ZodValidationPipe(rejectQuoteSchema)) body: z.output<typeof rejectQuoteSchema>) {
    await this.commands.execute(new RejectQuoteCommand(user, id, body.reason));
  }

  @Post(':id/acceptance-code')
  @Roles('client')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async requestCode(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string): Promise<{ devCode: string | null }> {
    return this.commands.execute(new RequestAcceptanceCodeCommand(user, id)); // devCode : uniquement en test local, sinon null
  }

  @Post(':id/accept')
  @Roles('client')
  @Permissions('payment:pay') // accepter = s'engager à payer
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(204)
  async accept(
    @CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Ip() ip: string, @Headers('user-agent') ua: string | undefined,
    @Body(new ZodValidationPipe(acceptQuoteSchema)) body: z.output<typeof acceptQuoteSchema>,
  ) {
    await this.commands.execute(new AcceptQuoteCommand(user, id, body.code, ip, ua ?? ''));
  }

  // ----- Lecture -----
  @Get()
  @Roles('client', 'provider')
  list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(listQuotesSchema)) q: z.output<typeof listQuotesSchema>) {
    return this.queries.execute(new ListQuotesQuery(user, q.requestId));
  }

  @Get(':id')
  @Roles('client', 'provider', 'super_admin')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.queries.execute(new GetQuoteQuery(user, id));
  }
}
