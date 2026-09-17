/**
 * server/app.js — the public application.
 * Express + EJS, session middleware, JSON API, SSE live sync, pjax fragments, image uploads.
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import * as db from './db.js';
import * as C from './content.js';
import * as A from './auth.js';
import { publish, stream as sseStream, heartbeat } from './bus.js';
import { translator } from './i18n.js';
import { securityHeaders, gzip, asyncH, isPjax, bodyParser, notFound, errorHandler, staticAssets, injectCsrfFields } from './lib/http.js';
import { RESOURCES, safeJson } from './resources.js';
import * as S from './seo.js';
import { imgAttrs, preloadAttrs } from './media.js';
import { imageDims } from './lib/images.js';
import { buildVCalendar, checkinWindow, parseJst, countdownParts, entryCode, validateWallNote, WALL_MAX, venueCode, normalizeNotifyEmail } from './lib/tourkit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

/** Build id from public/build.json (written by scripts/build.mjs) — used to bust asset URLs on deploy. */
function buildId() {
  if (process.env.BUILD_ID) return process.env.BUILD_ID;
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'public', 'build.json'), 'utf8');
    return JSON.parse(raw).build || 'dev';
  } catch { return 'dev'; }
}
const VIEWS = path.join(ROOT, 'views');
const UPLOADS = db.UPLOAD_DIR;

export const NAV = [
  { href: '/', key: 'nav.home', num: '01' },
  { href: '/work/', key: 'nav.work', num: '02', drop: [{ label: 'Film • TV', href: '/work/#film' }, { label: 'CM & Brands', href: '/work/#cm' }, { label: 'Selected works', href: '/work/#selected' }] },
  { href: '/music/', key: 'nav.music', num: '03', drop: [{ label: 'CHECKPOINT', href: '/music/#campaign' }, { label: 'Discography', href: '/music/#discography' }] },
  { href: '/tour/', key: 'nav.tour', num: '04', drop: [{ label: 'Tour center', href: '/tour/' }, { label: 'Dates & calendar', href: '/tour/#dates' }, { label: 'Show archive', href: '/tour/#shows' }, { label: 'Lotteries', href: '/tour/#lottery' }, { label: 'Passport', href: '/tour/#pass' }] },
  { href: '/journal/', key: 'nav.journal', num: '05' },
  { href: '/wall/', key: 'nav.wall', num: '06' },
  { href: '/archive/', key: 'nav.archive', num: '07' },
  { href: '/members/', key: 'nav.members', num: '08', drop: [{ label: 'Fan card', href: '/members/#card' }, { label: 'Tickets', href: '/members/#tickets' }, { label: 'Lotteries', href: '/members/#lottery' }, { label: 'Vault', href: '/#vault' }] },
  { href: '/shop/', key: 'nav.shop', num: '09', tag: 'NEW', drop: [{ label: 'All goods', href: '/shop/' }, { label: 'Verify order', href: '/shop/verify' }] },
  { href: '/search/', key: 'nav.search', num: '10' },
  { href: '/join/', key: 'nav.join', num: '11' },
];

