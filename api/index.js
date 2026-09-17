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
import { seed } from '../server/seed.js';
import { createCombinedApp } from '../server/host.js';

let app = null;

function boot() {
  open();
  const rows = getDb().prepare('SELECT COUNT(*) AS n FROM settings').get().n;
  if (!rows) seed();
  console.log(`[vercel] site ready — db ${DB_FILE}`);
  return createCombinedApp();
}

export default async function handler(req, res) {
  if (!app) app = boot();
  return app(req, res);
}
