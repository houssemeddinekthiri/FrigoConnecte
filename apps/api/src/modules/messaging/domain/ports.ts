import type { ConversationSummary, MessageDto } from '@frigoconnect/contracts';
import { OpenContext } from './conversation-policy';

export interface ConversationRef {
  id: string;
  requestId: string | null;
  clientId: string;
  providerId: string;
}

export interface MessagingRepository {
  openContext(requestId: string, providerId: string): Promise<OpenContext | null>;
  /** Idempotent sur (request, client, provider). */
  upsertConversation(requestId: string, clientId: string, providerId: string): Promise<string>;
  getConversation(id: string): Promise<ConversationRef | null>;
  /** Un contrat existe pour (demande, prestataire) = devis accepté = coordonnées autorisées. */
  contactsUnlocked(requestId: string | null, providerId: string): Promise<boolean>;
  /** Fichier envoyé par `userId`, téléversé, pas encore rattaché. */
  isAttachable(fileId: string, userId: string): Promise<boolean>;
  insertMessage(m: { conversationId: string; senderId: string; body: string | null; fileId: string | null; quoteId?: string | null; masked: boolean }): Promise<MessageDto>;
  markRead(conversationId: string, userId: string): Promise<void>;
  listConversations(userId: string): Promise<ConversationSummary[]>;
  listMessages(conversationId: string, before: number | undefined, limit: number): Promise<MessageDto[]>;
}
export const MESSAGING_REPOSITORY = Symbol('MESSAGING_REPOSITORY');
