/**
 * server/content.js — read models. Every public page renders from these queries,
 * so an admin edit in SQLite shows up on the next request (and instantly over SSE).
 */
import { get, all, run, insert } from './db.js';
import { parseJst, nextUpcoming, checkinWindow, venueCode, venueMapData, hash32 } from './lib/tourkit.js';

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

/* =====================================================================
   the live-show layer — tour calendar, countdown, show archive, fan wall,
   meet & greet lotteries and the tour passport. Everything reads from SQLite
   so an admin edit is on the page on the next request, and nothing here needs
   JavaScript: the countdown ships as text and only the ticking is enhanced.
   ===================================================================== */

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** one shape for a tour date, whether it came from the admin console or the seed */
function tourDate(row) {
  const at = parseJst(row.date, row.time);
  const past = at !== null && at + 4 * 3600 * 1000 < Date.now();
  const d = at === null ? null : new Date(at + 9 * 3600 * 1000);        // JST wall time
  return {
    ...row,
    at_ms: at,
    is_past: past,
    sold_out: Number(row.remaining) <= 0,
    fill_pct: row.capacity ? Math.round(((Number(row.capacity) - Number(row.remaining)) / Number(row.capacity)) * 100) : 0,
    pretty: d ? `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}` : row.date,
    day: d ? `${d.getUTCDate()} ${MON[d.getUTCMonth()]}` : row.date,
    doors: row.doors_at || null,
    /** the door code is only ever hinted at — the board by the gate carries the real one */
    code_hint: row.checkin_code ? `${String(row.checkin_code).slice(0, 5)} ••••` : null,
    ics: `/tour/calendar/${row.id}.ics`,
    /** the code on the board by the gate — set by the desk, or derived from city and day */
    code: venueCode(row),
    checkin_open: !!venueCode(row) && checkinWindow(row.date).open,
    /** one vocabulary for the row's state, so the card, the feed and the API cannot disagree */
    sale_state: saleState(row, past),
    wants_notify: ['coming_soon', 'waitlist', 'sold_out'].includes(saleState(row, past)),
    /** when the two windows open — the priority one is only ever shown to an account that qualifies */
    presale_at: row.presale_at || null,
    presale_ms: row.presale_at ? parseJst(String(row.presale_at).slice(0, 10), (String(row.presale_at).split(' ')[1] || '').slice(0, 5)) : null,
    on_sale_at: row.on_sale_at || null,
    on_sale_ms: row.on_sale_at ? parseJst(String(row.on_sale_at).slice(0, 10), (String(row.on_sale_at).split(' ')[1] || '').slice(0, 5)) : null,
    min_rank: row.tier_required ? tierRank(row.tier_required) : 0,
    /** the locator map is drawn from these numbers by views/partials/venue-map.ejs */
    map: venueMapData(row),
  };
}

/** `pre_sale` in the table is the fan-facing "coming soon": tickets are not out yet */
function saleState(row, past) {
  if (row.status === 'cancelled') return 'cancelled';
  if (past) return 'done';
  if (row.status === 'pre_sale') return 'coming_soon';
  if (row.status === 'waitlist') return 'waitlist';
  if (row.status === 'lottery') return 'lottery';
  return Number(row.remaining) <= 0 ? 'sold_out' : 'on_sale';
}

/**
 * Who is asking: the id drives stamps and their own waitlist rows, the rank drives what they may
 * see, and the browser marker lets an anonymous fan take themselves back off a list they just joined.
 */
export function viewerOf(req) {
  if (!req) return null;
  const v = {
    userId: req.user?.id || null,
    email: req.user ? String(req.user.email || '').toLowerCase() : null,
    tierRank: Number(req.tierRank || 0),
    tokens: req.notifyTokens || [],
  };
  return v.userId || v.email || v.tierRank || v.tokens.length ? v : null;
}

function viewerId(v) {
  if (!v) return null;
  return typeof v === 'number' ? v : (v.userId || null);
}

/** the stamps a member already owns, keyed by tour date — one lookup for every consumer */
function stampIndex(userId) {
  const map = new Map();
  if (!userId) return map;
  for (const s of all(`SELECT tour_date_id, stamped_at FROM passport_stamps WHERE user_id=@u AND tour_date_id IS NOT NULL`, { u: Number(userId) })) {
    if (s.tour_date_id != null) map.set(Number(s.tour_date_id), s.stamped_at);
  }
  return map;
}

