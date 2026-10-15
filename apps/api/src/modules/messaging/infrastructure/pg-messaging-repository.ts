import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import type { ConversationSummary, MessageDto } from '@frigoconnect/contracts';
import { Database } from '../../../shared/infrastructure/database/database.service';
import { OpenContext } from '../domain/conversation-policy';
import { ConversationRef, MessagingRepository } from '../domain/ports';

const toMessage = (r: QueryResultRow): MessageDto => ({
  id: r.id, conversationId: r.conversation_id, senderId: r.sender_id, type: r.type, body: r.body, masked: r.masked,
  quoteId: r.quote_id, createdAt: r.created_at.toISOString(),
  file: r.file_id ? { id: r.file_id, name: r.original_name, mimeType: r.mime_type, sizeBytes: r.size_bytes } : null,
});

const MESSAGE_SELECT = `SELECT m.id, m.conversation_id, m.sender_id, m.type, m.body, m.masked, m.quote_id, m.created_at,
       f.id AS file_id, f.original_name, f.mime_type, f.size_bytes
  FROM messages m LEFT JOIN files f ON f.id = m.file_id`;

@Injectable()
export class PgMessagingRepository implements MessagingRepository {
  constructor(private readonly db: Database) {}

  async openContext(requestId: string, providerId: string): Promise<OpenContext | null> {
    const [r] = await this.db.query(
      `SELECT sr.client_id, sr.status,
              EXISTS (SELECT 1 FROM request_matches rm WHERE rm.request_id = sr.id AND rm.provider_id = $2) AS matched,
              EXISTS (SELECT 1 FROM quotes q WHERE q.request_id = sr.id AND q.provider_id = $2 AND q.status IN ('sent','accepted')) AS has_quote
         FROM service_requests sr WHERE sr.id = $1`,
      [requestId, providerId],
    );
    return r && { requestClientId: r.client_id, requestStatus: r.status, providerMatched: r.matched, providerHasQuote: r.has_quote };
  }

  async upsertConversation(requestId: string, clientId: string, providerId: string): Promise<string> {
    const [r] = await this.db.query(
      `INSERT INTO conversations (request_id, client_id, provider_id) VALUES ($1,$2,$3)
       ON CONFLICT (request_id, client_id, provider_id) DO UPDATE SET request_id = EXCLUDED.request_id
       RETURNING id`,
      [requestId, clientId, providerId],
    );
    return r.id;
  }

  async getConversation(id: string): Promise<ConversationRef | null> {
    const [r] = await this.db.query('SELECT id, request_id, client_id, provider_id FROM conversations WHERE id = $1', [id]);
    return r && { id: r.id, requestId: r.request_id, clientId: r.client_id, providerId: r.provider_id };
  }

  async contactsUnlocked(requestId: string | null, providerId: string): Promise<boolean> {
    if (!requestId) return false;
    const [r] = await this.db.query('SELECT EXISTS (SELECT 1 FROM contracts WHERE request_id = $1 AND provider_id = $2) AS ok', [requestId, providerId]);
    return r.ok;
  }

  async isAttachable(fileId: string, userId: string): Promise<boolean> {
    const [r] = await this.db.query(
      `SELECT EXISTS (SELECT 1 FROM files WHERE id = $1 AND uploaded_by = $2 AND status IN ('uploaded','scanned_ok') AND entity_id IS NULL) AS ok`,
      [fileId, userId],
    );
    return r.ok;
  }

  async insertMessage(m: { conversationId: string; senderId: string; body: string | null; fileId: string | null; quoteId?: string | null; masked: boolean }): Promise<MessageDto> {
    return this.db.tx(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO messages (conversation_id, sender_id, type, body, file_id, quote_id, masked)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [m.conversationId, m.senderId, m.quoteId ? 'quote' : m.fileId ? 'file' : 'text', m.body, m.fileId, m.quoteId ?? null, m.masked],
      );
      await c.query(
        `UPDATE conversations SET last_message_at = now(),
           client_last_read_at   = CASE WHEN client_id   = $2 THEN now() ELSE client_last_read_at END,
           provider_last_read_at = CASE WHEN provider_id = $2 THEN now() ELSE provider_last_read_at END
         WHERE id = $1`,
        [m.conversationId, m.senderId],
      );
      // le fichier devient accessible aux deux participants (et à eux seuls)
      if (m.fileId) await c.query(`UPDATE files SET entity_type = 'conversation', entity_id = $2 WHERE id = $1`, [m.fileId, m.conversationId]);
      const { rows: [row] } = await c.query(`${MESSAGE_SELECT} WHERE m.id = $1`, [rows[0].id]);
      return toMessage(row);
    });
  }

  async markRead(conversationId: string, userId: string): Promise<void> {
    await this.db.query(
      `UPDATE conversations SET
         client_last_read_at   = CASE WHEN client_id   = $2 THEN now() ELSE client_last_read_at END,
         provider_last_read_at = CASE WHEN provider_id = $2 THEN now() ELSE provider_last_read_at END
       WHERE id = $1`,
      [conversationId, userId],
    );
  }

  async listConversations(userId: string): Promise<ConversationSummary[]> {
    const rows = await this.db.query(
      `SELECT c.id, c.request_id, r.title AS request_title, c.last_message_at,
              CASE WHEN c.client_id = $1 THEN c.provider_id ELSE c.client_id END AS counterpart_id,
              -- le prestataire ne voit que "Prénom N." du client avant contrat
              CASE WHEN c.client_id = $1 THEN p.company_name ELSE u.first_name || ' ' || left(u.last_name, 1) || '.' END AS counterpart_name,
              lm.body AS lm_body, lm.type AS lm_type, lm.created_at AS lm_at,
              (SELECT count(*) FROM messages m
                WHERE m.conversation_id = c.id AND m.sender_id IS DISTINCT FROM $1
                  AND m.created_at > COALESCE(CASE WHEN c.client_id = $1 THEN c.client_last_read_at ELSE c.provider_last_read_at END, 'epoch'::timestamptz)) AS unread
         FROM conversations c
         JOIN providers p ON p.user_id = c.provider_id
         JOIN users u ON u.id = c.client_id
         LEFT JOIN service_requests r ON r.id = c.request_id
         LEFT JOIN LATERAL (SELECT body, type, created_at FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) lm ON true
        WHERE c.client_id = $1 OR c.provider_id = $1
        ORDER BY c.last_message_at DESC NULLS LAST LIMIT 50`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id, requestId: r.request_id, requestTitle: r.request_title,
      counterpart: { id: r.counterpart_id, name: r.counterpart_name },
      lastMessage: r.lm_at ? { body: r.lm_body, type: r.lm_type, createdAt: r.lm_at.toISOString() } : null,
      unreadCount: r.unread, lastMessageAt: r.last_message_at?.toISOString() ?? null,
    }));
  }

  async listMessages(conversationId: string, before: number | undefined, limit: number): Promise<MessageDto[]> {
    const rows = await this.db.query(`${MESSAGE_SELECT} WHERE m.conversation_id = $1 AND ($2::bigint IS NULL OR m.id < $2) ORDER BY m.id DESC LIMIT $3`, [
      conversationId, before ?? null, limit,
    ]);
    return rows.map(toMessage); // du plus récent au plus ancien ; l'UI inverse
  }
}
