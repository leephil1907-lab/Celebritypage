/**
 * server/content.js — read models. Every public page renders from these queries,
 * so an admin edit in SQLite shows up on the next request (and instantly over SSE).
 */
import { get, all } from './db.js';

const J = (v, fb) => { try { return v == null ? fb : JSON.parse(v); } catch { return fb; } };
const yen = (n) => '¥' + Number(n || 0).toLocaleString('en-US');

export const published = (status = 'published') => ({ status });

export function settingsMap() {
  const rows = all(`SELECT key, value FROM settings`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function heroSlides(limit = 12) {
  return all(`SELECT * FROM hero_slides WHERE active=1 ORDER BY sort, id LIMIT ${Number(limit)}`);
}

export function tiers() {
  return all(`SELECT * FROM tiers ORDER BY sort, price_yen`).map((t) => ({ ...t, perks: J(t.perks, []), featured: !!t.featured, price_label: yen(t.price_yen) }));
}

export function tierById(id) {
  const t = get(`SELECT * FROM tiers WHERE id=@id`, { id });
  return t ? { ...t, perks: J(t.perks, []), price_label: yen(t.price_yen) } : null;
}

export function news(limit = 6) {
  return all(`SELECT * FROM news WHERE status='published' ORDER BY date DESC, id DESC LIMIT ${Number(limit)}`);
}

export function newsById(id) {
  return get(`SELECT * FROM news WHERE id=@id AND status='published'`, { id });
}

export function schedule(limit = 12) {
  return all(`SELECT * FROM schedule WHERE status='published' ORDER BY starts_on, sort LIMIT ${Number(limit)}`).map((s) => ({ ...s, label: `${s.starts_on} • ${s.starts_at || '—'}` }));
}

export function worksByKind(kind, limit = 30) {
  return all(`SELECT * FROM works WHERE kind=@kind AND status='published' ORDER BY sort, release_date DESC LIMIT ${Number(limit)}`, { kind });
}

export function worksAll() {
  return all(`SELECT * FROM works WHERE status='published' ORDER BY kind, sort, release_date DESC`).map((w) => ({ ...w, yearNum: Number((w.release_date || w.year || '').slice(0, 4)) || 0 }));
}

export function releases(limit = 12) {
  return all(`SELECT * FROM releases WHERE status='published' ORDER BY sort, release_date DESC LIMIT ${Number(limit)}`)
    .map((r) => ({ ...r, tracks: J(r.tracks, []), price_label: r.price_yen ? yen(r.price_yen) : null }));
}

export function tourDates(limit = 20) {
  return all(`SELECT * FROM tour_dates ORDER BY date, sort LIMIT ${Number(limit)}`).map((d) => ({
    ...d,
    sold_out: d.remaining <= 0,
    fill_pct: d.capacity ? Math.round(((d.capacity - d.remaining) / d.capacity) * 100) : 0,
  }));
}

export function vaultItems() {
  // the grid must not carry media paths: /api/vault/:id is the only place a clip is handed out,
  // and only after the tier check — a URL in the HTML is as good as an unlocked file
  return all(`SELECT id, code, title, description, image, min_tier, duration, streams, likes, status, sort
              FROM vault_items WHERE status='published' ORDER BY sort, id`).map((v) => ({ ...v, label: v.min_tier.toUpperCase() }));
}

export function journalPosts({ category, limit = 24, viewerTier = 'none' } = {}) {
  const rows = category && category !== 'all'
    ? all(`SELECT * FROM journal_posts WHERE status='published' AND lower(category)=lower(@c) ORDER BY published_at DESC, id DESC LIMIT ${Number(limit)}`, { c: category })
    : all(`SELECT * FROM journal_posts WHERE status='published' ORDER BY published_at DESC, id DESC LIMIT ${Number(limit)}`);
  const rank = { none: 0, silver: 1, gold: 2, platinum: 3, diamond: 4 }[viewerTier] ?? 0;
  return rows.map((p) => ({ ...p, locked: p.visibility === 'members' && rank < 2 }));
}

export function journalPost(id, viewerTier = 'none') {
  const p = get(`SELECT * FROM journal_posts WHERE id=@id AND status='published'`, { id: Number(id) });
  if (!p) return null;
  const rank = { none: 0, silver: 1, gold: 2, platinum: 3, diamond: 4 }[viewerTier] ?? 0;
  return { ...p, locked: p.visibility === 'members' && rank < 2 };
}

export function journalCategories() {
  return all(`SELECT category, COUNT(*) AS n FROM journal_posts WHERE status='published' GROUP BY category ORDER BY category`).map((r) => r.category);
}

export function archiveItems() {
  return all(`SELECT * FROM archive_items ORDER BY year, sort`);
}

export function products({ category, status = 'active' } = {}) {
  const sql = `SELECT * FROM products ${status ? `WHERE status=@status` : ''} ${category && category !== 'all' ? `${status ? 'AND' : 'WHERE'} category=@category` : ''} ORDER BY sort, id`;
  const params = { ...(status ? { status } : {}), ...(category && category !== 'all' ? { category } : {}) };
  return all(sql, params).map((p) => ({
    ...p,
    images: J(p.images, [p.image]),
    price_label: yen(p.price_yen),
    available: p.stock > 0,
    low_stock: p.stock > 0 && p.stock <= 6,
  }));
}

export function productCategories() {
  return all(`SELECT category, COUNT(*) AS n FROM products WHERE status='active' GROUP BY category ORDER BY category`);
}

export function productBySku(sku) {
  const p = get(`SELECT * FROM products WHERE sku=@sku`, { sku });
  return p ? { ...p, images: J(p.images, [p.image]), price_label: yen(p.price_yen) } : null;
}

export function stats() {
  return all(`SELECT * FROM stats ORDER BY sort, id`);
}

export function site() {
  return settingsMap();
}

/* ---------- tier ranking helpers ---------- */
export const TIER_RANK = { none: 0, silver: 1, gold: 2, platinum: 3, diamond: 4 };
export function tierRank(tier) { return TIER_RANK[tier || 'none'] ?? 0; }
export function canViewVault(memberTier, requiredTier) {
  return tierRank(memberTier) >= tierRank(requiredTier);
}

/* ---------- member state ---------- */
export function membershipFor(userId) {
  if (!userId) return null;
  // pending is shown in the dashboard (so a member can see what they asked for) but carries no privileges
  const m = get(`SELECT * FROM memberships WHERE user_id=@u AND status IN ('active','pending') ORDER BY (status='active') DESC, issued_at DESC LIMIT 1`, { u: userId });
  if (!m) return null;
  const tier = tierById(m.tier);
  const active = m.status === 'active';
  return {
    ...m, is_active: active, tier_name: tier?.name || m.tier.toUpperCase(),
    tier_price_label: tier?.price_label || '', price_label: yen(m.price_yen),
    rank: active ? tierRank(m.tier) : 0,
    discount_pct: active && tier ? Math.max(5, tier.rank * 5) : 0,
  };
}

/** only an approved card counts for gating: vault, pre-sale rank, discounts */
export function activeMembershipFor(userId) {
  if (!userId) return null;
  const m = get(`SELECT * FROM memberships WHERE user_id=@u AND status='active' ORDER BY issued_at DESC LIMIT 1`, { u: userId });
  if (!m) return null;
  const tier = tierById(m.tier);
  return { ...m, is_active: true, tier_name: tier?.name || m.tier.toUpperCase(), rank: tierRank(m.tier), tier_detail: tier };
}

export function ticketsForSession(token, { limit = 20 } = {}) {
  if (!token) return [];
  return all(`SELECT * FROM tickets WHERE session_token=@t ORDER BY updated_at DESC LIMIT ${Number(limit)}`, { t: token })
    .map((t) => ({ ...t, last_message: get(`SELECT body FROM ticket_messages WHERE ticket_id=@id ORDER BY id DESC LIMIT 1`, { id: t.id })?.body || '' }));
}

export function ticketsFor(userId, { limit = 40 } = {}) {
  if (!userId) return [];
  return all(`SELECT * FROM tickets WHERE user_id=@u ORDER BY updated_at DESC LIMIT ${Number(limit)}`, { u: userId })
    .map((t) => ({ ...t, last_message: get(`SELECT body FROM ticket_messages WHERE ticket_id=@id ORDER BY id DESC LIMIT 1`, { id: t.id })?.body || '' }));
}

export function bookingsFor(userId, { email, limit = 30 } = {}) {
  if (userId) return all(`SELECT * FROM bookings WHERE user_id=@u ORDER BY created_at DESC LIMIT ${Number(limit)}`, { u: userId });
  if (email) return all(`SELECT * FROM bookings WHERE email=@e ORDER BY created_at DESC LIMIT ${Number(limit)}`, { e: email });
  return [];
}

export function ordersFor(userId, limit = 20) {
  if (!userId) return [];
  return all(`SELECT * FROM orders WHERE user_id=@u ORDER BY created_at DESC LIMIT ${Number(limit)}`, { u: userId })
    .map((o) => ({ ...o, items: all(`SELECT * FROM order_items WHERE order_no=@n`, { n: o.order_no }) }));
}

export function notificationsFor(userId, limit = 12) {
  if (!userId) return [];
  return all(`SELECT * FROM notifications WHERE user_id=@u ORDER BY created_at DESC LIMIT ${Number(limit)}`, { u: userId });
}

export function passportStamps(userId) {
  const attended = userId
    ? all(`SELECT DISTINCT td.city FROM orders o JOIN order_items oi ON oi.order_no=o.order_no JOIN products p ON p.sku=oi.product_sku JOIN tour_dates td ON 1=1
            WHERE o.user_id=@u AND o.status IN ('paid','ready','collected') AND td.city IS NOT NULL`, { u: userId })
    : [];
  const stamps = new Set(attended.map((a) => a.city.toLowerCase()));
  const hasTickets = userId ? !!get(`SELECT 1 FROM tickets WHERE user_id=@u LIMIT 1`, { u: userId }) : false;
  const member = membershipFor(userId);
  const rank = member?.rank ?? 0;
  return tourDates(6).map((d) => ({
    city: d.city,
    date: d.date,
    stamped: stamps.has(d.city.toLowerCase()) || (hasTickets && d.city === 'Fukuoka'),
    locked: tierRank(d.tier_required) > rank,
  }));
}

/* ---------- search ---------- */
export function search(q, limit = 30) {
  const like = `%${String(q || '').trim().replace(/[%_]/g, '')}%`;
  if (like === '%%') return [];
  const out = [];
  const push = (kind, rows, map) => rows.forEach((r) => out.push(map(kind, r)));

  push('NEWS', all(`SELECT id,date,category,title FROM news WHERE status='published' AND (title LIKE @q OR IFNULL(body,'') LIKE @q) ORDER BY date DESC LIMIT 8`, { q: like }),
    (kind, r) => ({ kind, id: r.id, title: r.title, meta: `${r.date} • ${r.category}`, href: `/journal/#news-${r.id}` }));
  push('WORK', all(`SELECT id,kind,title,meta,year FROM works WHERE status='published' AND (title LIKE @q OR IFNULL(description,'') LIKE @q OR IFNULL(role,'') LIKE @q) ORDER BY release_date DESC LIMIT 8`, { q: like }),
    (kind, r) => ({ kind: 'WORK', id: r.id, title: r.title, meta: `${r.meta || ''} ${r.year || ''}`.trim(), href: `/work/#work-${r.id}` }));
  push('MUSIC', all(`SELECT id,kind,title,release_date FROM releases WHERE status='published' AND (title LIKE @q OR IFNULL(blurb,'') LIKE @q) ORDER BY release_date DESC LIMIT 6`, { q: like }),
    (kind, r) => ({ kind: 'RELEASE', id: r.id, title: r.title, meta: `${r.kind.toUpperCase()} • ${r.release_date}`, href: `/music/#release-${r.id}` }));
  push('SHOP', all(`SELECT id,sku,title,category,price_yen,stock FROM products WHERE status='active' AND (title LIKE @q OR IFNULL(blurb,'') LIKE @q OR sku LIKE @q) ORDER BY sort LIMIT 8`, { q: like }),
    (kind, r) => ({ kind: 'PRODUCT', id: r.id, title: r.title, meta: `${r.category} • ${yen(r.price_yen)} • ${r.stock > 0 ? r.stock + ' in stock' : 'sold out'}`, href: `/shop/#p-${r.sku}` }));
  push('JOURNAL', all(`SELECT id,category,title,published_at FROM journal_posts WHERE status='published' AND (title LIKE @q OR IFNULL(excerpt,'') LIKE @q OR IFNULL(body,'') LIKE @q) ORDER BY published_at DESC LIMIT 8`, { q: like }),
    (kind, r) => ({ kind: 'JOURNAL', id: r.id, title: r.title, meta: `${r.category} • ${r.published_at}`, href: `/journal/${r.id}` }));
  push('ARCHIVE', all(`SELECT id,year,title,description FROM archive_items WHERE year LIKE @q OR title LIKE @q OR IFNULL(description,'') LIKE @q ORDER BY year DESC LIMIT 6`, { q: like }),
    (kind, r) => ({ kind: 'ARCHIVE', id: r.id, title: r.title, meta: `${r.year} • ${r.description || ''}`.trim(), href: `/archive/#a-${r.year}` }));
  push('TOUR', all(`SELECT id,date,city,venue FROM tour_dates WHERE city LIKE @q OR IFNULL(venue,'') LIKE @q OR tour LIKE @q ORDER BY date LIMIT 6`, { q: like }),
    (kind, r) => ({ kind: 'TOUR', id: r.id, title: `${r.city} — ${r.venue || 'Arena'}`, meta: r.date, href: `/tour/#d-${r.id}` }));

  return out.slice(0, limit);
}

/* ---------- dashboard KPIs ---------- */
export function kpis() {
  const one = (sql) => get(sql)?.n || 0;
  return {
    members: one(`SELECT COUNT(*) n FROM users WHERE role='member'`),
    active_cards: one(`SELECT COUNT(*) n FROM memberships WHERE status='active'`),
    open_tickets: one(`SELECT COUNT(*) n FROM tickets WHERE status IN ('open','in_progress','waiting')`),
    pending_bookings: one(`SELECT COUNT(*) n FROM bookings WHERE status='Pending Review'`),
    orders: one(`SELECT COUNT(*) n FROM orders`),
    revenue_yen: get(`SELECT IFNULL(SUM(total_yen),0) n FROM orders`) ?.n || 0,
    mrr_yen: get(`SELECT IFNULL(SUM(price_yen),0) n FROM memberships WHERE status='active'`) ?.n || 0,
    products: one(`SELECT COUNT(*) n FROM products WHERE status='active'`),
    low_stock: one(`SELECT COUNT(*) n FROM products WHERE status='active' AND stock <= 6`),
    news: one(`SELECT COUNT(*) n FROM news`),
    journal: one(`SELECT COUNT(*) n FROM journal_posts`),
    mrr_label: yen(get(`SELECT IFNULL(SUM(price_yen),0) n FROM memberships WHERE status='active'`) ?.n || 0),
    revenue_label: yen(get(`SELECT IFNULL(SUM(total_yen),0) n FROM orders`) ?.n || 0),
  };
}

export { yen };
