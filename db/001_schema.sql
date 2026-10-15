-- FrigoConnect - schema PostgreSQL 17 + PostGIS (Phase 3)
-- Montants en centimes (bigint). Dates en timestamptz (UTC). IDs en uuid.
-- Source de verite des roles : Keycloak ; la table roles sert aux FK et aux permissions (Phase 5).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- recherche texte floue
CREATE EXTENSION IF NOT EXISTS citext;    -- emails insensibles a la casse
CREATE EXTENSION IF NOT EXISTS btree_gist; -- EXCLUDE sur provider_time_off

-- ========== ENUMS ==========
CREATE TYPE user_status        AS ENUM ('pending','active','suspended','deleted');
CREATE TYPE client_type        AS ENUM ('individual','company','shop','hotel','restaurant','syndic','public_body');
CREATE TYPE provider_status    AS ENUM ('draft','pending_review','approved','rejected','suspended');
CREATE TYPE service_type       AS ENUM ('breakdown','maintenance','installation','audit','compliance','annual_contract');
CREATE TYPE trade_type         AS ENUM ('refrigeration','heating','air_conditioning','ventilation','heat_pump','maintenance_company');
CREATE TYPE urgency_level      AS ENUM ('low','normal','high','emergency');
CREATE TYPE request_status     AS ENUM ('draft','open','quoted','awarded','in_progress','completed','cancelled','expired');
CREATE TYPE certification_type AS ENUM ('fluid_handling_cat1','fluid_handling_cat2','fluid_handling_cat3','fluid_handling_cat4','qualipac','rge','qualibat','electrical_habilitation','insurance_decennale','other');
CREATE TYPE review_status_t    AS ENUM ('pending','approved','rejected','not_applicable');
CREATE TYPE quote_status       AS ENUM ('draft','sent','accepted','rejected','expired','withdrawn');
CREATE TYPE contract_type      AS ENUM ('one_off','annual');
CREATE TYPE contract_status    AS ENUM ('pending_signature','active','completed','cancelled','disputed');
CREATE TYPE message_type       AS ENUM ('text','file','quote','system');
CREATE TYPE payment_kind       AS ENUM ('deposit','balance','full','refund');
CREATE TYPE payment_status     AS ENUM ('pending','authorized','held','released','failed','refunded','partially_refunded');
CREATE TYPE file_status        AS ENUM ('pending_upload','uploaded','scanned_ok','rejected');
CREATE TYPE review_status      AS ENUM ('published','pending_moderation','hidden');

-- ========== UTILITAIRE updated_at ==========
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ========== ROLES / USERS ==========
CREATE TABLE roles (
  code        text PRIMARY KEY CHECK (code IN ('super_admin','provider','client')),
  label       text NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}'
);
INSERT INTO roles (code,label) VALUES ('super_admin','Super Admin'),('provider','Prestataire'),('client','Client');

CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keycloak_id  uuid NOT NULL UNIQUE,
  email        citext NOT NULL UNIQUE,
  phone        text,
  first_name   text NOT NULL,
  last_name    text NOT NULL,
  role_code    text NOT NULL REFERENCES roles(code),
  status       user_status NOT NULL DEFAULT 'pending',
  locale       text NOT NULL DEFAULT 'fr',
  avatar_file_id uuid,
  last_login_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz                       -- soft delete (RGPD : anonymisation differee)
);
CREATE INDEX users_role_status_idx ON users (role_code, status) WHERE deleted_at IS NULL;
CREATE TRIGGER users_upd BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========== FILES ==========
CREATE TABLE files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  bucket      text NOT NULL,
  object_key  text NOT NULL,
  original_name text NOT NULL,
  mime_type   text NOT NULL,
  size_bytes  bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400), -- 25 Mo
  checksum_sha256 text,
  status      file_status NOT NULL DEFAULT 'pending_upload',
  entity_type text,                                -- 'service_request','certification','message',...
  entity_id   uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, object_key)
);
CREATE INDEX files_entity_idx ON files (entity_type, entity_id);
CREATE INDEX files_uploader_idx ON files (uploaded_by);
ALTER TABLE users ADD CONSTRAINT users_avatar_fk FOREIGN KEY (avatar_file_id) REFERENCES files(id) ON DELETE SET NULL;

