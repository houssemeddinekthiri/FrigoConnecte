-- Factures : une par contrat terminé, émise au nom du prestataire, numérotation continue PAR PRESTATAIRE et par année.
CREATE TABLE invoice_counters (
  provider_id uuid NOT NULL REFERENCES providers(user_id),
  year        integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (provider_id, year)
);
CREATE TABLE invoices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number       text NOT NULL UNIQUE,                       -- ex : FA-2026-000001 (une suite par prestataire)
  contract_id  uuid NOT NULL UNIQUE REFERENCES contracts(id),
  client_id    uuid NOT NULL REFERENCES clients(user_id),
  provider_id  uuid NOT NULL REFERENCES providers(user_id),
  issued_on    date NOT NULL DEFAULT CURRENT_DATE,
  subtotal_cents bigint NOT NULL CHECK (subtotal_cents >= 0),
  vat_cents    bigint NOT NULL CHECK (vat_cents >= 0),
  total_cents  bigint NOT NULL CHECK (total_cents = subtotal_cents + vat_cents),
  pdf_file_id  uuid REFERENCES files(id),                  -- NULL tant que le PDF n'est pas généré (régénéré à la demande)
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_client_idx ON invoices (client_id, issued_on DESC);
CREATE INDEX invoices_provider_idx ON invoices (provider_id, issued_on DESC);
