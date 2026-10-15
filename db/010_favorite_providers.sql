-- Prestataires favoris du client + demande adressée en priorité à un prestataire.
CREATE TABLE client_favorite_providers (
  client_id   uuid NOT NULL REFERENCES clients(user_id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES providers(user_id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, provider_id)
);
ALTER TABLE service_requests ADD COLUMN preferred_provider_id uuid REFERENCES providers(user_id) ON DELETE SET NULL;
