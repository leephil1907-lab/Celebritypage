-- =============================================================================
-- TAKUYA KIMURA — OFFICIAL DIGITAL WORLD
-- PostgreSQL Schema v1.0 — 2026-09-15 (Africa/Lagos)
-- Design for STARTO ENTERTAINMENT — modular, scalable, production-ready
-- Zero-Fabrication: No official content seeded. Use DATA REQUIRED / ASSET REQUIRED.
-- Dev test data isolated in seed.dev.sql — never mixed with production.
-- Stack: Next.js (App Router) + React + TypeScript + Tailwind + Framer Motion
--        PostgreSQL 15+ + Redis (cache/rate limit) + S3/R2 + Cloudflare + pgcrypto
-- =============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- gen_random_uuid(), crypt()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";         -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- trigram search
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- =============================================================================
-- 0. Helpers & Conventions
-- =============================================================================
-- All PKs: UUID v4 (gen_random_uuid())
-- Timestamps: TIMESTAMPTZ, UTC, default now()
-- Soft delete: deleted_at
-- Audit: created_at / updated_at + actor tracking via audit_logs
-- Never store plaintext passwords — only password_hash (bcrypt via crypt)
-- Secrets encrypted at rest with pgp_sym_encrypt (app key via Vault / env)
-- JSONB for i18n / flexible metadata, with GIN indexes
-- RLS enabled on user-facing tables (policies documented below)
-- =============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='locale_code') THEN
    CREATE TYPE locale_code AS ENUM ('ja','en');
  END IF;
END $$;

-- =============================================================================
-- 1. AUTH & IDENTITY — Users, Profiles, Roles, Sessions, MFA, OAuth
-- =============================================================================

-- 1.1 users — core identity. Email is citext unique. No plaintext password.
CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             CITEXT UNIQUE NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_verified_at TIMESTAMPTZ,
  phone_e164        TEXT CHECK (phone_e164 ~ '^\+[1-9]\d{7,14}$'),
  phone_verified_at TIMESTAMPTZ,
  password_hash     TEXT NOT NULL CHECK (password_hash ~ '^\$2[aby]\$'), -- bcrypt
  status            TEXT NOT NULL DEFAULT 'pending_verification'
                    CHECK (status IN ('pending_verification','active','suspended','deleted')),
  locale            locale_code NOT NULL DEFAULT 'ja',
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  -- privacy
  data_export_requested_at TIMESTAMPTZ,
  deletion_requested_at    TIMESTAMPTZ
);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_created ON users(created_at);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 1.2 profiles — display / public persona, separated for privacy
CREATE TABLE IF NOT EXISTS profiles (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  handle            TEXT UNIQUE CHECK (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name      TEXT NOT NULL DEFAULT 'DATA REQUIRED',
  display_name_ja   TEXT,
  avatar_asset_id   UUID, -- FK to assets later (deferred)
  bio               TEXT,
  bio_ja            TEXT,
  prefecture        TEXT,
  birth_month_day   TEXT CHECK (birth_month_day ~ '^\d{2}-\d{2}$'), -- MM-DD for birthday surprise
  website_url       TEXT CHECK (website_url ~ '^https?://'),
  is_public         BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_profiles_updated ON profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 1.3 roles & permissions (RBAC)
CREATE TABLE IF NOT EXISTS roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT UNIQUE NOT NULL CHECK (key ~ '^[a-z_]+$'), -- super_admin, admin, editor, support, member
  name        TEXT NOT NULL,
  name_ja     TEXT,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT UNIQUE NOT NULL, -- e.g. news:write, analytics:read, support:assign
  name        TEXT NOT NULL,
  description TEXT
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS user_roles (
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  role_id     UUID REFERENCES roles(id) ON DELETE CASCADE,
  granted_by  UUID REFERENCES users(id),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX idx_user_roles_user ON user_roles(user_id);

-- Seed RBAC (system) — idempotent
INSERT INTO roles (key,name,is_system) VALUES
  ('super_admin','Super Admin',true),
  ('admin','Administrator',true),
  ('editor','Editor',true),
  ('support','Support',true),
  ('member','Member',true)
ON CONFLICT (key) DO NOTHING;
INSERT INTO permissions (key,name) VALUES
  ('cms:read','CMS Read'),('cms:write','CMS Write'),('cms:publish','CMS Publish'),
  ('media:read','Media Read'),('media:write','Media Write'),
  ('user:read','User Read'),('user:write','User Write'),
  ('member:read','Member Read'),('member:write','Member Write'),
  ('support:read','Support Read'),('support:write','Support Write'),('support:assign','Support Assign'),
  ('order:read','Order Read'),('order:write','Order Write'),
  ('analytics:read','Analytics Read'),('audit:read','Audit Read'),('settings:write','Settings Write')
ON CONFLICT (key) DO NOTHING;

-- 1.4 sessions & devices
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE, -- SHA256 of JWT/session token, never raw
  ip_hash       TEXT, -- hashed IP (privacy)
  user_agent    TEXT,
  device_id     UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint   TEXT NOT NULL, -- hashed device fingerprint
  name          TEXT, -- e.g. iPhone 15 — Safari
  platform      TEXT, -- ios/android/web
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  trusted       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, fingerprint)
);

-- 1.5 email verification & password reset (token_hash only, short-lived)
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1.6 OAuth accounts
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                TEXT NOT NULL CHECK (provider IN ('google','apple','line','x')),
  provider_user_id        TEXT NOT NULL,
  provider_email          CITEXT,
  access_token_encrypted  TEXT, -- pgp_sym_encrypt
  refresh_token_encrypted TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_user_id)
);