-- ========== CLIENTS ==========
CREATE TABLE clients (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  client_type    client_type NOT NULL DEFAULT 'individual',
  company_name   text,
  siret          text CHECK (siret IS NULL OR siret ~ '^[0-9]{14}$'),
  vat_number     text,
  billing_address text,
  billing_postal_code text,
  billing_city   text,
  stripe_customer_id text UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (client_type = 'individual' OR company_name IS NOT NULL)
);
CREATE TRIGGER clients_upd BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========== PROVIDERS ==========
CREATE TABLE providers (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_name   text NOT NULL,
  siret          text NOT NULL UNIQUE CHECK (siret ~ '^[0-9]{14}$'),
  slug           text NOT NULL UNIQUE,
  headline       text,
  bio            text,
  trades         trade_type[] NOT NULL,
  services       service_type[] NOT NULL,
  years_experience smallint NOT NULL DEFAULT 0 CHECK (years_experience BETWEEN 0 AND 60),
  hourly_rate_cents integer CHECK (hourly_rate_cents > 0),
  emergency_available boolean NOT NULL DEFAULT false,
  address        text,
  postal_code    text,
  city           text,
  base_location  geography(Point,4326) NOT NULL,
  service_radius_km smallint NOT NULL DEFAULT 30 CHECK (service_radius_km BETWEEN 1 AND 500),
  status         provider_status NOT NULL DEFAULT 'draft',
  validated_at   timestamptz,
  validated_by   uuid REFERENCES users(id),
  rejection_reason text,
  insurance_expires_on date,
  -- denormalise, maintenu par triggers/jobs (cf. reviews)
  avg_rating     numeric(3,2) NOT NULL DEFAULT 0 CHECK (avg_rating BETWEEN 0 AND 5),
  reviews_count  integer NOT NULL DEFAULT 0,
  completed_missions integer NOT NULL DEFAULT 0,
  avg_response_minutes integer,
  stripe_account_id text UNIQUE,
  stripe_charges_enabled boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX providers_location_gix ON providers USING gist (base_location) WHERE status = 'approved';
CREATE INDEX providers_services_gin ON providers USING gin (services) WHERE status = 'approved';
CREATE INDEX providers_trades_gin   ON providers USING gin (trades)   WHERE status = 'approved';
CREATE INDEX providers_status_idx   ON providers (status, created_at);
CREATE INDEX providers_rating_idx   ON providers (avg_rating DESC, reviews_count DESC) WHERE status = 'approved';
CREATE INDEX providers_name_trgm    ON providers USING gin (company_name gin_trgm_ops);
CREATE TRIGGER providers_upd BEFORE UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE provider_certifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(user_id) ON DELETE CASCADE,
  type        certification_type NOT NULL,
  label       text,
  number      text,
  issuer      text,
  issued_on   date,
  expires_on  date,
  file_id     uuid NOT NULL REFERENCES files(id),
  review_status review_status_t NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on > issued_on)
);
CREATE INDEX certs_provider_idx ON provider_certifications (provider_id, type);
CREATE INDEX certs_expiry_idx   ON provider_certifications (expires_on) WHERE review_status = 'approved';
CREATE INDEX certs_review_idx   ON provider_certifications (review_status, created_at) WHERE review_status = 'pending';

CREATE TABLE provider_availability_rules (          -- creneaux hebdomadaires
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(user_id) ON DELETE CASCADE,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),  -- ISO, 1 = lundi
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX avail_rules_idx ON provider_availability_rules (provider_id, weekday);

CREATE TABLE provider_time_off (                    -- conges / indisponibilites
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(user_id) ON DELETE CASCADE,
  period      tstzrange NOT NULL,
  reason      text,
  EXCLUDE USING gist (provider_id WITH =, period WITH &&)          -- pas de chevauchement
);

