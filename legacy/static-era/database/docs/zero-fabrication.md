# Zero-Fabrication Rule — How it’s enforced

> “Never fabricate official information. Use DATA REQUIRED / ASSET REQUIRED.”

## DB level

- Every content text column defaults to `'DATA REQUIRED'` (or `'ASSET REQUIRED'` for images).
  Example: `works.title DEFAULT 'DATA REQUIRED'`, `works.synopsis DEFAULT 'DATA REQUIRED'`.
- Production `cms_news`, `works`, `music_releases`, `tours`, `events` start **empty**. `schema.sql` inserts no fake tour dates — only `membership_tiers` (pricing) and `roles/permissions` (system).
- Fake data lives only in `seed.dev.sql`, guarded by `current_database() ILIKE '%prod%'` exception. It prefixes titles with `[DEV]`.

## CMS level

- Admin UI shows empty states: “No news yet — add your first item.” / “No schedule — empty state shown on public site.” No placeholders render as real content.
- Image fields require licensed `assets` with `rights_id`. Upload without `rights_id` is blocked in production (warning in dev). Missing asset shows `ASSET REQUIRED` placeholder, not a fake Takuya photo.

## API level

- `GET /api/cms/news?status=published` returns 0 rows in fresh prod — frontend renders empty state, not invented news.
- Search indexes skip `DATA REQUIRED` rows unless `?includePlaceholders` is set (dev only).

## Process

1. Management provides licensed copy + assets → editor pastes into CMS → `status='published'` → live.
2. Until then, staging uses `seed.dev.sql` with `[DEV]` prefix so QA can test layouts without confusing real users.
3. Code review checks: no hardcoded Takuya dates, venues, or lyrics outside `seed.dev.sql`.

This matches the existing site’s `FRESH='v4-no-mocks'` wipe — `localStorage` and Postgres both start blank.