-- 1.7 MFA (TOTP) — secret encrypted, recovery codes hashed
CREATE TABLE IF NOT EXISTS mfa_secrets (
  user_id               UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted      TEXT NOT NULL, -- encrypted TOTP secret
  recovery_codes_hash   TEXT[] NOT NULL, -- array of bcrypt hashes
  verified_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_mfa_updated ON mfa_secrets;
CREATE TRIGGER trg_mfa_updated BEFORE UPDATE ON mfa_secrets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 2. ASSETS & RIGHTS — S3/R2 abstraction, secure uploads, licensing
-- =============================================================================

CREATE TABLE IF NOT EXISTS rights_holders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL, -- e.g. STARTO ENTERTAINMENT Inc.
  kind        TEXT CHECK (kind IN ('label','agency','photographer','other')),
  contact_json JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rights (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL DEFAULT 'DATA REQUIRED',
  holder_id     UUID REFERENCES rights_holders(id),
  territory     TEXT NOT NULL DEFAULT 'JP', -- JP / WW / etc
  license_type  TEXT NOT NULL DEFAULT 'editorial' CHECK (license_type IN ('editorial','commercial','limited','other')),
  start_date    DATE,
  end_date      DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   UUID REFERENCES users(id),
  bucket          TEXT NOT NULL, -- s3 bucket / r2
  s3_key          TEXT NOT NULL UNIQUE, -- object key, never public URL alone
  mime            TEXT NOT NULL CHECK (mime ~ '^[\w\-]+/[\w\-\+\.]+$'),
  size_bytes      BIGINT NOT NULL CHECK (size_bytes >= 0),
  width           INT CHECK (width > 0),
  height          INT CHECK (height > 0),
  duration_seconds INT CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  blurhash        TEXT,
  checksum_sha256 TEXT,
  status          TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('uploading','ready','processing','blocked','deleted')),
  rights_id       UUID REFERENCES rights(id),
  alt_text        TEXT,
  alt_text_ja     TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_assets_bucket_key ON assets(bucket, s3_key);
CREATE INDEX idx_assets_status ON assets(status);
CREATE INDEX idx_assets_metadata ON assets USING GIN(metadata);
DROP TRIGGER IF EXISTS trg_assets_updated ON assets;
CREATE TRIGGER trg_assets_updated BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Add FK from profiles.avatar_asset_id now that assets exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_avatar_asset_id_fkey') THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_avatar_asset_id_fkey FOREIGN KEY (avatar_asset_id) REFERENCES assets(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS asset_variants (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id  UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  variant   TEXT NOT NULL CHECK (variant IN ('thumb','sm','md','lg','xl','og','blur')),
  s3_key    TEXT NOT NULL UNIQUE,
  width     INT,
  height    INT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(asset_id, variant)
);

-- Track where asset is used (for rights audit / CDN purging)
CREATE TABLE IF NOT EXISTS asset_usages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id    UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL, -- e.g. hero, news, product
  entity_id   UUID NOT NULL,
  field       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_asset_usages_entity ON asset_usages(entity_type, entity_id);

