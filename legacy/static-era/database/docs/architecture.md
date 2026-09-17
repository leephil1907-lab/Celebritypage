# Architecture — Takuya Kimura Digital World

> Modular system that already powers your localStorage demo and scales to official prod + iOS/Android.

## Stack (recommended, as requested)

- **Frontend:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind + Framer Motion / GSAP
- **DB:** PostgreSQL 15+ (this schema) · **Cache:** Redis 7 · **Storage:** S3 or Cloudflare R2
- **CDN:** Cloudflare (Images, Workers, WAF)
- **Auth:** Auth.js / Lucia + pg + TOTP MFA (admin)
- **Payments:** Stripe + PayPay + Konbini (via Stripe) + Apple Pay / Google Pay
- **Search:** Postgres `pg_trgm` + `tsvector` → Meilisearch later
- **Analytics:** `analytics_events` (partitioned) + PostHog / Plausible
- **Monitoring:** Sentry + OpenTelemetry + pg_stat_statements
- **Email:** Resend / SES + DKIM

## Layers

```
┌─────────────────────────────────────────────────┐
│  Clients: Web (Next.js), iOS, Android (RN/Expo) │  ← same API
├─────────────────────────────────────────────────┤
│  Next.js App Router                             │
│  • Server Components (RSC) → direct SQL         │
│  • Route Handlers /api/* → validation (Zod)     │
│  • Middleware: auth, RBAC, rate limit, audit    │
│  • Image/Font optimization, ISR (news, events)  │
├─────────────────────────────────────────────────┤
│  Services                                       │
│  • API: auth, cms, membership, tour, shop,      │
│        support, assets, notifications           │
│  • Workers: webhooks, emails, rollups, stamps   │
├─────────────────────────────────────────────────┤
│  Postgres (schema.sql) │ Redis │ R2/S3 │ Stripe │
└─────────────────────────────────────────────────┘
```

## URL map ↔ DB

| Public nav | DB source | CMS table |
|---|---|---|
| TOP hero | `cms_hero_slides` + `assets` | Hero Slider |
| ARTIST PROFILE | `profiles` + `assets` | Profile |
| NEWS | `cms_news` / `works` where category | News CMS |
| SCHEDULE | `events` + `tour_dates` + `venues` | Schedule CMS |
| CONCERT/STAGE | `tours` + `tour_dates` + `work_assets` | Concert CMS |
| MOVIE | `works` where kind=movie/drama | Movie CMS |
| RELEASE | `music_releases` + `music_tracks` | Discography |
| ABOUT/REGULAR/CM | `events` category=regular/cm, `site_settings` | CM/Regular |
| FAN CLUB | `membership_tiers` → `memberships` → `fan_cards` | Fan Club CMS |
| SHOP | `products` + `product_variants` + `inventory` | Shop |
| Support chat | `support_tickets` + `support_messages` | Support inbox |

## API contract (REST, ready for mobile)

- `POST /api/auth/register` → creates `users` pending, sends `email_verification_tokens`
- `POST /api/auth/login` → verifies `password_hash`, writes `sessions`, sets httpOnly cookie, logs `audit_logs`
- `GET /api/cms/news?status=published` → `cms_news`
- `POST /api/membership/purchase {tier}` → creates `payments` intent → webhook → `memberships` + `fan_cards` + `support_tickets` → unlocks vault
- `GET /api/tour/passport` → `tour_passports` + `tour_passport_stamps`
- `POST /api/support/tickets` + `POST /api/support/tickets/:id/messages` → `support_tickets` / `support_messages` (admin sees via SSE/WebSocket)
- `GET /api/analytics/summary` → `analytics_daily_rollup`

All handlers: `Zod` validation → RBAC check (`user_roles` → `permissions`) → `audit_logs` entry → rate limit (Redis `INCR` + `rate_limit_buckets` fallback).

## Data flow — Fan Card purchase (current site already does this via localStorage)

```
User clicks PLATINUM ¥750k
  → frontend purchaseTier('platinum') — now calls POST /api/membership/purchase
  → server creates payments row (status=pending, provider=stripe, amount=750000)
  → Stripe PaymentIntent + client secret returned
  → frontend confirms with Apple Pay / Card / PayPay sheet
  → Stripe webhook POST /api/webhooks/stripe {event_id, type=payment_intent.succeeded}
  → verify signature, upsert payment_webhooks, mark payments.succeeded
  → create memberships(active) + fan_cards(card_no, qr_token_hash)
  → create support_tickets + first support_messages ("Purchase Fan Card — PLATINUM")
  → notifications (in_app + email: "Welcome — vault unlocked")
  → vault UI checks view_member_with_tier → shows Exclusive Vault/Gallery/Stream
```

Current localStorage version does the same synchronously without money movement — schema is ready to swap to real provider when agreements signed.

## Caching

- **CMS:** Redis `cms:news:published` (60s stale-while-revalidate), invalidated on `cms_news` write + `audit_logs`
- **Assets:** Cloudflare cache `assets/*` immutable 1y, variant URLs signed 1h
- **Sessions:** Redis `sess:{token_hash}` 15min, DB as source of truth

## iOS/Android future

Same API, same DB. `fan_cards` and `tour_passports` already emit Apple Wallet passes (`digital_wallet_payload` contains `pass.json`). Mobile app is just another client with `Authorization: Bearer <session>`.

## File layout (Next.js)

```
/app
  /(public)/page.tsx  → hero, news, schedule (ISR 60s)
  /artist/page.tsx
  /api/auth/...
  /api/cms/...
  /api/support/...
/lib
  db.ts        → pg Pool
  redis.ts
  r2.ts
  auth.ts      → session + MFA
  rbac.ts
/components
  HeroCarousel.tsx (Framer Motion)
  Vault.tsx (unlocks via /api/membership/me)
```

No frontend visual change needed — just point `NEXT_PUBLIC_API_URL`.