/* ---------- render helpers ---------- */
export function makeRender(app) {
  app.set('view engine', 'ejs');
  app.set('views', VIEWS);
  app.locals.version = buildId();
  app.locals.imgAttrs = imgAttrs;
  app.locals.imgDims = imageDims;
  app.locals.preloadAttrs = preloadAttrs;

  app.use((req, res, next) => {
    const baseRender = res.render.bind(res);
    res.render = (viewName, data = {}, cb) => {
      const t = translator(req.lang || 'ja');
      const locals = {
        req, res, t, lang: req.lang || 'ja',
        nav: NAV,
        user: req.user || null,
        membership: req.membership || null,
        cart: req.cartView || { lines: [], total_label: '\u00a50' },
        csrf: req.csrf,
        site: C.settingsMap(),
        yen: C.yen,
        imgAttrs,
        preloadAttrs,
        year: new Date().getFullYear(),
        now: new Date(),
        ...data,
      };
      locals.view = locals.view || viewName;
      locals.page = locals.page || viewName.split('/').pop();
      // metadata is computed once, here, for both the full document and the pjax fragment
      if (!locals.admin) {
        try {
          locals.meta = S.metaFor({ req, locals, status: res.statusCode });
          if (!locals.meta.indexable) res.setHeader('X-Robots-Tag', 'noindex, follow');
        } catch (err) { console.warn('[seo] meta skipped:', err.message); }
      }
      const isAdmin = !!locals.admin;
      const view = locals.view;
      const finish = (err, html) => {
        if (err) return next(err);
        const out = injectCsrfFields(html, locals.csrf);
        if (cb) return cb(null, out);
        res.type('html').send(out);
      };

      // pjax: same template, fragment only — powers the motion page transition
      if (!isAdmin && isPjax(req)) {
        return baseRender(view, { ...locals, fragment: true }, (err, html) => {
          if (err) return next(err);
          res.json({
            html: injectCsrfFields(html, locals.csrf),
            title: locals.meta?.title || locals.title || C.settingsMap()['site.title'],
            description: locals.meta?.description || locals.description || C.settingsMap()['site.description'],
            page: locals.page, lang: locals.lang,
            // never hand the client a URL carrying the transport flag — it would land in the address bar
            url: (() => { const u = new URL(req.originalUrl, 'http://x'); u.searchParams.delete('_pjax'); return u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : ''); })(),
          });
        });
      }
      if (locals.layout === false) return baseRender(view, locals, (err, html) => (err ? next(err) : (cb ? cb(null, html) : res.type('html').send(html))));
      // the admin shell lives in views/admin/, so its body path is relative to that folder
      baseRender(isAdmin ? 'admin/layout' : 'layout', { ...locals, bodyView: isAdmin ? view.replace(/^admin\//, '') : view, bodyData: locals, adminShell: isAdmin }, finish);
    };
    next();
  });
}

/* ---------- shared middleware ---------- */
export function coreMiddleware(app, { admin = false } = {}) {
  app.disable('x-powered-by');
  // behind a platform proxy (Render/Fly/Railway) this is what makes req.protocol and req.ip correct
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(gzip);
  app.use(bodyParser);
  app.use(A.sessionMiddleware);
  app.use((req, res, next) => {
    // the waitlist marker belongs to the browser, so it is read whether or not there is a user
    req.notifyTokens = A.notifyTokens(req);
    if (req.user) {
      req.membership = C.membershipFor(req.user.id);
      req.activeMembership = C.activeMembershipFor(req.user.id);
      req.tierRank = req.membership?.rank || 0;
    }
    req.cartView = cartView(req.cart || [], req);
    res.locals.cartView = req.cartView;
    next();
  });
  if (!admin) {
    // ?lang=ja|en seeds the session language, then the URL is cleaned so both locales stay indexable
    app.get(/^\/(?!api\/).*/, (req, res, next) => {
      const want = String(req.query.lang || '').toLowerCase();
      if (want !== 'ja' && want !== 'en') return next();
      A.setLang(req, res, want);
      if (isPjax(req)) return next();
      const u = new URL(req.originalUrl, 'http://x');
      u.searchParams.delete('lang');
      const rest = u.searchParams.toString();
      return res.redirect(302, u.pathname + (rest ? `?${rest}` : '') + (req.query._pjax ? '' : '') + (u.hash || ''));
    });
    // one URL per page: /shop and /shop/index.html both fold into /shop/
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const target = S.slashRedirectFor(req.path);
      if (target) {
        const q = new URL(req.originalUrl, 'http://x').searchParams;
        q.delete('_pjax');
        const rest = q.toString();
        return res.redirect(301, target + (rest ? `?${rest}` : ''));
      }
      if (/\/index\.html?$/i.test(req.path)) return res.redirect(301, req.path.replace(/\/index\.html?$/i, '/'));
      next();
    });
  }
  app.use(express.static(path.join(ROOT, 'public'), {
    index: false, fallthrough: true, maxAge: '5m',
    setHeaders: (res, fp) => {
      if (fp.includes(`${path.sep}dist${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      if (/\.(svg|webp|png|jpg|jpeg|gif|avif)$/i.test(fp)) res.setHeader('Cache-Control', 'public, max-age=604800');
      if (/\.woff2?$/i.test(fp)) res.setHeader('Cache-Control', 'public, max-age=2592000');
    },
  }));
  app.use('/uploads', staticAssets(UPLOADS, { maxAge: '1d' }));
  if (!admin) {
    app.get('/api/events', sseStream);
    setInterval(() => { try { A.sweepSessions(); } catch { /* ignore */ } }, 6 * 3600 * 1000).unref?.();
  }
}

/* ---------- API ---------- */
export function apiRouter() {
  const r = express.Router();
  r.use(A.csrfGuard);

  /* --- i18n --- */
  r.post('/lang', (req, res) => {
    A.setLang(req, res, req.body?.lang);
    res.json({ ok: true, lang: req.lang });
  });

  /* --- auth --- */
  r.post('/auth/signup', asyncH(async (req, res) => {
    const { name, email, password } = req.body || {};
    const errors = A.validateSignup({ name, email, password });
    if (errors.length) { res.status(422).json({ error: 'invalid', message: errors[0] }); return; }
    if (!A.throttle(`su:${req.ip}:${email}`, { capacity: 4, refillPerSec: 1 / 60 })) { res.status(429).json({ error: 'throttled', message: 'Too many attempts — wait a minute.' }); return; }
    const user = A.signup({ name, email, password });
    A.attachUser(req, res, { id: user.id, name: user.name, email: user.email, role: user.role });
    db.audit(user.email, 'AUTH.SIGNUP', 'users', user.id);
    db.insert('notifications', { user_id: user.id, title: 'Welcome to the fan club', body: 'Your account is live. Choose a Fan Card tier to unlock the vault and pre-sales.', kind: 'membership' });
    publish('member:joined', { id: user.id, name: user.name, email: user.email });
    res.json({ ok: true, user, message: 'Account created — welcome!' });
  }));

  r.post('/auth/login', asyncH(async (req, res) => {
    const { email, password } = req.body || {};
    if (!A.throttle(`li:${req.ip}:${String(email || '').toLowerCase()}`, { capacity: 6, refillPerSec: 1 / 30 })) { res.status(429).json({ error: 'throttled', message: 'Too many attempts — wait a minute.' }); return; }
    const user = A.login(email, password);
    A.attachUser(req, res, user);
    db.audit(user.email, 'AUTH.LOGIN', 'users', user.id);
    res.json({ ok: true, user });
  }));

  r.post('/auth/logout', (req, res) => { A.detachUser(req, res); res.json({ ok: true }); });

  r.post('/auth/password', A.requireMember, asyncH(async (req, res) => {
    const { current, next } = req.body || {};
    const row = db.get(`SELECT pass_hash FROM users WHERE id=@id`, { id: req.user.id });
    if (!row || !A.bcrypt.compareSync(String(current || ''), row.pass_hash)) { res.status(400).json({ error: 'bad_password', message: 'Current password is incorrect.' }); return; }
    const errs = [];
    if (!next || String(next).length < 8) errs.push('New password must be 8+ characters.');
    if (errs.length) { res.status(422).json({ error: 'invalid', message: errs[0] }); return; }
    db.run(`UPDATE users SET pass_hash=@h WHERE id=@id`, { h: A.bcrypt.hashSync(String(next), 10), id: req.user.id });
    db.audit(req.user.email, 'AUTH.PASSWORD', 'users', req.user.id);
    res.json({ ok: true, message: 'Password updated.' });
  }));

  r.get('/me', (req, res) => {
    const me = req.user;
    const membership = me ? C.membershipFor(me.id) : null;
    const tier = membership ? C.tierById(membership.tier) : null;
    const vault = C.vaultItems();
    res.json({
      user: me || null,
      lang: req.lang,
      membership: membership ? { ...membership, price_label: C.yen(membership.price_yen), tier_detail: tier, valid_until: membership.valid_until } : null,
      vault_unlocked: membership ? vault.filter((v) => C.canViewVault(membership.tier, v.min_tier)).length : 0,
      vault_message: membership ? '' : (C.settingsMap()['msg.nocard'] || 'No active Fan Card.'),
      tickets: me ? C.ticketsFor(me.id, { limit: 8 }) : [],
      bookings: me ? C.bookingsFor(me.id) : [],
      orders: me ? C.ordersFor(me.id).map((o) => ({ ...o, total_label: C.yen(o.total_yen) })) : [],
      stamps: C.passportStamps(me?.id),
      notifications: me ? C.notificationsFor(me.id) : [],
      cart: req.cartView,
    });
  });

  /* --- fan card / membership --- */
  r.post('/membership/purchase', A.requireMember, asyncH(async (req, res) => {
    const tier = C.tierById(String(req.body?.tier || '').toLowerCase());
    if (!tier) { res.status(422).json({ error: 'invalid_tier', message: 'Choose a valid tier.' }); return; }
    const existing = db.get(`SELECT * FROM memberships WHERE user_id=@u AND tier=@t AND status IN ('pending','active')`, { u: req.user.id, t: tier.id });
    if (existing) { res.json({ ok: true, message: `${tier.name} already in progress — check your ticket`, ticket: existing.ticket_id }); return; }
    const cardNo = 'TK-48' + Math.floor(1000 + Math.random() * 8999);
    const subject = `Purchase Fan Card — ${tier.name} ${C.yen(tier.price_yen)}`;
    const tk = db.insert('tickets', { code: 'TKT-' + Date.now().toString(36).toUpperCase(), user_id: req.user.id, email: req.user.email, name: req.user.name, subject, category: 'membership', status: 'open' });
    db.insert('ticket_messages', { ticket_id: tk.lastInsertRowid, sender: 'user', body: `I want to purchase the ${tier.name} Fan Card (${C.yen(tier.price_yen)}/year). Please send payment details and confirm my ${tier.tagline || 'membership'}.` });
    const m = db.insert('memberships', { user_id: req.user.id, tier: tier.id, card_no: cardNo, price_yen: tier.price_yen, status: 'pending', ticket_id: tk.lastInsertRowid, valid_until: nextYear() });
    db.run(`UPDATE tickets SET updated_at=datetime('now') WHERE id=@id`, { id: tk.lastInsertRowid });
    db.insert('notifications', { user_id: req.user.id, title: `${tier.name} request received`, body: `Card ${cardNo} is pending payment. Management will reply in your ticket.`, kind: 'membership' });
    db.audit(req.user.email, 'MEMBERSHIP.PURCHASE', 'memberships', `${tier.id}:${cardNo}`);
    publish('ticket:created', { id: tk.lastInsertRowid, subject, email: req.user.email, tier: tier.id });
    res.json({ ok: true, message: `Ticket #${tk.lastInsertRowid} opened for ${tier.name} — chat is live`, ticket_id: tk.lastInsertRowid, card_no: cardNo, membership_id: m.lastInsertRowid });
  }));

  /* --- booking --- */
  r.post('/bookings', asyncH(async (req, res) => {
    const b = req.body || {};
    const name = req.user?.name || b.name;
    const email = req.user?.email || b.email;
    const missing = ['type', 'date', 'message'].filter((k) => !String(b[k] || '').trim());
    if (!name || !email) missing.push('name/email');
    if (missing.length) { res.status(422).json({ error: 'invalid', message: `Missing: ${missing.join(', ')}.` }); return; }
    if (!A.throttle(`bk:${req.ip}`, { capacity: 5, refillPerSec: 1 / 120 })) { res.status(429).json({ error: 'throttled', message: 'Please slow down — a few seconds.' }); return; }
    const payload = {
      user_id: req.user?.id || null, name, email,
      type: String(b.type).slice(0, 40), date: String(b.date).slice(0, 24),
      guests: Math.max(1, Math.min(50, Number(b.guests) || 1)),
      budget_yen: Number(b.budget_yen || b.budget || 0) || null,
      message: String(b.message).slice(0, 2000),
    };
    const bk = db.insert('bookings', payload);
    const subject = `Booking: ${payload.type} — ${payload.date}`;
    const tk = db.insert('tickets', { code: 'TKT-' + Date.now().toString(36).toUpperCase(), user_id: req.user?.id || null, email, name, subject, category: 'booking', status: 'open' });
    db.insert('ticket_messages', { ticket_id: tk.lastInsertRowid, sender: 'user', body: `Booking request — ${payload.type} on ${payload.date}\nGuests: ${payload.guests}\nBudget: ${payload.budget_yen ? C.yen(payload.budget_yen) : 'flexible'}\n${payload.message}` });
    db.run(`UPDATE bookings SET ticket_id=@t WHERE id=@id`, { t: tk.lastInsertRowid, id: bk.lastInsertRowid });
    if (req.user) db.insert('notifications', { user_id: req.user.id, title: 'Booking request received', body: `${payload.type} on ${payload.date} — Management will confirm here.`, kind: 'ticket' });
    db.audit(email, 'BOOKING.CREATE', 'bookings', `${payload.type} ${payload.date}`);
    publish('booking:created', { id: bk.lastInsertRowid, type: payload.type, date: payload.date, name, email });
    res.json({ ok: true, id: bk.lastInsertRowid, ticket_id: tk.lastInsertRowid, message: `Request sent — ticket ${'TKT-' + tk.lastInsertRowid.toString(36).toUpperCase()} created. Management replies in chat.` });
  }));

  /* --- tickets + chat --- */
  r.get('/tickets', A.requireMember, (req, res) => res.json(C.ticketsFor(req.user.id)));
  r.get('/tickets/latest', asyncH(async (req, res) => {
    // one ownership rule for members and guests: a ticket is readable by its member or the session that opened it
    res.json(threadFor(req) || { id: null, code: 'NEW', status: 'open', messages: [] });
  }));
  r.get('/tickets/:id', asyncH(async (req, res) => {
    const t = db.get(`SELECT * FROM tickets WHERE id=@id`, { id: Number(req.params.id) });
    const mine = t && (req.user ? (req.user.role === 'admin' || t.user_id === req.user.id) : (!t.user_id && t.session_token === req.sid));
    if (!mine) { res.status(404).json({ error: 'not_found', message: 'No such conversation.' }); return; }   // never confirm what exists
    res.json(shapeTicket(t));
  }));

  r.post('/chat/send', asyncH(async (req, res) => {
    const text = String(req.body?.message || '').trim().slice(0, 1200);
    if (!text) { res.status(422).json({ error: 'empty', message: 'Write a message first.' }); return; }
    if (!A.throttle(`chat:${req.ip}`, { capacity: 12, refillPerSec: 0.5 })) { res.status(429).json({ error: 'throttled', message: 'Sending fast — pause a moment.' }); return; }
    // ownership first: a ticket is only ever readable/writable by its member or the session that opened it
    const owned = (row) => !!row && (req.user ? row.user_id === req.user.id : (!row.user_id && row.session_token === req.sid));
    let ticket = req.body?.ticket_id ? db.get(`SELECT * FROM tickets WHERE id=@id`, { id: Number(req.body.ticket_id) }) : null;
    if (!owned(ticket)) ticket = req.user ? db.get(`SELECT * FROM tickets WHERE user_id=@u ORDER BY updated_at DESC LIMIT 1`, { u: req.user.id }) : db.get(`SELECT * FROM tickets WHERE session_token=@s ORDER BY updated_at DESC LIMIT 1`, { s: req.sid });
    if (!owned(ticket)) {
      const info = db.insert('tickets', { code: 'TKT-' + Date.now().toString(36).toUpperCase(), user_id: req.user?.id || null, email: req.user?.email || 'guest@site', name: req.user?.name || 'Guest', subject: text.slice(0, 60), category: 'general', status: 'open', session_token: req.user ? null : req.sid });
      ticket = db.get(`SELECT * FROM tickets WHERE id=@id`, { id: info.lastInsertRowid });
    }
    db.insert('ticket_messages', { ticket_id: ticket.id, sender: 'user', body: text });
    db.run(`UPDATE tickets SET updated_at=datetime('now'), status='open' WHERE id=@id`, { id: ticket.id });
    // auto-triage: instant acknowledgement for known intents, otherwise queue for staff
    const auto = autoReply(text);
    if (auto) db.insert('ticket_messages', { ticket_id: ticket.id, sender: 'staff', body: auto });
    publish('ticket:message', { ticket_id: ticket.id, from: 'user', preview: text.slice(0, 60) });
    if (auto) publish('ticket:reply', { ticket_id: ticket.id, preview: auto.slice(0, 80) });
    const messages = db.all(`SELECT * FROM ticket_messages WHERE ticket_id=@id ORDER BY id`, { id: ticket.id });
    res.json({ ok: true, ticket: { ...ticket, messages } });
  }));

  /* --- vault (server-side gating) --- */
  r.get('/chat/mine', (req, res) => res.json({ ticket: threadFor(req) }));

  r.get('/chat/ticket/:id', (req, res) => {
    const row = db.get(`SELECT * FROM tickets WHERE id=@id`, { id: Number(req.params.id) });
    const mine = row && (req.user ? row.user_id === req.user.id : (!row.user_id && row.session_token === req.sid));
    if (!mine) { res.status(404).json({ error: 'not_found', message: 'No such conversation.' }); return; }
    res.json({ ticket: shapeTicket(row) });
  });

  r.get('/vault/:id', asyncH(async (req, res) => {
    const v = db.get(`SELECT * FROM vault_items WHERE id=@id`, { id: Number(req.params.id) });
    if (!v) { res.status(404).json({ error: 'not_found', message: 'Vault item missing.' }); return; }
    const m = req.user ? C.activeMembershipFor(req.user.id) : null;
    const ok = C.canViewVault(m?.tier || 'none', v.min_tier);
    const tiers = C.tiers();
    const nextTier = tiers.find((x) => C.tierRank(x.id) >= C.tierRank(v.min_tier)) || tiers[tiers.length - 1];
    db.run(`UPDATE vault_items SET streams = streams + 1 WHERE id=@id`, { id: v.id });
    res.json({
      ...(ok ? v : { id: v.id, code: v.code, title: v.title, image: v.image, duration: v.duration, min_tier: v.min_tier }),
      label: v.min_tier.toUpperCase(), locked: !ok,
      requirement: ok ? null : `${v.min_tier.toUpperCase()} tier or above required`,
      message: ok ? '' : `Your tier: ${(m?.tier || 'none').toUpperCase()} — upgrade to ${nextTier.name} to open this drop.`,
      next_tier: nextTier.id, image: v.image, title: v.title, code: v.code,
    });
  }));

  /* --- tour passport: a stamp is written at the door, against the code on the board --- */
  const checkIn = asyncH(async (req, res) => {
    const out = performCheckIn(req.user, req.body?.code);
    res.status(out.status).json(out.body);
  });
  r.post('/passport/checkin', A.requireMember, checkIn);
  r.post('/passport/stamp', A.requireMember, checkIn);        // the old name still works

  /* --- fan wall: anyone signed in can leave a note, the desk publishes it --- */
  r.get('/wall', (_req, res) => res.json({ notes: C.wallNotes({ limit: 24 }), total: C.wallCount() }));
  r.post('/wall', A.requireMember, asyncH(async (req, res) => {
    const out = performWallNote(req.user, req.body);
    res.status(out.status).json(out.body);
  }));
  // JSON door: the enhanced page. The form door lives in pageRoutes and redirects instead.
  r.post('/wall/:id/clap', A.requireMember, asyncH(async (req, res) => {
    const out = performClap(req.user, req.params.id);
    res.status(out.status).json(out.body);
  }));

  /* --- the waitlist: an address before tickets open --- */
  r.get('/notify', (req, res) => {
    const id = Number(req.query.date_id || 0);
    const row = id ? C.tourAll(240).find((d) => Number(d.id) === id) : null;
    res.json({ counts: C.notifyCounts(), ...(row ? { date: row.date, city: row.city, waiting: row.waiting, state: row.sale_state } : {}) });
  });
  r.post('/notify', asyncH(async (req, res) => {
    const out = performNotify(req, res);
    res.status(out.status).json(out.body);
  }));

  /* the token is the capability: an address must be able to leave the list without an account */
  r.post('/notify/leave', asyncH(async (req, res) => {
    const out = performNotifyLeave(req);
    res.status(out.status).json(out.body);
  }));

  r.get('/raffles', (req, res) => res.json({ raffles: C.raffleList({ userId: req.user?.id, tier: req.tierRank || 0 }) }));
  r.post('/raffle/enter', A.requireMember, asyncH(async (req, res) => {
    const out = performRaffleEnter(req.user, req.tierRank || 0, req.body);
    res.status(out.status).json(out.body);
  }));

  /* --- shop --- */
  r.get('/cart', (req, res) => res.json(cartView(req.cart || [], req)));
  r.post('/cart/add', asyncH(async (req, res) => {
    const p = C.productBySku(String(req.body?.sku || ''));
    if (!p) { res.status(404).json({ error: 'not_found', message: 'Product not available.' }); return; }
    if (p.stock < 1) { res.status(409).json({ error: 'sold_out', message: `${p.title} is sold out — join the waitlist from Support.` }); return; }
    const qty = Math.max(1, Math.min(10, Number(req.body?.qty) || 1));
    const cart = [...(req.cart || [])];
    const i = cart.findIndex((l) => l.sku === p.sku);
    if (i >= 0) cart[i] = { ...cart[i], qty: Math.min(p.stock, cart[i].qty + qty) };
    else cart.push({ sku: p.sku, title: p.title, price_yen: p.price_yen, qty, image: p.image, member_discount: p.member_discount });
    A.cartStore.write(req.sid, cart);
    res.json({ ok: true, cart: cartView(cart, req) });
  }));
  r.post('/cart/qty', asyncH(async (req, res) => {
    const sku = String(req.body?.sku || '');
    const qty = Number(req.body?.qty);
    let cart = [...(req.cart || [])];
    const i = cart.findIndex((l) => l.sku === sku);
    if (i < 0) { res.json({ ok: true, cart: cartView(cart, req) }); return; }
    if (!Number.isFinite(qty) || qty <= 0) cart.splice(i, 1);
    else {
      const p = C.productBySku(sku);
      cart[i] = { ...cart[i], qty: Math.min(p?.stock ?? 99, Math.min(10, qty)) };
    }
    A.cartStore.write(req.sid, cart);
    res.json({ ok: true, cart: cartView(cart, req) });
  }));
  r.post('/cart/remove', asyncH(async (req, res) => {
    const cart = (req.cart || []).filter((l) => l.sku !== String(req.body?.sku || ''));
    A.cartStore.write(req.sid, cart);
    res.json({ ok: true, cart: cartView(cart, req) });
  }));

  r.post('/checkout', A.requireMember, asyncH(async (req, res) => {
    const cart = req.cart || [];
    if (!cart.length) { res.status(422).json({ error: 'empty_cart', message: 'Your cart is empty.' }); return; }
    const order = db.tx(() => {
      const lines = [];
      const tier = req.activeMembership ? C.tierById(req.activeMembership.tier) : null;
      const memberRate = tier ? Math.max(5, tier.rank * 5) / 100 : 0;
      let total = 0;
      for (const l of cart) {
        const p = C.productBySku(l.sku);
        if (!p) throw httpError(409, `${l.sku} is no longer on sale.`);
        if (p.stock < l.qty) throw httpError(409, `Only ${p.stock} left of ${p.title}.`);
        const rate = memberRate; // member tiers only — guests pay list price
        const price = Math.max(0, Math.round(p.price_yen * (1 - rate)));
        total += price * l.qty;
        lines.push({ sku: p.sku, title: p.title, qty: l.qty, unit_price: price, image: p.image });
        db.run(`UPDATE products SET stock = stock - @q WHERE sku=@s`, { q: l.qty, s: p.sku });
      }
      const order_no = 'SO-2026-' + Date.now().toString(36).toUpperCase();
      const qr = crypto.randomBytes(8).toString('hex');
      db.insert('orders', { order_no, user_id: req.user.id, email: req.user.email, total_yen: total, status: 'paid', pickup_venue: req.body?.pickup_venue || null, qr });
      lines.forEach((l) => db.insert('order_items', { order_no, product_sku: l.sku, title: l.title, qty: l.qty, unit_price: l.unit_price }));
      A.cartStore.write(req.sid, []);
      return { order_no, total, qr, lines };
    });
    db.insert('notifications', { user_id: req.user.id, title: `Order ${order.order_no} confirmed`, body: 'Present the QR at the venue kiosk or merch counter to collect.', kind: 'merchandise' });
    db.audit(req.user.email, 'ORDER.CREATE', 'orders', order.order_no);
    order.lines.forEach((l) => publish('stock:changed', { sku: l.sku, stock: C.productBySku(l.sku)?.stock ?? 0 }));
    publish('cart:changed', { ...req.cartView, lines: [] }, { persist: false });
    publish('order:created', { order_no: order.order_no, total: order.total, email: req.user.email });
    res.json({ ok: true, order_no: order.order_no, qr: order.qr, url: `/shop/verify/${order.qr}`, total_label: C.yen(order.total) });
  }));

  r.post('/orders/verify', asyncH(async (req, res) => {
    const code = String(req.body?.qr || '');
    const o = db.get(`SELECT * FROM orders WHERE qr=@q`, { q: code });
    if (!o) { res.status(404).json({ error: 'not_found', message: 'QR not recognised — check the code.' }); return; }
    const items = db.all(`SELECT * FROM order_items WHERE order_no=@n`, { n: o.order_no });
    if (o.status === 'collected') { res.json({ ok: true, already: true, order: o, items }); return; }
    db.run(`UPDATE orders SET status='collected' WHERE order_no=@n`, { n: o.order_no });
    if (o.user_id) db.insert('notifications', { user_id: o.user_id, title: `Order ${o.order_no} collected`, body: 'Thanks — enjoy the goods. Passport stamp applied.', kind: 'merchandise' });
    db.audit(req.user?.email || 'kiosk', 'ORDER.COLLECT', 'orders', o.order_no);
    publish('order:collected', { order_no: o.order_no });
    res.json({ ok: true, order: db.get(`SELECT * FROM orders WHERE order_no=@n`, { n: o.order_no }), items });
  }));

  /* --- misc read APIs (feeds) --- */
  r.get('/search', (req, res) => res.json({ query: req.query.q || '', results: C.search(req.query.q, 24) }));
  r.get('/news', (_req, res) => res.json(C.news(24)));
  r.get('/schedule', (_req, res) => res.json(C.schedule(24)));
  r.get('/tour', (req, res) => {
    // a priority window is account-only information — it is removed, not hidden
    const rows = C.tourDates(20, C.viewerOf(req)).map((d) => {
      const o = { ...d };
      if (!o.presale_visible) { delete o.presale_at; delete o.presale_ms; }
      if (!o.map) delete o.map;
      return o;
    });
    res.json(rows);
  });
  r.get('/tiers', (_req, res) => res.json(C.tiers()));
  r.get('/releases', (_req, res) => res.json(C.releases()));
  r.get('/products', (req, res) => res.json(C.products({ category: req.query.category })));
  r.get('/hero', (_req, res) => res.json(C.heroSlides()));
  r.get('/live', (_req, res) => res.json({ events: db.all(`SELECT * FROM outbox ORDER BY id DESC LIMIT 20`).map((e) => ({ ...e, payload: safeJson(e.payload, {}) })) }));
  r.get('/health', (_req, res) => res.json({ ok: true, db: 'up', uptime: Math.round(process.uptime()) }));

  /* --- section fragments for live refresh --- */
  const SECTION_ALIAS = { products: 'shop-grid', 'shop': 'shop-grid', 'tour': 'tour-dates', 'faq': null };
  r.get('/section/:name', (req, res) => {
    const name = req.params.name.replace(/[^a-z0-9-]/gi, '');
    const view = `partials/sections/${SECTION_ALIAS[name] || name}`;
    if (!fs.existsSync(path.join(VIEWS, view + '.ejs'))) { res.status(404).send(''); return; }
    res.app.render(view, sectionData(name, req), (err, html) => {
      if (err) { res.status(500).send(''); return; }
      res.type('html').send(html);
    });
  });

  /* --- uploads (admin + management chat) --- */
  r.post('/upload', A.requireRole('admin'), asyncH(async (req, res) => {
    // urlencoded base64 payload keeps the zero-dependency promise
    const { name, data } = req.body || {};
    const m = /^data:(image|video)\/(png|jpe?g|jpeg|webp|gif|mp4|webm|mov);base64,(.+)$/.exec(String(data || ''));
    if (!m) { res.status(422).json({ error: 'invalid', message: 'Expected a base64 image or video data URL (png, jpg, webp, gif, mp4, webm).' }); return; }
    const buf = Buffer.from(m[3], 'base64');
    const cap = m[1] === 'video' ? 24 * 1024 * 1024 : 8 * 1024 * 1024;
    if (buf.length > cap) { res.status(413).json({ error: 'too_big', message: `Max ${(cap / 1024 / 1024).toFixed(0)} MB per ${m[1]}.` }); return; }
    const id = crypto.randomBytes(6).toString('hex');
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
      'video/mp4': '.mp4', 'video/webm': '.webm', 'video/mov': '.mp4', 'video/quicktime': '.mp4' }[`${m[1]}/${m[2]}`] || `.${m[2]}`;
    fs.mkdirSync(UPLOADS, { recursive: true });
    const file = `u-${Date.now().toString(36)}-${id}${ext}`;
    fs.writeFileSync(path.join(UPLOADS, file), buf);
    res.json({ ok: true, url: `/uploads/${file}`, bytes: buf.length, name: name || file });
  }));

  return r;
}

/* ---------- chat thread helpers (member by user_id, guest by session token) ---------- */
function threadFor(req) {
  const row = req.user
    ? db.get(`SELECT * FROM tickets WHERE user_id=@u ORDER BY updated_at DESC LIMIT 1`, { u: req.user.id })
    : db.get(`SELECT * FROM tickets WHERE session_token=@s ORDER BY updated_at DESC LIMIT 1`, { s: req.sid });
  return row ? shapeTicket(row) : null;
}

function shapeTicket(row) {
  return {
    ...row,
    messages: db.all(`SELECT id, sender, body, created_at FROM ticket_messages WHERE ticket_id=@id ORDER BY id`, { id: row.id }),
  };
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
function nextYear() { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); }

function autoReply(text) {
  const t = text.toLowerCase();
  if (/fan card|membership|tier|price|payment link|invoice/.test(t)) return 'Thanks — Fan Card tiers run ¥300,000 to ¥1,000,000/year. Choose your tier on the membership section and I will send the payment link right here.';
  if (/vault|unlock/.test(t)) return 'Vault 01 opens with any active card, Vault 02 needs Gold+, Vault 03 is Platinum/Diamond. Your ticket is now linked to the vault unlock.';
  if (/booking|meet|greet|private/.test(t)) return 'For Meet & Greet I need the date, city and guest count. The tour slots are Fukuoka Sep 10 (6 left), Seoul Oct 18 (Gold+) and Taipei Nov 13 (Diamond).';
  if (/ticket|seat|presale|pre-sale|lottery/.test(t)) return 'Fan Club pre-sale closes 48h before each city. Lottery results are pushed to your dashboard — you will also see them here.';
  if (/refund|cancel|exchange/.test(t)) return 'I can help with that — please quote your order number (SO-…) and I will process it within one business day.';
  return null;
}

function cartView(cart, req) {
  const subtotal = cart.reduce((s, l) => s + l.price_yen * l.qty, 0);
  let discount = 0;
  const tier = req.membership ? C.tierById(req.membership.tier) : null;
  if (tier) discount = cart.reduce((s, l) => s + Math.round(l.price_yen * l.qty * (Math.max(5, tier.rank * 5) / 100)), 0);
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const total = Math.max(0, subtotal - discount);
  return {
    lines: cart.map((l) => ({ ...l, unit_label: C.yen(l.price_yen), line_label: C.yen(l.price_yen * l.qty) })),
    subtotal, subtotal_label: C.yen(subtotal), discount, discount_label: discount ? `Member discount −${C.yen(discount)}` : '',
    total, total_label: C.yen(total), count,
  };
}

/* =========================================================================
   Three actions have two doors each: a JSON endpoint for the enhanced page and
   a plain form post for everything else. Both doors call the function below,
   so a rate limit or a tier gate can never be avoided by switching doors.
   Each returns { status, body } and the caller decides how to say it.
   ========================================================================= */

/** stamp a passport from the code on the board by the door */
function performCheckIn(user, rawCode) {
  const raw = String(rawCode || '').toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9-]{3,16}$/.test(raw)) return { status: 422, body: { error: 'invalid', message: 'Enter the code from the board by the door.' }, flash: 'bad' };
  const date = C.tourAll(240).find((d) => d.code && d.code.replace(/\s+/g, '') === raw);
  if (!date) return { status: 404, body: { error: 'not_found', message: 'That code is not on this tour.' }, flash: 'unknown' };
  const win = checkinWindow(date.date);
  if (!win.open) {
    return { status: 409, flash: win.reason === 'too_early' ? 'early' : 'late',
      body: { error: 'closed', message: win.reason === 'too_early' ? `Check-in for ${date.city} opens three days before the show.` : `Check-in for ${date.city} has closed — see the fan club desk.` } };
  }
  if (db.get(`SELECT 1 AS x FROM passport_stamps WHERE user_id=@u AND tour_date_id=@d`, { u: user.id, d: date.id })) {
    return { status: 200, flash: 'dupe', body: { ok: true, already: true, city: date.city, message: `${date.city} is already in your passport.` } };
  }
  db.insert('passport_stamps', { user_id: user.id, tour_date_id: date.id, city: date.city, source: 'venue' });
  const show = db.get(`SELECT slug FROM shows WHERE date=@d AND city=@c`, { d: date.date, c: date.city });
  db.audit(user.email, 'PASSPORT.CHECKIN', 'tour_dates', `${date.city} ${date.date}`);
  publish('passport:stamp', { user: user.email, city: date.city, date: date.date });
  return { status: 200, flash: 'stamped', city: date.city,
    body: { ok: true, city: date.city, date: date.date, show: show ? `/tour/show/${show.slug}` : null, message: `Stamped — ${date.city}. The passport is in sync.` } };
}