-- =============================================================================
-- 3. WORK — Film / Drama / Stage / CM / Radio etc (zero-fabrication)
-- =============================================================================
CREATE TABLE IF NOT EXISTS works (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9\-]+$'),
  kind            TEXT NOT NULL CHECK (kind IN ('movie','drama','stage','cm','radio','tv','other')),
  title           TEXT NOT NULL DEFAULT 'DATA REQUIRED',
  title_ja        TEXT,
  subtitle        TEXT,
  synopsis        TEXT DEFAULT 'DATA REQUIRED',
  synopsis_ja     TEXT,
  release_date    DATE,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  cover_asset_id  UUID REFERENCES assets(id) ON DELETE SET NULL,
  meta_json       JSONB NOT NULL DEFAULT '{}', -- e.g. director, cast, network
  search_tsv      TSVECTOR,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at    TIMESTAMPTZ
);
CREATE INDEX idx_works_kind ON works(kind);
CREATE INDEX idx_works_status ON works(status);
CREATE INDEX idx_works_release ON works(release_date DESC);
CREATE INDEX idx_works_search ON works USING GIN(search_tsv);
DROP TRIGGER IF EXISTS trg_works_updated ON works;
CREATE TRIGGER trg_works_updated BEFORE UPDATE ON works FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- tsvector update trigger
CREATE OR REPLACE FUNCTION works_search_trigger() RETURNS TRIGGER AS $$
BEGIN
  NEW.search_tsv := to_tsvector('english', coalesce(NEW.title,'') || ' ' || coalesce(NEW.title_ja,'') || ' ' || coalesce(NEW.synopsis,''));
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_works_search ON works;
CREATE TRIGGER trg_works_search BEFORE INSERT OR UPDATE ON works FOR EACH ROW EXECUTE FUNCTION works_search_trigger();

CREATE TABLE IF NOT EXISTS work_assets (
  work_id   UUID REFERENCES works(id) ON DELETE CASCADE,
  asset_id  UUID REFERENCES assets(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'gallery' CHECK (role IN ('cover','gallery','poster','behind')),
  position  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (work_id, asset_id)
);

-- =============================================================================
-- 4. MUSIC — Releases & Tracks
-- =============================================================================
CREATE TABLE IF NOT EXISTS music_releases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9\-]+$'),
  title           TEXT NOT NULL DEFAULT 'DATA REQUIRED',
  title_ja        TEXT,
  kind            TEXT NOT NULL CHECK (kind IN ('album','single','dvd','other')),
  release_date    DATE,
  label           TEXT,
  cover_asset_id  UUID REFERENCES assets(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  meta_json       JSONB NOT NULL DEFAULT '{}',
  search_tsv      TSVECTOR,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at    TIMESTAMPTZ
);
CREATE INDEX idx_music_releases_kind ON music_releases(kind);
CREATE INDEX idx_music_releases_date ON music_releases(release_date DESC);
CREATE INDEX idx_music_releases_search ON music_releases USING GIN(search_tsv);
DROP TRIGGER IF EXISTS trg_music_releases_updated ON music_releases;
CREATE TRIGGER trg_music_releases_updated BEFORE UPDATE ON music_releases FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS music_tracks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id      UUID NOT NULL REFERENCES music_releases(id) ON DELETE CASCADE,
  position        INT NOT NULL CHECK (position > 0),
  title           TEXT NOT NULL DEFAULT 'DATA REQUIRED',
  title_ja        TEXT,
  duration_seconds INT CHECK (duration_seconds > 0),
  isrc            TEXT,
  lyrics          TEXT,
  lyrics_ja       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(release_id, position)
);

-- =============================================================================
-- 5. TOURS & EVENTS — Tour, Venues, Dates, Schedule (unified Events)
-- =============================================================================
CREATE TABLE IF NOT EXISTS tours (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9\-]+$'),
  title           TEXT NOT NULL DEFAULT 'DATA REQUIRED',
  title_ja        TEXT,
  description     TEXT DEFAULT 'DATA REQUIRED',
  description_ja  TEXT,
  poster_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  hero_asset_id   UUID REFERENCES assets(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived','cancelled')),
  period_start    DATE,
  period_end      DATE,
  meta_json       JSONB NOT NULL DEFAULT '{}',
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end IS NULL OR period_end >= period_start)
);
DROP TRIGGER IF EXISTS trg_tours_updated ON tours;
CREATE TRIGGER trg_tours_updated BEFORE UPDATE ON tours FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS venues (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9\-]+$'),
  name        TEXT NOT NULL,
  name_ja     TEXT,
  address     TEXT,
  address_ja  TEXT,
  capacity    INT CHECK (capacity IS NULL OR capacity > 0),
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tour_dates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id       UUID NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  venue_id      UUID REFERENCES venues(id) ON DELETE SET NULL,
  date          DATE NOT NULL,
  doors_at      TIMESTAMPTZ,
  start_at      TIMESTAMPTZ,
  end_at        TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sold_out','cancelled','postponed','completed')),
  ticket_url    TEXT CHECK (ticket_url ~ '^https?://'),
  notes         TEXT,
  notes_ja      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tour_dates_tour ON tour_dates(tour_id);
