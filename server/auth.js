/**
 * server/auth.js — real sessions (httpOnly cookie), bcrypt passwords, guest carts, CSRF, throttling.
 * No localStorage auth, no client-side "passHash" demo: the server owns the state.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { get, all, run, insert, getDb } from './db.js';

export const SESSION_COOKIE = 'tk_sid';
export const CSRF_COOKIE = 'tk_csrf';
const SESSION_TTL_DAYS = 30;

/* ---------- cookies ---------- */
export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i < 0) return;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function setCookie(res, name, value, { maxAge = SESSION_TTL_DAYS * 86400, httpOnly = true, path = '/', sameSite = 'Lax' } = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `Max-Age=${maxAge}`, 'HttpOnly', `SameSite=${sameSite}`];
  if (process.env.NODE_ENV === 'production') bits.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const arr = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  res.setHeader('Set-Cookie', [...arr, bits.join('; ')]);
}

/* ---------- throttle ---------- */
const buckets = new Map();
export function throttle(key, { capacity = 8, refillPerSec = 0.25 } = {}) {
  const now = Date.now();
  const b = buckets.get(key) || { tokens: capacity, last: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.last) / 1000) * refillPerSec);
  b.last = now;
  if (b.tokens < 1) { buckets.set(key, b); return false; }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}

/* ---------- sessions ---------- */
function newSessionToken(userId = null, lang = 'ja') {
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  insert('sessions', { token, user_id: userId, lang, cart: '[]', expires_at: expires });
  return token;
}

function createCart() { return []; }

function readCart(token) {
  if (!token) return null;
  const row = get(`SELECT cart FROM sessions WHERE token=@t`);
  if (!row) return null;
  try { return JSON.parse(row.cart || '[]'); } catch { return []; }
}

function writeCart(token, cart) {
  run(`UPDATE sessions SET cart=@c WHERE token=@t`, { c: JSON.stringify(cart), t: token });
}

export function sessionMiddleware(req, res, next) {
  const cookies = parseCookies(req);
  let sid = cookies[SESSION_COOKIE] || null;
  let row = sid ? get(`SELECT * FROM sessions WHERE token=@t`, { t: sid }) : null;

  if (row && new Date(row.expires_at + 'Z') < new Date()) {
    run(`DELETE FROM sessions WHERE token=@t`, { t: sid });
    row = null; sid = null;
  }
  if (!row) {
    sid = newSessionToken(null, cookies.tk_lang || 'ja');
    setCookie(res, SESSION_COOKIE, sid);
    row = get(`SELECT * FROM sessions WHERE token=@t`, { t: sid });
  } else if (!cookies[SESSION_COOKIE] || cookies[SESSION_COOKIE] !== sid) {
    setCookie(res, SESSION_COOKIE, sid);
  }

  req.sid = sid;
  req.lang = ['ja', 'en'].includes(row.lang) ? row.lang : 'ja';
  req.cart = (() => { try { return JSON.parse(row.cart || '[]'); } catch { return createCart(); } })();
  req.user = row.user_id ? get(`SELECT id,name,email,role,created_at FROM users WHERE id=@id`, { id: row.user_id }) : null;
  req.csrf = cookies[CSRF_COOKIE] || (() => { const t = crypto.randomBytes(12).toString('hex'); setCookie(res, CSRF_COOKIE, t, { httpOnly: false }); return t; })();

  res.locals.sid = sid;
  res.locals.user = req.user;
  res.locals.lang = req.lang;
  res.locals.cart = req.cart;
  res.locals.csrf = req.csrf;
  next();
}

export function ensureCartRow(req) {
  if (readCart(req.sid) === null) run(`INSERT INTO sessions (token, user_id, lang, cart, expires_at) VALUES (@t,NULL,@l,'[]',@e)`, {
    t: req.sid, l: req.lang, e: new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000).toISOString().slice(0, 19).replace('T', ' '),
  });
}

export const cartStore = {
  read: readCart,
  write: writeCart,
};

/* ---------- csrf guard for mutating API calls ---------- */
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = req.get('x-csrf-token') || req.body?._csrf;
  const have = parseCookies(req)[CSRF_COOKIE];
  if (!have || sent !== have) return res.status(403).json({ error: 'csrf_failed', message: 'Session token mismatch — reload the page and retry.' });
  next();
}

/* ---------- accounts ---------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateSignup({ name, email, password }) {
  const errors = [];
  if (!name || String(name).trim().length < 2) errors.push('Please enter your full name.');
  if (!EMAIL_RE.test(String(email || ''))) errors.push('A valid email is required.');
  if (!password || String(password).length < 8) errors.push('Password must be at least 8 characters.');
  return errors;
}

export function signup({ name, email, password }) {
  const clean = String(email).trim().toLowerCase();
  if (get(`SELECT 1 FROM users WHERE email=@e`, { e: clean })) {
    const err = new Error('That email is already registered — try logging in.');
    err.status = 409;
    throw err;
  }
  const info = insert('users', { name: String(name).trim(), email: clean, pass_hash: bcrypt.hashSync(password, 10), role: 'member', last_login_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
  return get(`SELECT id,name,email,role,created_at FROM users WHERE id=@id`, { id: info.lastInsertRowid });
}

export function login(email, password) {
  const user = get(`SELECT * FROM users WHERE email=@e`, { e: String(email || '').trim().toLowerCase() });
  if (!user || !bcrypt.compareSync(String(password || ''), user.pass_hash)) {
    const err = new Error('Invalid email or password.');
    err.status = 401;
    throw err;
  }
  run(`UPDATE users SET last_login_at=datetime('now') WHERE id=@id`, { id: user.id });
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export function attachUser(req, res, user) {
  run(`UPDATE sessions SET user_id=@u WHERE token=@t`, { u: user.id, t: req.sid });
  req.user = user;
  res.locals.user = user;
}

export function detachUser(req, res) {
  run(`UPDATE sessions SET user_id=NULL WHERE token=@t`, { t: req.sid });
  req.user = null;
  res.locals.user = null;
}

export function setLang(req, res, lang) {
  const l = lang === 'en' ? 'en' : 'ja';
  run(`UPDATE sessions SET lang=@l WHERE token=@t`, { l, t: req.sid });
  req.lang = l;
  res.locals.lang = l;
  setCookie(res, 'tk_lang', l, { httpOnly: false });
}

export function requireMember(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'auth_required', message: 'Please sign up or log in to continue.' });
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'auth_required', message: 'Login required.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden', message: 'Not permitted for your role.' });
    next();
  };
}

export function membershipOf(userId) {
  if (!userId) return null;
  return get(`SELECT m.*, t.name AS tier_name, t.price_yen, t.icon, t.accent, t.rank
              FROM memberships m JOIN tiers t ON t.id=m.tier
              WHERE m.user_id=@u AND m.status='active' ORDER BY m.issued_at DESC LIMIT 1`, { u: userId });
}

export function setLangRow(req, lang) { run(`UPDATE sessions SET lang=@l WHERE token=@t`, { l: lang, t: req.sid }); }

export function activeSessionCount() { return all(`SELECT 1 FROM sessions`).length; }
export function sweepSessions() { const r = run(`DELETE FROM sessions WHERE expires_at < datetime('now')`); return r.changes; }
export { bcrypt, crypto, getDb };