const WALL_MOODS = ['LIVE', 'MERCH', 'LOTTERY', 'RADIO', 'BIRTHDAY', 'HELLO'];

/** take a note for the wall: validated, capped at two a day, and held for the desk */
function performWallNote(user, body = {}) {
  const v = validateWallNote(body.message, { name: body.name || user.name, city: body.city });
  if (!v.ok) return { status: 422, flash: 'bad', body: { error: 'invalid', field: 'message', message: v.errors[0], limit: WALL_MAX } };
  const recent = db.get(`SELECT COUNT(*) AS n FROM fan_wall WHERE user_id=@u AND created_at > datetime('now','-1 day')`, { u: user.id });
  if (Number(recent?.n || 0) >= 2) return { status: 429, flash: 'dupe', body: { error: 'rate_limited', message: 'Two notes a day is the limit — the desk reads every one.' } };
  const mood = WALL_MOODS.includes(String(body.mood || '').toUpperCase()) ? String(body.mood).toUpperCase() : null;
  const info = db.insert('fan_wall', { user_id: user.id, name: v.name, city: v.city || null, mood, message: v.message, status: 'pending' });
  db.audit(user.email, 'WALL.SUBMIT', 'fan_wall', info.lastInsertRowid);
  publish('wall:submit', { user: user.email, id: info.lastInsertRowid });
  return { status: 201, flash: 'sent', body: { ok: true, id: info.lastInsertRowid, pending: true, message: 'Sent — the desk reviews notes before they go up on the wall.' } };
}