CREATE INDEX idx_tour_dates_date ON tour_dates(date);
DROP TRIGGER IF EXISTS trg_tour_dates_updated ON tour_dates;
CREATE TRIGGER trg_tour_dates_updated BEFORE UPDATE ON tour_dates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Unified schedule/events (TV/Radio/CM/Regular) — also links to tour_dates where relevant
CREATE TABLE IF NOT EXISTS events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9\-]+$'),
  title           TEXT NOT NULL DEFAULT 'DATA REQUIRED',
  title_ja        TEXT,
  category        TEXT NOT NULL CHECK (category IN ('concert','tv','radio','cm','regular','other')),
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ,
  venue_id        UUID REFERENCES venues(id) ON DELETE SET NULL,
  tour_date_id    UUID REFERENCES tour_dates(id) ON DELETE SET NULL,
  cover_asset_id  UUID REFERENCES assets(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived','cancelled')),
  link_url        TEXT CHECK (link_url ~ '^https?://'),
  description     TEXT,
  description_ja  TEXT,
  meta_json       JSONB NOT NULL DEFAULT '{}',
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at    TIMESTAMPTZ,
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX idx_events_category ON events(category);
CREATE INDEX idx_events_starts ON events(starts_at DESC);
CREATE INDEX idx_events_status ON events(status);
DROP TRIGGER IF EXISTS trg_events_updated ON events;
CREATE TRIGGER trg_events_updated BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 6. MEMBERSHIP — Fan Club, Fan Cards, Tour Passports & Stamps
-- =============================================================================
CREATE TABLE IF NOT EXISTS membership_tiers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key             TEXT UNIQUE NOT NULL CHECK (key IN ('silver','gold','platinum','diamond')),
  name            TEXT NOT NULL,
  name_ja         TEXT,
  price_yen       INT NOT NULL CHECK (price_yen >= 0), -- silver 300000, gold 500000, platinum 750000, diamond 1000000
  period          TEXT NOT NULL DEFAULT '/ year',
  features        JSONB NOT NULL DEFAULT '[]', -- array of benefit strings
  rank            INT NOT NULL UNIQUE, -- 1..4 for ordering
  is_active       BOOLEAN NOT NULL DEFAULT true,
  stripe_price_id TEXT, -- provider mapping
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_membership_tiers_updated ON membership_tiers;
CREATE TRIGGER trg_membership_tiers_updated BEFORE UPDATE ON membership_tiers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Canonical tiers (idempotent, matches current pricing)
INSERT INTO membership_tiers (key,name,price_yen,rank,features) VALUES
  ('silver','SILVER',300000,1,'["Member Fan Card","Ticket pre-sale","Blog & photos","5% shop","Birthday surprise"]'::jsonb),
  ('gold','GOLD',500000,2,'["All Silver","Goods pre-sale","Video & radio","10% shop","Meet & Greet lottery"]'::jsonb),
  ('platinum','PLATINUM',750000,3,'["All Gold","Front-row lottery","Gift box","15% shop","Priority 2x"]'::jsonb),
  ('diamond','DIAMOND VIP',1000000,4,'["All Platinum","Guaranteed Meet & Greet","Private booking","Concierge","Taipei lottery"]'::jsonb)
ON CONFLICT (key) DO UPDATE SET price_yen=EXCLUDED.price_yen, rank=EXCLUDED.rank;

CREATE TABLE IF NOT EXISTS memberships (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier_id                 UUID NOT NULL REFERENCES membership_tiers(id),
  status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','past_due','cancelled','expired','paused')),
  started_at              TIMESTAMPTZ,
  expires_at              TIMESTAMPTZ,
  auto_renew              BOOLEAN NOT NULL DEFAULT false,
  provider                TEXT CHECK (provider IN ('stripe','paypay','konbini','manual')),
  provider_subscription_id TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_status ON memberships(status);
CREATE INDEX idx_memberships_expires ON memberships(expires_at);
DROP TRIGGER IF EXISTS trg_memberships_updated ON memberships;
CREATE TRIGGER trg_memberships_updated BEFORE UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS fan_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_id   UUID REFERENCES memberships(id) ON DELETE SET NULL,
  card_no         TEXT UNIQUE NOT NULL CHECK (card_no ~ '^[A-Z0-9\-]{8,24}$'),
  tier_key        TEXT NOT NULL REFERENCES membership_tiers(key),
  qr_token_hash   TEXT NOT NULL UNIQUE, -- hash of wallet QR payload
  design_variant  TEXT NOT NULL DEFAULT 'standard',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired','reissued')),
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, tier_key) -- one active card per tier
);
CREATE INDEX idx_fan_cards_user ON fan_cards(user_id);
CREATE INDEX idx_fan_cards_no ON fan_cards(card_no);

CREATE TABLE IF NOT EXISTS tour_passports (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tour_id                 UUID NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  passport_no             TEXT UNIQUE NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','revoked')),
  digital_wallet_payload  JSONB, -- Apple Wallet / Google Wallet
  issued_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at            TIMESTAMPTZ,
  UNIQUE(user_id, tour_id)
);
CREATE INDEX idx_tour_passports_user ON tour_passports(user_id);

