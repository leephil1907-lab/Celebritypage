# Takuya Kimura — STARTO Premium Official Site

**Full-stack edition.** Not a static page set: Express + SQLite + EJS on the server, session auth, a
REST API, SSE live sync, a server-rendered admin CMS, and a motion/carousel layer over the editorial
design. No CDN, no Redis, no Postgres, no build service.

```
npm install
npm run db:reset        # schema + demo content
npm run build           # esbuild + css concat → public/js, public/css (hashed)
npm start               # site :8000 · console :8001
```

| | |
| --- | --- |
| Public site | `http://localhost:8000` |
| Admin console | `http://localhost:8001` — `admin@starto.jp / Starto2026!` (development only — see *Credentials*) |
| Demo members | `aiko@` / `marc@` / `yuki@example.com`, same fixture password |
| Database | `data/celebrity.db` (SQLite, WAL) |
| Tokens | pearl `#fbf6ee` · ink `#0f0e0c` · gold `#c9a86a` · Cormorant Garamond / Inter / JetBrains Mono |

## What runs

```
server/index.js       boots both apps, auto-seeds an empty DB, sweeps sessions, SSE heartbeat
server/host.js        composition roots: site alone, and COMBINED=1 with the console at /admin
server/app.js         pages, REST, SSE, pjax fragments      server/admin.js   console: CRUD, stock, media, CSV
server/auth.js        httpOnly sessions, bcrypt, CSRF, throttling
server/db.js          migrations, tx(), audit(); data/ and uploads/ fall back to a writable scratch dir
server/content.js     every read, projected against the viewer, so a template cannot show what the
                      server means to withhold        server/lib/tourkit.js  venue coordinates, countdown
views/                61 EJS templates      client/  carousel + motion + features      public/  built assets
api/index.js          the Vercel entry point (lazy boot into the same app)
vercel.json · render.yaml                            the two deployment paths
scripts/              build, check, audit, qa-browser, fetch-fonts        tests/  35 end-to-end tests
```

## Features, and where they are enforced

* **Membership** — four tiers (¥300k–¥1M). A purchase opens a ticket and issues a *pending* fan card;
  pending is shown to the member and grants nothing, because `activeMembershipFor()` is what the vault,
  the presale rank and the shop discount consult.
* **Vault gating is server-side** — a locked item returns `locked: true` plus the tier needed, never the
  payload; the card prints a teaser.
* **Shop** — session cart, stock reserved in a transaction, order number + QR verification, member
  discount only on active cards.
* **Tour** — per-date countdown, `.ics` on demand, a venue check-in window that stamps the passport,
  a per-show archive once the night has happened, a member-posted/console-moderated fan wall, and a
  meet-and-greet lottery entered per night and drawn (and audited) in the console.
* **"Notify me"** — a date that is not on sale takes an address instead of a ticket: real table + API,
  unique per (email, date), IP-throttled, a token'd unsubscribe that works without a session, a
  honeypot that gets a 201 and writes nothing. The console reads and exports the queue but cannot write
  it, and no part of it is a `mailto`.
* **Venue locator** — real coordinates projected to inline SVG. No tiles, no third-party request, so it
  renders under the CDN-free CSP.
* **Priority access is a door, not a label** — presale windows and seat releases are stripped from
  `/api/tour` and the templates until the session's rank clears it; anonymous visitors get `join/#signup`
  instead of a button whose only answer is 401.