/** enter a meet & greet draw — one entry per member, tier gated, on the clock */
function performRaffleEnter(user, tierRankOf, body = {}) {
  const id = Number(body?.raffle_id ?? body?.id);
  const r = db.get(`SELECT * FROM raffles WHERE id=@id`, { id });
  if (!r) return { status: 404, flash: 'unknown', body: { error: 'not_found', message: 'No such lottery.' } };
  if (r.status !== 'open') return { status: 409, flash: 'closed', body: { error: 'closed', message: r.status === 'drawn' ? 'This draw has already run — results are published.' : 'This draw is not taking entries.' } };
  if (C.tierRank(r.tier_min) > Number(tierRankOf || 0)) {
    return { status: 403, flash: 'tier', body: { error: 'tier', message: `${String(r.tier_min).toUpperCase()} members and above can enter this draw.`, needed: r.tier_min } };
  }
  const opensAt = r.opens_at ? parseJst(r.opens_at.slice(0, 10), (r.opens_at.split(' ')[1] || '').slice(0, 5)) : null;
  const closesAt = r.closes_at ? parseJst(r.closes_at.slice(0, 10), (r.closes_at.split(' ')[1] || '').slice(0, 5)) : null;
  if (opensAt !== null && opensAt > Date.now()) return { status: 425, flash: 'early', body: { error: 'too_early', message: `Entries open ${r.opens_at}.` } };
  if (closesAt !== null && closesAt < Date.now()) return { status: 409, flash: 'closed', body: { error: 'closed', message: `Entries closed ${r.closes_at}.` } };
  const mine = db.get(`SELECT * FROM raffle_entries WHERE raffle_id=@r AND user_id=@u`, { r: id, u: user.id });
  if (mine) return { status: 200, flash: 'dupe', body: { ok: true, already: true, code: mine.code, status: mine.status, message: `You are in this draw — code ${mine.code}. One entry per member.` } };
  const code = entryCode(r.seed || r.title, id, user.id);
  db.insert('raffle_entries', { raffle_id: id, user_id: user.id, code, ticket_ref: body?.ticket_ref ? String(body.ticket_ref).slice(0, 40) : null, status: 'entered' });
  db.audit(user.email, 'RAFFLE.ENTER', 'raffles', `${id} ${code}`);
  publish('raffle:entry', { raffle: id, code });
  return { status: 201, flash: 'in', code, body: { ok: true, code, message: `Entered — your ticket code is ${code}. The draw runs when entries close, on a published seed.` } };
}

