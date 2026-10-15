-- Phase 11 : paiements Stripe Connect (séquestre : separate charges and transfers)

-- La capacité testée est « peut recevoir des virements de la plateforme », pas « peut encaisser » (on encaisse sur la plateforme).
ALTER TABLE providers RENAME COLUMN stripe_charges_enabled TO stripe_transfers_enabled;

-- Base de la commission (HT) et acompte fixés à la signature
ALTER TABLE contracts
  ADD COLUMN subtotal_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN deposit_cents  bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT contracts_amounts_chk CHECK (subtotal_cents >= 0 AND deposit_cents >= 0 AND deposit_cents <= total_cents);
CREATE INDEX contracts_request_idx ON contracts (request_id);

-- Impossible de payer deux fois le même acompte / solde, même en cas de double clic ou de course
CREATE UNIQUE INDEX payments_one_active_per_kind
  ON payments (contract_id, kind)
  WHERE kind IN ('deposit','balance') AND status IN ('pending','authorized','held','released','partially_refunded');

-- Libération des fonds : retrouver vite ce qui attend un versement
CREATE INDEX payments_releasable_idx ON payments (contract_id) WHERE stripe_transfer_id IS NULL AND status IN ('held','partially_refunded','authorized');

-- Idempotence générale des notifications (l'outbox est « au moins une fois »)
CREATE UNIQUE INDEX notif_dedupe
  ON notifications (user_id, type, (data->>'dedupeKey'))
  WHERE (data->>'dedupeKey') IS NOT NULL;

-- Statuts d'un paiement (colonne payments.status, enum payment_status) :
--   pending            intention créée, pas encore payée
--   held               payé par le client, fonds conservés par la plateforme (séquestre)
--   authorized         versement au prestataire EN COURS (verrou : interdit tout remboursement concurrent)
--   released           versé au prestataire
--   failed             échec ou abandon
--   refunded / partially_refunded   remboursé au client (uniquement avant versement)