-- ========== SERVICE REQUESTS ==========
CREATE TABLE service_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid NOT NULL REFERENCES clients(user_id),
  service_type service_type NOT NULL,
  trade        trade_type NOT NULL,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 5 AND 150),
  description  text NOT NULL,
  equipment    text,                                   -- ex: "chambre froide negative 20 m3"
  urgency      urgency_level NOT NULL DEFAULT 'normal',
  status       request_status NOT NULL DEFAULT 'open',
  address      text NOT NULL,
  postal_code  text NOT NULL,
  city         text NOT NULL,
  location     geography(Point,4326) NOT NULL,
  desired_from timestamptz,
  desired_to   timestamptz,
  budget_min_cents bigint CHECK (budget_min_cents >= 0),
  budget_max_cents bigint CHECK (budget_max_cents >= COALESCE(budget_min_cents,0)),
  quotes_count integer NOT NULL DEFAULT 0,
  accepted_quote_id uuid,                              -- FK ajoutee apres creation de quotes
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (desired_to IS NULL OR desired_from IS NULL OR desired_to >= desired_from)
);
CREATE INDEX requests_open_location_gix ON service_requests USING gist (location) WHERE status IN ('open','quoted');
CREATE INDEX requests_client_idx  ON service_requests (client_id, created_at DESC);
CREATE INDEX requests_feed_idx    ON service_requests (status, urgency, created_at DESC) WHERE status IN ('open','quoted');
CREATE INDEX requests_expiry_idx  ON service_requests (expires_at) WHERE status IN ('open','quoted');
CREATE TRIGGER requests_upd BEFORE UPDATE ON service_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE request_matches (                       -- resultat du matching (Phase 8), auditable
  request_id  uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES providers(user_id) ON DELETE CASCADE,
  score       numeric(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  score_details jsonb NOT NULL DEFAULT '{}',
  notified_at timestamptz,
  viewed_at   timestamptz,
  declined_at timestamptz,
  PRIMARY KEY (request_id, provider_id)
);
CREATE INDEX matches_provider_idx ON request_matches (provider_id, notified_at DESC);

-- ========== QUOTES ==========
CREATE TABLE quotes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number       text NOT NULL UNIQUE,                   -- ex: DV-2026-000123
  request_id   uuid NOT NULL REFERENCES service_requests(id),
  provider_id  uuid NOT NULL REFERENCES providers(user_id),
  status       quote_status NOT NULL DEFAULT 'draft',
  subtotal_cents bigint NOT NULL CHECK (subtotal_cents >= 0),
  vat_cents    bigint NOT NULL CHECK (vat_cents >= 0),
  total_cents  bigint NOT NULL CHECK (total_cents = subtotal_cents + vat_cents),
  deposit_percent smallint NOT NULL DEFAULT 30 CHECK (deposit_percent BETWEEN 0 AND 100),
  valid_until  date NOT NULL,
  estimated_start date,
  estimated_duration_hours numeric(6,1),
  notes        text,
  pdf_file_id  uuid REFERENCES files(id),
  sent_at      timestamptz,
  decided_at   timestamptz,
  signature_hash text,                                 -- hash du PDF signe (preuve d'integrite)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- un seul devis actif par prestataire et par demande
CREATE UNIQUE INDEX quotes_one_active_per_provider ON quotes (request_id, provider_id) WHERE status IN ('draft','sent');
-- un seul devis accepte par demande
CREATE UNIQUE INDEX quotes_one_accepted_per_request ON quotes (request_id) WHERE status = 'accepted';
CREATE INDEX quotes_request_idx  ON quotes (request_id, status);
CREATE INDEX quotes_provider_idx ON quotes (provider_id, created_at DESC);
CREATE TRIGGER quotes_upd BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
ALTER TABLE service_requests ADD CONSTRAINT requests_accepted_quote_fk FOREIGN KEY (accepted_quote_id) REFERENCES quotes(id);

CREATE TABLE quote_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  position    smallint NOT NULL,
  label       text NOT NULL,
  quantity    numeric(10,2) NOT NULL CHECK (quantity > 0),
  unit        text NOT NULL DEFAULT 'u',
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  vat_rate_bps smallint NOT NULL DEFAULT 2000 CHECK (vat_rate_bps IN (0,550,1000,2000)),  -- 0 / 5,5 / 10 / 20 %
  UNIQUE (quote_id, position)
);

-- ========== CONTRACTS ==========
CREATE TABLE contracts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    uuid NOT NULL UNIQUE REFERENCES quotes(id),
  request_id  uuid NOT NULL REFERENCES service_requests(id),
  client_id   uuid NOT NULL REFERENCES clients(user_id),
  provider_id uuid NOT NULL REFERENCES providers(user_id),
  type        contract_type NOT NULL DEFAULT 'one_off',
  status      contract_status NOT NULL DEFAULT 'pending_signature',
  total_cents bigint NOT NULL CHECK (total_cents > 0),
  starts_on   date,
  ends_on     date,                                    -- renseignee pour les contrats annuels
  client_signed_at   timestamptz,
  provider_signed_at timestamptz,
  work_done_at       timestamptz,                      -- declare par le prestataire
  client_validated_at timestamptz,
  auto_validate_at   timestamptz,                      -- work_done_at + 7 jours
  pdf_file_id uuid REFERENCES files(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on > starts_on)
);
CREATE INDEX contracts_client_idx   ON contracts (client_id, status);
CREATE INDEX contracts_provider_idx ON contracts (provider_id, status);
CREATE INDEX contracts_autovalidate_idx ON contracts (auto_validate_at) WHERE status = 'active' AND client_validated_at IS NULL;
CREATE TRIGGER contracts_upd BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========== MESSAGING ==========
CREATE TABLE conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid REFERENCES service_requests(id) ON DELETE SET NULL,
  client_id   uuid NOT NULL REFERENCES clients(user_id),
  provider_id uuid NOT NULL REFERENCES providers(user_id),
  last_message_at timestamptz,
  client_last_read_at   timestamptz,
  provider_last_read_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, client_id, provider_id)
);
CREATE INDEX conv_client_idx   ON conversations (client_id, last_message_at DESC);
CREATE INDEX conv_provider_idx ON conversations (provider_id, last_message_at DESC);