/**
 * Stamps, the waitlist tally and the tier gate all belong to the list, not to one page, so the
 * card, the countdown, the feed and the API cannot disagree about what a given fan may see.
 */
function withViewerState(d, ctx) {
  const stamp = ctx.stamps.get(Number(d.id));
  const waiting = ctx.waits.get(Number(d.id)) || 0;
  const listed = ctx.mine.get(Number(d.id));
  const on_list = listed !== undefined;
  return {
    ...d,
    stamped: !!stamp,
    stamped_at: stamp || null,
    can_check_in: !!d.checkin_open && !stamp,
    waiting,
    on_list,
    notify_token: listed || null,
    /** the priority window is account-only information: no rank, no date */
    gate_open: !d.min_rank || d.min_rank <= ctx.rank,
    presale_visible: !!d.presale_at && (!d.min_rank || d.min_rank <= ctx.rank),
    notify_label: on_list ? 'on the list' : (waiting ? `${waiting} waiting` : 'ask me'),
  };
}

/** how many fans are waiting per date — one grouped query for the whole list */
function waitCounts() {
  const map = new Map();
  for (const r of all(`SELECT tour_date_id, COUNT(*) AS n FROM notify_list WHERE status='subscribed' GROUP BY tour_date_id`)) {
    map.set(Number(r.tour_date_id), Number(r.n));
  }
  return map;
}

/** the dates this viewer is on the list for — plus the token that lets them leave again */
function myNotifyIds(email, userId, tokens) {
  const map = new Map();
  const p = {};
  const ords = [];
  if (email) { p.e = email; ords.push('lower(email)=@e'); }
  if (userId) { p.u = userId; ords.push('user_id=@u'); }
  const names = [];
  (tokens || []).forEach((t, i) => { names.push(`@t${i}`); p[`t${i}`] = t; });
  if (names.length) ords.push(`token IN (${names.join(',')})`);
  if (!ords.length) return map;
  for (const r of all(`SELECT tour_date_id, token FROM notify_list WHERE status='subscribed' AND (${ords.join(' OR ')})`, p)) {
    if (r.tour_date_id != null) map.set(Number(r.tour_date_id), r.token);
  }
  return map;
}

/** the "next dates" consumers must never advertise a show that already happened */
export function tourDates(limit = 20, viewer = null) {
  const up = tourUpcoming(limit, viewer);
  return up.length ? up : tourAll(limit, viewer);
}

export function tourAll(limit = 80, viewer = null) {
  const v = viewer || null;
  const uid = viewerId(v);
  const ctx = {
    stamps: stampIndex(uid),
    waits: waitCounts(),
    mine: myNotifyIds(v && v.email, uid, v && v.tokens),
    rank: v && typeof v === 'object' ? Number(v.tierRank || 0) : 0,
  };
  return all(`SELECT * FROM tour_dates ORDER BY date, sort LIMIT ${Number(limit)}`)
    .map((row) => withViewerState(tourDate(row), ctx));
}

export function tourUpcoming(limit = 24, viewer = null) {
  return tourAll(200, viewer).filter((d) => !d.is_past).slice(0, Number(limit));
}

export function tourPast(limit = 24) {
  return tourAll(200).filter((d) => d.is_past).reverse().slice(0, Number(limit));
}

/** the show the countdown counts to, from any state of the table */
export function nextShow(viewer = null) {
  const rows = tourAll(200, viewer);
  const pick = nextUpcoming(rows.map((r) => ({ ...r })), Date.now());
  return pick ? rows.find((r) => r.id === pick.row.id) : null;
}

export function tourById(id) {
  const row = get(`SELECT * FROM tour_dates WHERE id=@id`, { id: Number(id) });
  return row ? tourDate(row) : null;
}

/** what goes into the .ics feed: everything still to come, plus a fortnight of recent shows */
export function tourCalendarRows(days = 30) {
  const cut = Date.now() - days * 86400 * 1000;
  return tourAll(200).filter((d) => d.at_ms === null || d.at_ms > cut);
}

/* ------------------------------------------------------- the show archive */

function showRow(row, { withReport = false } = {}) {
  const setlist = J(row.setlist, []);
  const gallery = J(row.gallery, []);
  const out = {
    ...row,
    title: `${row.tour} — ${row.city}`,
    setlist, songs: setlist.length, gallery, photos: gallery.length,
    encore: String(row.encore || '').split(' • ').filter(Boolean),
    fill_pct: row.capacity ? Math.round((Number(row.attended) / Number(row.capacity)) * 100) : 0,
  };
  if (!withReport) delete out.report;
  return out;
}