/** one clap per member per note, and it can be taken back */
/**
 * The waitlist, once, for both doors: the JSON one the bundle uses and the form one that works
 * without it. An address is all that is asked for — no mail is sent from here, the desk reads the queue.
 */
function performNotify(req, res) {
  const v = normalizeNotifyEmail(req.body?.email);
  if (!v.ok) return { status: 422, flash: 'notify_bad', body: { error: 'invalid', field: 'email', message: v.error } };
  if (String(req.body?.company || '') !== '') return { status: 201, flash: 'notify_in', body: { ok: true, message: 'Added.' } };   // honeypot: a filled hidden field is a bot
  if (!A.throttle(`nl:${req.ip}`, { capacity: 12, refillPerSec: 1 / 90 })) {
    return { status: 429, flash: 'notify_dupe', body: { error: 'throttled', message: 'Too many addresses from here — give it a minute.' } };
  }
  const many = db.get(`SELECT COUNT(*) AS n FROM notify_list WHERE lower(email)=@e AND created_at > datetime('now','-1 day')`, { e: v.email });
  if (Number(many?.n || 0) > 4) {
    return { status: 429, flash: 'notify_dupe', body: { error: 'rate_limited', message: 'That address has asked for several dates today — try again tomorrow.' } };
  }
  const out = C.notifyAdd({ email: v.email, tourDateId: req.body?.tour_date_id, userId: req.user?.id || null, source: 'site', tierHint: req.body?.tier_hint });
  if (!out.ok) return { status: out.status, flash: out.error === 'on_sale' ? 'notify_onsale' : 'notify_bad', body: { error: out.error, message: out.message, href: out.href || null } };
  if (out.token) A.rememberNotify(req, res, out.token);
  db.audit(req.user ? req.user.email : v.email, 'NOTIFY.JOIN', 'notify_list', `${out.city || ''} ${out.date || ''}`.trim());
  publish('notify:join', { date_id: Number(req.body?.tour_date_id), city: out.city });
  return {
    status: out.already ? 200 : 201,
    flash: out.already ? 'notify_dupe' : 'notify_in',
    body: { ok: true, already: !!out.already, message: out.message, waiting: out.waiting, token: out.token || null, href: out.href || null },
  };
}

function performNotifyLeave(req) {
  const out = C.notifyUnsubscribe(req.body?.token);
  return { status: out.status || 200, flash: out.ok ? 'notify_left' : 'notify_bad', body: out };
}