CREATE TABLE IF NOT EXISTS tour_passport_stamps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_id   UUID NOT NULL REFERENCES tour_passports(id) ON DELETE CASCADE,
  tour_date_id  UUID NOT NULL REFERENCES tour_dates(id) ON DELETE CASCADE,
  venue_id      UUID REFERENCES venues(id),
  stamped_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  method        TEXT NOT NULL DEFAULT 'qr' CHECK (method IN ('qr','nfc','manual','auto')),
  metadata      JSONB NOT NULL DEFAULT '{}',
  UNIQUE(passport_id, tour_date_id)
);

-- =============================================================================
-- 7. JOURNAL, FAN CONTENT & SOCIAL
-- =============================================================================
CREATE TABLE IF NOT EXISTS journal_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9\-]+$'),
  title           TEXT NOT NULL DEFAULT 'DATA REQUIRED',
  title_ja        TEXT,
  excerpt         TEXT,
  excerpt_ja      TEXT,
  body            TEXT NOT NULL DEFAULT 'DATA REQUIRED',
  body_ja         TEXT,
  cover_asset_id  UUID REFERENCES assets(id) ON DELETE SET NULL,
  author_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  visibility      TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','members','tier_gold','tier_platinum','tier_diamond')),
  lang            locale_code NOT NULL DEFAULT 'ja',
  search_tsv      TSVECTOR,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_journal_status ON journal_entries(status);