export function showsArchive({ limit = 24, tour = null } = {}) {
  const rows = tour
    ? all(`SELECT * FROM shows WHERE status='published' AND tour=@t ORDER BY date DESC, id DESC LIMIT ${Number(limit)}`, { t: tour })
    : all(`SELECT * FROM shows WHERE status='published' ORDER BY date DESC, id DESC LIMIT ${Number(limit)}`);
  return rows.map((r) => showRow(r));
}

export function showTours() {
  return all(`SELECT tour, COUNT(*) AS n, MIN(date) AS first_on, MAX(date) AS last_on FROM shows WHERE status='published' GROUP BY tour ORDER BY last_on DESC`)
    .map((t) => ({ ...t, shows: Number(t.n) }));
}

export function showBySlug(slug) {
  const row = get(`SELECT * FROM shows WHERE slug=@s AND status='published'`, { s: String(slug || '') });
  if (!row) return null;
  const detail = showRow(row, { withReport: true });
  const near = all(`SELECT slug, tour, date, city FROM shows WHERE status='published' ORDER BY date DESC, id DESC LIMIT 40`)
    .map((x) => ({ ...x, title: `${x.tour} — ${x.city}` }));
  const i = near.findIndex((x) => x.slug === row.slug);
  // the list runs newest-first, so the neighbour above is the later show
  detail.newer = i > 0 ? near[i - 1] : null;
  detail.older = i >= 0 && i < near.length - 1 ? near[i + 1] : null;
  detail.tour_dates = all(`SELECT * FROM tour_dates WHERE tour=@t ORDER BY date`, { t: row.tour }).map(tourDate).filter((d) => d.city === row.city);
  return detail;
}

/* ------------------------------------------------------------- fan wall */

