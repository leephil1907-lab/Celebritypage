# Security & Privacy — Implementation Notes

> Covers §29 AUTHENTICATION + PAYMENTS + SECURITY & PRIVACY from the brief.

## 1) Authentication

- **Registration:** `POST /api/auth/register {email, password, handle}` → `crypt(password, gen_salt('bf'))` → `users.password_hash`. Never log raw password. Create `email_verification_tokens(token_hash = sha256(token))` expiry 24h, send via Resend. Click `GET /api/auth/verify?token=` → set `email_verified_at`, `status='active'`, `audit_logs(LOGIN)`.
- **Login:** `POST /api/auth/login` → `SELECT crypt(input, password_hash) = password_hash` → on success `INSERT sessions(token_hash=sha256(jwt), user_id, ip_hash=sha256(ip), expires_at=now()+30d)` + `devices`. On 5 fails / IP / 15min → 429 + `rate_limit_buckets` + `audit_logs(LOGIN_FAILED)`. Cookie `__Host-session` httpOnly + Secure + SameSite=Lax.
- **Password reset:** `POST /api/auth/forgot` → `password_reset_tokens` (15min, single use, token_hash), email link ` /reset?token=`. `POST /api/auth/reset` checks expiry/consumed, re-hashes.
- **OAuth:** `GET /api/auth/oauth/{provider}` → PKCE → callback upserts `oauth_accounts` (tokens encrypted via `pgp_sym_encrypt(..., $ENCRYPTION_KEY)`), links by verified email or creates `users` with `status='active'`.
- **MFA (admin/support):** `POST /api/auth/mfa/setup` → `mfa_secrets(secret_encrypted)` + QR, verify TOTP → `verified_at`. Login then requires `POST /api/auth/mfa/verify {code}` → sets `session.mfa_verified`. Enforce via middleware: if `user_roles` contains `admin`/`support` and `mfa_secrets.verified_at IS NULL` → block `/admin/*`.
- **Session/device:** `GET /api/auth/sessions` lists, `DELETE /api/auth/sessions/:id` revokes. `devices` trusted flag for “remember this device”.

## 2) Payments (compliant)

- **Never store PAN.** Only `payment_methods.provider_method_id` (`pm_xxx`), `payments.provider_payment_id` (`pi_xxx`), `card_last4`/`brand` from Stripe.
- **Providers:** `stripe` (cards, Apple Pay, Google Pay, Konbini via Stripe), `paypay`, `konbini` (FamilyMart/Lawson), `manual` for concierge.
- **Apple Pay / Google Pay:** Stripe Payment Sheet automatically surfaces them — no extra DB fields besides `method`.
- **Japanese methods:** `paypay` QR, `konbini` voucher — `payments.method` enum covers, expiration handled via `payments.status='pending'` + webhook timeout job.
- **Webhooks:** `POST /api/webhooks/stripe` reads raw body → `stripe.webhooks.constructEvent(body, sig, secret)` → idempotency `payment_webhooks.event_id` unique → `signature_verified=true` → `processed_at=now()` → upsert `payments` + `orders.status`. Same for PayPay HMAC. Always return 200 fast, process async via queue.
- **Refunds:** `POST /api/payments/:id/refund` (RBAC `order:write`) → Stripe refund → `payments.status='refunded'`, `audit_logs`.

## 3) Security & Privacy

- **HTTPS:** Cloudflare → Next.js + HSTS `preload`, `__Host-` cookies, CSP `default-src 'self'; img-src 'self' https://*.r2.cloudflarestorage.com;`.
- **RBAC:** `user_roles` → `role_permissions` → middleware `requirePermission('cms:write')`. Policies: `super_admin` all, `admin` all except user deletion, `editor` cms/media only, `support` support/*, `member` own data only.
- **Rate limiting:** Redis `INCR key window` (5 login / 60s per IP, 20 chat / min per user, 100 api / min). Fallback `rate_limit_buckets` table.
- **Validation:** Zod on every handler, `citext` + CHECK for email, length checks for `support_messages.body`, file type allowlist for `assets.mime` (image/jpeg, png, webp, avif, mp4), max 10MB (configurable), virus scan via ClamAV worker.
- **XSS/SQLi:** Parameterized queries only (`pg` + `$1`), no string concat. React escapes by default, `dangerouslySetInnerHTML` never used for user content. `Content-Security-Policy` + `X-Frame-Options`.
- **Uploads:** Presigned PUT to R2 with `content-length` + `checksum_sha256` check, `assets.status='uploading' → 'ready'` after worker validates, virus scan, generates `asset_variants`.
- **Encryption:** At rest: Postgres `pgcrypto` `pgp_sym_encrypt` for `mfa_secrets.secret_encrypted`, `oauth_accounts` tokens, `fan_cards.qr_token_hash` is sha256 only. In transit: TLS everywhere. Secrets in Cloudflare Workers Secrets / Vault, never in repo.
- **Audit:** Every write → `audit_logs(actor_user_id, action, entity_type, entity_id, diff jsonb {before,after}, ip_hash)`. Immutable, append-only, shipped to Loki/S3.
- **Privacy:** `users.data_export_requested_at` → `GET /api/me/export` dumps `users, profiles, memberships, orders, support_tickets` as JSON + assets zip. `DELETE /api/me` → sets `deletion_requested_at`, 30d grace, then anonymizes (`email=deleted+<uuid>@example.invalid`, `password_hash='deleted'`, `profiles` cleared) but retains `audit_logs` + `payments` for legal hold. Consent checkbox on register, privacy page links.
- **Backups:** Daily `pg_dump` + WAL archiving (PITR 7d), R2 versioned, tested restore monthly, encrypted with KMS.

## 4) RLS

Enabled on `users, profiles, sessions, memberships, fan_cards, orders, payments, support_tickets`. App uses service role (bypass RLS) + explicit checks. For Supabase-style JWT, add:

```sql
CREATE POLICY "own_profile" ON profiles FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "own_membership" ON memberships FOR SELECT USING (user_id = auth.uid());
```

Current `database/schema.sql` leaves policies permissive for service role — tighten when you choose Supabase/Auth.js JWT shape.

## 5) Monitoring

- `pg_stat_statements` + slow query log >200ms
- Sentry for API errors, Web Vitals for frontend
- Uptime: Cloudflare + Health `/api/health` checks `SELECT 1`, Redis ping, R2 head

