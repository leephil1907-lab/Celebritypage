/**
 * server/index.js — the process entry point.
 * Boots the public site (:8000) and the admin console (:8001) on the same SQLite database,
 * opens a session sweep + SSE heartbeat, and self-seeds a fresh database so a clone runs
 * with `npm install && npm start` alone.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { open, getDb, close, ROOT } from './db.js';
import { seed } from './seed.js';
import { createPublicApp } from './app.js';
import { createAdminApp } from './admin.js';
import { heartbeat, clientCount } from './bus.js';
import { sweepSessions, activeSessionCount } from './auth.js';

const PORT = Number(process.env.PORT || 8000);
const ADMIN_PORT = Number(process.env.ADMIN_PORT || 8001);
const HOST = process.env.HOST || '0.0.0.0';

/* ---------- boot ---------- */
open();
const rows = getDb().prepare(`SELECT COUNT(*) AS n FROM settings`).get().n;
if (!rows) {
  console.log('[boot] empty database — seeding content');
  seed();
}
const sweep = setInterval(() => {
  const removed = sweepSessions();
  if (removed) console.log(`[boot] swept ${removed} expired session(s)`);
}, 15 * 60 * 1000);
sweep.unref?.();
const beat = setInterval(() => heartbeat(), 20000);
beat.unref?.();

const publicApp = createPublicApp();
const adminApp = createAdminApp();

const server = publicApp.listen(PORT, HOST, () => {
  console.log(`\n  ● site   http://localhost:${PORT}   (bind ${HOST})`);
  console.log(`  ● admin  http://localhost:${ADMIN_PORT}   admin@starto.jp / Starto2026!`);
  console.log(`  ● db     ${path.relative(ROOT, path.join(ROOT, 'data', 'celebrity.db'))}  •  ${activeSessionCount()} active session(s)\n`);
});
const adminServer = adminApp.listen(ADMIN_PORT, HOST, () => {
  console.log(`[boot] admin console listening on :${ADMIN_PORT}`);
});

for (const kind of ['error']) {
  server.on(kind, (e) => console.error('[public] ' + e.message));
  adminServer.on(kind, (e) => console.error('[admin] ' + e.message));
}

/* ---------- clean shutdown ---------- */
let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\n[boot] ${signal} — closing`);
  clearInterval(sweep);
  clearInterval(beat);
  let left = 2;
  const done = () => { if (--left <= 0) { close(); process.exit(0); } };
  server.close(done);
  adminServer.close(done);
  setTimeout(() => { close(); process.exit(0); }, 1500).unref?.();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => console.error('[boot] unhandled rejection:', e?.message || e));
