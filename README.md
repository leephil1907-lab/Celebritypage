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
  host.js       the two composition roots: public-only, and `COMBINED=1` with the console at /admin
  app.js        the public app: every page, the REST endpoints, the SSE stream, pjax fragment mode
  admin.js      the console: auth, generic CRUD per content type, stock, media upload, CSV, live feed
  auth.js       sessions (httpOnly cookie), bcrypt password hashing, CSRF guard, throttling
  db.js         better-sqlite3 wrapper: migrations, tx(), insert/update/run, audit(); `data/` and
                `uploads/` fall back to a writable scratch directory when the mount is read-only
  content.js    every read the site needs (hero, news, tour, vault, shop, stats, kpis), projected
                against the viewer, so a template cannot show what the server means to withhold
  resources.js  the CMS contract: 16 content types — which table, which list columns, which fields
  lib/tourkit.js venue coordinates and the maths behind the countdown, the check-in window,
                the haversine walk from the gate and the projected SVG locator
  i18n.js       ja/en dictionaries — the server renders both, the client never re-implements it
  bus.js        publish/subscribe with a replay buffer, so a late tab still sees the last events
  seed.js, seed-extra.js
                the fiction, generated into any empty database: the full route with setlists and
                past nights, the journal, releases, awards, wall notes, lottery entries, sign-ups
