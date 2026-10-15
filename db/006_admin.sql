-- Phase 12 : administration

-- 1) Journal d'audit en AJOUT SEUL : même un bug applicatif (ou un administrateur de l'application) ne peut ni modifier ni effacer l'historique.
--    À compléter en production : l'utilisateur SQL de l'application n'a que INSERT/SELECT sur audit_logs (REVOKE UPDATE, DELETE, TRUNCATE).
CREATE FUNCTION audit_logs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs est en ajout seul (% interdit)', TG_OP;
END $$;
CREATE TRIGGER audit_logs_no_change   BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW       EXECUTE FUNCTION audit_logs_append_only();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE         ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();

-- 2) Alertes d'expiration des certifications : on mémorise le dernier palier notifié (30, 7, 0 jours) pour ne notifier qu'une fois par palier
ALTER TABLE provider_certifications ADD COLUMN last_alert_days smallint;
CREATE INDEX certs_expiring_idx ON provider_certifications (expires_on) WHERE review_status = 'approved' AND expires_on IS NOT NULL;

-- 3) Index des tableaux de bord
CREATE INDEX payments_paid_idx ON payments (paid_at) WHERE paid_at IS NOT NULL;
CREATE INDEX requests_created_idx ON service_requests (created_at);
CREATE INDEX contracts_status_idx ON contracts (status) WHERE status IN ('disputed','active');
