/**
 * server/admin.js — isolated admin application (its own Express app, port 8001).
 * Same database, own auth wall (admin role), own layout, audit trail, CSV export, live publish.
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';

import * as db from './db.js';
import * as C from './content.js';
import * as A from './auth.js';
import { publish, stream as sseStream, clientCount } from './bus.js';
import { RESOURCES, safeJson } from './resources.js';
import { securityHeaders, gzip, asyncH, bodyParser, notFound, errorHandler, staticAssets } from './lib/http.js';
import { makeRender, ROOT } from './app.js';

const SECTION_FOR = {
  hero: 'hero', news: 'news', schedule: 'schedule', releases: 'releases', tour: 'tour-dates',
  vault: 'vault', tiers: 'tiers', products: 'products', journal: 'journal', stats: null, works: null, archive: null,
};

const csv = (rows, cols) => {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c])).join(','))].join('\n');
};

export function createAdminApp() {
  const app = express();
  makeRender(app);
  app.set('views', path.join(ROOT, 'views'));
  app.locals.admin = true;
  app.use(securityHeaders);
  app.use(gzip);
  app.use(bodyParser);
  app.use(A.sessionMiddleware);
  app.use('/static', staticAssets(path.join(ROOT, 'public'), { maxAge: '5m' }));
  app.use('/uploads', staticAssets(path.join(ROOT, 'uploads'), { maxAge: '1d' }));

  const gate = (req, res, next) => {
    if (req.user?.role === 'admin') return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'auth_required', message: 'Admin login required.' });
    return res.redirect('/login');
  };

  /* ---------- auth ---------- */
  app.get('/login', (req, res) => {
    if (req.user?.role === 'admin') return res.redirect('/');
    res.render('admin/login', { layout: false, title: 'Admin sign-in', error: null, lang: req.lang, t: (k) => k, nav: [], site: {}, user: null, csrf: req.csrf });
  });

  app.post('/login', A.csrfGuard, asyncH(async (req, res) => {
    const { email, password } = req.body || {};
    if (!A.throttle(`adm:${req.ip}`, { capacity: 5, refillPerSec: 1 / 60 })) {
      return res.status(429).render('admin/login', { layout: false, title: 'Admin sign-in', error: 'Too many attempts — wait 60s.', lang: 'ja', t: (k) => k, nav: [], site: {}, user: null, csrf: req.csrf });
    }
    try {
      const user = A.login(email, password);
      if (user.role !== 'admin') throw Object.assign(new Error('This account has no admin role.'), { status: 403 });
      A.attachUser(req, res, user);
      db.audit(user.email, 'ADMIN.LOGIN', 'sessions', req.sid.slice(0, 8));
      res.redirect('/');
    } catch (e) {
      res.status(e.status || 401).render('admin/login', { layout: false, title: 'Admin sign-in', error: e.message, lang: 'ja', t: (k) => k, nav: [], site: {}, user: null, csrf: req.csrf });
    }
  }));

  app.post('/logout', (req, res) => { A.detachUser(req, res); res.redirect('/login'); });

  app.use(gate);

  /* ---------- overview ---------- */
  app.get('/', asyncH(async (req, res) => {
    const k = C.kpis();
    const activity = db.all(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 24`);
    const tickets = db.all(`SELECT t.*, COUNT(m.id) AS msgs FROM tickets t LEFT JOIN ticket_messages m ON m.ticket_id=t.id GROUP BY t.id ORDER BY t.updated_at DESC LIMIT 8`);
    const members = db.all(`SELECT u.*, m.tier, m.status AS mstatus FROM users u LEFT JOIN memberships m ON m.user_id=u.id AND m.status='active' WHERE u.role='member' ORDER BY u.created_at DESC LIMIT 6`);
    const week = db.all(`SELECT date(created_at) d, COUNT(*) n FROM bookings GROUP BY d ORDER BY d DESC LIMIT 14`).reverse();
    const feeds = db.all(`SELECT date(created_at) d, COUNT(*) n FROM tickets GROUP BY d ORDER BY d DESC LIMIT 14`).reverse();
    const max = Math.max(1, ...week.map((w) => w.n), ...feeds.map((f) => f.n));
    res.render('admin/dashboard', {
      title: 'Overview', admin: true, kpi: k, activity, tickets, members,
      chart: { week, feeds, max },
      recentOrders: db.all(`SELECT * FROM orders ORDER BY id DESC LIMIT 6`).map((o) => ({ ...o, total_label: C.yen(o.total_yen) })),
      topProducts: db.all(`SELECT p.*, COALESCE(SUM(oi.qty),0) sold FROM products p LEFT JOIN order_items oi ON oi.product_sku=p.sku GROUP BY p.id ORDER BY sold DESC, p.sort LIMIT 6`),
      live: { clients: clientCount() },
    });
  }));

  /* ---------- generic CMS resources ---------- */
  app.get('/content/:key', (req, res, next) => {
    const r = RESOURCES[req.params.key];
    if (!r) return next();
    const rows = resourceRows(req.params.key);
    res.render('admin/resource', { title: r.label, admin: true, key: req.params.key, resource: r, rows, editing: req.query.edit ? rows.find((x) => String(x.id) === String(req.query.edit)) : null });
  });

  app.post('/content/:key', A.csrfGuard, asyncH(async (req, res) => {
    const r = RESOURCES[req.params.key];
    if (!r) return res.status(404).json({ error: 'not_found' });
    const values = coerce(r, req.body);
    const id = req.body.id ? Number(req.body.id) : null;
    if (id) {
      db.update(r.table, id, { ...values, ...(hasCol(r.table, 'updated_at') ? { updated_at: nowSql() } : {}) });
      db.audit(req.user.email, `${r.label.toUpperCase()}.UPDATE`, r.table, id);
    } else {
      const info = db.insert(r.table, values);
      id || (req.body.id = info.lastInsertRowid);
      db.audit(req.user.email, `${r.label.toUpperCase()}.CREATE`, r.table, info.lastInsertRowid);
    }
    emitChange(req.params.key, `${r.label} saved`);
    res.redirect(`/content/${req.params.key}${req.body.__redirect ? '?ok=1' : '?ok=1'}`);
  }));

  app.post('/content/:key/:id/delete', A.csrfGuard, (req, res) => {
    const r = RESOURCES[req.params.key];
    if (!r) return res.status(404).send('');
    db.run(`DELETE FROM ${r.table} WHERE id=@id`, { id: Number(req.params.id) });
    db.audit(req.user.email, `${r.label.toUpperCase()}.DELETE`, r.table, req.params.id);
    emitChange(req.params.key, `${r.label} deleted`);
    res.redirect(`/content/${req.params.key}?ok=1`);
  });

  app.post('/content/:key/:id/toggle', A.csrfGuard, (req, res) => {
    const r = RESOURCES[req.params.key];
    const field = String(req.body.field || 'status');
    const row = db.get(`SELECT * FROM ${r.table} WHERE id=@id`, { id: Number(req.params.id) });
    if (!row) return res.status(404).json({ error: 'not_found' });
    const nextVal = field === 'status' ? (row.status === 'published' ? 'draft' : 'published') : (row[field] ? 0 : 1);
    db.run(`UPDATE ${r.table} SET ${field}=@v WHERE id=@id`, { v: nextVal, id: Number(req.params.id) });
    emitChange(req.params.key, `${r.label} #${req.params.id} → ${nextVal}`);
    res.json({ ok: true, value: nextVal });
  });

  /* ---------- members ---------- */
  app.get('/members', (req, res) => {
    const q = req.query.q ? `%${req.query.q}%` : null;
    const rows = q
      ? db.all(`SELECT u.*, m.tier, m.card_no, m.status AS m_status, m.valid_until, m.price_yen,
                  (SELECT COUNT(*) FROM tickets t WHERE t.user_id=u.id) AS tickets,
                  (SELECT COUNT(*) FROM bookings b WHERE b.user_id=u.id) AS bookings
                 FROM users u LEFT JOIN memberships m ON m.user_id=u.id AND m.status='active'
                 WHERE u.role='member' AND (u.name LIKE @q OR u.email LIKE @q) ORDER BY u.created_at DESC`, { q })
      : db.all(`SELECT u.*, m.tier, m.card_no, m.status AS m_status, m.valid_until, m.price_yen,
                  (SELECT COUNT(*) FROM tickets t WHERE t.user_id=u.id) AS tickets,
                  (SELECT COUNT(*) FROM bookings b WHERE b.user_id=u.id) AS bookings
                 FROM users u LEFT JOIN memberships m ON m.user_id=u.id AND m.status='active'
                 WHERE u.role='member' ORDER BY u.created_at DESC`);
    res.render('admin/members', { title: 'Members', admin: true, rows, tiers: C.tiers(), q: req.query.q || '' });
  });

  app.post('/members/:id/tier', A.csrfGuard, (req, res) => {
    const { tier, status } = req.body;
    const t = C.tierById(String(tier || 'none'));
    if (tier === 'none' || !t) {
      db.run(`UPDATE memberships SET status='cancelled' WHERE user_id=@u`, { u: Number(req.params.id) });
    } else {
      const cardNo = 'TK-48' + Math.floor(1000 + Math.random() * 8999);
      db.run(`UPDATE memberships SET status='superseded' WHERE user_id=@u`, { u: Number(req.params.id) });
      db.insert('memberships', { user_id: Number(req.params.id), tier: t.id, card_no: cardNo, price_yen: t.price_yen, status: status || 'active', issued_at: nowSql(), valid_until: plusYear() });
      db.insert('notifications', { user_id: Number(req.params.id), title: `${t.name} Fan Card issued`, body: `Card active until ${plusYear()}. Vault unlocked.`, kind: 'membership' });
    }
    db.audit(req.user.email, 'MEMBER.TIER', 'memberships', `${req.params.id}:${tier}`);
    publish('content:changed', { sections: ['tiers', 'tickets'], reason: 'membership' }, { persist: false });
    res.redirect('/members?ok=1');
  });

  app.post('/members/:id/delete', A.csrfGuard, (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.redirect('/members?err=self');
    db.run(`DELETE FROM users WHERE id=@id AND role='member'`, { id });
    db.audit(req.user.email, 'MEMBER.DELETE', 'users', id);
    res.redirect('/members?ok=1');
  });

  app.get('/members.csv', (req, res) => {
    const rows = db.all(`SELECT u.id,u.name,u.email,u.created_at,m.tier,m.card_no,m.status,m.valid_until FROM users u LEFT JOIN memberships m ON m.user_id=u.id AND m.status='active' WHERE u.role='member' ORDER BY u.id`);
    res.setHeader('Content-Disposition', 'attachment; filename="members.csv"');
    res.type('csv').send(csv(rows, ['id', 'name', 'email', 'joined', 'tier', 'card_no', 'status', 'valid_until']));
  });

  /* ---------- bookings ---------- */
  app.get('/bookings', (req, res) => {
    const rows = db.all(`SELECT b.*, u.name AS uname FROM bookings b LEFT JOIN users u ON u.id=b.user_id ORDER BY b.created_at DESC`).map((b) => ({ ...b, budget_label: b.budget_yen ? C.yen(b.budget_yen) : '—' }));
    res.render('admin/bookings', { title: 'Bookings', admin: true, rows, statuses: ['Pending Review', 'Approved', 'Declined', 'Completed'] });
  });
  app.post('/bookings/:id/status', A.csrfGuard, (req, res) => {
    const status = String(req.body.status || 'Pending Review').slice(0, 24);
    db.run(`UPDATE bookings SET status=@s WHERE id=@id`, { s: status, id: Number(req.params.id) });
    const b = db.get(`SELECT * FROM bookings WHERE id=@id`, { id: Number(req.params.id) });
    if (b?.ticket_id) db.insert('ticket_messages', { ticket_id: b.ticket_id, sender: 'staff', body: `Booking update: your request for ${b.type} on ${b.date} is now ${status}.` });
    if (b?.user_id) db.insert('notifications', { user_id: b.user_id, title: `Booking ${status}`, body: `${b.type} — ${b.date}`, kind: 'ticket' });
    if (b?.ticket_id) publish('ticket:reply', { ticket_id: b.ticket_id, preview: `Booking ${status}` });
    db.audit(req.user.email, 'BOOKING.STATUS', 'bookings', `${req.params.id}:${status}`);
    res.redirect('/bookings?ok=1');
  });
  app.post('/bookings/:id/delete', A.csrfGuard, (req, res) => {
    db.run(`DELETE FROM bookings WHERE id=@id`, { id: Number(req.params.id) });
    db.audit(req.user.email, 'BOOKING.DELETE', 'bookings', req.params.id);
    res.redirect('/bookings?ok=1');
  });
  app.get('/bookings.csv', (_req, res) => {
    const rows = db.all(`SELECT * FROM bookings ORDER BY created_at DESC`);
    res.setHeader('Content-Disposition', 'attachment; filename="bookings.csv"');
    res.type('csv').send(csv(rows, ['id', 'date', 'type', 'name', 'email', 'guests', 'budget_yen', 'status', 'message']));
  });

  /* ---------- tickets / inbox ---------- */
  app.get('/tickets', (req, res) => {
    const rows = db.all(`SELECT t.*, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id=t.id) AS msg_count,
                  (SELECT body FROM ticket_messages m WHERE m.ticket_id=t.id ORDER BY id DESC LIMIT 1) AS last_body,
                  (SELECT sender FROM ticket_messages m WHERE m.ticket_id=t.id ORDER BY id DESC LIMIT 1) AS last_from
                  FROM tickets t ORDER BY (t.status IN ('open','in_progress','waiting')) DESC, t.updated_at DESC LIMIT 80`);
    const open = rows.filter((t) => t.status !== 'closed' && t.status !== 'resolved');
    res.render('admin/tickets', { title: 'Ticket desk', admin: true, rows, open: open.length, selected: req.query.id ? Number(req.query.id) : null });
  });
  app.get('/tickets/:id', (req, res) => {
    const t = db.get(`SELECT * FROM tickets WHERE id=@id`, { id: Number(req.params.id) });
    if (!t) return res.redirect('/tickets');
    const msgs = db.all(`SELECT * FROM ticket_messages WHERE ticket_id=@id ORDER BY id`, { id: t.id });
    res.render('admin/ticket', { title: `${t.code}`, admin: true, ticket: t, msgs, statuses: ['open', 'in_progress', 'waiting', 'resolved', 'closed'] });
  });
  app.post('/tickets/:id/reply', A.csrfGuard, (req, res) => {
    const id = Number(req.params.id);
    const body = String(req.body.body || '').trim().slice(0, 2000);
    if (body) db.insert('ticket_messages', { ticket_id: id, sender: 'staff', body });
    if (req.body.status) db.run(`UPDATE tickets SET status=@s, updated_at=datetime('now') WHERE id=@id`, { s: req.body.status, id });
    else db.run(`UPDATE tickets SET updated_at=datetime('now') WHERE id=@id`, { id });
    const t = db.get(`SELECT * FROM tickets WHERE id=@id`, { id });
    if (t?.user_id) db.insert('notifications', { user_id: t.user_id, title: 'New reply from Management', body: body.slice(0, 120), kind: 'ticket' });
    db.audit(req.user.email, 'TICKET.REPLY', 'tickets', id);
    publish('ticket:reply', { ticket_id: id, preview: body.slice(0, 90), email: t?.email });
    res.redirect(req.body.keep ? `/tickets/${id}` : '/tickets?ok=1');
  });
  app.post('/tickets/:id/status', A.csrfGuard, (req, res) => {
    db.run(`UPDATE tickets SET status=@s, updated_at=datetime('now') WHERE id=@id`, { s: String(req.body.status || 'open').slice(0, 20), id: Number(req.params.id) });
    publish('ticket:status', { ticket_id: Number(req.params.id), status: req.body.status });
    res.redirect(req.body.keep ? `/tickets/${req.params.id}` : '/tickets?ok=1');
  });

  /* ---------- orders ---------- */
  app.get('/orders', (req, res) => {
    const rows = db.all(`SELECT * FROM orders ORDER BY id DESC LIMIT 100`).map((o) => ({ ...o, total_label: C.yen(o.total_yen), items: db.all(`SELECT * FROM order_items WHERE order_no=@n`, { n: o.order_no }) }));
    res.render('admin/orders', { title: 'Orders', admin: true, rows });
  });
  app.post('/orders/:no/status', A.csrfGuard, (req, res) => {
    db.run(`UPDATE orders SET status=@s WHERE order_no=@n`, { s: String(req.body.status).slice(0, 20), n: req.params.no });
    db.audit(req.user.email, 'ORDER.STATUS', 'orders', `${req.params.no}:${req.body.status}`);
    res.redirect('/orders?ok=1');
  });
  app.get('/orders.csv', (_req, res) => {
    const rows = db.all(`SELECT * FROM orders ORDER BY id DESC`);
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    res.type('csv').send(csv(rows, ['id', 'order_no', 'email', 'total_yen', 'status', 'pickup_venue', 'created_at']));
  });

  /* ---------- stock ---------- */
  app.post('/stock/:sku', A.csrfGuard, (req, res) => {
    const delta = Number(req.body.delta) || 0;
    db.run(`UPDATE products SET stock = MAX(0, stock + @d) WHERE sku=@s`, { d: delta, s: req.params.sku });
    const p = C.productBySku(req.params.sku);
    publish('stock:changed', { sku: req.params.sku, stock: p?.stock ?? 0 });
    db.audit(req.user.email, 'STOCK.ADJUST', 'products', `${req.params.sku}:${delta}`);
    res.json({ ok: true, stock: p?.stock ?? 0 });
  });

  /* ---------- settings ---------- */
  app.get('/settings', (req, res) => {
    const rows = db.all(`SELECT * FROM settings ORDER BY key`).map((s) => ({ ...s, big: (s.value || '').length > 70 || /\n/.test(s.value || '') }));
    res.render('admin/settings', { title: 'Site settings', admin: true, rows });
  });
  app.post('/settings', A.csrfGuard, (req, res) => {
    Object.entries(req.body || {}).forEach(([k, v]) => {
      if (k === '_csrf' || !k.includes('.')) return;
      db.run(`INSERT INTO settings (key,value,updated_at) VALUES (@k,@v,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=@v, updated_at=datetime('now')`, { k, v: String(v) });
    });
    db.audit(req.user.email, 'SETTINGS.UPDATE', 'settings', Object.keys(req.body || {}).length + ' keys');
    publish('content:changed', { sections: ['hero', 'news', 'tiers'], reason: 'settings' }, { persist: false });
    res.redirect('/settings?ok=1');
  });

  /* ---------- audit + live ---------- */
  app.get('/audit', (req, res) => res.render('admin/audit', { title: 'Audit log', admin: true, rows: db.all(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200`) }));
  app.get('/events', sseStream);

  /* ---------- api for the shell ---------- */
  app.use('/api', A.csrfGuard, express.Router()
    .post('/publish', (req, res) => { publish('content:changed', { sections: ['*'], reason: 'manual' }, { persist: false }); res.json({ ok: true }); })
    .post('/media', (req, res) => {
      const m = /^data:(image|video)\/(png|jpe?g|jpeg|webp|gif|mp4|webm|mov);base64,(.+)$/.exec(String(req.body?.data || ''));
      if (!m) return res.status(422).json({ error: 'invalid', message: 'Upload a png, jpg, webp, gif, mp4 or webm.' });
      const buf = Buffer.from(m[3], 'base64');
      const cap = m[1] === 'video' ? 24 * 1024 * 1024 : 8 * 1024 * 1024;
      if (buf.length > cap) return res.status(413).json({ error: 'too_big', message: `Max ${(cap / 1024 / 1024).toFixed(0)} MB per ${m[1]}.` });
      const dir = path.join(ROOT, 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
        'video/mp4': '.mp4', 'video/webm': '.webm', 'video/mov': '.mp4' }[`${m[1]}/${m[2]}`] || `.${m[2]}`;
      const file = `media-${Date.now().toString(36)}${ext}`;
      fs.writeFileSync(path.join(dir, file), buf);
      res.json({ ok: true, url: `/uploads/${file}`, bytes: buf.length });
    })
    .get('/state', (_req, res) => res.json({ kpis: C.kpis(), events: db.all(`SELECT * FROM outbox ORDER BY id DESC LIMIT 25`) })));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

/* ---------- helpers ---------- */
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const plusYear = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); };

const colCache = new Map();
function hasCol(table, col) {
  const key = `${table}.${col}`;
  if (colCache.has(key)) return colCache.get(key);
  const cols = db.all(`PRAGMA table_info(${table})`).map((c) => c.name);
  cols.forEach((c) => colCache.set(`${table}.${c}`, true));
  return colCache.get(key) === true;
}

function coerce(r, body) {
  const out = {};
  r.fields.forEach((f) => {
    if (f.immutable && body.id) return;
    const raw = body?.[f.key];
    if (raw === undefined) { if (f.type === 'check') out[f.key] = 0; return; }
    if (f.type === 'number') out[f.key] = raw === '' ? null : Number(raw);
    else if (f.type === 'check') out[f.key] = raw === 'on' || raw === '1' || raw === true ? 1 : 0;
    else if (f.type === 'lines') out[f.key] = JSON.stringify(String(raw).split('\n').map((s) => s.trim()).filter(Boolean));
    else out[f.key] = String(raw).trim();
    if (f.type === 'select' && f.options && !f.options.includes(out[f.key]) && out[f.key] !== '') out[f.key] = f.options[0];
  });
  return out;
}

function resourceRows(key) {
  const r = RESOURCES[key];
  return db.all(`SELECT * FROM ${r.table} ORDER BY ${r.order}`).map((row) => {
    const out = { ...row };
    r.fields.forEach((f) => { if (f.type === 'lines') out[f.key] = safeJson(row[f.key], []).join('\n'); });
    if (r.format) Object.assign(out, r.format(row));
    return out;
  });
}

function emitChange(key, message) {
  const sections = [SECTION_FOR[key], key === 'products' ? 'shop-grid' : null].filter(Boolean);
  publish('content:changed', { sections: sections.length ? sections : ['*'], reason: message, resource: key }, { persist: false });
}

export { RESOURCES };