CREATE INDEX idx_journal_visibility ON journal_entries(visibility);
CREATE INDEX idx_journal_published ON journal_entries(published_at DESC);
CREATE INDEX idx_journal_search ON journal_entries USING GIN(search_tsv);
DROP TRIGGER IF EXISTS trg_journal_updated ON journal_entries;
CREATE TRIGGER trg_journal_updated BEFORE UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS fan_contents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journal_id      UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('photo','message','art','video')),
  body            TEXT,
  asset_id        UUID REFERENCES assets(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','hidden')),
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  like_count      INT NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fan_contents_user ON fan_contents(user_id);
CREATE INDEX idx_fan_contents_status ON fan_contents(status);

CREATE TABLE IF NOT EXISTS fan_content_likes (
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  fan_content_id UUID REFERENCES fan_contents(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, fan_content_id)
);

-- Social links (managed via CMS, cached + R2)
CREATE TABLE IF NOT EXISTS social_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform    TEXT NOT NULL CHECK (platform IN ('x','instagram','youtube','weibo','tiktok','line')),
  label       TEXT NOT NULL,
  url         TEXT NOT NULL CHECK (url ~ '^https?://'),
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 8. COMMERCE — Products, Inventory, Orders
-- =============================================================================
CREATE TABLE IF NOT EXISTS products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9\-]+$'),
  title           TEXT NOT NULL DEFAULT 'DATA REQUIRED',
  title_ja        TEXT,
  description     TEXT DEFAULT 'DATA REQUIRED',
  description_ja  TEXT,
  kind            TEXT NOT NULL DEFAULT 'goods' CHECK (kind IN ('goods','digital','ticket','bundle')),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived','sold_out')),
  base_price_yen  INT CHECK (base_price_yen IS NULL OR base_price_yen >= 0),
  currency        TEXT NOT NULL DEFAULT 'JPY' CHECK (currency IN ('JPY','USD','EUR','CNY')),
  cover_asset_id  UUID REFERENCES assets(id) ON DELETE SET NULL,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_products_updated ON products;
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS product_variants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku               TEXT UNIQUE NOT NULL CHECK (sku ~ '^[A-Z0-9\-_]{4,32}$'),
  title             TEXT NOT NULL,
  title_ja          TEXT,
  price_yen         INT NOT NULL CHECK (price_yen >= 0),
  compare_at_yen    INT CHECK (compare_at_yen IS NULL OR compare_at_yen >= price_yen),
  inventory_policy  TEXT NOT NULL DEFAULT 'deny' CHECK (inventory_policy IN ('deny','continue')),
  weight_grams      INT CHECK (weight_grams IS NULL OR weight_grams >= 0),
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory (
  variant_id    UUID PRIMARY KEY REFERENCES product_variants(id) ON DELETE CASCADE,
  warehouse     TEXT NOT NULL DEFAULT 'main',
  quantity      INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved      INT NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  -- available is quantity - reserved (computed in app / view)
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id  UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  delta       INT NOT NULL, -- + inbound, - outbound
  reason      TEXT NOT NULL CHECK (reason IN ('purchase','sale','refund','adjustment','reserve','release')),
  order_id    UUID, -- FK to orders deferred
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_inventory_movements_variant ON inventory_movements(variant_id);

CREATE TABLE IF NOT EXISTS orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no        TEXT UNIQUE NOT NULL CHECK (order_no ~ '^ORD-[A-Z0-9]{8,16}$'),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  email           CITEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','fulfilled','refunded','cancelled','failed')),
  currency        TEXT NOT NULL DEFAULT 'JPY',
  subtotal_yen    INT NOT NULL CHECK (subtotal_yen >= 0),
  tax_yen         INT NOT NULL DEFAULT 0 CHECK (tax_yen >= 0),
  shipping_yen    INT NOT NULL DEFAULT 0 CHECK (shipping_yen >= 0),
  discount_yen    INT NOT NULL DEFAULT 0 CHECK (discount_yen >= 0),
  total_yen       INT NOT NULL CHECK (total_yen >= 0),
  payment_id      UUID, -- FK to payments deferred
  shipping_address JSONB,
  billing_address  JSONB,
  placed_at       TIMESTAMPTZ,
  fulfilled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_orders_updated ON orders;
CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id    UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  product_id    UUID REFERENCES products(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  sku           TEXT,
  qty           INT NOT NULL CHECK (qty > 0),
  unit_price_yen INT NOT NULL CHECK (unit_price_yen >= 0),
  total_yen     INT NOT NULL CHECK (total_yen >= 0)
);
CREATE INDEX idx_order_items_order ON order_items(order_id);
-- now add deferred FKs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_movements_order_id_fkey') THEN
    ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- =============================================================================
-- 9. PAYMENTS — Provider-agnostic, no raw card storage, webhook-verified
-- =============================================================================
CREATE TABLE IF NOT EXISTS payment_methods (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL CHECK (provider IN ('stripe','paypay','apple_pay','google_pay','konbini','manual')),
  provider_method_id  TEXT NOT NULL, -- pm_xxx / token
  brand               TEXT CHECK (brand IN ('visa','mastercard','jcb','amex','other')),
  last4               TEXT CHECK (last4 ~ '^\d{4}$'),
  exp_month           INT CHECK (exp_month BETWEEN 1 AND 12),
  exp_year            INT CHECK (exp_year >= 2025),
  is_default          BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_method_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider              TEXT NOT NULL CHECK (provider IN ('stripe','paypay','apple_pay','google_pay','konbini','manual')),
  provider_payment_id   TEXT UNIQUE NOT NULL, -- pi_xxx / paypay id, idempotency key
  order_id              UUID REFERENCES orders(id) ON DELETE SET NULL,
  membership_id         UUID REFERENCES memberships(id) ON DELETE SET NULL,
  fan_card_id           UUID REFERENCES fan_cards(id) ON DELETE SET NULL,
  user_id               UUID REFERENCES users(id) ON DELETE SET NULL,
  amount_yen            INT NOT NULL CHECK (amount_yen >= 0),
  currency              TEXT NOT NULL DEFAULT 'JPY',
  status                TEXT NOT NULL CHECK (status IN ('requires_action','pending','succeeded','failed','refunded','cancelled')),
  method                TEXT CHECK (method IN ('card','apple_pay','google_pay','konbini','paypay','bank_transfer')),
  card_brand            TEXT,
  card_last4            TEXT,
  receipt_url           TEXT CHECK (receipt_url IS NULL OR receipt_url ~ '^https?://'),
  webhook_verified      BOOLEAN NOT NULL DEFAULT false,
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_user ON payments(user_id);
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_payments_status ON payments(status);
DROP TRIGGER IF EXISTS trg_payments_updated ON payments;
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- add FK from orders.payment_id now
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='orders_payment_id_fkey') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payment_webhooks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            TEXT NOT NULL,
  event_id            TEXT UNIQUE NOT NULL, -- Stripe event id, prevents replay
  payload             JSONB NOT NULL,
  signature_verified  BOOLEAN NOT NULL DEFAULT false,
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payment_webhooks_provider ON payment_webhooks(provider);

-- =============================================================================
-- 10. SUPPORT — Tickets, Messages, Assignment (operator console)
-- =============================================================================
CREATE TABLE IF NOT EXISTS support_tickets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no     TEXT UNIQUE NOT NULL CHECK (ticket_no ~ '^TK-[A-Z0-9]{8,12}$'),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  email         CITEXT NOT NULL,
  subject       TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general','membership','payment','tour','technical','other')),
  priority      TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved','closed')),
  assigned_to   UUID REFERENCES users(id) ON DELETE SET NULL,
  tier_key      TEXT REFERENCES membership_tiers(key),
  price_yen     INT CHECK (price_yen IS NULL OR price_yen >= 0),
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ,
  -- thread for per-user chat fallback
  thread_key    TEXT -- email or device hash for anonymous
);
CREATE INDEX idx_support_tickets_email ON support_tickets(email);
CREATE INDEX idx_support_tickets_status ON support_tickets(status);
CREATE INDEX idx_support_tickets_assigned ON support_tickets(assigned_to);
DROP TRIGGER IF EXISTS trg_support_tickets_updated ON support_tickets;
CREATE TRIGGER trg_support_tickets_updated BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS support_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  sender_role     TEXT NOT NULL CHECK (sender_role IN ('visitor','member','staff','system')),
  body            TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  is_internal     BOOLEAN NOT NULL DEFAULT false, -- staff-only note
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_support_messages_ticket ON support_messages(ticket_id);
CREATE INDEX idx_support_messages_created ON support_messages(created_at);

