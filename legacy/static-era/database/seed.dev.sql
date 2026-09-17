-- =============================================================================
-- DEV ONLY — Test seed. Never run in production.
-- Purpose: local smoke tests, UI previews, E2E without touching production data.
-- All real official content stays as DATA REQUIRED until licensed.
-- Guard: only allow in non-prod DB
-- =============================================================================
\echo 'Seeding DEV data...'

DO $$
BEGIN
  IF current_database() ILIKE '%prod%' THEN
    RAISE EXCEPTION 'Refusing to seed dev data into production DB (%)', current_database();
  END IF;
END $$;

-- Dev users (password = Test1234! bcrypt)
-- hash generated via: crypt('Test1234!', gen_salt('bf', 10))
INSERT INTO users (email, password_hash, status, email_verified_at) VALUES
  ('dev.member@example.com', crypt('Test1234!', gen_salt('bf')), 'active', now()),
  ('dev.editor@example.com', crypt('Test1234!', gen_salt('bf')), 'active', now()),
  ('dev.support@example.com', crypt('Test1234!', gen_salt('bf')), 'active', now())
ON CONFLICT (email) DO NOTHING;

-- Assign roles
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u, roles r
WHERE u.email='dev.editor@example.com' AND r.key='editor'
ON CONFLICT DO NOTHING;
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u, roles r
WHERE u.email='dev.support@example.com' AND r.key='support'
ON CONFLICT DO NOTHING;
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u, roles r
WHERE u.email='dev.member@example.com' AND r.key='member'
ON CONFLICT DO NOTHING;

-- Dev membership for member
INSERT INTO memberships (user_id, tier_id, status, started_at, expires_at, provider)
SELECT u.id, t.id, 'active', now(), now() + interval '1 year', 'manual'
FROM users u, membership_tiers t
WHERE u.email='dev.member@example.com' AND t.key='gold'
ON CONFLICT DO NOTHING;

-- Dev fan card
INSERT INTO fan_cards (user_id, membership_id, card_no, tier_key, qr_token_hash, expires_at)
SELECT u.id, m.id, 'DEV-'||upper(substring(md5(random()::text) from 1 for 8)), 'gold', encode(digest(random()::text,'sha256'),'hex'), now()+interval '1 year'
FROM users u JOIN memberships m ON m.user_id=u.id
WHERE u.email='dev.member@example.com'
ON CONFLICT DO NOTHING;

-- Dev news (clear placeholder, still DATA REQUIRED guard in title)
INSERT INTO cms_news (slug, date, category, title, title_ja, status, published_at)
VALUES
  ('dev-checkpoint-tour-2026', '2026-09-07', 'concert', '[DEV] Checkpoint Tour — DEV ONLY', '[DEV] チェックポイントツアー', 'published', now()),
  ('dev-release-notes', '2026-08-12', 'release', '[DEV] Release Preview', '[DEV] リリースプレビュー', 'draft', null)
ON CONFLICT (slug) DO NOTHING;

-- Dev hero slide
INSERT INTO cms_hero_slides (kicker, title, sub, link_url, sort_order, is_active)
VALUES ('DEV', 'DEV Hero — Replace with licensed asset', 'This is test data. Production requires licensed imagery.', '#news', 99, true)
ON CONFLICT DO NOTHING;

-- Dev tour + venue
INSERT INTO venues (slug, name, name_ja, address) VALUES ('dev-fukuoka-dome','DEV Fukuoka Dome','DEV 福岡','DEV') ON CONFLICT (slug) DO NOTHING;
INSERT INTO tours (slug, title, title_ja, status, period_start, period_end)
VALUES ('dev-checkpoint-2026','DEV Checkpoint Tour','DEV チェックポイント 2026','published','2026-09-05','2026-11-23')
ON CONFLICT (slug) DO NOTHING;

-- Dev order / product
INSERT INTO products (slug, title, kind, base_price_yen, status) VALUES ('dev-photo-set','DEV Photo Set','goods',3500,'published') ON CONFLICT (slug) DO NOTHING;
INSERT INTO product_variants (product_id, sku, title, price_yen)
SELECT p.id, 'DEV-SKU-'||upper(substring(md5(random()::text) from 1 for 5)), 'DEV Variant', 3500
FROM products p WHERE p.slug='dev-photo-set'
ON CONFLICT (sku) DO NOTHING;

-- Dev ticket
INSERT INTO support_tickets (ticket_no, email, subject, category, status, tier_key, price_yen)
VALUES ('TK-DEV00001','dev.member@example.com','[DEV] Fan Card — GOLD ¥500,000','membership','open','gold',500000)
ON CONFLICT (ticket_no) DO NOTHING;

INSERT INTO support_messages (ticket_id, sender_role, body)
SELECT id, 'visitor', 'Hello, this is a DEV test message for fan card purchase.'
FROM support_tickets WHERE ticket_no='TK-DEV00001'
ON CONFLICT DO NOTHING;

\echo 'DEV seed complete. Remember: never run this in production.'
