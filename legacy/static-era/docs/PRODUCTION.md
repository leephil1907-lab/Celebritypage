# TAKUYA KIMURA — Production Ready Flow

**Site:** https://takuya-kimura.jp (STARTO ENTERTAINMENT official)  
**API:** https://api.takuya-kimura.jp  
**Assets (R2):** https://assets.takuya-kimura.jp  
**Env:** `ja` primary, `en` secondary, `ko/zh` via approved translations (CMS, not auto)

---

## 1) Backend wiring — Postgres (schema.sql 1068 lines) → Prod

**DB:** `database/schema.sql` + `pgcrypto`, `citext`, `pg_trgm`  
**Migrate:**
```bash
psql $DATABASE_URL -f database/schema.sql
# RLS already enabled on users/profiles/sessions/memberships/fan_cards/orders/payments/support_tickets
# reject_plaintext_password() trigger on users — only $2* bcrypt allowed
```

**Test RLS & trigger:**
```sql
-- should fail:
INSERT INTO users (email,password_hash) VALUES ('x@x.jp','plaintext');
-- ERROR: password_hash must be bcrypt hash
-- RLS: anon cannot SELECT users; service_role bypasses via SECURITY DEFINER API
```

**Connection (pool + RLS context):** `backend/src/db.js` uses `SET LOCAL app.current_user_id` per request, `withRls()` helper.  
**Env:** `DATABASE_URL` with `sslmode=require`, `REDIS_URL` for rate-limit fallback.

**Legacy localStorage bridge:** `public/js/db-adapter.js v2` maps `st_tk_*` → REST:
```
st_tk_news_v2    → /api/cms/news
st_tk_hero_v2    → /api/cms/hero
st_shop_products → /api/products
st_shop_orders   → /api/orders/mine
st_journal       → /api/journal
st_notifications → /api/notifications
...
```
If `meta[name="kimura-api"]` is empty → localStorage demo. If set to `https://api.takuya-kimura.jp` → Postgres.

**Run API:**
```bash
cd backend
cp .env.example .env # fill DATABASE_URL, R2_*, STRIPE_*, SMTP_*
npm i
npm run migrate
npm run dev # :3001
# health
curl http://localhost:3001/health
```

---

## 2) R2/S3 — Real assets (no fake production data)

**Bucket:** `takuya-kimura-prod` (`R2_PUBLIC_BASE=https://assets.takuya-kimura.jp`)  
**Upload:** `POST /api/upload` (admin/editor/shop_manager, 12MB, `image/*` only) → `backend/src/r2.js` `uploadOptimized()`:
- `sharp` WebP variants: `thumb 320`, `sm 640`, `md 960`, `lg 1280`, `og 1200x630`, `blur 20` + `orig`
- `Cache-Control: public, max-age=31536000, immutable`
- `assets` + `asset_variants` + `asset_usages` for rights audit

**CMS:** `cms_hero_slides`, `cms_news`, `works`, `music_releases`, `tours` all reference `assets.id` (never bare URL).  
**Frontend:** `public/image-search/` 10 demo images → `public/images/optimized/*-320/640/960/1280/og.webp` (via `backend/scripts/optimize-images.js` or R2 upload). Prod uses `R2_PUBLIC_BASE + s3_key`.

**Optimize existing:**
```bash
cd backend && npm run optimize:images
# → public/images/optimized/takuya-kimura-live-tour-checkpoint-2026--1-og.webp (84q) etc
```

---

## 3) Production payments — Stripe (no raw card storage)

**Demo `st_tk_payments_v2` removed.**  
**Providers:** `card` (Stripe), `konbini` (Stripe konbini or GMO), `paypay` (Stripe), `manual` (Pay-easy) — all via Stripe `PaymentIntent` / `Checkout Session` + webhook.

