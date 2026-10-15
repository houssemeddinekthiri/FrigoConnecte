import { ALLOWED_MIME, MAX_FILE_BYTES } from '@frigoconnect/contracts';
import { api } from '@/lib/api';

export const ACCEPT = ALLOWED_MIME.join(',');

/** Envoi direct vers MinIO via URL pré-signée, puis confirmation : renvoie l'id du fichier. */
export async function uploadFile(file: File): Promise<string> {
  if (!(ALLOWED_MIME as readonly string[]).includes(file.type)) throw new Error('Formats acceptés : photos (JPEG, PNG, WebP) et PDF.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Fichier trop volumineux (25 Mo maximum).');
  const up = await api<{ fileId: string; url: string; headers: Record<string, string> }>('files/upload-url', {
    method: 'POST', body: JSON.stringify({ fileName: file.name, mimeType: file.type, sizeBytes: file.size }),
  });
  const put = await fetch(up.url, { method: 'PUT', headers: up.headers, body: file });
  if (!put.ok) throw new Error('Envoi impossible, réessayez.');
  await api(`files/${up.fileId}/confirm`, { method: 'POST' });
  return up.fileId;
}
