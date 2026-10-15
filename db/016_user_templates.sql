-- Modèle Word (champs {{...}}) de contrat ou de facture propre à chaque utilisateur, client ou prestataire.
CREATE TABLE user_templates (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('contract','invoice')),
  file_id    uuid NOT NULL REFERENCES files(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