**5140 yen flow (入会金1000+年会費4000+事務手数料140):**
```
1. /join/form/ → POST /api/auth/join/request {email} → email with token (24h) → allowlist check
2. /join/complete/?token=xxx → POST /api/auth/join/complete {token,name,address,birthdate} → userId
3. POST /api/payments/join/intent {email, method:card|konbini|paypay} → PI clientSecret
   - card: stripe.confirmCardPayment(clientSecret)
   - konbini/paypay: redirect to Checkout (session.url)
4. Stripe webhook POST /api/payments/webhook (raw body, verify signature, idempotent via payment_webhooks.event_id)
   → INSERT payments (succeeded, webhook_verified=true) → INSERT memberships (pending→active, 1yr from next month 1st) → fan_cards + tour_passports → notifications
```

**Shop checkout:** `POST /api/orders` (reserve inventory `FOR UPDATE`, `quantity - reserved >= qty`) → `POST /api/payments/shop/checkout` → Stripe Checkout `success_url=/shop/?success=ORD-…` → webhook `paid` → `UPDATE orders status=paid` → QR `QR-ORD-…`

**No raw card:** `payments` stores `provider_payment_id (pi_xxx)`, `card_brand/last4` only, never number/CVV. `payment_webhooks` stores `event_id` dedup.

**Env:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_JOIN_PRICE_ID=price_5140`, `SITE_URL`.

---

## 4) Email — fc-member.familyclub.jp allowlist + real delivery

**Transport:** `nodemailer` + SendGrid/SES (`SMTP_HOST`, `SMTP_USER/PASS`), `EMAIL_FROM=no-reply@takuya-kimura.jp`  
**Allowlist:** `EMAIL_ALLOWLIST=fc-member.familyclub.jp,gmail.com,icloud.com,...` — `isAllowedRecipient()` throws if domain not in list (prevents abuse, handles `iCloud/Gmail` delay note from 2025-6-16, `softbank` known issue).

**Templates:** `backend/src/email.js`
- `sendJoinApplicationMail` (STEP2) → `https://takuya-kimura.jp/join/complete/?token=…` (24h, `転送不要`)
- `sendJoinCompletedMail` (memberNo, 2-3wks postal)
- `sendTicketUpdate` (support)

**Dev fallback:** if `NODE_ENV!=production` and SMTP fails, returns `devToken` in JSON for preview.

---

## 5) SEO / i18n

**Primary `ja`, secondary `en`**, `ko/zh` via CMS `site_settings` `i18n.follow_en` (approved translations only, not auto).  
**Each HTML:** `<html lang="ja">`, `data-lang`, `<link rel="alternate" hreflang="ja" href="https://takuya-kimura.jp/PATH">`, `en`, `x-default`, `og:locale ja_JP` + `en_US`, `canonical`, `og:image 1200x630` (`/images/optimized/...-og.webp`), `twitter:card`, `description`, `meta kimura-api`.

**Files:** `public/sitemap.xml` (13 URLs, `lastmod 2026-09-15`, `xhtml:link`), `public/robots.txt` (`Allow: /`, `Sitemap:`, `Disallow: /*?token=`, `Disallow: /api/` except `/api/cms/`), `public/manifest.json` (`start_url "/"`, `maskable`).

**Future ko/zh:** add `hreflang="ko"` etc after translation approval; do not auto-translate.

---

## 6) Media — R2 + WebP

**Source:** `public/image-search/` 10 files (`takuya-kimura-live-tour...gif/jpg/webp/png`) — hero 6 carousel + Checkpoint.  
**Prod:** `backend/scripts/optimize-images.js` (`sharp` 320/640/960/1280/og.webp, `q78-84`, `blur 20`) → `public/images/optimized/` (also uploaded to R2 as `assets/hero/...-og.webp`). `vercel.json` caches `optimized` as `immutable`.

**CMS upload:** hero/news/film/release via `/api/upload` (rights check, `alt_text_ja`, `blurhash`).

---

## 7) QA — Lighthouse

