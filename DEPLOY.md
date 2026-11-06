# Deploying STARTŌ

One Docker image, one disk, one process. Nothing is built on the client, no CDN is contacted,
and the database is a file — so the only thing that has to survive a redeploy is the disk.

Files that matter:

| File | Role |
| --- | --- |
| `render.yaml` | Render Blueprint: Docker runtime, `singapore`, 1 GB disk at `/app/data`, health check `/healthz` |
| `Dockerfile` | two-stage `node:20-bookworm-slim`; installs prod deps **with** install scripts, then `npm run build` |
| `docker-entrypoint.sh` | takes ownership of the mounted disk, then drops to the `node` user |
| `.env.example` | every variable the process reads, with the value it expects in production |

## Render (the supported path)

1. **New + → Blueprint**, pick this repository, branch `main`, **Apply**.
2. Fill the two prompted values:
   - `ADMIN_PASSWORD` — the `/admin` login password (any strong value; it is applied on every boot)
   - `SITE_URL` — `https://your-domain`, or leave blank until a custom domain is attached
3. Choose **Starter**. A disk cannot be attached to a free instance.
4. Watch the first build (3–6 min: it compiles `better-sqlite3`). Then confirm, in this order:

```bash
curl -s https://YOUR-SERVICE.onrender.com/healthz        # {"ok":true,…,"db":"up"}
curl -sI https://YOUR-SERVICE.onrender.com/tour/         # 200, Strict-Transport-Security present
curl -s https://YOUR-SERVICE.onrender.com/sitemap.xml    # absolute URLs on your domain
```

Then sign in at `/admin` as `admin@starto.jp` with the password from step 2. If you set
`SITE_URL` after the first deploy, change it in **Environment** and redeploy — canonical links,
Open Graph tags and the sitemap are derived from it.

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | — | set to `production`: https-only cookies, HSTS, demo accounts locked |
| `DATA_DIR` | `./data` | **must** point inside the disk mount (`/app/data`) |
| `UPLOAD_DIR` | `$DATA_DIR/uploads` | admin media uploads; inside the disk |
| `ADMIN_PASSWORD` | generated once | authoritative on every boot; rotate by changing it and redeploying |
| `ADMIN_EMAIL` | `admin@starto.jp` | console identity |
| `SITE_URL` | request host | absolute origin for canonical/OG/JSON-LD/sitemap |
| `PORT` | `8000` | Render injects this |
| `COMBINED` | `0` | `1` = site and console on one origin; `render.yaml` sets it |
| `SEED_DEMO_PASSWORD` | unset | if unset in production, demo members get random passwords and cannot sign in |

## Backups

The database, uploads and exports all live on the disk. Render keeps daily disk snapshots for
7 days; for longer retention, download `/admin/export.csv` and copy `data/*.db` off the instance
periodically. A restore is: stop the service, replace the file, start it.

## Runs anywhere else

```bash
docker build -t starto . && docker run -p 8000:8000 \
  -e NODE_ENV=production -e COMBINED=1 -e ADMIN_PASSWORD='…' -e SITE_URL='https://…' \
  -v starto-data:/app/data starto
```

Any host works if it gives the container a writable volume mounted at `/app/data`
(Fly, Railway, ECS, a VPS with `docker compose up -d`). Without a volume the site works but
resets to the seed on every restart.

Vercel is **not** a fit for this architecture, and that is deliberate: every page holds an SSE
connection for live updates, sessions and carts are rows in SQLite, and `better-sqlite3` is a
native module — all three fight a per-request serverless runtime that wipes `/tmp`.

## Verifying a deployment

```bash
npm run check    # 123 static checks: templates, includes, route sweep, deploy bundle, env contract
npm test         # 40 end-to-end tests against a real server + SQLite
npm run audit    # 299 whole-site checks: links, media, fonts, metadata, sitemap, 6 widths
npm run qa       # 70 Chromium checks: motion, pointer light, carousel, waitlist, console clean
```
