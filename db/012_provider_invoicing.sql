-- Mentions légales de facturation du prestataire (portées par chaque facture émise en son nom).
ALTER TABLE providers
  ADD COLUMN vat_number text,
  ADD COLUMN legal_form text,
  ADD COLUMN share_capital_cents bigint CHECK (share_capital_cents >= 0),
  ADD COLUMN registration text;       -- ex : « RCS Lyon 123 456 789 » ou « RM Lyon »
