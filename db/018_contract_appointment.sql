-- Rendez-vous d'intervention : fixé (ou déplacé) par le prestataire une fois le devis signé, affiché aux deux parties.
-- Colonne facultative : compatible avec la version précédente de l'application.
ALTER TABLE contracts ADD COLUMN scheduled_at timestamptz;