**Accessibility:**
- Drawer `role="dialog" aria-modal="true" aria-hidden="true" aria-label="Navigation menu"` + focus trap (`Tab`/`Shift+Tab`/`Escape`, restore `lastFocus`, `body overflow hidden`), `aria-label="Share on X/Facebook/LINE"` on `𝕏 f L`, `alt="QR for …"`.
- `prefers-reduced-motion` in `site.css` disables `hero-slide`, `reveal`, `marquee`, `live-dot` animations.
- `NEWS` 2→1 col at 680 via CSS `#newsList{grid-template-columns:1fr 1fr} @media(max-width:680px){1fr}`, also 320.
- `lang` toggle `data-lang`, `focus-visible` on `share-btn`.

**Performance:**
- `site.css` 27KB `immutable`, `images/optimized` `immutable`, `hero` `max-height 760`, `will-change` on `reveal`, `loading="lazy"` on gallery (add where needed).

**Test:**
```bash
npx lighthouse https://takuya-kimura.jp --view
# Expect: Accessibility 95+, Performance 90+ (WebP, immutable, no layout shift)
```

---

## 8) Deploy — Vercel (frontend) + Render/Fly (API)

**Frontend (static):** `vercel.json`
```json
{ "cleanUrls": true, "trailingSlash": true,
  "headers": [
    { "source": "/css/site.css", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/images/optimized/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/(.*)", "headers": [{ "key": "Strict-Transport-Security", "value": "max-age=63072000" }] }
  ],
  "rewrites": [{ "source": "/api/:path*", "destination": "https://api.takuya-kimura.jp/api/:path*" }]
}
```
Set `meta kimura-api` at build:
```bash
# Vercel env: NEXT_PUBLIC_API_URL=https://api.takuya-kimura.jp
# or inject:
sed -i 's|<meta name="kimura-api" content=""|<meta name="kimura-api" content="https://api.takuya-kimura.jp"|' public/**/index.html
```

**API (Node 20):** `backend/` `npm start` (`PORT 3001`), `DATABASE_URL`, `REDIS_URL`, `R2_*`, `STRIPE_*`, `SMTP_*`. Health `/health`, webhook `/api/payments/webhook` (raw body before json).

**Env:** copy `backend/.env.example` → `.env`, fill secrets, never commit.

**CI:** `psql $DATABASE_URL -f database/schema.sql` on deploy, `npm run optimize:images` for OG.

---

## Clean Flow (production)

1. **Visit** `/` → hero + `NEWS`/`SCHEDULE`/`REGULAR`/`CM`/`CONCERT/STAGE`/`RELEASE` (R2 `og` WebP, `ja` primary)
2. **Join** `/join/` (benefits, fee =1,000+4,000+140) → `/join/form/` email+terms → `POST /api/auth/join/request` → real mail (allowlist) → `/join/complete/?token=xxx` info+Stripe 5140 (card/konbini/PayPay) → webhook → `memberships active` → `fan_cards` QR + `notifications`
3. **Shop** `/shop/` (R2 products, real `quantity-reserved`) → `addToCart` → `/members/#account` login → `POST /api/orders` (reserve) → Stripe Checkout → webhook `paid` → QR `QR-ORD-…` → `/shop/verify/` `SCAN→VERIFY→COLLECT` (inventory `quantity - reserved` → `sale`)
4. **Support** `/support/` → `POST /api/support` (`TK-…`, `open→closed`) → staff `support:read/write` + `BroadcastChannel` + email `ticket update` → `audit_logs`
5. **Notifications** `/members/#notifications` `In-App/Email/Push` per `tour/music/journal/membership/ticket/merchandise/support` → `PUT /api/notifications/preferences`
6. **Admin** `/admin-panel` (KIMURA ADMIN) 10 roles `super_admin`…`developer` strict perms + `audit_logs` + R2 upload

All `st_*` now via Postgres when `kimura-api` set, else localStorage demo (FRESH v7 wipe preserved).