function performClap(user, id) {
  const wallId = Number(id);
  const note = db.get(`SELECT id, status FROM fan_wall WHERE id=@id`, { id: wallId });
  if (!note || note.status !== 'approved') return { status: 404, flash: 'unknown', body: { error: 'not_found', message: 'Nothing to applaud there yet.' } };
  const mine = db.get(`SELECT 1 AS x FROM fan_wall_claps WHERE wall_id=@w AND user_id=@u`, { w: wallId, u: user.id });
  if (mine) {
    db.run(`DELETE FROM fan_wall_claps WHERE wall_id=@w AND user_id=@u`, { w: wallId, u: user.id });
    db.run(`UPDATE fan_wall SET applause = MAX(0, applause - 1) WHERE id=@id`, { id: wallId });
  } else {
    db.run(`INSERT INTO fan_wall_claps (wall_id, user_id) VALUES (@w, @u)`, { w: wallId, u: user.id });
    db.run(`UPDATE fan_wall SET applause = applause + 1 WHERE id=@id`, { id: wallId });
  }
  const n = db.get(`SELECT applause FROM fan_wall WHERE id=@id`, { id: wallId });
  const clapped = !mine;
  return { status: 200, flash: 'none', body: { ok: true, id: wallId, applause: Number(n?.applause || 0), clapped } };
}

/* every outcome a form can land on, in both languages — never free text from the client */
const FORM_FLASH = {
  stamped: ['gold', 'スタンプを押しました — パスポートは同期済みです', 'Stamped — your passport is in sync'],
  dupe: ['warn', 'その夜はすでにパスポートに入っています', 'That night is already in your passport'],
  early: ['warn', '会場チェックインは公演の3日前から開きます', 'Check-in opens three days before the show'],
  late: ['warn', 'この夜の受付は終わりました — デスクまで', 'Check-in for that night has closed — see the desk'],
  bad: ['err', 'コードを読み取れません — 看板の表記どおりに入力してください', 'That code could not be read — type it as the board shows it'],
  unknown: ['err', 'そのコードはこのツアーにありません', 'That code is not on this tour'],
  sent: ['gold', 'ノートを送りました — デスクが読んでから壁に出します', 'Note sent — the desk reads it before it goes up'],
  in: ['gold', '抽選に参加しました — 参加番号は会員ページに出ます', 'You are in the draw — your code is on your account'],
  notify_in: ['gold', '待機リストに入りました — 発売当日の朝にメールします', 'On the list — we write the morning tickets open'],
  notify_dupe: ['warn', 'その日程ではすでに登録済みです', 'That address is already waiting for this date'],
  notify_onsale: ['gold', 'この回は発売中です — 待つより先に席を確保してください', 'That night is on sale now — take a seat instead of waiting'],
  notify_left: ['warn', '待機リストから外しました', 'Taken off the waitlist — nothing further will be sent'],
  closed: ['warn', 'この抽選は現在受け付けていません', 'This draw is not taking entries'],
  tier: ['warn', 'この抽選は上位ティア限定です', 'That draw is for higher tiers'],
};

/** a query flag becomes a banner; anything unexpected becomes nothing */
function formFlash(req, key, target) {
  const f = FORM_FLASH[String(key || '')];
  if (!f) return null;
  return { kind: f[0], text: req.lang === 'en' ? f[2] : f[1], to: target || null };
}

/** only same-site pages a form may bounce back to */
function safeBack(v, fallback) {
  const s = String(v || '');
  return /^\/tour\/(?:show\/[a-z0-9-]{2,64})?\/?$/.test(s) || s === '/wall/' ? s : fallback;
}

function sectionData(name, req) {
  const base = { req, lang: req.lang, t: translator(req.lang || 'ja'), site: C.settingsMap(), user: req.user, membership: req.membership, tierRank: req.tierRank || 0, activeMembership: req.activeMembership || null, yen: C.yen, imgAttrs, preloadAttrs, nav: NAV, csrf: req.csrf };
  switch (name) {
    case 'hero': return { ...base, hero: C.heroSlides(), tour: C.tourDates(4, C.viewerOf(req)), site: C.settingsMap() };
    case 'news': return { ...base, news: C.news(6) };
    case 'schedule': return { ...base, schedule: C.schedule(6) };
    case 'releases': return { ...base, releases: C.releases(8) };
    case 'tiers': return { ...base, tiers: C.tiers() };
    case 'vault': return { ...base, vault: C.vaultItems() };
    case 'tour-dates': return { ...base, tour: C.tourDates(24, C.viewerOf(req)) };
    case 'shows': return { ...base, shows: C.showsArchive({ limit: 9 }), tours: C.showTours() };
    case 'wall': return { ...base, ...C.wallPage({ per: 12, userId: req.user?.id }) };
    case 'tour': return { ...base, tour: C.tourDates(24, C.viewerOf(req)), next: C.nextShow(C.viewerOf(req)), countdown: countdownParts((C.nextShow(C.viewerOf(req))?.at_ms || 0) - Date.now()) };
    case 'raffles': return { ...base, raffles: C.raffleList({ userId: req.user?.id, tier: req.tierRank || 0 }) };
    case 'home-pulse': return { ...base, next: C.nextShow(C.viewerOf(req)), countdown: countdownParts((C.nextShow(C.viewerOf(req))?.at_ms || 0) - Date.now()), wall_notes: C.wallNotes({ limit: 3 }), wall_total: C.wallCount(), draw: C.nextDraw({ userId: req.user?.id }) };
    case 'countdown': {
      const next = C.nextShow(C.viewerOf(req));
      const mine = req.user ? C.passportSummary(req.user.id) : null;
      return { ...base, next, countdown: countdownParts((next?.at_ms || 0) - Date.now()), passport: mine };
    }
    case 'shop-grid': return { ...base, products: C.products({}) };
    case 'products': return { ...base, products: C.products({}), categories: C.productCategories() };
    case 'journal': return { ...base, posts: C.journalPosts({ limit: 6, viewerTier: req.membership?.tier }) };
    case 'cart': return { ...base, cart: cartView(req.cart || [], req) };
    case 'member-pill': return { ...base, pill: true };
    case 'tickets': return { ...base, tickets: C.ticketsFor(req.user?.id), me: true };
    default: return base;
  }
}

/* ---------- public page app ---------- */
/**
 * `extra(app)` runs after every route the site owns but before the 404 handler — that is the only
 * safe place to mount another app (see server/host.js: a mounted console has to be reached before
 * the site decides the path does not exist).
 */
export function createPublicApp({ extra } = {}) {
  const app = express();
  makeRender(app);
  coreMiddleware(app);

  const pages = pageRoutes();
  app.use('/', pages);
  app.use('/api', apiRouter());
  if (extra) extra(app);
  app.use(notFound);
  app.use(errorHandler);
  heartbeat();
  return app;
}

