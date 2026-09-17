# Takuya Kimura — STARTO Premium Official Site

**Full-stack edition.** Not a static page set: an Express server, a real SQLite database, session
auth, a REST API, live sync over SSE, a server-rendered admin CMS, and a motion/carousel layer on
top of the editorial design.

```
npm install
npm run db:reset        # schema + demo content (76 rows)
npm run build           # esbuild + css concat → public/js, public/css (hashed)
npm start               # site :8000  ·  admin console :8001
```

| | |
| --- | --- |
| Public site | `http://localhost:8000` |
| Admin console | `http://localhost:8001` — `admin@starto.jp` / `Starto2026!` |
| Demo members | `aiko@example.com`, `marc@example.com`, `yuki@example.com` — password `Starto2026!` |
| Database | `data/celebrity.db` (SQLite, WAL) — `DB_FILE=/tmp/x.db` to override |
| Design tokens | pearl `#fbf6ee` · ink `#0f0e0c` · gold `#c9a86a` · Cormorant Garamond / Inter / Noto Sans JP / JetBrains Mono |

---

## What runs

```
server/
  index.js      boots both apps, auto-seeds an empty DB, sweeps sessions, SSE heartbeat
  app.js        23 public routes + 32 REST endpoints + SSE stream + pjax fragment mode
  admin.js      the console on its own origin: auth, generic CRUD per content type,
                stock, media upload, CSV export, live state feed
  auth.js       sessions (httpOnly cookie), bcrypt password hashing, CSRF guard, throttling
  db.js         better-sqlite3 wrapper: migrations, tx(), insert/update/run, audit()
  content.js    every read the site needs (hero, news, tour, vault, shop, stats, kpis)
  resources.js  the CMS contract: which table, which list columns, which form fields
  i18n.js       ja/en dictionaries — the server renders both, the client never re-implements it
  bus.js        publish/subscribe with a replay buffer, so a late tab still sees the last events
views/          51 EJS templates: layout, partials, sections, pages, admin/*
client/         app.js (bootstrap), site.js (features), carousel.js (engine), motion.js
                (transitions), admin.js (console), css/*.css
public/         built assets + images; served with hash-aware caching
scripts/        build.mjs (esbuild), check.mjs (integrity gate), qa-browser.mjs (Chromium QA)
tests/          app.test.mjs — 25 end-to-end tests against a real booted server
```

Nothing in `client/` is a copy of server truth: pages come from the database, and so do the
fragments the live layer swaps in.

## Features, and where they are enforced

* **Membership** — four tiers (¥300,000 / ¥500,000 / ¥750,000 / ¥1,000,000). Buying a tier opens a
  ticket and issues a fan-card preview; the card stays `pending` until Management approves it in the
  console. A pending card is *shown* to the member and grants *nothing* — `activeMembershipFor()` is
  what the vault, pre-sale rank and shop discount consult.
* **Vault gating** is server-side: `GET /api/vault/:id` withholds the description and returns
  `locked: true` + the tier needed. Locked cards print a truncated teaser, never the payload.
* **Booking → ticket** — `POST /api/bookings` writes the booking and a linked ticket, so the member
  gets one thread to talk in and the console gets one row to work.
* **Shop** — session cart (`/api/cart/*`), stock reserved in a transaction, order number + QR
  (`/api/orders/verify`), collection page, member discount only for active cards.
* **Support chat** — same thread the console answers in; a guest's thread is bound to their session
  token, and reading someone else's thread is a 404, not a 403 (no existence leak).
* **Admin CMS** — every content type in `resources.js` gets list + editor + toggle + delete + CSV;
  a save publishes `content:changed` with the affected sections, and open tabs re-render those
  sections in place (carousel position preserved).
* **i18n** — the language lives on the session (`POST /api/lang`); the server re-renders, and the
  soft navigation keeps `<html lang>` in step.
* **Search** — one SQL `LIKE` sweep across news, works, releases, journal, shop, tour (`/api/search`).

## Motion & carousels

`client/carousel.js` is a single engine with three modes used across the site:

| mode | where | behaviour |
| --- | --- | --- |
| `fade` | hero, about, product media | crossfade + Ken Burns breathing + per-slide `data-c-in` stagger |
| `rail` | news, films, releases, shop | measured, drag/swipe with velocity, per-view responsive |
| `coverflow` | vault | 3D depth, click-through to the gated viewer |

Markers: `[data-carousel]` `[data-c-viewport]` `[data-c-track]` `[data-c-slide]`
`[data-c-prev|-next|-dots|-counter|-toggle]`, attributes `data-c-mode/-interval/-per-view/-gap/-loop/-start/-kenburns`.

`client/motion.js` adds the rest of the transitions: curtain + View Transitions API on navigation
(full-page fallback when unsupported), pjax fragments from `GET /api/section/:name`, scroll reveals,
magnetic buttons, tilt, counters, header tuck, scroll progress — all behind
`prefers-reduced-motion`, which switches animations off but keeps every piece of content visible.
Server-rendered markup never depends on JS to appear.

Live layer: `GET /api/events` (SSE) carries 12 event types — `content:changed`, `stock:changed`,
`cart:changed`, `ticket:created|reply|status|message`, `order:created|collected`, `member:joined`,
`booking:created`, `passport:stamp`, plus a `ping` heartbeat with the connected-client count that
paints the console's live badge.

## Security notes that matter here

