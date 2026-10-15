import { z } from 'zod';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', DOCX_MIME] as const;
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // = CHECK files.size_bytes

export const uploadUrlSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(ALLOWED_MIME),
  sizeBytes: z.number().int().positive().max(MAX_FILE_BYTES),
});
export type UploadUrlInput = z.output<typeof uploadUrlSchema>;

export const openConversationSchema = z.object({
  requestId: z.string().uuid(),
  providerId: z.string().uuid().optional(), // requis côté client ; ignoré côté prestataire (= lui-même)
});
export type OpenConversationInput = z.output<typeof openConversationSchema>;

export const sendMessageSchema = z
  .object({ body: z.string().trim().max(4000).optional(), fileId: z.string().uuid().optional() })
  .refine((v) => !!v.body || !!v.fileId, { message: 'Message vide' });
export type SendMessageInput = z.output<typeof sendMessageSchema>;

export const listMessagesSchema = z.object({
  before: z.coerce.number().int().positive().optional(), // curseur : id du plus ancien message déjà chargé
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListMessagesInput = z.output<typeof listMessagesSchema>;

export interface MessageDto {
  id: number;
  conversationId: string;
  senderId: string | null; // null = message système
  type: 'text' | 'file' | 'quote' | 'system';
  body: string | null;
  masked: boolean;
  file: { id: string; name: string; mimeType: string; sizeBytes: number } | null;
  quoteId: string | null;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  requestId: string | null;
  requestTitle: string | null;
  counterpart: { id: string; name: string };
  lastMessage: { body: string | null; type: string; createdAt: string } | null;
  unreadCount: number;
  lastMessageAt: string | null;
}

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}