-- legacy per-user threads (chat) stored as JSONB migration helper
CREATE TABLE IF NOT EXISTS support_threads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  email       CITEXT NOT NULL,
  messages    JSONB NOT NULL DEFAULT '[]', -- [{from, text, ts}]
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(email)
);

-- =============================================================================
-- 11. NOTIFICATIONS & CAMPAIGNS
-- =============================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('system','membership','order','support','tour','journal')),
  title       TEXT NOT NULL,
  title_ja    TEXT,
  body        TEXT NOT NULL,
  body_ja     TEXT,
  payload     JSONB NOT NULL DEFAULT '{}',
  channel     TEXT NOT NULL CHECK (channel IN ('in_app','email','push')),
  read_at     TIMESTAMPTZ,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(read_at);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  channel   TEXT NOT NULL CHECK (channel IN ('email','push','in_app')),
  type      TEXT NOT NULL,
  enabled   BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, channel, type)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9\-]+$'),
  name          TEXT NOT NULL,
  name_ja       TEXT,
  type          TEXT NOT NULL CHECK (type IN ('email','push','in_app')),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','cancelled')),
  segment_query JSONB NOT NULL DEFAULT '{}', -- e.g. {tier: gold, tour: checkpoint}
  scheduled_at  TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  stats         JSONB NOT NULL DEFAULT '{}', -- {sent, opened, clicked}
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','opened','clicked','bounced','unsub')),
  sent_at     TIMESTAMPTZ,
  opened_at   TIMESTAMPTZ,
  clicked_at  TIMESTAMPTZ,
  UNIQUE(campaign_id, user_id)
);

-- =============================================================================
-- 12. ANALYTICS & AUDIT — partitioned, append-only
-- =============================================================================
CREATE TABLE IF NOT EXISTS analytics_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id  TEXT,
  event_name  TEXT NOT NULL CHECK (event_name ~ '^[a-z_\.]+$'), -- e.g. page.view, tier.purchase
  props       JSONB NOT NULL DEFAULT '{}',
  path        TEXT,
  referrer    TEXT,
  ip_hash     TEXT,
  user_agent  TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (occurred_at);
-- Create initial partitions (monthly) — add via cron/pg_partman in production
CREATE TABLE IF NOT EXISTS analytics_events_2026_09 PARTITION OF analytics_events
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE IF NOT EXISTS analytics_events_2026_10 PARTITION OF analytics_events
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE INDEX idx_analytics_events_name ON analytics_events(event_name);
CREATE INDEX idx_analytics_events_user ON analytics_events(user_id);
CREATE INDEX idx_analytics_events_occurred ON analytics_events(occurred_at DESC);
CREATE INDEX idx_analytics_events_props ON analytics_events USING GIN(props);

