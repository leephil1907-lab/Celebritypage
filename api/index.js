/**
 * api/index.js — the Vercel (and any single-function Node host) entry point.
 *
 * Vercel hands a request to this exported handler instead of running a process, so the database is
 * opened lazily on the first request of a cold instance and a fresh file seeds itself — the same
 * self-seeding boot `npm start` uses. Server-side state (SQLite + uploads) lives on the instance's
 * writable temp directory: attach Vercel Postgres/KV and Blob (or point DB_FILE at a mounted volume
 * on a host that has one) when the data has to survive cold starts.
 */
import { open, getDb, DB_FILE } from '../server/db.js';
import { seed, syncCredentials, credentials } from '../server/seed.js';
import { createCombinedApp } from '../server/host.js';

let app = null;

function boot() {
  open();
  const rows = getDb().prepare('SELECT COUNT(*) AS n FROM settings').get().n;
  if (!rows) seed();
  syncCredentials();
  console.log(`[vercel] site ready — db ${DB_FILE}`);
  /* A serverless instance boots whenever the platform feels like it, so a generated admin password
     exists only in this log line. Set ADMIN_PASSWORD in the project's environment variables to stop
     guessing: that value is authoritative on every boot. */
  if (credentials.admin.source === 'generated') {
    console.log(`[vercel] !! ADMIN_PASSWORD is not set — generated admin login: ${credentials.admin.email} / ${credentials.admin.password} (this instance only; set ADMIN_PASSWORD to fix it)`);
  }
  else if (credentials.admin.source === 'existing') console.log(`[vercel] an admin already exists (${credentials.admin.email}) and ADMIN_PASSWORD is not set — set it to control the console`);
  if (credentials.demo.source === 'locked') console.log('[vercel] demo member accounts are locked (random passwords) — set SEED_DEMO_PASSWORD to enable them');
  return createCombinedApp();
}

export default async function handler(req, res) {
  if (!app) app = boot();
  return app(req, res);
}
