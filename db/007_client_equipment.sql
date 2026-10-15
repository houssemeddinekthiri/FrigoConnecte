-- Équipements du client (chambre froide, clim…) avec leur adresse : pré-remplissent les nouvelles demandes.
CREATE TABLE client_equipment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES clients(user_id) ON DELETE CASCADE,
  label       text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 100),
  trade       trade_type NOT NULL,
  details     text CHECK (char_length(details) <= 200),   -- marque, modèle, volume…
  address     text NOT NULL,
  postal_code text NOT NULL,
  city        text NOT NULL,
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_equipment_client_idx ON client_equipment (client_id, created_at DESC);