views/          61 EJS templates: layout, partials, sections, pages, admin/*
client/         app.js (bootstrap), site.js (features), carousel.js (engine), motion.js
                (transitions), admin.js (console), css/*.css
public/         built assets + images, served with hash-aware caching; `build.json` is the fingerprint
api/index.js    the Vercel entry point: a lazy boot into the same app, self-seeding on first request
vercel.json     build `npm run build`, output `public`, every non-`/api` path rewritten to `/api`
scripts/        build.mjs (esbuild), check.mjs (integrity gate), audit.mjs (whole-site sweep),
                qa-browser.mjs (Chromium QA), fetch-fonts.mjs (self-hosted brand faces)
tests/          app.test.mjs — 33 end-to-end tests against a real booted server, one of them a
                `COMBINED=1` boot that crawls the console inside the public app
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
* **Tour** — each date carries its own countdown, an `.ics` on demand, a venue check-in window that
  stamps the passport inside it, and (once it has happened) a setlist and photo archive at
  `/tour/show/<slug>`. The fan wall under a night is member-posted and console-moderated; a
  meet-and-greet lottery is entered per night and drawn in the console, which writes the winners and
  audits the draw.
* **"Notify me"** — a date that is not on sale yet takes an address instead of a ticket.
  `notify_list` + `POST /api/tour/notify`, unique per (email, date), throttled per IP, answered by a
  token'd unsubscribe link that works without a session; the honeypot field gets a 201 and no row.
  The console reads and exports the queue but cannot write it, and no part of this is a `mailto`.
* **Venue locator** — real coordinates per venue, projected to inline SVG in
  `views/partials/venue-map.ejs`. No tiles, no third-party request, so it renders under the
  CDN-free CSP and on a plane; the OSM and Google links underneath are for the live map.
* **Priority access is a door, not a label** — `tier_required` on a date decides what a viewer may see:
  presale windows and seat releases are stripped from `/api/tour` and the templates until the session's
  rank clears it, and a visitor with no session is linked to `join/#signup` rather than handed a
  button whose only possible answer is 401.
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
npm run verify          # build + integrity check + 33 e2e tests   (~6 s)
npm run audit           # 299 whole-site checks: links, media, fonts, meta, sitemap, layout at 6 widths
npm run qa              # 61 Chromium checks: carousels, motion, live sync, waitlist, mobile, console
```

Neither browser suite pretends to have run: if Chromium cannot be launched, `npm run qa` exits
non-zero and says what is missing (and `npm run audit` records the skipped stages as a failure) —
`QA_ALLOW_NO_BROWSER=1` / `AUDIT_ALLOW_NO_BROWSER=1` are the opt-outs for a machine that has no
browser by design. `npm run audit` likewise refuses to run against a server that is not up.

`npm run check` (110 checks) walks every template through `ejs.compile`, resolves every `include`,
scans for inline handlers, matches all 31 client `api()` calls to a real route, and — when a server
answers on :8000 — sweeps all 16 live pages. `npm run audit` fetches the rendered site and checks the
things a browser would punish: a 404 image, an upscale past its frame, an off-screen control at any of
six widths, a relative canonical, a dead sitemap entry. Both are gates, not reports: a failure is a
non-zero exit. One of its stages is the deploy bundle itself: it runs `@vercel/nft` over
`api/index.js` — the same trace Vercel uses to decide what a function gets — and fails if a template,
the template engine, the fingerprint file or the native SQLite binding would be left behind. `npm run qa` needs Playwright's Chromium; the sandbox has it under
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
| `COMBINED` | empty | `1` puts the console at `/admin` on the site's own port instead of a second listener |
| `DATA_DIR` / `UPLOAD_DIR` | `data/` / `uploads/` | where state is written; both fall back to the temp dir when the filesystem is read-only |

`settings.site.url` (Admin → Settings → `site.url`) overrides `SITE_URL` when you would rather not
touch the environment. Both are empty in a fresh install on purpose: a hard-coded origin is the usual
reason a staging preview starts emitting production canonicals.

### Vercel

`vercel.json` and `api/index.js` are the deploy path: one Node function runs the same Express app,
`npm run build` regenerates `public/` from `client/` during the build, and the function's
`includeFiles` carries the templates (a single glob — Vercel's schema rejects an array), while `npm run check` traces the function and proves the engine and the native SQLite binding come along too. Import the repository,
accept the defaults (framework: **Other**, build `npm run build`, output `public`), and the site is
live — `/admin` is the desk console on the same origin, which is what `COMBINED=1` does locally too.

Three things are worth knowing before you point anything real at it:

- **Set `SITE_URL`** to the deployment URL (Admin → Settings → `site.url` also works). Canonicals,
  OG tags, the sitemap and JSON-LD are absolute, and a preview domain that emits production
  canonicals is the mistake this avoids.
- **Server-side state is per instance.** Vercel's filesystem is read-only apart from `/tmp`, so the
  SQLite file and uploads land there and are lost when an instance is recycled: content, members and
  waitlist sign-ups start from the seed again. That is fine for a demo, a preview or a read-mostly
  brochure; it is not a database. Attach Vercel Postgres/KV (or run the container image on any host
  with a volume) before treating a write as durable, and note that `POST /api/*` writes will fail
  with a 500 on a function that somehow gets no `/tmp`.
- **Live sync degrades, on purpose.** The console and the site keep an SSE connection open
  (`/api/events`); a serverless function caps how long that can run, so open tabs simply stop
  receiving the "content changed" ping and refresh on navigation. `maxDuration` in `vercel.json`
  sets the ceiling.

Nothing in the build or the runtime reaches for a CDN, a tile server or an image API — the fonts,
icons and photography are all in `public/`, so a deployment with no network access still renders.

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

## Repository housekeeping

The tree contains only what the running site reads: `server/` (the app), `views/` (templates),
`client/` + `public/` (source and built assets), `scripts/` (build, integrity check, audit, browser
QA), `tests/`, and the two deployment paths above.

Removed once the server replaced them, because they were dead weight and nothing referenced them:
`legacy/` (the static-era HTML, its duplicate `image-search/` downloads and the abandoned `backend/`
Postgres experiment), `public/favicon.png` (1.8 MB, unreferenced — `public/favicon.ico` plus
`icon-192/512.png` are what the head and the manifest ask for), the QA screenshots that had been
committed under `qa/` (the browser suite writes them again on every run and they are ignored now), and
four stray `uploads/IMG_*.jpg` that no row and no template pointed at. `git log --stat` and
`git show HEAD~1:legacy` still have all of it; nothing was rewritten or squashed away.
