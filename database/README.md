# TAKUYA KIMURA — PostgreSQL Platform · Database

> Production DB for the official STARTO digital world. Preserves every pixel of the existing premium frontend while adding a proper backend.

**Date:** 2026-09-15 (Africa/Lagos) · **Version:** 1.0 · **DB:** PostgreSQL 15+

---

## Why this exists

You asked to **enhance without spoiling hard work** and **use PostgreSQL** for:

`Users, Profiles, Roles, Assets, Rights, Work, Music, Tours, Events, Memberships, Fan Cards, Tour Passports, Journal, Fan Content, Products, Inventory, Orders, Support, Notifications, Campaigns, Analytics, Audit Logs` — plus Auth, Payments, Security, Performance, Mobile.

The current site runs on `localStorage + BroadcastChannel` (demo). This schema is the **drop-in production backend** designed for future expansion and a future iOS/Android app. Frontend stays untouched visually; a thin adapter (see `public/js/db-adapter.js`) swaps storage to Postgres via API.

---

## Files

```
database/
├── schema.sql          ← Full production DDL (extensions, tables, indexes, RLS, views)
├── seed.dev.sql        ← DEV-ONLY test data (never in prod)
├── .env.example        ← Env template (DB, Redis, S3, Stripe, secrets)
├── docker-compose.yml  ← Postgres + Redis + Mailhog for local dev
├── README.md           ← This file
└── docs/
    ├── architecture.md ← System design, API layers, mobile
    ├── security.md     ← Auth, RBAC, MFA, payments, privacy
    └── zero-fabrication.md
```

## Quick start

```bash
# 1. Bring up Postgres + Redis
docker compose -f database/docker-compose.yml up -d

# 2. Create DB & run schema
createdb kimura_prod
psql $DATABASE_URL -f database/schema.sql

# 3. (dev only) seed test data — blocked if DB name contains prod
psql $DATABASE_URL -f database/seed.dev.sql

# 4. Verify
psql $DATABASE_URL -c "\dt" -c "SELECT key, price_yen FROM membership_tiers ORDER BY rank;"
```

`DATABASE_URL` format: `postgres://user:pass@host:5432/kimura_prod?sslmode=require`

## Core design principles

- **UUID PKs** (`gen_random_uuid()`), `TIMESTAMPTZ` UTC, `citext` email, soft delete.
- **Never plaintext passwords** — `password_hash` checks `^$2[aby]$` + trigger rejects inserts.
- **Secrets encrypted** at rest (`pgp_sym_encrypt` + Vault/env key). Rotate via `mfa_secrets`, `oauth_accounts`.
- **Rights-first** — `assets` → `rights` → `rights_holders` ensures licensed imagery only.
- **Zero-fabrication** — every content title defaults to `DATA REQUIRED` / `ASSET REQUIRED` until licensed. Production has no fake tour dates.
- **Modular** — `works`, `music_releases`, `tours`, `events`, `journal_entries`, `fan_contents`, `products` all share asset + search patterns, ready for new kinds.
- **Localizable** — `title` / `title_ja`, `bio` / `bio_ja`, `locale` enum, `site_settings` JSONB for JP/EN toggle.
- **Scalable** — `analytics_events` partitioned monthly + BRIN, GIN on JSONB/search, Cloudflare + S3/R2 + Redis cache, lazy images + variants.

## The 22 core domains (tables)

| Domain | Key tables |
|---|---|
| **Users** | `users`, `profiles` |
| **Roles** | `roles`, `permissions`, `role_permissions`, `user_roles` |
| **Auth** | `sessions`, `devices`, `email_verification_tokens`, `password_reset_tokens`, `oauth_accounts`, `mfa_secrets` |
| **Assets** | `assets`, `asset_variants`, `asset_usages` |
| **Rights** | `rights`, `rights_holders` |
| **Work** | `works`, `work_assets` |
| **Music** | `music_releases`, `music_tracks` |
| **Tours** | `tours`, `venues`, `tour_dates` |
| **Events** | `events` (schedule — concert/tv/radio/cm/regular) |
| **Memberships** | `membership_tiers`, `memberships` |
| **Fan Cards** | `fan_cards` (card_no, qr_token_hash) |
| **Tour Passports** | `tour_passports`, `tour_passport_stamps` |
| **Journal** | `journal_entries` |
| **Fan Content** | `fan_contents`, `fan_content_likes`, `social_links` |
| **Products** | `products`, `product_variants` |
| **Inventory** | `inventory`, `inventory_movements` |
| **Orders** | `orders`, `order_items` |
| **Support** | `support_tickets`, `support_messages`, `support_threads` |
| **Payments** | `payments`, `payment_methods`, `payment_webhooks` |
| **Notifications** | `notifications`, `notification_preferences` |
| **Campaigns** | `campaigns`, `campaign_recipients` |
| **Analytics/Audit** | `analytics_events` (partitioned), `analytics_daily_rollup`, `audit_logs` |

