-- Vitrine publique du prestataire : photos de réalisations (le logo réutilise users.avatar_file_id)
-- et statut « disponible maintenant », qui expire tout seul (on ne reste pas « disponible » par oubli).
ALTER TABLE providers ADD COLUMN available_until timestamptz;

CREATE TABLE provider_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(user_id) ON DELETE CASCADE,
  file_id     uuid NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_photos_provider_idx ON provider_photos (provider_id, created_at);