CSP without `unsafe-inline` for scripts (so no inline handlers anywhere — enforced by `npm run check`),
`SameSite=Lax` httpOnly session cookie, double-submit CSRF token on every state change (POST forms in
the rendered HTML get their hidden field injected by the render pipeline, so a template can't forget it),
per-IP throttling on login/signup/chat, bcrypt password hashes, and role checks
(`requireMember` → 401, `requireRole('admin')` → 403) on the API as well as the console.

## Verify

```
npm run verify          # build + integrity check + 25 e2e tests   (~3 s)
npm run qa              # 49 Chromium checks: carousels, motion, live sync, mobile, console errors
```

`npm run check` walks every template through `ejs.compile`, resolves every `include`, scans for inline
handlers, matches every client `api()` call to a real route, and (when a server answers on :8000)
sweeps all 16 live routes. `npm run qa` needs Playwright's Chromium; the sandbox has it under
`/home/user/tools`, and `scripts/qa-browser.mjs` imports it from there — point `QA_BASE`/`QA_ADMIN`
elsewhere to run it against another deployment. Screenshots land in `qa/`.

## Deploy

The process needs Node 20+, a writable directory for `data/` and `uploads/`, and nothing else — no
Redis, no Postgres, no build service, no CDN.

```
npm ci --omit=dev      # postinstall runs scripts/build.mjs, so css/js/fonts land in public/
npm start              # site :8000, console :8001 — both bind 0.0.0.0
```

An empty `data/celebrity.db` is created and seeded on first boot, so the pair of commands above is a
complete deploy. Sessions live in SQLite, so a restart does not log members out.

| Variable | Default | Used for |
| --- | --- | --- |
| `PORT` / `ADMIN_PORT` | `8000` / `8001` | public site / console listeners |
| `HOST` | `0.0.0.0` | bind address |
| `DB_FILE` | `data/celebrity.db` | SQLite path (`:memory:` works for tests) |
| `SITE_URL` | empty | absolute origin for canonical, OG, sitemap, robots, hreflang. Empty follows the request host, which is correct on every preview; set it once you have a real domain behind a proxy |
| `BUILD_ID` | content hash | cache-busting token, also written to `public/build.json` |

`settings.site.url` (Admin → Settings → `site.url`) overrides `SITE_URL` when you would rather not
touch the environment. Both are empty in a fresh install on purpose: a hard-coded origin is the usual
reason a staging preview starts emitting production canonicals.

### Container

```
docker build -t starto-site .
docker run -p 8080:8080 -p 8081:8081 -v "$PWD/data:/app/data" -v "$PWD/uploads:/app/uploads" starto-site
# or: docker compose up -d
```

Two stages: production dependencies resolve (and `better-sqlite3` compiles) in the first, the second
runs as `node` on a slim base with no devDependencies and no client source. `HEALTHCHECK` polls
`/healthz`, which answers `{ ok: true, db: "up" }` only when SQLite responds.

### Reverse proxy

Put TLS in front and forward both listeners; the app trusts `X-Forwarded-Proto`/`-For` for secure
cookies and per-IP throttling. SSE (`/api/events`, `/events`) must not be buffered —
`proxy_buffering off;` and a read timeout above the 20 s heartbeat.

### Media

Everything the site renders is in the repository (`public/image-search`, `public/fonts`, `public/uploads`).

* **Fonts** are self-hosted variable faces (Inter, Cormorant Garamond, JetBrains Mono) inlined into the
  built CSS. `npm run fonts` re-subsets them from Google Fonts when you want to change a family — it is
  a build-time step only, and no page loads a CDN.
* **Optional WebP renditions**: drop `public/images/optimized/<source-basename>-{320,640,960,1280}.webp`
  (plus `-og.webp` at 1200×630) and `server/media.js` starts emitting `srcset`/`sizes` and a
  matching `<link rel=preload imagesrcset>` within 30 seconds — no rebuild, no restart. Candidates are
  opened and checked (real WebP, width matches the name); anything else is ignored so a mislabeled file
  cannot make the site softer. The static-era archive shipped such mislabeled files and they are gone.
* **Video**: upload through the console (image *or* video, size-capped per kind) and the field stores a
  `/uploads/...` path. Vault items render a real `<video>` with the transport bar; hero slides and
  journal posts loop muted `mp4/webm` behind the copy. Range requests (`206`/`416`) are implemented for
  uploads, so scrubbing works and Safari is happy.

### Backups

`data/` and `uploads/` are the entire mutable state:

```
sqlite3 data/celebrity.db ".backup 'backup/$(date +%F).db'"   # WAL-safe, unlike cp
tar czf uploads-$(date +%F).tgz uploads/
```

Then `curl -s localhost:8000/api/health` (or `/healthz`) shows `db: "up"` again. The audit runs
against production with `AUDIT_BASE=https://your-domain npm run audit` (`QA_BASE`/`QA_ADMIN` point the browser suite); media 404s are fatal there by design.

### Change the demo credentials

`admin@starto.jp / Starto2026!` and the three seeded members (`aiko|marc|yuki@example.com / Starto2026!`)
are seed data. Rotate them in Admin → Members (or delete those rows) before the site is public.

## Legacy

`legacy/` keeps the pre-server era so nothing is lost: `legacy/static-era/` holds the original static
site (`admin-panel`, the `backend/` Postgres experiment, the root `image-search/` downloads and the old
DEPLOYMENT/PRODUCTION notes), `legacy/static-pages/` and `legacy/public-js/` the earlier hand-written
pages and scripts, `legacy/index.static.html` / `static-home.html` the first mock-ups. The app loads
none of it — `git log`/`git show` still has them at their original paths if you want them back.
