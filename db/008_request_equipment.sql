-- Lien demande -> équipement du client : permet « dernier entretien » et les rappels.
ALTER TABLE service_requests ADD COLUMN client_equipment_id uuid REFERENCES client_equipment(id) ON DELETE SET NULL;
CREATE INDEX requests_equipment_idx ON service_requests (client_equipment_id) WHERE client_equipment_id IS NOT NULL;