CREATE TABLE messages (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- tri naturel, compact
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       uuid REFERENCES users(id),                         -- NULL = message systeme
  type            message_type NOT NULL DEFAULT 'text',
  body            text,
  file_id         uuid REFERENCES files(id),
  quote_id        uuid REFERENCES quotes(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'text' AND body IS NOT NULL) OR (type = 'file' AND file_id IS NOT NULL)
      OR (type = 'quote' AND quote_id IS NOT NULL) OR type = 'system')
);
CREATE INDEX messages_conv_idx ON messages (conversation_id, id DESC);  -- pagination par curseur

-- ========== PAYMENTS ==========
CREATE TABLE commission_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid REFERENCES providers(user_id),                    -- NULL = taux par defaut
  rate_bps    smallint NOT NULL CHECK (rate_bps BETWEEN 0 AND 3000), -- 1000 = 10 %
  valid_from  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL REFERENCES users(id)
);
CREATE INDEX commission_lookup_idx ON commission_rules (provider_id, valid_from DESC);

CREATE TABLE payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  payer_id    uuid NOT NULL REFERENCES users(id),
  provider_id uuid NOT NULL REFERENCES providers(user_id),
  kind        payment_kind NOT NULL,
  status      payment_status NOT NULL DEFAULT 'pending',
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  platform_fee_cents bigint NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  provider_amount_cents bigint NOT NULL DEFAULT 0 CHECK (provider_amount_cents >= 0),
  currency    char(3) NOT NULL DEFAULT 'EUR',
  commission_rate_bps smallint,                                      -- taux fige au moment du paiement
  refund_of   uuid REFERENCES payments(id),
  stripe_payment_intent_id text UNIQUE,
  stripe_charge_id   text,
  stripe_transfer_id text,
  stripe_refund_id   text,
  idempotency_key text NOT NULL UNIQUE,
  failure_reason text,
  paid_at     timestamptz,
  released_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'refund' OR amount_cents = platform_fee_cents + provider_amount_cents),
  CHECK ((kind = 'refund') = (refund_of IS NOT NULL))
);
CREATE INDEX payments_contract_idx ON payments (contract_id, kind);
CREATE INDEX payments_provider_idx ON payments (provider_id, created_at DESC);
CREATE INDEX payments_release_idx  ON payments (status) WHERE status = 'held';
CREATE TRIGGER payments_upd BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE stripe_webhook_events (                 -- idempotence des webhooks
  event_id    text PRIMARY KEY,
  type        text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- ========== REVIEWS ==========
CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id),
  author_id   uuid NOT NULL REFERENCES users(id),
  target_id   uuid NOT NULL REFERENCES users(id),
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  response    text,
  response_at timestamptz,
  status      review_status NOT NULL DEFAULT 'published',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, author_id),                   -- un avis par partie et par mission
  CHECK (author_id <> target_id)
);
CREATE INDEX reviews_target_idx ON reviews (target_id, created_at DESC) WHERE status = 'published';
CREATE INDEX reviews_moderation_idx ON reviews (created_at) WHERE status = 'pending_moderation';

-- ========== NOTIFICATIONS ==========
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,                          -- 'quote.received', 'payment.succeeded', ...
  title       text NOT NULL,
  body        text,
  data        jsonb NOT NULL DEFAULT '{}',
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notif_user_idx   ON notifications (user_id, created_at DESC);
CREATE INDEX notif_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE device_tokens (                        -- FCM
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  platform   text NOT NULL CHECK (platform IN ('web','android','ios')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_user_idx ON device_tokens (user_id);

CREATE TABLE notification_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type    text NOT NULL,
  email   boolean NOT NULL DEFAULT true,
  sms     boolean NOT NULL DEFAULT false,
  push    boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, type)
);

-- ========== TECHNIQUE : OUTBOX + AUDIT ==========
CREATE TABLE outbox_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox_events (id) WHERE published_at IS NULL;

CREATE TABLE audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  diff        jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_actor_idx  ON audit_logs (actor_id, created_at DESC);

-- ========== EXEMPLE : recherche prestataires (distance + filtres) ==========
-- SELECT p.user_id, p.company_name, p.avg_rating,
--        ST_Distance(p.base_location, ST_MakePoint(:lng,:lat)::geography) / 1000 AS km
-- FROM providers p
-- WHERE p.status = 'approved'
--   AND p.services @> ARRAY['breakdown']::service_type[]
--   AND ST_DWithin(p.base_location, ST_MakePoint(:lng,:lat)::geography, 500000)  -- borne fixe : utilise l'index GiST
--   AND ST_Distance(p.base_location, ST_MakePoint(:lng,:lat)::geography) <= p.service_radius_km * 1000  -- rayon propre
-- ORDER BY km LIMIT 20;
