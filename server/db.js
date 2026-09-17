/**
 * server/db.js — SQLite (better-sqlite3) data layer.
 * Real persistence: members, sessions, carts, tickets, bookings, orders, CMS content, audit log.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
/**
 * Some hosts (Vercel, CI sandboxes) hand the function a read-only filesystem and only /tmp is
 * writable. A state directory that cannot be written must not stop the site from booting, so the
 * data dir and the upload dir each fall back to a single scratch root and say so on the console.
 */
/**
 * Never create first: a directory that already exists but cannot be written (the read-only task
 * dir on Vercel) is answered by one access() call, and mkdir is only tried for a path that is
 * simply missing. On an odd virtual filesystem mkdir can block, so it is the last resort.
 */
function usableDir(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch (e) {
    if (!e || e.code !== 'ENOENT') return false;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

const SCRATCH = path.join(os.tmpdir(), 'starto-celebritypage');
const WANTED_DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const WANTED_UPLOADS = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
export const DATA_DIR = usableDir(WANTED_DATA) ? WANTED_DATA : path.join(SCRATCH, 'data');
export const UPLOAD_DIR = usableDir(WANTED_UPLOADS) ? WANTED_UPLOADS : path.join(SCRATCH, 'uploads');
const DB_FILE = process.env.DB_FILE && usableDir(path.dirname(process.env.DB_FILE))
  ? process.env.DB_FILE
  : path.join(DATA_DIR, 'celebrity.db');
/** true when state cannot live in the repo — the boot line says so out loud */
export const STATE_ON_SCRATCH = DATA_DIR.startsWith(SCRATCH) || UPLOAD_DIR.startsWith(SCRATCH);

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',          -- member | admin
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  lang TEXT NOT NULL DEFAULT 'ja',
  cart TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL,
  card_no TEXT NOT NULL,
  price_yen INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending | active | expired | cancelled
  ticket_id INTEGER,
  issued_at TEXT,
  valid_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id, status);

CREATE TABLE IF NOT EXISTS tiers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tagline TEXT,
  price_yen INTEGER NOT NULL,
  icon TEXT,
  accent TEXT,
  perks TEXT NOT NULL DEFAULT '[]',             -- json array
  featured INTEGER NOT NULL DEFAULT 0,
  rank INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hero_slides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kicker TEXT, title TEXT, subtitle TEXT,
  image TEXT NOT NULL, alt TEXT,
  cta_label TEXT, cta_href TEXT,
  tone TEXT DEFAULT 'light',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL,
  body TEXT, image TEXT, url TEXT,
  status TEXT NOT NULL DEFAULT 'published',     -- draft | published
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_news_pub ON news(status, date DESC);

CREATE TABLE IF NOT EXISTS schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  starts_on TEXT NOT NULL, starts_at TEXT,
  title TEXT NOT NULL, meta TEXT, kind TEXT,
  link TEXT, status TEXT NOT NULL DEFAULT 'published', sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                           -- movie | drama | radio | magazine | cm | regular
  title TEXT NOT NULL, role TEXT, meta TEXT, description TEXT,
  image TEXT, release_date TEXT, year TEXT,
  status TEXT NOT NULL DEFAULT 'published', sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_works_kind ON works(kind, status);

CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                           -- album | single | vinyl
  title TEXT NOT NULL, artist TEXT DEFAULT 'Takuya Kimura',
  release_date TEXT, cover TEXT, blurb TEXT,
  tracks TEXT NOT NULL DEFAULT '[]',
  price_yen INTEGER, product_sku TEXT,
  status TEXT NOT NULL DEFAULT 'published', sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tour_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tour TEXT NOT NULL, date TEXT NOT NULL, time TEXT,
  city TEXT NOT NULL, venue TEXT, note TEXT,
  capacity INTEGER DEFAULT 20, remaining INTEGER DEFAULT 20,
  tier_required TEXT, status TEXT NOT NULL DEFAULT 'on_sale', sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notify_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  tour_date_id INTEGER REFERENCES tour_dates(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tier_hint TEXT,                                  -- what they said they are, free text from the form
  source TEXT NOT NULL DEFAULT 'site',             -- site | kiosk | admin
  token TEXT NOT NULL UNIQUE,                      -- one-click unsubscribe, no login needed
  status TEXT NOT NULL DEFAULT 'subscribed',       -- subscribed | unsubscribed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  unsubscribed_at TEXT,
  UNIQUE (email, tour_date_id)
);
CREATE INDEX IF NOT EXISTS idx_notify_date ON notify_list(tour_date_id, status);
CREATE INDEX IF NOT EXISTS idx_notify_email ON notify_list(email);

CREATE TABLE IF NOT EXISTS vault_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL, title TEXT NOT NULL, description TEXT, image TEXT,
  min_tier TEXT NOT NULL DEFAULT 'silver',      -- silver | gold | platinum | diamond
  duration TEXT, streams INTEGER DEFAULT 0, likes INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published', sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS journal_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL, title TEXT NOT NULL, excerpt TEXT, body TEXT,
  image TEXT, published_at TEXT NOT NULL, read_minutes INTEGER DEFAULT 3,
  visibility TEXT NOT NULL DEFAULT 'public',     -- public | members
  status TEXT NOT NULL DEFAULT 'published', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS archive_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year TEXT NOT NULL, era TEXT, title TEXT NOT NULL, description TEXT,
  image TEXT, metric TEXT, sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE, title TEXT NOT NULL, category TEXT NOT NULL,
  price_yen INTEGER NOT NULL, stock INTEGER NOT NULL DEFAULT 0,
  image TEXT, images TEXT NOT NULL DEFAULT '[]', blurb TEXT,
  member_discount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email TEXT, total_yen INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'paid',          -- paid | ready | collected | cancelled
  pickup_venue TEXT, qr TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL, product_sku TEXT NOT NULL, title TEXT NOT NULL,
  qty INTEGER NOT NULL, unit_price INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items ON order_items(order_no);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL, email TEXT NOT NULL,
  type TEXT NOT NULL, date TEXT NOT NULL,
  guests INTEGER NOT NULL DEFAULT 1, budget_yen INTEGER,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'Pending Review', -- Pending Review | Approved | Declined | Completed
  ticket_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  email TEXT, name TEXT,
  subject TEXT NOT NULL, category TEXT DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'open',          -- open | in_progress | waiting | resolved | closed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  session_token TEXT                       -- guest chats are owned by the session, members by user_id
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,                         -- user | staff
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ticket_messages ON ticket_messages(ticket_id, id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT, kind TEXT,
  read_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT, label TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  icon TEXT, value TEXT NOT NULL, label TEXT, note TEXT, sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT, action TEXT NOT NULL, entity TEXT, detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
/* ---------- live-show archive: setlist, gallery, the report ---------- */
CREATE TABLE IF NOT EXISTS shows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  tour TEXT NOT NULL,
  date TEXT NOT NULL,                              -- YYYY.MM.DD (site convention)
  city TEXT NOT NULL, venue TEXT,
  capacity INTEGER DEFAULT 0, attended INTEGER DEFAULT 0,
  duration_min INTEGER DEFAULT 120,
  setlist TEXT NOT NULL DEFAULT '[]',               -- JSON array of song titles
  encore TEXT,
  gallery TEXT NOT NULL DEFAULT '[]',               -- JSON array of /image-search paths
  report TEXT, note TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_shows_date ON shows(date DESC, status);

/* ---------- fan wall: notes from members, published only after review ---------- */
CREATE TABLE IF NOT EXISTS fan_wall (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,                                 -- null for seeded editorial notes
  name TEXT NOT NULL, city TEXT, mood TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',          -- pending | approved | rejected
  applause INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  reply TEXT,                                      -- a note back from the fan club desk
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT, reviewed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_wall_pub ON fan_wall(status, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS fan_wall_claps (
  wall_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (wall_id, user_id)
);

/* ---------- meet & greet lotteries: entries, then a reproducible draw ---------- */
CREATE TABLE IF NOT EXISTS raffles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, prize TEXT,
  tour_date_id INTEGER, show_id INTEGER,
  tier_min TEXT NOT NULL DEFAULT 'silver',
  winners INTEGER NOT NULL DEFAULT 5, alternates INTEGER NOT NULL DEFAULT 3,
  opens_at TEXT, closes_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',              -- open | closed | drawn | cancelled
  seed TEXT, drawn_at TEXT, note TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS raffle_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raffle_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  code TEXT NOT NULL, ticket_ref TEXT,
  status TEXT NOT NULL DEFAULT 'entered',           -- entered | winner | alternate | missed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (raffle_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_entries_raffle ON raffle_entries(raffle_id, status);

/* ---------- tour passport: a stamp is a record, not a decoration ---------- */
CREATE TABLE IF NOT EXISTS passport_stamps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tour_date_id INTEGER, show_id INTEGER,
  city TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'venue',             -- venue | desk | import
  stamped_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, tour_date_id)
);
CREATE INDEX IF NOT EXISTS idx_stamps_user ON passport_stamps(user_id, stamped_at DESC);
`;

let db;
export function open() {
  if (db) return db;
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** additive column migrations so an existing data/celebrity.db upgrades in place */
function migrate(handle) {
  const addIf = (table, column, decl) => {
    const cols = handle.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) handle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  };
  // optional video slots: an ambient loop on a hero slide, a private clip in the vault
  addIf('hero_slides', 'video_url', 'TEXT');
  addIf('vault_items', 'video_url', 'TEXT');
  addIf('vault_items', 'video_kind', "TEXT NOT NULL DEFAULT 'clip'");
  addIf('tickets', 'session_token', 'TEXT');
  addIf('news', 'sort', 'INTEGER NOT NULL DEFAULT 0');
  addIf('journal_posts', 'sort', 'INTEGER NOT NULL DEFAULT 0');
  // the live-show features: a door code to check in against and a doors-open time
  addIf('tour_dates', 'checkin_code', 'TEXT');
  addIf('tour_dates', 'doors_at', 'TEXT');
  addIf('tour_dates', 'setlist_teaser', 'TEXT');
  // where the room is (a locator map needs numbers) and when each window opens
  addIf('tour_dates', 'lat', 'REAL');
  addIf('tour_dates', 'lng', 'REAL');
  addIf('tour_dates', 'presale_at', 'TEXT');
  addIf('tour_dates', 'on_sale_at', 'TEXT');
  handle.exec(`CREATE INDEX IF NOT EXISTS idx_tickets_session ON tickets(session_token)`);
}

export function getDb() {
  return db || open();
}

export function reset() {
  close();
  for (const suffix of ['', '-wal', '-shm']) {
    const f = DB_FILE + suffix;
    if (fs.existsSync(f)) fs.rmSync(f);
  }
  console.log('[db] removed', DB_FILE);
  open();
}

export function close() {
  if (db) { db.close(); db = undefined; }
}

/* ---------- query helpers ---------- */
export const all = (sql, params = {}) => getDb().prepare(sql).all(params);
export const get = (sql, params = {}) => getDb().prepare(sql).get(params);
export const run = (sql, params = {}) => getDb().prepare(sql).run(params);
export const tx = (fn) => getDb().transaction(fn)();   // runs immediately, returns the callback value

export function tableEmpty(name) {
  const row = get(`SELECT COUNT(*) AS n FROM ${name}`);
  return !row || row.n === 0;
}

export function insert(table, obj) {
  const keys = Object.keys(obj);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((k) => ':' + k).join(',')})`;
  return getDb().prepare(sql).run(obj);
}

export function update(table, id, obj, idCol = 'id') {
  const keys = Object.keys(obj);
  if (!keys.length) return { changes: 0 };
  const sets = keys.map((k) => `${k} = @${k}`).join(', ');
  return getDb().prepare(`UPDATE ${table} SET ${sets} WHERE ${idCol} = @__id`).run({ ...obj, __id: id });
}

export function audit(actor, action, entity, detail) {
  insert('audit_logs', { actor: actor || 'system', action, entity: entity || null, detail: detail ? String(detail).slice(0, 500) : null });
}

export { DB_FILE };

/* CLI: node server/db.js --reset */
if (process.argv[1] && process.argv[1].endsWith('db.js')) {
  if (process.argv.includes('--reset')) reset();
  open();
  const tables = all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  console.log('[db] ready at', DB_FILE);
  console.log('[db] tables:', tables.map((t) => t.name).join(', '));
  close();
}
