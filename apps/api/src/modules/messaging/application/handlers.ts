import { Inject, Logger } from '@nestjs/common';
import { CommandHandler, EventsHandler, ICommandHandler, IEventHandler, IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import type { ConversationSummary, ListMessagesInput, MessageDto, OpenConversationInput, SendMessageInput } from '@frigoconnect/contracts';
import { AuthUser } from '../../../shared/auth/auth';
import { IntegrationEvent } from '../../../shared/infrastructure/outbox/outbox';
import { ForbiddenError, InvalidStateError, NotFoundError } from '../../../shared/kernel/errors';
import { RealtimeGateway } from '../../../shared/realtime/realtime';
import { maskContacts } from '../domain/contact-masking';
import { checkOpen, partyOf } from '../domain/conversation-policy';
import { MESSAGING_REPOSITORY, MessagingRepository } from '../domain/ports';

// ---------- helpers ----------
/** 404 (et non 403) pour un non-participant : on ne révèle pas l'existence d'une conversation. */
async function loadForParticipant(repo: MessagingRepository, id: string, user: AuthUser, opts: { adminReadOnly?: boolean } = {}) {
  const conv = await repo.getConversation(id);
  const party = conv && partyOf(conv, user.id);
  const admin = !!opts.adminReadOnly && user.roles.includes('super_admin');
  if (!conv || (!party && !admin)) throw new NotFoundError('Conversation');
  return { conv, party };
}

// ---------- Open ----------
export class OpenConversationCommand {
  constructor(readonly user: AuthUser, readonly input: OpenConversationInput) {}
}

@CommandHandler(OpenConversationCommand)
export class OpenConversationHandler implements ICommandHandler<OpenConversationCommand, string> {
  constructor(@Inject(MESSAGING_REPOSITORY) private readonly repo: MessagingRepository) {}

  async execute({ user, input }: OpenConversationCommand) {
    const party = user.roles.includes('provider') ? 'provider' : 'client';
    const providerId = party === 'provider' ? user.id : input.providerId;
    if (!providerId) throw new InvalidStateError('providerId requis');

    const ctx = await this.repo.openContext(input.requestId, providerId);
    if (!ctx) throw new NotFoundError('Demande');
    const verdict = checkOpen(ctx, { userId: user.id, party });
    if (verdict === 'request_closed') throw new InvalidStateError('Cette demande est clôturée');
    if (verdict === 'not_allowed') throw new ForbiddenError('Conversation non autorisée pour cette demande');
    return this.repo.upsertConversation(input.requestId, ctx.requestClientId, providerId);
  }
}

// ---------- Send ----------
export class SendMessageCommand {
  constructor(readonly user: AuthUser, readonly conversationId: string, readonly input: SendMessageInput) {}
}

@CommandHandler(SendMessageCommand)
export class SendMessageHandler implements ICommandHandler<SendMessageCommand, MessageDto> {
  constructor(@Inject(MESSAGING_REPOSITORY) private readonly repo: MessagingRepository, private readonly realtime: RealtimeGateway) {}

  async execute({ user, conversationId, input }: SendMessageCommand) {
    const { conv } = await loadForParticipant(this.repo, conversationId, user); // l'admin ne peut pas écrire

    let body = input.body ?? null;
    let masked = false;
    if (body && !(await this.repo.contactsUnlocked(conv.requestId, conv.providerId))) {
      ({ text: body, masked } = maskContacts(body));
    }
    if (input.fileId && !(await this.repo.isAttachable(input.fileId, user.id))) throw new InvalidStateError('Pièce jointe invalide');

    const message = await this.repo.insertMessage({ conversationId, senderId: user.id, body, fileId: input.fileId ?? null, masked });
    // les deux participants (et tous les appareils de l'expéditeur) reçoivent le message en direct
    for (const id of new Set([conv.clientId, conv.providerId])) this.realtime.emitToUser(id, 'message:new', message);
    return message;
  }
}

// ---------- Read ----------
export class MarkReadCommand {
  constructor(readonly user: AuthUser, readonly conversationId: string) {}
}

@CommandHandler(MarkReadCommand)
export class MarkReadHandler implements ICommandHandler<MarkReadCommand, void> {
  constructor(@Inject(MESSAGING_REPOSITORY) private readonly repo: MessagingRepository, private readonly realtime: RealtimeGateway) {}

  async execute({ user, conversationId }: MarkReadCommand) {
    await loadForParticipant(this.repo, conversationId, user);
    await this.repo.markRead(conversationId, user.id);
    this.realtime.emitToUser(user.id, 'conversation:read', { conversationId }); // synchronise les autres appareils
  }
}

// ---------- Queries ----------
export class ListConversationsQuery {
  constructor(readonly userId: string) {}
}
export class ListMessagesQuery {
  constructor(readonly user: AuthUser, readonly conversationId: string, readonly params: ListMessagesInput) {}
}

@QueryHandler(ListConversationsQuery)
export class ListConversationsHandler implements IQueryHandler<ListConversationsQuery, ConversationSummary[]> {
  constructor(@Inject(MESSAGING_REPOSITORY) private readonly repo: MessagingRepository) {}
  execute({ userId }: ListConversationsQuery) {
    return this.repo.listConversations(userId);
  }
}

@QueryHandler(ListMessagesQuery)
export class ListMessagesHandler implements IQueryHandler<ListMessagesQuery, MessageDto[]> {
  constructor(@Inject(MESSAGING_REPOSITORY) private readonly repo: MessagingRepository) {}

  async execute({ user, conversationId, params }: ListMessagesQuery) {
    await loadForParticipant(this.repo, conversationId, user, { adminReadOnly: true }); // admin : lecture seule (litiges)
    return this.repo.listMessages(conversationId, params.before, params.limit);
  }
}

export const commandHandlers = [OpenConversationHandler, SendMessageHandler, MarkReadHandler];
export const queryHandlers = [ListConversationsHandler, ListMessagesHandler];

// ---------- Réaction à l'envoi d'un devis : il apparaît dans la conversation ----------
/** Ouvre la conversation si besoin (le client a bien reçu un devis, la règle d'ouverture est donc satisfaite) et y dépose le devis. */
@EventsHandler(IntegrationEvent)
export class PostQuoteInConversation implements IEventHandler<IntegrationEvent> {
  private readonly log = new Logger(PostQuoteInConversation.name);
  constructor(@Inject(MESSAGING_REPOSITORY) private readonly repo: MessagingRepository, private readonly realtime: RealtimeGateway) {}

  async handle(e: IntegrationEvent) {
    if (e.type !== 'quote.sent') return;
    const p = e.payload as { quoteId: string; number: string; requestId: string; clientId: string; providerId: string };
    try {
      const conversationId = await this.repo.upsertConversation(p.requestId, p.clientId, p.providerId);
      const message = await this.repo.insertMessage({ conversationId, senderId: p.providerId, body: `Devis ${p.number}`, fileId: null, quoteId: p.quoteId, masked: false });
      for (const id of [p.clientId, p.providerId]) this.realtime.emitToUser(id, 'message:new', message);
    } catch (err) {
      this.log.error(`message de devis échoué (${p.quoteId})`, err as Error);
    }
  }
}
