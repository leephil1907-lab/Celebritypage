# Takuya Kimura — STARTO Premium Official Site (Motion Edition)

**Rebuilt — motion-driven, premium, isolated admin.**

## Live URLs (E2B Preview)
- **Public Site (motion, membership, booking):** `https://8000-*.e2b.app/` → serves `/home/user/public/index.html`
- **Secure Admin (isolated):** `https://8001-*.e2b.app/` → serves `/home/user/admin-panel/index.html`
  - Admin is **NOT** on the public website — no link in nav/footer, separate origin/port, separate auth.

## Separation
```
Public  : 8000 → /home/user/public/    (index.html + image-search/)
Admin   : 8001 → /home/user/admin-panel/ (index.html)
```
- No `<a href="/admin">` in public code. Admin uses own login, own storage namespace, but shares localStorage keys for live sync (replace with API in production).

## Public — Premium Motion Design
- **Palette:** Editorial black/white (`#0a0a0a`, `#faf8f5`, `#eceae6`) + **lively gold** `#b9975b / #d4b78a` for VIP, warm pearl gradients, gold progress.
- **Motion everywhere:**
  - Preloader with shimmer + gold loader line
  - Header `backdrop-filter` + scroll `scrolled` shadow
  - Marquee ticker (28s infinite) — tour + album + membership
  - Hero 72vh Ken Burns (scale 1.04→1, 6s), parallax on scroll (`translateY(scroll*0.08)`), dots with fill animation, progress bar `linear 5s`, text stagger, side card `heroCardIn`
  - `IntersectionObserver` reveal: `translateY(18px) scale(.98) blur(4px) → none` with `.delay1/2/3`
  - Tier cards `translateY(-6px)` + gold border + glow on hover, featured ribbon
  - Fan Card 3D tilt (`perspective 900px rotateY/X` on mousemove) + shine sweep
  - News row `translateX(2px)` + gold arrow, release card lift + image scale, cm hover lift
  - Buttons with `::before scaleX` fill, drawer `translateX` + backdrop blur
- **Content — rigorously from internet:**
  - Hero images: local `image-search/takuya-*.webp/jpg/gif` (STARTO portrait + Live Tour 2026 Checkpoint Seoul/Taipei) + fallback STARTO official `starto.jp/images/...`
  - About: Wikiwand/Wikipedia biography (1972.11.13, 176cm, O, SMAP 1987→, HERO/Long Vacation/Beautiful Life, Howl's Moving Castle, Judgment, THE SWARM, TOKYO TAXI 2025, Kyojo Requiem 2026)
  - Filmography + Discography dynamic via `localStorage` (admin editable)
- **Navigation — celebrity dropdowns:**
  - `TOP | ARTIST ▾ | NEWS ▾ | LIVE ▾ | FAN CLUB ▾ (mega 2-col) | BOOKING ▾ | RELEASE`
  - Mega menu: Membership Tiers ¥300k—¥1M, Become a Member, Dashboard, Fan Card VIP, Meet & Greet, Benefits
  - Member pill when logged in (avatar + tier), else `Login / Sign Up`
  - Hamburger drawer on <1100px with accordion

## Fan Club & Membership (¥300,000 → ¥1,000,000)
- **4 tiers (fan cards):**
  - SILVER — ¥300,000 / year (entry)
  - GOLD — ¥500,000 / year
  - PLATINUM — ¥750,000 / year (featured, most popular)
  - DIAMOND VIP — ¥1,000,000 / year (ultimate, private)
- Tier grid with live preview Fan Card (holds name, cardNo `TK-48xx`, tier, valid thru 2027.08). Color shifts per tier, 3D tilt + shine.
- Benefits listed, “Choose” → pre-fills signup + toast.
- Storage: `st_member_users` (id, name, email, passHash, tier, cardNo, created), `st_member_current`, `st_tk_tiers_v2` (admin editable pricing).

## Member Auth (modal, 4 tabs)
- **Sign Up:** name, email, password 8+, tier select → instant Fan Card issue (`hash` demo, production bcrypt)
- **Login:** email + password → sets `st_member_current`, header pill
- **Forgot:** email → simulated reset toast (production email link)
- **Dashboard:** shows Fan Card (gradient per tier), tier/valid, bookings list (filtered by email), new booking CTA, logout.
- Validation on all fields, duplicate email check, rate-limit ready.

## Booking — Meet & Greet / Private / Corporate
- **Left:** dark cards for Fukuoka Sep 10 (6 left), Seoul Oct 18, Taipei Nov 13 birthday lottery — each `Book` prefills form.
- **Right:** form `Occasion Type | Date | Guests | Budget (¥300k/500k/750k/1M/Custom) | Name | Email | Message` → saves to `st_bookings` (id, type, date, guests, budget, name, email, msg, status `Pending Review`, ts). Shows `✓ Request sent` + appears in Member Dashboard + Admin → Bookings (status dropdown).
- Auto-fills name/email if logged in.

## Chat — Still premium, isolated
- Floating black launcher + badge, window/bottom sheet, Support Staff identity, quick actions `Fan Club / Booking / Tour`, typing indicator, `BroadcastChannel('st_tk_chat')` sync.

## Admin — Isolated, Special Control
- **URL:** 8001, login `admin@starto.jp / Starto2026!`, rate-limit 5→60s, audit.
- **Nav:** Overview, Content CMS (News, Schedule, Concert, Movie, Discography, Hero, Media, Blog, Fan Club, CM/Regular, Social), Site (JP/EN, SEO, Settings), Support (Live Chat, Quick Replies), **Members & Bookings (NEW)**, System (Users)
- **NEW — Members:** table ID/Name/Email/Tier/CardNo/Joined, edit tier, delete, export CSV, storage `st_member_users`
- **NEW — Bookings:** table Date/Type/Name/Email/Guests/Budget/Status (Pending→Approved/Declined/Completed), delete, clear all, export CSV, `st_bookings`
- **NEW — Fan Card Tiers:** edit price/label per tier, save → `st_tk_tiers_v2` → public reads instantly
- **KPI:** members + bookings now in dashboard.
- All CMS still live-sync to public via `BroadcastChannel('st_tk_sync')`.

## Run Locally
```bash
# Public (8000)
python3 -m http.server 8000 --bind 0.0.0.0 --directory /home/user/public
# Admin  (8001)
python3 -m http.server 8001 --bind 0.0.0.0 --directory /home/user/admin-panel
```

## Production Replace
- Auth: move `hash` → `bcrypt` + HTTP-only JWT + server middleware for `/admin/*`
- Storage: `localStorage` → Postgres/Supabase + S3/Cloudinary for images
- Realtime: `BroadcastChannel` → WebSocket/SSE
- Add CSP/HSTS headers, turn demo creds into env vars.