CREATE TABLE IF NOT EXISTS analytics_daily_rollup (
  date          DATE NOT NULL,
  event_name    TEXT NOT NULL,
  count         BIGINT NOT NULL DEFAULT 0,
  unique_users  BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (date, event_name)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email     CITEXT,
  action          TEXT NOT NULL, -- e.g. LOGIN, CMS.UPDATE, PAYMENT.SUCCEEDED, TICKET.ASSIGN
  entity_type     TEXT NOT NULL, -- user, news, tour, order, ticket
  entity_id       TEXT,
  diff            JSONB, -- {before, after}
  ip_hash         TEXT,
  user_agent      TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_actor ON audit_logs(actor_user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_occurred ON audit_logs(occurred_at DESC);
CREATE INDEX idx_audit_diff ON audit_logs USING GIN(diff);

-- Hero slider, news etc as CMS content tables (normalized from JSONB localStorage)
CREATE TABLE IF NOT EXISTS cms_hero_slides (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kicker      TEXT,
  kicker_ja   TEXT,
  title       TEXT NOT NULL,
  title_ja    TEXT,
  sub         TEXT,
  sub_ja      TEXT,
  image_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  image_url   TEXT, -- fallback for external
  link_url    TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cms_news (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9\-]+$'),
  date        DATE NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('concert','release','movie','news','regular','other')),
  title       TEXT NOT NULL,
  title_ja    TEXT,
  body        TEXT,
  body_ja     TEXT,
  href        TEXT,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  cover_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cms_news_status ON cms_news(status);
CREATE INDEX idx_cms_news_date ON cms_news(date DESC);
CREATE INDEX idx_cms_news_category ON cms_news(category);

-- Site settings / i18n / SEO (single row + history)
CREATE TABLE IF NOT EXISTS site_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT UNIQUE NOT NULL, -- e.g. seo.title, i18n.follow_en
  value_json  JSONB NOT NULL,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 13. VIEWS — convenience for API
-- =============================================================================
CREATE OR REPLACE VIEW view_member_with_tier AS
SELECT u.id as user_id, u.email, u.status as user_status, p.display_name, p.handle,
       m.id as membership_id, m.status as membership_status, m.expires_at,
       t.key as tier_key, t.name as tier_name, t.price_yen, t.rank,
       fc.card_no, fc.status as card_status, fc.qr_token_hash
FROM users u
LEFT JOIN profiles p ON p.user_id = u.id
LEFT JOIN memberships m ON m.user_id = u.id AND m.status = 'active'
LEFT JOIN membership_tiers t ON t.id = m.tier_id
LEFT JOIN fan_cards fc ON fc.user_id = u.id AND fc.status='active';

CREATE OR REPLACE VIEW view_order_summary AS
SELECT o.id, o.order_no, o.email, o.status, o.total_yen, o.created_at,
       COUNT(oi.id) as item_count, json_agg(json_build_object('title', oi.title,'qty',oi.qty,'total',oi.total_yen)) as items
FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id;

-- =============================================================================
-- 14. SECURITY — RLS, indexes, constraints, rate limiting (Redis + DB fallback)
-- =============================================================================
-- Enable RLS on sensitive tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE fan_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Example policies (app uses service role bypass; user JWT sets current_user_id via SET LOCAL)
-- Policies are permissive for service_role; restrict anon/authenticated as needed.
-- Supabase-style: create policy "Users can read own profile" ON profiles FOR SELECT USING (user_id = auth.uid());
-- Placeholder — implement per auth provider (see docs/security.md)
-- For now, force app to use SECURITY DEFINER functions + API layer.

-- Rate limit buckets (DB fallback if Redis unavailable)
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key         TEXT PRIMARY KEY, -- e.g. ip:1.2.3.4:login or user:uuid:chat
  tokens      INT NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Secure uploads — only allowlisted MIME, size caps enforced in API
-- Encryption check helper (ensure no plaintext password inserted)
CREATE OR REPLACE FUNCTION reject_plaintext_password() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.password_hash NOT LIKE '$2%' THEN
    RAISE EXCEPTION 'password_hash must be bcrypt hash, never plaintext';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_users_password_hash ON users;
CREATE TRIGGER trg_users_password_hash BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION reject_plaintext_password();

-- =============================================================================
-- 15. PERFORMANCE — CDN, caching, lazy, code splitting (DB hints)
-- =============================================================================
-- Recommended:
-- - Cloudflare in front of Next.js + R2/S3 for assets (immutable cache, signed URLs)
-- - Redis for session, rate limit, CMS cache (stale-while-revalidate)
-- - Next.js Image Optimization + asset_variants (thumb/sm/md/lg/xl) + blurhash
-- - GIN indexes on JSONB/search, BRIN on occurred_at for analytics
-- - Partition analytics_events monthly, VACUUM regularly, use pg_stat_statements
-- - GSAP/Framer Motion: prefer transform/opacity, will-change, disable on prefers-reduced-motion
CREATE INDEX IF NOT EXISTS idx_analytics_events_occurred_brin ON analytics_events USING BRIN(occurred_at);

-- =============================================================================
-- 16. SEED GUARD — Zero-fabrication
-- =============================================================================
-- Production must NOT contain fake official data.
-- Any filler uses 'DATA REQUIRED' / 'ASSET REQUIRED' placeholders above.
-- Dev seeds in seed.dev.sql are wrapped in:
--   -- DEV ONLY — never run in production
-- and guarded by:
--   SELECT pg_advisory_xact_lock(1);
--   -- check current_database() != 'prod'

-- =============================================================================
-- END SCHEMA
-- =============================================================================
-- Next steps:
-- 1. psql $DATABASE_URL -f schema.sql
-- 2. Configure env (see .env.example / docs/architecture.md)
-- 3. Run seed.dev.sql only in dev
-- 4. Enable RLS policies per auth provider
-- 5. Set up S3/R2 + Cloudflare + Stripe/PayPay webhooks (verify signatures)
-- =============================================================================