function pageRoutes() {
  const r = express.Router();

  const view = (slug, renderFn) => asyncH(async (req, res) => {
    const data = await renderFn(req, res);
    res.render(data.view, data);
  });

  r.get('/', view('home', (req) => ({
    view: 'pages/home',
    page: 'home',
    title: C.settingsMap()['site.title'],
    description: C.settingsMap()['site.description'],
    hero: C.heroSlides(),
    tiers: C.tiers(),
    news: C.news(6),
    schedule: C.schedule(6),
    releases: C.releases(6),
    works: { film: C.worksByKind('movie', 6), drama: C.worksByKind('drama', 6), regular: C.worksByKind('radio', 3).concat(C.worksByKind('tv', 2), C.worksByKind('magazine', 2)), cm: C.worksByKind('cm', 12) },
    tour: C.tourDates(8, C.viewerOf(req)),
    next: C.nextShow(C.viewerOf(req)), countdown: countdownParts((C.nextShow(C.viewerOf(req))?.at_ms || 0) - Date.now()),
    wall_notes: C.wallNotes({ limit: 6 }), wall_total: C.wallCount(),
    draw: C.nextDraw({ userId: req.user?.id }),
    shows: C.showsArchive({ limit: 4 }),
    vault: C.vaultItems(),
    journal: C.journalPosts({ limit: 4, viewerTier: req.membership?.tier }),
    archive: C.archiveItems(),
    products: C.products({}).slice(0, 8),
    stats: C.stats(),
    membership: req.membership,
  })));

  r.get('/work/', view('work', (req) => ({
    view: 'pages/work', page: 'work', title: 'WORK — Film • TV • CM', description: 'Verified filmography, television, commercials and selected works.',
    works: C.worksAll(), movie: C.worksByKind('movie', 20), drama: C.worksByKind('drama', 20), cm: C.worksByKind('cm', 20), regular: C.worksByKind('radio', 3).concat(C.worksByKind('tv', 3), C.worksByKind('magazine', 3)),
    news: C.news(10), stats: C.stats(), archive: C.archiveItems(),
  })));

  r.get('/music/', view('music', (req) => ({
    view: 'pages/music', page: 'music', title: 'MUSIC — Checkpoint & Discography', description: 'Albums, singles, the CHECKPOINT campaign and the members-only player.',
    releases: C.releases(12), news: C.news(6).filter((n) => n.category === 'RELEASE'), products: C.products({ category: 'Albums' }), tour: C.tourDates(6, C.viewerOf(req)),
  })));

  r.get('/tour/', view('tour', (req) => {
    const next = C.nextShow(C.viewerOf(req));
    return {
      view: 'pages/tour', page: 'tour', title: 'TOUR — Live 2026 Checkpoint', description: 'Tour center — dates, calendar, the show archive, meet & greet lotteries and the QR Tour Passport.',
      tour: C.tourDates(24, C.viewerOf(req)),
      next, countdown: countdownParts((next?.at_ms || 0) - Date.now()),
      shows: C.showsArchive({ limit: 6 }), tours: C.showTours(),
      raffles: C.raffleList({ userId: req.user?.id, tier: req.tierRank || 0 }),
      wall_notes: C.wallNotes({ limit: 4 }),
      products: C.products({ category: 'Tour Merch' }), stamps: C.passportStamps(req.user?.id), news: C.news(4), releases: C.releases(3),
      flash: formFlash(req, req.query.flash, req.query.to),
    };
  }));

  /* the no-JS doors for the same three actions — same functions, same rules, a redirect out */
  r.post('/tour/checkin', asyncH(async (req, res) => {
    if (!req.user) { res.redirect('/join/'); return; }
    const out = performCheckIn(req.user, req.body?.code);
    const back = safeBack(req.body?.back, '/tour/');
    res.redirect(`${back}${back.includes('?') ? '&' : '?'}flash=${out.flash}${out.body?.show ? `&to=${encodeURIComponent(out.body.show)}` : ''}`);
  }));

  r.get('/journal/', view('journal', async (req) => ({
    view: 'pages/journal', page: 'journal', title: 'JOURNAL — Editorial', description: 'Tour, film, music and style writing from the official desk.',
    posts: C.journalPosts({ category: req.query.cat, limit: 30, viewerTier: req.membership?.tier }),
    cats: C.journalCategories(), active: req.query.cat || 'all',
  })));

  r.get('/journal/:id', view('journal-post', async (req, res) => {
    const post = C.journalPost(req.params.id, req.membership?.tier);
    if (!post) throw httpError(404, 'Journal entry not found.');
    return { view: 'pages/journal-post', page: 'journal', post, related: C.journalPosts({ limit: 4, viewerTier: req.membership?.tier }).filter((p) => p.id !== post.id) };
  }));

  r.get('/archive/', view('archive', (req) => ({
    view: 'pages/archive', page: 'archive', title: 'ARCHIVE — 1987 → Future', description: 'A verified timeline from debut to the 2026 arena run.',
    items: C.archiveItems(), works: C.worksAll().filter((w) => ['movie', 'drama'].includes(w.kind)), releases: C.releases(8),
  })));

  /* ---------- live shows: the archive, the wall, the draws, the calendar ---------- */
  r.get('/tour/show/:slug', view('tour-show', async (req) => {
    const show = C.showBySlug(req.params.slug);
    if (!show) throw httpError(404, 'That show is not in the archive.');
    return {
      view: 'pages/tour-show', page: 'tour', show,
      title: `${show.tour} — ${show.city}, ${show.date}`,
      description: `Setlist of ${show.songs} songs, ${show.photos} frames from the vault and the desk report from ${show.venue || show.city}.`,
      siblings: C.showsArchive({ tour: show.tour, limit: 8 }).filter((x) => x.slug !== show.slug),
      flash: formFlash(req, req.query.flash, '#passport-night'),
      passport: C.passportSummary(req.user?.id),
      raffles: C.raffleList({ userId: req.user?.id, tier: req.tierRank || 0 }).filter((x) => x.show_id === show.id),
    };
  }));

  r.get('/wall/', view('wall', async (req) => {
    const per = 24;
    const total = C.wallCount();
    const pages = Math.max(1, Math.ceil(total / per));
    const current = Math.min(pages, Math.max(1, Number(req.query.p) || 1));
    return {
      view: 'pages/wall', page: 'wall', title: 'FAN WALL — notes from the crowd',
      description: 'Notes members leave after a show. The desk reads every one and publishes what is not a link, a slur or a spoiler.',
      notes: C.wallNotes({ limit: per, offset: (current - 1) * per, userId: req.user?.id }),
      featured: C.wallNotes({ limit: 3, featured: true, userId: req.user?.id }),
      total, pages, current, mine: C.wallMine(req.user?.id),
      highlights: C.showsArchive({ limit: 4 }),
      flash: formFlash(req, req.query.flash, '#compose'),
    };
  }));

  r.post('/wall/', asyncH(async (req, res) => {
    if (!req.user) { res.redirect('/join/'); return; }
    const out = performWallNote(req.user, req.body);
    res.redirect(`/wall/?flash=${out.flash}${out.status === 201 ? '#compose' : '#compose'}`);
  }));

  r.post('/wall/:id/clap', asyncH(async (req, res) => {
    if (!req.user) { res.redirect('/join/'); return; }
    const out = performClap(req.user, req.params.id);
    const back = safeBack(req.body?.back, '/wall/');
    res.redirect(`${back}${back.includes('?') ? '&' : '?'}flash=${out.flash}#notes`);
  }));

  r.post('/tour/notify', asyncH(async (req, res) => {
    const out = performNotify(req, res);
    const back = safeBack(req.body?.back, '/tour/');
    res.redirect(`${back}${back.includes('?') ? '&' : '?'}flash=${out.flash}#date-${Number(req.body?.tour_date_id) || 0}`);
  }));

  r.post('/tour/notify/leave', asyncH(async (req, res) => {
    const out = performNotifyLeave(req);
    const back = safeBack(req.body?.back, '/tour/');
    res.redirect(`${back}${back.includes('?') ? '&' : '?'}flash=${out.flash}#date-${Number(req.body?.tour_date_id) || 0}`);
  }));

  r.post('/tour/raffle/:id/enter', asyncH(async (req, res) => {
    if (!req.user) { res.redirect('/join/'); return; }
    const out = performRaffleEnter(req.user, req.tierRank || 0, { ...req.body, raffle_id: req.body?.raffle_id ?? req.params.id });
    const back = safeBack(req.body?.back, '') || `/tour/raffle/${Number(req.params.id) || 0}`;
    res.redirect(`${back}${back.includes('?') ? '&' : '?'}flash=${out.flash}${out.code ? `&code=${encodeURIComponent(out.code)}` : ''}`);
  }));

  r.get('/tour/raffle/:id', view('tour-raffle', async (req) => {
    const raffle = C.raffleById(Number(req.params.id), { userId: req.user?.id, tier: req.tierRank || 0 });
    if (!raffle) throw httpError(404, 'No such lottery.');
    return {
      view: 'pages/tour-raffle', page: 'tour', raffle,
      title: `${raffle.title} — draw`,
      description: raffle.status === 'drawn'
        ? `The draw for ${raffle.title} ran on a published seed. ${raffle.winners.length} winner codes and ${raffle.alternates.length} alternates.`
        : `Entries for ${raffle.title} ${raffle.status === 'open' ? 'are open' : 'have closed'}. One entry per member, drawn from the ticket codes.`,
      others: C.raffleList({ userId: req.user?.id, tier: req.tierRank || 0 }).filter((x) => x.id !== raffle.id).slice(0, 4),
    };
  }));

  /** an .ics a fan can subscribe to: the whole tour, or one date on its own */
  const calendarSend = (req, res, rows, filename, name) => {
    const o = S.origin(req);
    const text = buildVCalendar(rows.map((d) => ({
      id: d.id,
      title: `${d.tour || 'Live Tour'} — ${d.city}`,
      date: d.date, time: d.time, durationMin: 165,
      city: d.city, venue: d.venue,
      note: [d.note, d.doors ? `Doors ${d.doors}` : null, d.setlist_teaser ? `Opening: ${d.setlist_teaser}` : null,
        d.sold_out ? 'Sold out — the waitlist runs through Support' : null].filter(Boolean).join(' / '),
      url: `${o}/tour/#date-${d.id}`,
      status: d.status === 'cancelled' ? 'cancelled' : 'published',
    })), { name });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(text);
  };
  r.get('/tour/calendar.ics', (req, res) => calendarSend(req, res, C.tourCalendarRows(30), 'takuya-kimura-tour.ics', 'Live Tour 2026 Checkpoint'));
  r.get('/tour/calendar/:id.ics', (req, res, next) => {
    const d = C.tourById(req.params.id);
    if (!d) return next();
    return calendarSend(req, res, [d], `takuya-kimura-${String(d.date).replace(/\./g, '-')}.ics`, `${d.tour} — ${d.city}`);
  });

  r.get('/members/', view('members', async (req) => {
    const me = req.user;
    return {
      // no description here on purpose: the curated per-language copy in seo.js is better than a
      // one-liner written for the wrong locale, and metaFor only defers to a route when it differs
      view: 'pages/members', page: 'members', title: 'MEMBERS — Fan Card & Vault',
      membership: req.membership, tiers: C.tiers(), vault: C.vaultItems(),
      tickets: me ? C.ticketsFor(me.id) : [], bookings: me ? C.bookingsFor(me.id) : [], orders: me ? C.ordersFor(me.id) : [],
      stamps: C.passportStamps(me?.id), notifications: me ? C.notificationsFor(me.id) : [],
      raffles: C.raffleList({ userId: me?.id, tier: req.tierRank || 0 }), wall_mine: C.wallMine(me?.id),
      passport: C.passportSummary(me?.id),
      flash: formFlash(req, req.query.flash, '#passport'),
    };
  }));

  r.get('/shop/', view('shop', (req) => ({
    view: 'pages/shop', page: 'shop', title: 'SHOP — Official Goods', description: 'Apparel, tour merch, albums and accessories — live inventory.',
    products: C.products({ category: req.query.cat }), categories: C.productCategories(), active: req.query.cat || 'all', cart: cartView(req.cart || [], req),
  })));

  r.get('/shop/complete', view('shop-complete', (req) => {
    const last = req.user ? db.get(`SELECT * FROM orders WHERE user_id=@u ORDER BY id DESC LIMIT 1`, { u: req.user.id }) : null;
    return { view: 'pages/shop-complete', page: 'shop', title: 'Order confirmed', description: 'Your order is confirmed.', order: last ? { ...last, items: db.all(`SELECT * FROM order_items WHERE order_no=@n`, { n: last.order_no }) } : null };
  }));

  r.get('/shop/verify/:qr?', view('verify', (req) => {
    const o = req.params.qr ? db.get(`SELECT * FROM orders WHERE qr=@q`, { q: req.params.qr }) : null;
    return {
      view: 'pages/verify', page: 'shop', title: 'Order & QR', description: 'Verify your order QR at the venue kiosk.',
      order: o ? { ...o, items: db.all(`SELECT * FROM order_items WHERE order_no=@n`, { n: o.order_no }), total_label: C.yen(o.total_yen) } : null,
      my: req.user ? C.ordersFor(req.user.id).map((x) => ({ ...x, total_label: C.yen(x.total_yen) })) : [],
    };
  }));

  r.get('/search/', view('search', (req) => ({
    view: 'pages/search', page: 'search', title: 'SEARCH — Explore', description: 'Search news, works, releases, journal, shop and tour data.',
    q: req.query.q || '', results: req.query.q ? C.search(req.query.q, 24) : [],
  })));

  r.get('/support/', view('support', (req) => ({
    view: 'pages/support', page: 'support', title: 'SUPPORT — Ticket desk', description: 'Ticket-based support with replies from Official Site / Management.',
    my: req.user ? C.ticketsFor(req.user.id) : C.ticketsForSession(req.sid), faq: FAQ,
    justOpened: req.query.ok ? Number(req.query.ok) : null,
  })));

  // progressive enhancement: the desk works with JS switched off, same tables, same ticket
  r.post('/support/ticket', asyncH(async (req, res) => {
    const subject = String(req.body?.subject || '').trim().slice(0, 120);
    const message = String(req.body?.message || '').trim().slice(0, 1200);
    const email = String(req.body?.email || '').trim().slice(0, 160);
    const category = ['membership', 'booking', 'shop', 'general'].includes(req.body?.category) ? req.body.category : 'general';
    if (!subject || !message || (!req.user && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) {
      return res.status(422).render('pages/support', { page: 'support', title: 'SUPPORT — Ticket desk', my: req.user ? C.ticketsFor(req.user.id) : [], faq: FAQ, formError: 'Subject, message and a valid email are all required.' });
    }
    const info = db.insert('tickets', { code: 'TKT-' + Date.now().toString(36).toUpperCase(), user_id: req.user?.id || null, email: req.user?.email || email, name: req.user?.name || 'Guest', subject, category, status: 'open', session_token: req.user ? null : req.sid });
    db.insert('ticket_messages', { ticket_id: info.lastInsertRowid, sender: 'user', body: message });
    const auto = autoReply(message) || 'Thank you — this ticket is open. Management replies here in the chat within a few hours.';
    db.insert('ticket_messages', { ticket_id: info.lastInsertRowid, sender: 'staff', body: auto });
    if (req.user) db.insert('notifications', { user_id: req.user.id, title: 'Ticket opened', body: subject.slice(0, 80), kind: 'ticket' });
    publish('ticket:message', { ticket_id: info.lastInsertRowid, from: 'user', preview: subject.slice(0, 60) });
    publish('ticket:reply', { ticket_id: info.lastInsertRowid, preview: auto.slice(0, 80) });
    db.audit(req.user?.email || email, 'TICKET.CREATE', 'tickets', info.lastInsertRowid);
    res.redirect('/support/?ok=' + info.lastInsertRowid);
  }));

  r.get('/join/', view('join', (req) => ({
    view: 'pages/join', page: 'join', title: 'JOIN — Fan Club', description: 'Membership entry — choose your Fan Card tier.',
    tiers: C.tiers(), tour: C.tourDates(4, C.viewerOf(req)), vault: C.vaultItems(), stats: C.stats(),
  })));

  r.post('/join/', asyncH(async (req, res) => {
    const { name, email, password, tier } = req.body || {};
    const errors = A.validateSignup({ name, email, password });
    if (errors.length) return res.status(422).render('pages/join', { page: 'join', title: 'JOIN — Fan Club', tiers: C.tiers(), tour: C.tourDates(4, C.viewerOf(req)), vault: C.vaultItems(), stats: C.stats(), formError: errors[0], form: req.body });
    const user = A.signup({ name, email, password });
    A.attachUser(req, res, { id: user.id, name: user.name, email: user.email, role: user.role });
    if (tier && tier !== 'none') {
      const t = C.tierById(tier);
      if (t) {
        const cardNo = 'TK-48' + Math.floor(1000 + Math.random() * 8999);
        const tk = db.insert('tickets', { code: 'TKT-' + Date.now().toString(36).toUpperCase(), user_id: user.id, email: user.email, name: user.name, subject: `Purchase Fan Card — ${t.name} ${C.yen(t.price_yen)}`, category: 'membership', status: 'open' });
        db.insert('ticket_messages', { ticket_id: tk.lastInsertRowid, sender: 'user', body: `Signup with tier selection: ${t.name}. Please send payment details.` });
        db.insert('memberships', { user_id: user.id, tier: t.id, card_no: cardNo, price_yen: t.price_yen, status: 'pending', ticket_id: tk.lastInsertRowid, valid_until: nextYear() });
      }
    }
    publish('member:joined', { id: user.id, name: user.name, email: user.email });
    res.redirect('/join/complete');
  }));

  r.get('/join/complete', view('join-complete', (req) => ({
    view: 'pages/join-complete', page: 'join', title: 'Welcome — membership in progress', description: 'Account created.',
    membership: req.membership, tickets: req.user ? C.ticketsFor(req.user.id, { limit: 3 }) : [], tiers: C.tiers(),
  })));

  r.get('/feed.json', (_req, res) => res.json({ news: C.news(20), schedule: C.schedule(20), tour: C.tourDates(20), releases: C.releases(20) }));

  /* Crawler files are generated, not committed: a hand-written sitemap went stale (a Vercel host,
     /en/... URLs that never existed and /join/form/ which 404s). These can't drift. */
  r.get('/sitemap.xml', (_req, res) => {
    res.type('application/xml').set('Cache-Control', 'public, max-age=900').send(S.sitemapXml(_req));
  });
  r.get('/robots.txt', (_req, res) => {
    res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(S.robotsTxt(_req));
  });
  r.get('/rss.xml', (_req, res) => {
    res.type('application/rss+xml').set('Cache-Control', 'public, max-age=1800').send(S.rssXml(_req));
  });
  r.get('/cart', (req, res) => res.redirect(302, '/shop/?cart=1'));   // legacy path kept alive
  r.get('/healthz', (_req, res) => res.json({ ok: true, service: 'public', uptime: Math.round(process.uptime()), db: 'up', boot: process.env.TEST_BOOT_MARK || null }));

  return r;
}

const FAQ = [
  { q: 'How do I purchase a Fan Card?', a: 'Sign up free → choose a tier → Purchase opens a ticket and Management sends payment details here in chat.' },
  { q: 'Vault not unlocking?', a: 'Vault 01 needs any active card, 02 needs Gold+, 03 needs Platinum+. The gate is checked server-side, so tier changes apply instantly.' },
  { q: 'Where is the chat?', a: 'Bottom-right bubble — always available. Every message creates or updates a ticket.' },
  { q: 'Can I bring guests to a Meet & Greet?', a: 'Yes — 1 guest on Silver/Gold, up to 2 on Platinum, and Diamond concierge arranges private sessions.' },
  { q: 'Do shop orders ship?', a: 'Venue pickup is default (QR at the kiosk); domestic shipping is added at confirmation by Management.' },
];

export { VIEWS };
