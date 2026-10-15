-- Phase 10 : devis et signature électronique simple (SES, eIDAS)

-- Numérotation lisible : DV-2026-000123 (la loi n'impose pas de séquence continue pour un devis)
CREATE SEQUENCE quote_number_seq;

-- Preuve de signature : un code à usage unique envoyé par email au client authentifié.
-- On conserve de quoi établir QUI a signé, QUAND, D'OÙ, et QUOI (empreinte du PDF présenté).
CREATE TABLE quote_signatures (
  quote_id          uuid PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE,
  code_hash         text,                       -- HMAC du code ; jamais le code en clair
  code_expires_at   timestamptz,
  code_requested_at timestamptz,
  attempts          smallint NOT NULL DEFAULT 0,
  signed_at         timestamptz,
  signer_user_id    uuid REFERENCES users(id),
  signer_ip         inet,
  signer_user_agent text,
  signer_email      citext,
  pdf_sha256        text,                       -- empreinte du devis tel que présenté au client
  signed_pdf_file_id uuid REFERENCES files(id)
);

-- Idempotence des notifications de devis (l'outbox est "au moins une fois")
CREATE UNIQUE INDEX notif_quote_once
  ON notifications (user_id, type, (data->>'quoteId'))
  WHERE type LIKE 'quote.%';

-- Expiration périodique des devis
CREATE INDEX quotes_expiry_idx ON quotes (valid_until) WHERE status = 'sent';