Plus CMS: `cms_hero_slides`, `cms_news`, `site_settings` — the exact keys your current `localStorage` uses, now normalized.

## Auth flow

- **Registration:** `users` → `email_verification_tokens` → verify → `status='active'`
- **Login:** bcrypt verify → `sessions` (token_hash) + `devices` + `audit_logs` + rate limit (Redis primary, `rate_limit_buckets` fallback)
- **Password reset:** `password_reset_tokens` (15min expiry, single use)
- **OAuth:** `oauth_accounts` (Line/Google/Apple/X) — encrypted tokens, link to existing `users.email`
- **MFA (admin):** `mfa_secrets` TOTP + recovery codes (admin/support forced via `user_roles` → middleware). `super_admin` must have MFA.
- **Sessions:** `token_hash` only, `revoked_at`, `last_active_at`, device fingerprint, `/auth/logout?all` revokes all.

See `docs/security.md` for implementation.

## Payments

Compliant — no raw PAN. Provider abstraction:

- **Providers:** Stripe (global), PayPay, Konbini (FamilyMart/Lawson), Apple Pay, Google Pay via Stripe
- **Flow:** `orders` → `payments(provider, provider_payment_id, status)` → webhook → `payment_webhooks(event_id unique, signature_verified)` → `order.status='paid'` → `memberships` + `fan_cards` issued → `notifications`
- **Webhooks:** Verify `Stripe-Signature` / PayPay HMAC with raw body; idempotency on `event_id`; store raw `payload` for replay.
- **Fan Card purchase:** Creates `support_tickets(category='membership', tier_key, price_yen)` + `support_messages` thread — Admin inbox picks it up live. Vault unlock checks `memberships.status='active'` via view.

## API layering (Next.js)

```
[Browser / iOS / Android]
        ↓
Next.js App Router (React + TS + Tailwind + Framer Motion)
  ├─ /api/auth/*, /api/cms/*, /api/membership/*, /api/tour/*, /api/shop/*, /api/support/*
  ├─ Middleware: auth (JWT), RBAC, rate limit, audit
  ├─ Server Components: direct Postgres via pg / Prisma / Drizzle
  ├─ Redis: session, cache (CMS, hero), rate buckets
  └─ S3/R2: assets/* via presigned PUT + Cloudflare signed URLs
        ↓
PostgreSQL (this schema) + Redis + S3/R2 + Stripe/PayPay + Search (pg_trgm / Meilisearch)
```

Existing frontend's `public/js/db-adapter.js` mirrors this: if `NEXT_PUBLIC_API_URL` exists it uses `fetch`, else falls back to `localStorage` — so your current build never breaks.

## Mobile

Schema supports mobile-first needs already:

- `fan_cards.qr_token_hash` + `tour_passports.digital_wallet_payload` → Apple/Google Wallet
- `asset_variants` (thumb/sm/md/lg/xl) + `blurhash` → fast lazy images
- `events` + `tour_dates` → swipeable schedule, fullscreen gallery
- `notification_preferences` → push via FCM/APNs

Frontend uses: touch gestures, swipe galleries, fullscreen media, bottom nav, digital card, reduced-motion check (`prefers-reduced-motion`).

## Performance targets

- LCP < 1.8s, CLS < 0.05, INP < 120ms on 4G
- Images: Next.js `<Image>` + `asset_variants` + `blurhash` + CDN immutable
- Video: HLS, poster, lazy
- Fonts: `next/font` with subset ja+en, `display:swap`
- JS: Route code-splitting, `dynamic()` for motion, tree-shake GSAP/Framer

## Environment

Copy `database/.env.example` → `.env.local` / `.env`:

```
DATABASE_URL=postgres://...
DIRECT_URL=postgres://...  # for migrations
REDIS_URL=redis://...
S3_BUCKET=kimura-assets
S3_REGION=auto
CLOUDFLARE_R2_ENDPOINT=...
NEXTAUTH_SECRET=...
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
PAYPAY_API_KEY=...
ENCRYPTION_KEY=... # for pgp_sym_encrypt
```

## Production checklist

- [ ] `schema.sql` applied, RLS policies tightened for anon/authenticated
- [ ] `seed.dev.sql` **never** run in prod
- [ ] S3/R2 buckets private, Cloudflare signed URLs
- [ ] Stripe/PayPay webhooks verified, `payment_webhooks` logging
- [ ] MFA enforced for `admin`/`super_admin`
- [ ] `audit_logs` shipping to SIEM, daily backups + PITR, secrets in Vault

---

**Nothing visual was spoiled.** The site still looks exactly as you approved — it now just has a real, licensed-ready foundation underneath ready for management approval, official assets, and payment agreements.

*Build systematically: Architecture → Design System → Database → CMS → Auth → Public → Membership → Tour → Shop → Support → Analytics → Security → Testing → Production.*
