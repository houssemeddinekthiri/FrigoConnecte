import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { uploadUrlSchema, type UploadUrlInput } from '@frigoconnect/contracts';
import { AuthUser, CurrentUser } from '../../shared/auth/auth';
import { Database } from '../../shared/infrastructure/database/database.service';
import { ForbiddenError, InvalidStateError, NotFoundError } from '../../shared/kernel/errors';
import { ZodValidationPipe } from '../../shared/presentation/zod-validation.pipe';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} manquant`);
  return v;
};
const URL_TTL_S = 300;

/**
 * Le fichier ne transite JAMAIS par l'API : le navigateur envoie directement à MinIO via une URL pré-signée courte.
 * Deux clients S3 : `internal` (HEAD, réseau Docker) et `signer` (URLs embarquées dans les réponses : hôte PUBLIC).
 */
@Injectable()
export class FilesService {
  private readonly bucket = env('S3_BUCKET');
  private readonly creds = { accessKeyId: env('S3_ACCESS_KEY'), secretAccessKey: env('S3_SECRET_KEY') };
  private readonly internal = new S3Client({ endpoint: env('S3_ENDPOINT'), region: 'us-east-1', forcePathStyle: true, credentials: this.creds });
  private readonly signer = new S3Client({ endpoint: process.env.S3_PUBLIC_ENDPOINT ?? env('S3_ENDPOINT'), region: 'us-east-1', forcePathStyle: true, credentials: this.creds });

  constructor(private readonly db: Database) {}

  async createUpload(user: AuthUser, input: UploadUrlInput) {
    const fileId = randomUUID();
    const safe = input.fileName.replace(/[^\w.\-]+/g, '_').slice(-120); // pas de chemin ni de caractères exotiques dans la clé
    const key = `${user.id}/${fileId}-${safe}`;
    await this.db.query(
      `INSERT INTO files (id, uploaded_by, bucket, object_key, original_name, mime_type, size_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [fileId, user.id, this.bucket, key, input.fileName, input.mimeType, input.sizeBytes],
    );
    // Type et taille sont signés : MinIO refuse un envoi qui ne correspond pas à ce qui a été déclaré
    const url = await getSignedUrl(this.signer, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: input.mimeType, ContentLength: input.sizeBytes }), { expiresIn: URL_TTL_S });
    return { fileId, url, headers: { 'Content-Type': input.mimeType } };
  }

  async confirm(user: AuthUser, id: string) {
    const [f] = await this.db.query('SELECT object_key, size_bytes, status FROM files WHERE id = $1 AND uploaded_by = $2', [id, user.id]);
    if (!f) throw new NotFoundError('Fichier');
    if (f.status !== 'pending_upload') return;
    const head = await this.internal.send(new HeadObjectCommand({ Bucket: this.bucket, Key: f.object_key })).catch(() => null);
    if (!head) throw new InvalidStateError('Fichier non reçu');
    if (head.ContentLength !== f.size_bytes) throw new InvalidStateError('Taille inattendue');
    await this.db.query(`UPDATE files SET status = 'uploaded' WHERE id = $1`, [id]);
  }

  /** Fichier produit par le serveur (PDF de devis) : stocké directement, déjà 'uploaded'. */
  async storeBuffer(o: { ownerId: string; fileName: string; mimeType: string; buffer: Buffer; entity: { type: string; id: string } }) {
    const fileId = randomUUID();
    const key = `${o.ownerId}/${fileId}-${o.fileName.replace(/[^\w.\-]+/g, '_')}`;
    const sha256 = createHash('sha256').update(o.buffer).digest('hex');
    await this.internal.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: o.buffer, ContentType: o.mimeType }));
    await this.db.query(
      `INSERT INTO files (id, uploaded_by, bucket, object_key, original_name, mime_type, size_bytes, checksum_sha256, status, entity_type, entity_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'uploaded',$9,$10)`,
      [fileId, o.ownerId, this.bucket, key, o.fileName, o.mimeType, o.buffer.length, sha256, o.entity.type, o.entity.id],
    );
    return { fileId, sha256 };
  }

  /** Contenu d'un fichier que l'utilisateur a lui-même importé (type vérifié) : sert aux modèles Word. */
  async readOwn(userId: string, fileId: string, mime: string): Promise<Buffer> {
    const [f] = await this.db.query(`SELECT object_key FROM files WHERE id = $1 AND uploaded_by = $2 AND status = 'uploaded' AND mime_type = $3`, [fileId, userId, mime]);
    if (!f) throw new NotFoundError('Fichier');
    const obj = await this.internal.send(new GetObjectCommand({ Bucket: this.bucket, Key: f.object_key }));
    return Buffer.from(await obj.Body!.transformToByteArray());
  }

  /** PDF importé par son auteur, rattaché à une entité : vérifie la signature « %PDF- » et enregistre l'empreinte SHA-256 (celle qui sera signée). */
  async claimPdf(userId: string, fileId: string, entity: { type: string; id: string }): Promise<void> {
    const [f] = await this.db.query(`SELECT object_key FROM files WHERE id = $1 AND uploaded_by = $2 AND status = 'uploaded' AND mime_type = 'application/pdf'`, [fileId, userId]);
    if (!f) throw new NotFoundError('Fichier PDF');
    const obj = await this.internal.send(new GetObjectCommand({ Bucket: this.bucket, Key: f.object_key }));
    const buffer = Buffer.from(await obj.Body!.transformToByteArray());
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new InvalidStateError('Ce fichier n\'est pas un PDF valide');
    await this.db.query('UPDATE files SET checksum_sha256 = $2, entity_type = $3, entity_id = $4 WHERE id = $1', [fileId, createHash('sha256').update(buffer).digest('hex'), entity.type, entity.id]);
  }

  /** Image affichée sur une page publique : uniquement le logo ou une photo d'un prestataire approuvé, jamais un document. */
  async publicImage(id: string) {
    const [f] = await this.db.query(
      `SELECT f.object_key, f.mime_type FROM files f
        WHERE f.id = $1 AND f.status IN ('uploaded','scanned_ok') AND f.mime_type IN ('image/jpeg','image/png','image/webp')
          AND (EXISTS (SELECT 1 FROM users u JOIN providers p ON p.user_id = u.id WHERE u.avatar_file_id = f.id AND p.status = 'approved')
            OR EXISTS (SELECT 1 FROM provider_photos ph JOIN providers p ON p.user_id = ph.provider_id WHERE ph.file_id = f.id AND p.status = 'approved'))`,
      [id],
    );
    if (!f) throw new NotFoundError('Image');
    const obj = await this.internal.send(new GetObjectCommand({ Bucket: this.bucket, Key: f.object_key }));
    return { body: obj.Body as Readable, mime: f.mime_type as string };
  }

  // ponytail: pas encore de scan antivirus (ClamAV prévu V1, statut 'scanned_ok'). Les fichiers 'uploaded' sont servis tels quels.
  async downloadUrl(user: AuthUser, id: string) {
    const [f] = await this.db.query(
      `SELECT f.object_key, f.original_name, f.uploaded_by, f.status,
              EXISTS (SELECT 1 FROM conversations c WHERE f.entity_type = 'conversation' AND c.id = f.entity_id AND $2 IN (c.client_id, c.provider_id))
              OR EXISTS (SELECT 1 FROM quotes q JOIN service_requests r ON r.id = q.request_id
                          WHERE f.entity_type = 'quote' AND q.id = f.entity_id
                            AND (q.provider_id = $2 OR (r.client_id = $2 AND q.status <> 'draft')))
              OR EXISTS (SELECT 1 FROM invoices i WHERE f.entity_type = 'invoice' AND i.id = f.entity_id AND $2 IN (i.client_id, i.provider_id))
              OR EXISTS (SELECT 1 FROM contract_documents d JOIN contracts c ON c.id = d.contract_id WHERE d.file_id = f.id AND $2 IN (c.client_id, c.provider_id))
              OR EXISTS (SELECT 1 FROM service_requests r
                          WHERE f.entity_type = 'service_request' AND r.id = f.entity_id
                            AND (r.client_id = $2 OR EXISTS (SELECT 1 FROM request_matches m WHERE m.request_id = r.id AND m.provider_id = $2))) AS participant
         FROM files f WHERE f.id = $1`,
      [id, user.id],
    );
    if (!f || f.status === 'pending_upload') throw new NotFoundError('Fichier');
    // téléchargement : l'auteur, les participants de la conversation, ou un admin
    if (!(f.uploaded_by === user.id || f.participant || user.roles.includes('super_admin'))) throw new ForbiddenError();
    const url = await getSignedUrl(
      this.signer,
      new GetObjectCommand({ Bucket: this.bucket, Key: f.object_key, ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}` }),
      { expiresIn: URL_TTL_S },
    );
    return { url };
  }
}

@Controller('files')
class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('upload-url')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  uploadUrl(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(uploadUrlSchema)) body: UploadUrlInput) {
    return this.files.createUpload(user, body);
  }

  @Post(':id/confirm')
  @HttpCode(204)
  async confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.files.confirm(user, id);
  }

  @Get(':id/download-url')
  download(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.files.downloadUrl(user, id);
  }
}

@Module({ controllers: [FilesController], providers: [FilesService], exports: [FilesService] })
export class FilesModule {}
