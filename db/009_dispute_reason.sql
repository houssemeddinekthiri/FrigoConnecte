-- Litige ouvert par une partie : motif conservé pour l'administration.
ALTER TABLE contracts ADD COLUMN dispute_reason text, ADD COLUMN disputed_by uuid REFERENCES users(id), ADD COLUMN disputed_at timestamptz;
