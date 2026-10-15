-- Documents importés sur un contrat (modèle de contrat ou de facture) par le client ou le prestataire.
CREATE TABLE contract_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  file_id     uuid NOT NULL UNIQUE REFERENCES files(id),
  kind        text NOT NULL CHECK (kind IN ('contract','invoice')),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contract_documents_contract_idx ON contract_documents (contract_id, created_at);