* **Support chat, admin CMS, i18n, search** — one thread the console answers in (a guest's thread is
  bound to their session; someone else's is a 404, not a 403); 16 content types with list/editor/toggle/
  delete/CSV, where a save publishes `content:changed` and open tabs re-render that section in place.

## Motion & the interaction layer

One carousel engine (`fade` / `rail` / `coverflow`) with `data-c-*` markers drives hero, rails and the
vault; navigation uses the View Transitions API with a full-page fallback; reveals, counters, tilt,
header tuck and scroll progress come from one `IntersectionObserver`. The cards answer the pointer *and*
the keyboard — a gold light that follows the cursor, a rim on `:focus-within`, a masked aura behind the
countdown, a sheen on dates that have not played, and hero calls to action that lean toward the pointer.
All of it is paint: one `pointermove` per card, no library, no request, and all of it stops under
`prefers-reduced-motion` while leaving every element exactly where it was. Server-rendered markup never
needs JS to appear. Live sync is `GET /api/events` (SSE): 12 event types plus a heartbeat with the
connected-client count.

## Verify

```
npm run verify   # build + integrity check + 35 e2e tests                                  (~10 s)
npm run audit    # 299 whole-site checks: links, media, fonts, meta, sitemap, layout at 6 widths
npm run qa       # 70 Chromium checks: carousels, motion, pointer light, magnet, waitlist, mobile, console
```

`check` (119 checks) compiles every template through `ejs.compile`, resolves every `include`, matches
every client `api()` call to a real route, sweeps the live pages when a server answers, and runs a
deploy-bundle stage that traces `api/index.js` with `@vercel/nft` — failing if a template, the engine,
the fingerprint file or the native SQLite binding would be left out of the function. `audit` fetches the
rendered site and punishes what a browser would: a 404 image, an upscale past its frame, an off-screen
control at any of six widths, a relative canonical, a dead sitemap entry. All three are gates, not
reports. The browser suites refuse to pass by skipping: if Chromium cannot launch, `qa` exits 1 with the
reason (`QA_ALLOW_NO_BROWSER=1` is the explicit opt-out) and `audit` records the skipped stages as a
failure. `AUDIT_BASE` / `QA_BASE` / `QA_ADMIN` point them at any deployment; screenshots land in `qa/`.

## Deploy

Node 20+, a writable `data/` and `uploads/`, and nothing else.

```
npm ci --omit=dev      # postinstall runs scripts/build.mjs, so public/ is built
npm start
```

An empty database is created and seeded on first boot, so those two commands are a complete deploy.
Sessions live in SQLite, so a restart does not log members out.

### Environment

`.env.example` lists all 26 variables the code reads, and `npm run check` fails if that file drifts in
either direction — a variable the code reads but the file omits, or one it documents that nothing reads.

| Variable | Default | Used for |
| --- | --- | --- |
| `PORT` / `ADMIN_PORT` | `8000` / `8001` | public site / console listeners |
| `HOST` | `0.0.0.0` | bind address |
| `COMBINED` | empty | `1` puts the console at `/admin` on the site's own port (one origin) |
| `DATA_DIR` / `UPLOAD_DIR` | `data/` / `uploads/` | where state is written; both fall back to the temp dir on a read-only filesystem |
| `DB_FILE` | `<DATA_DIR>/celebrity.db` | SQLite path (`:memory:` works) |
| `SITE_URL` | empty | absolute canonical/OG/sitemap/hreflang; empty follows the request host, which is right on every preview. `site.url` in Admin → Settings overrides it |
| `ADMIN_PASSWORD` / `ADMIN_EMAIL` | empty | console credentials — authoritative on every boot |
| `SEED_DEMO_PASSWORD` | empty | unlocks the seeded member accounts on a production build |
| `BUILD_ID` | content hash | cache-busting token, also written to `public/build.json` |

### Vercel

`vercel.json` + `api/index.js`: one Node function runs the same Express app, `npm run build` regenerates
`public/`, and `includeFiles` carries the templates — a single glob, because Vercel's schema rejects an
array. The check traces the function to prove the engine and the native SQLite binding come along.
Import the repository, accept the defaults (framework **Other**), deploy. Two things to know: **set
`SITE_URL`**, and remember the function filesystem is read-only apart from `/tmp` — SQLite and uploads
land there and reset when an instance is recycled, so this path is a preview or a read-mostly brochure,
not durable storage. SSE degrades instead of erroring when a function is capped.

### A host with a disk

For state that survives, use a host that can mount a volume. `render.yaml` is a working blueprint:
Dockerfile, `/healthz` probe, 1 GB disk at `/app/data`, `DATA_DIR`/`UPLOAD_DIR` on it, `COMBINED=1`, and
secrets as `sync: false` so the host asks for them instead of storing them. The check verifies that the
mount and `DATA_DIR` agree, that the health check is a route the app actually serves, and that no
password value is committed to the blueprint.

```
docker build -t starto-site .          # or: docker compose up -d
```

Two stages: production dependencies (and the `better-sqlite3` compile) in the first, a slim `node`
runtime with no devDependencies in the second. Behind a reverse proxy, forward both ports, trust
`X-Forwarded-Proto`/`-For`, and switch buffering off for SSE (`proxy_buffering off;`, read timeout above
the 20 s heartbeat).

### Media and backups

Fonts are self-hosted variable faces inlined into the built CSS (`npm run fonts` re-subsets them — build
time only, and no page loads a CDN). WebP renditions are optional: drop
`public/images/optimized/<name>-{320,640,960,1280}.webp` and `server/media.js` starts emitting
`srcset`/`sizes` within 30 seconds, with candidates opened and validated so a mislabeled file cannot
soften the site. Uploads support range requests, and `data/` + `uploads/` are the entire mutable state:

```
sqlite3 data/celebrity.db ".backup 'backup/$(date +%F).db'"   # WAL-safe, unlike cp
tar czf uploads-$(date +%F).tgz uploads/
```

### Credentials

The fixture password is a development convenience and this repository is public, so the code refuses to
let it become a deployment:

* `ADMIN_PASSWORD` set — **authoritative on every boot**, not just the first: change it, restart, you are
  in, and the old password stops working.
* Production without it, empty database — a random password is generated and printed **once** in the boot
  log; set the variable and restart to choose your own.
* Production without it, admin already exists — the boot line says the stored password is unchanged and
  cannot be read back, and asks you to set the variable. It never invents one.
* The three seeded members are locked (random passwords) in production until `SEED_DEMO_PASSWORD` is set;
  their orders, tickets and memberships still exist, because the seeded content references them.
* Development keeps `Starto2026!`, so `npm start` and the suites work with no setup.

`npm test` proves all five.

## Housekeeping

The tree contains only what the running site reads: `server/`, `views/`, `client/`, `public/`,
`scripts/`, `tests/`, and the deployment files. The static-era `legacy/`, the unreferenced 1.8 MB
`favicon.png`, committed QA screenshots and four stray uploads are gone — `git log --stat` still has
them, and nothing was rewritten.
