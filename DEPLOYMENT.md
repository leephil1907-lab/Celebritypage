# Deployment — Celebritypage (Takuya Kimura STARTO Site)

## Repo
https://github.com/leephil1907-lab/Celebritypage.git
Branch: `main` — static site in `/public`, API in `/backend`

## Where did `takuya-kimura.jp` come from?
`https://takuya-kimura.jp` and `https://api.takuya-kimura.jp` are **placeholder canonical domains** we invented for the project because the brief is a premium official site for Takuya Kimura (STARTO ENTERTAINMENT). They are NOT scraped. They appear in:
- `<link rel="canonical">` / `og:image` / `hreflang` tags
- `sitemap.xml` / `robots.txt`
- `<meta name="kimura-api" content="https://api.takuya-kimura.jp">`
- `vercel.json` rewrite `/api/* → https://api.takuya-kimura.jp/api/*`
- `PRODUCTION.md` and backend `.env.example` (`SITE_URL`, `API_URL`, `R2_PUBLIC_BASE`)

**If you own a different domain (e.g. Vercel `celebritypage.vercel.app` or `celebritypage.com`), we will replace all occurrences in one pass before DNS cutover.** Tell me the final domain and I will run the replacement + regenerate sitemap/robots and set `SITE_URL` env.

## Vercel — Best deployment setup (zero-build static)

### 1) Import project
- Vercel → Add New Project → Import `leephil1907-lab/Celebritypage`
- Framework Preset: **Other** (no build)
- Root Directory: `./` (repo root)
- Build Command: *(empty)*
- Output Directory: `public`  ← set this in Vercel dashboard → Settings → Build & Development Settings
- Install Command: *(empty)*

> Why `public`? The live site is `/public/...` (E2B preview served `public` on :8000). Vercel automatically serves `public/` at `/` — `public/css/site.css` → `https://your-domain/css/site.css`. Headers in `vercel.json` already match this layout.

### 2) Environment (only if backend deployed)
Frontend needs no env. Backend (`/backend`) is separate service — deploy to Render/Fly/Railway or Vercel Function with:
```
DATABASE_URL=postgres://...
R2_PUBLIC_BASE=https://assets.takuya-kimura.jp
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_JOIN_PRICE_ID=price_5140
SMTP_HOST / SMTP_USER / SMTP_PASS
SITE_URL=https://takuya-kimura.jp  # → change to final domain
```

### 3) Headers / security
`vercel.json` already sets:
- `Cache-Control: immutable` for `/css/site.css` + `/images/optimized/*`
- `HSTS`, `X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin`

### 4) After first deploy
- Vercel gives `https://celebritypage-xxx.vercel.app`
- Test: `/`, `/work/`, `/music/`, `/tour/`, `/shop/`, `/join/form/`, `/shop/verify/`
- Shop `getProducts()` will return `[]` (empty, no demo) until API live — shows “Products are not yet published” (production-only mode `v8-production-no-demo`)
- Join `POST /api/auth/join/request` will show “Deploying — API not configured” until backend live (no localStorage demo user)

### 5) Custom domain
- Vercel → Settings → Domains → Add `takuya-kimura.jp` (or your domain)
- Add DNS `A`/`CNAME` as instructed, then replace canonicals:
```bash
# I will run this for you when you confirm domain:
grep -r "takuya-kimura.jp" public/ --include="*.html" --include="*.xml" --include="*.txt"
# sed replace to new domain + regenerate sitemap
```

## Local preview (same as Vercel output)
```bash
python3 -m http.server 8000 --bind 0.0.0.0 --directory /home/user/public
# open http://localhost:8000
```

## Git push with token (we used for this deploy)
```bash
git remote add origin https://ghp_*** (your private token - not committed)@github.com/leephil1907-lab/Celebritypage.git
git push -u origin main
# Token is temporary — revoke after deploy and switch to Vercel Git integration (recommended)
```

## Next steps for you
1. Confirm final domain (keep `takuya-kimura.jp` or use `celebritypage.vercel.app` / custom?)
2. Decide backend host for `api.takuya-kimura.jp` (or keep shop/join in “deploying” empty state until ready)
3. I will do find-replace + push again on your call.
