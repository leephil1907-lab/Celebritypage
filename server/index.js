/**
 * server/index.js — the process entry point.
 * Boots the public site (:8000) and the admin console (:8001) on the same SQLite database,
 * opens a session sweep + SSE heartbeat, and self-seeds a fresh database so a clone runs
 * with `npm install && npm start` alone.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { open, getDb, close, ROOT, DB_FILE, STATE_ON_SCRATCH } from './db.js';
import { seed, syncCredentials, credentials } from './seed.js';
import { createApps, COMBINED } from './host.js';
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
syncCredentials();
/* Four different people run this: the fixture password exists for the suites, an operator's env var
   is authoritative, and a production boot with no ADMIN_PASSWORD gets a generated one that is shown
   once — here, and nowhere else. */
const creds = credentials.admin;
let credLine = '';
if (creds.source === 'dev-default') credLine = `admin@starto.jp / Starto2026! (development fixture — set ADMIN_PASSWORD before deploying)`;
else if (creds.source === 'env') credLine = `${creds.email} (password from ADMIN_PASSWORD)`;
else if (creds.source === 'generated') credLine = `${creds.email} / ${creds.password} — GENERATED for this database, shown once. Set ADMIN_PASSWORD and restart to choose your own.`;
else credLine = `${creds.email} (password unchanged — set ADMIN_PASSWORD to take control)`;
if (creds.source === 'generated') console.log(`\n  ! no ADMIN_PASSWORD was set, so one was generated:\n    ${creds.email} / ${creds.password}\n    copy it now — it is not stored anywhere in readable form\n`);
else if (creds.source === 'existing') console.log(`\n  ! this database already has an admin (${creds.email}) and ADMIN_PASSWORD is not set.\n    The stored password is unchanged and cannot be read back — set ADMIN_PASSWORD to take control.\n`);
if (credentials.demo.source === 'locked') console.log('  ! demo member accounts were seeded with random passwords (set SEED_DEMO_PASSWORD to use them)\n');
const sweep = setInterval(() => {
  const removed = sweepSessions();
  if (removed) console.log(`[boot] swept ${removed} expired session(s)`);
}, 15 * 60 * 1000);
sweep.unref?.();
const beat = setInterval(() => heartbeat(), 20000);
beat.unref?.();

const { app: publicApp, adminApp, mount } = createApps();

const server = publicApp.listen(PORT, HOST, () => {
  console.log(`\n  ● site   http://localhost:${PORT}   (bind ${HOST})`);
  console.log(COMBINED
    ? `  ● admin  http://localhost:${PORT}${mount}/   ${credLine} (single origin)`
    : `  ● admin  http://localhost:${ADMIN_PORT}   ${credLine}`);
  console.log(`  ● db     ${path.relative(ROOT, DB_FILE) || DB_FILE}  •  ${activeSessionCount()} active session(s)`);
  if (STATE_ON_SCRATCH) console.log('  ● note   the repo data/ dir is not writable here — state lives in the temp dir for this process');
  console.log('');
});
const adminServer = adminApp ? adminApp.listen(ADMIN_PORT, HOST, () => {
  console.log(`[boot] admin console listening on :${ADMIN_PORT}`);
}) : null;
if (adminServer) adminServer.on('error', (e) => console.error('[admin] ' + e.message));
server.on('error', (e) => console.error('[public] ' + e.message));

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
  if (adminServer) adminServer.close(done); else { left -= 1; }
  setTimeout(() => { close(); process.exit(0); }, 1500).unref?.();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => console.error('[boot] unhandled rejection:', e?.message || e));