export function wallNotes({ limit = 48, offset = 0, featured = false, userId = null } = {}) {
  // EXISTS instead of a join, so the row count cannot inflate the page
  const rows = all(`SELECT w.*, EXISTS(SELECT 1 FROM fan_wall_claps c WHERE c.wall_id = w.id AND c.user_id = @u) AS clapped
    FROM fan_wall w
    WHERE w.status='approved'${featured ? ' AND w.featured=1' : ''}
    ORDER BY w.featured DESC, w.applause DESC, w.created_at DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
    { u: Number(userId || 0) });
  return rows.map((w) => ({ ...w, clapped: !!w.clapped, initials: String(w.name || '?').trim().slice(0, 1).toUpperCase(), when: String(w.created_at || '').slice(0, 10) }));
}

export function wallCount() {
  const row = get(`SELECT COUNT(*) AS n FROM fan_wall WHERE status='approved'`);
  return row ? Number(row.n) : 0;
}

/** a page of the wall plus the numbers the pager needs — the review queue never shows here */
export function wallPage({ page = 1, per = 12, userId = null } = {}) {
  const total = wallCount();
  const pages = Math.max(1, Math.ceil(total / per));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  return {
    notes: wallNotes({ limit: per, offset: (current - 1) * per, userId }),
    featured: wallNotes({ limit: 3, featured: true }).slice(0, 3),
    mine: wallMine(userId),
    total, pages, current,
  };
}

export function wallMine(userId) {
  if (!userId) return [];
  return all(`SELECT * FROM fan_wall WHERE user_id=@u ORDER BY id DESC LIMIT 12`, { u: userId });
}

/* --------------------------------------------------------- m&g lotteries */

export function raffleList({ userId = null, tier = 0 } = {}) {
  return all(`SELECT * FROM raffles ORDER BY (status='open') DESC, closes_at DESC, sort, id DESC`).map((r) => {
    const entry = userId ? get(`SELECT * FROM raffle_entries WHERE raffle_id=@r AND user_id=@u`, { r: r.id, u: userId }) : null;
    const tally = get(`SELECT COUNT(*) AS n FROM raffle_entries WHERE raffle_id=@r`, { r: r.id });
    const wins = get(`SELECT COUNT(*) AS n FROM raffle_entries WHERE raffle_id=@r AND status='winner'`, { r: r.id });
    const alts = get(`SELECT COUNT(*) AS n FROM raffle_entries WHERE raffle_id=@r AND status='alternate'`, { r: r.id });
    return {
      ...r,
      entered: !!entry, my_code: entry ? entry.code : null, my_status: entry ? entry.status : null,
      entries: Number(tally?.n || 0), winner_count: Number(wins?.n || 0), alternate_count: Number(alts?.n || 0),
      eligible: tierRank(r.tier_min) <= Number(tier || 0), min_rank: tierRank(r.tier_min),
      draw_open: r.status === 'open', drawn: r.status === 'drawn',
    };
  });
}

/** the draw entries are closing soonest — the home dashboard counts down to this, not to a made-up clock */
export function nextDraw({ userId = null } = {}) {
  const r = get(`SELECT * FROM raffles WHERE status='open' AND closes_at IS NOT NULL ORDER BY closes_at LIMIT 1`);
  if (!r) return null;
  const ms = parseJst(String(r.closes_at).slice(0, 10), (String(r.closes_at).split(' ')[1] || '').slice(0, 5));
  const tally = get(`SELECT COUNT(*) AS n FROM raffle_entries WHERE raffle_id=@r`, { r: r.id });
  const mine = userId ? get(`SELECT code, status FROM raffle_entries WHERE raffle_id=@r AND user_id=@u`, { r: r.id, u: userId }) : null;
  return {
    id: r.id, title: r.title, prize: r.prize, closes_at: r.closes_at, closes_ms: ms,
    entries: Number(tally?.n || 0), winners: Number(r.winners), tier_min: r.tier_min,
    my_code: mine ? mine.code : null, my_status: mine ? mine.status : null,
  };
}

export function raffleById(id, { userId = null, tier = 0 } = {}) {
  const r = get(`SELECT * FROM raffles WHERE id=@id`, { id: Number(id) });
  if (!r) return null;
  const list = raffleList({ userId, tier }).find((x) => x.id === r.id) || { ...r };
  const rows = all(`SELECT code, status, created_at FROM raffle_entries WHERE raffle_id=@r ORDER BY CASE status WHEN 'winner' THEN 0 WHEN 'alternate' THEN 1 ELSE 2 END, code LIMIT 80`, { r: r.id });
  list.winners = rows.filter((x) => x.status === 'winner');
  list.alternates = rows.filter((x) => x.status === 'alternate');
  list.date = r.tour_date_id ? (tourById(r.tour_date_id) || {}).date : null;
  list.show = (() => {
    if (!r.show_id) return null;
    const x = get(`SELECT slug, tour, date, city FROM shows WHERE id=@i`, { i: r.show_id });
    return x ? { ...x, title: `${x.tour} — ${x.city}` } : null;
  })();
  return list;
}

/* ------------------------------------------------------------ the waitlist */

/**
 * A fan leaves an address before tickets go on sale. It is written immediately (there is no
 * second mail to confirm — the site has no mail transport) and it carries a one-click
 * unsubscribe token so the address can be taken back out without an account.
 */
export function notifyAdd({ email, tourDateId, userId = null, source = 'site', tierHint = null }) {
  const clean = String(email || '').trim().toLowerCase().slice(0, 180);
  const date = get(`SELECT id, city, date, status, remaining FROM tour_dates WHERE id=@i`, { i: Number(tourDateId) });
  if (!date) return { ok: false, status: 404, error: 'not_found', message: 'That date is not on this tour.' };
  if (date.status === 'on_sale' && Number(date.remaining) > 0) {
    return { ok: false, status: 409, error: 'on_sale', message: `${date.city} is on sale now — take a seat instead of waiting.`, href: '/tour/#dates' };
  }
  if (parseJst(date.date, '23:59') !== null && parseJst(date.date, '23:59') + 60 * 60 * 1000 < Date.now()) {
    return { ok: false, status: 409, error: 'closed', message: 'That night has already happened.' };
  }
  const state = saleState(date, false);
  if (!['coming_soon', 'waitlist', 'sold_out'].includes(state)) {
    return { ok: false, status: 409, error: 'closed', message: 'That window is not collecting addresses.' };
  }
  const token = `nw_${hash32(`notify|${clean}|${date.id}`).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const dup = get(`SELECT id, status FROM notify_list WHERE lower(email)=@e AND tour_date_id=@d`, { e: clean, d: date.id });
  if (dup) {
    if (dup.status === 'subscribed') {
      const held = get(`SELECT token FROM notify_list WHERE id=@i`, { i: dup.id });
      return { ok: true, already: true, id: dup.id, token: held?.token || null, waiting: (waitCounts().get(Number(date.id)) || 0), city: date.city, date: date.date, message: `You are already on the list for ${date.city}.` };
    }
    run(`UPDATE notify_list SET status='subscribed', token=@t, unsubscribed_at=NULL, user_id=COALESCE(@u, user_id) WHERE id=@i`, { t: token, u: userId, i: dup.id });
    return { ok: true, resumed: true, id: dup.id, token, waiting: (waitCounts().get(Number(date.id)) || 0), city: date.city, date: date.date, message: `Back on the list for ${date.city}.` };
  }
  const info = insert('notify_list', { email: clean, tour_date_id: date.id, user_id: userId, tier_hint: tierHint ? String(tierHint).slice(0, 40) : null, source, token, status: 'subscribed' });
  const saved = get(`SELECT token FROM notify_list WHERE id=@i`, { i: Number(info.lastInsertRowid) });
  return { ok: true, id: Number(info.lastInsertRowid), token: saved?.token || token, city: date.city, date: date.date, waiting: (waitCounts().get(Number(date.id)) || 0), message: `We will write to ${clean} the morning tickets for ${date.city} open.` };
}

export function notifyUnsubscribe(token) {
  const row = get(`SELECT id, tour_date_id, status FROM notify_list WHERE token=@t`, { t: String(token || '') });
  if (!row) return { ok: false, status: 404, message: 'That link has expired or never existed.' };
  if (row.status !== 'subscribed') return { ok: true, already: true, message: 'That address is already off the list.' };
  run(`UPDATE notify_list SET status='unsubscribed', unsubscribed_at=datetime('now') WHERE id=@i`, { i: row.id });
  return { ok: true, message: 'Removed from the waitlist — nothing further will be sent.' };
}

export function notifyRows({ dateId = null, status = null, limit = 400 } = {}) {
  const where = [];
  const p = {};
  if (dateId) { where.push('n.tour_date_id=@d'); p.d = Number(dateId); }
  if (status) { where.push('n.status=@s'); p.s = String(status); }
  const sql = `SELECT n.*, t.city, t.date FROM notify_list n LEFT JOIN tour_dates t ON t.id = n.tour_date_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY n.id DESC LIMIT ${Number(limit)}`;
  return all(sql, p);
}

export function notifyCounts() {
  const byDate = all(`SELECT tour_date_id, COUNT(*) AS n FROM notify_list WHERE status='subscribed' GROUP BY tour_date_id`);
  return {
    total: byDate.reduce((s, r) => s + Number(r.n), 0),
    dates: byDate.length,
    pending_today: Number(get(`SELECT COUNT(*) AS n FROM notify_list WHERE created_at > datetime('now','-1 day')`)?.n || 0),
  };
}

/* ------------------------------------------------------- tour passport */

/**
 * A stamp is a row, not a guess: it is written at the door (or by the desk) and every
 * city on the tour is a slot in the book, so the grid can show what is missing as well
 * as what was collected.
 */
export function passportStamps(userId) {
  const mine = userId ? all(`SELECT * FROM passport_stamps WHERE user_id=@u`, { u: userId }) : [];
  const byDate = new Map(mine.map((m) => [String(m.tour_date_id), m]));
  const rank = membershipFor(userId)?.rank ?? 0;
  return tourAll(200).map((d) => ({
    city: d.city,
    date: d.date,
    id: d.id,
    stamped: byDate.has(String(d.id)),
    stamped_at: byDate.get(String(d.id))?.stamped_at || null,
    code: d.code,
    checkin_open: d.checkin_open,
    can_check_in: d.checkin_open && !byDate.has(String(d.id)),
    past: d.is_past,
    locked: tierRank(d.tier_required) > rank,
  })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function passportSummary(userId) {
  const stamps = passportStamps(userId);
  const have = stamps.filter((s) => s.stamped).length;
  return { stamps, have, total: stamps.length, pct: stamps.length ? Math.round((have / stamps.length) * 100) : 0, cities: [...new Set(stamps.map((s) => s.city))].length };
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
    wall_pending: one(`SELECT COUNT(*) n FROM fan_wall WHERE status='pending'`),
    raffles_open: one(`SELECT COUNT(*) n FROM raffles WHERE status='open'`),
    shows: one(`SELECT COUNT(*) n FROM shows WHERE status='published'`),
    journal: one(`SELECT COUNT(*) n FROM journal_posts`),
    mrr_label: yen(get(`SELECT IFNULL(SUM(price_yen),0) n FROM memberships WHERE status='active'`) ?.n || 0),
    revenue_label: yen(get(`SELECT IFNULL(SUM(total_yen),0) n FROM orders`) ?.n || 0),
  };
}

export { yen };
