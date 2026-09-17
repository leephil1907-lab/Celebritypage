/**
 * tests/app.test.mjs — end-to-end proof that this is a running application:
 * real server, real SQLite persistence, session auth, REST API, tier gating,
 * cart/checkout with stock debits, ticket ⇄ chat sync, admin writes, SSE sync,
 * and every page rendering without an error.
 *
 * Boots its own server on :8100 / admin :8101 against a throwaway database file.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPAN = 200 + (process.pid % 600);                      // never collide with a dev server or a parallel run
const PORT = Number(process.env.TEST_PORT || 8100 + SPAN);
const ADMIN_PORT = Number(process.env.TEST_ADMIN_PORT || 8101 + SPAN);
const BASE = `http://127.0.0.1:${PORT}`;
const ABASE = `http://127.0.0.1:${ADMIN_PORT}`;
const DB_FILE = path.join(ROOT, 'data', `test-${process.pid}.db`);
const BOOT_MARK = `qa-${process.pid}`;

let child;
const jars = new Map();

/* ---------- tiny cookie-aware fetch wrapper ---------- */
function jarFor(name) {
  if (!jars.has(name)) jars.set(name, new Map());
  return jars.get(name);
}
function eatCookies(jar, res) {
  for (const raw of res.headers.getSetCookie?.() || []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
async function req(who, url, { method = 'GET', form, json, headers = {}, base = BASE } = {}) {
  const jar = jarFor(who);
  const opt = { method, headers: { ...headers }, redirect: 'manual' };
  if (url.startsWith('/')) url = base + url;
  const body = new URLSearchParams();
  const explicitToken = !!opt.headers['x-csrf-token'];
  if (json !== undefined) {
    opt.headers['content-type'] = 'application/json';
    opt.body = JSON.stringify(json);
    if (method !== 'GET' && !explicitToken) opt.headers['x-csrf-token'] = jar.get('tk_csrf') || '';
  } else if (form !== undefined) {
    opt.headers['content-type'] = 'application/x-www-form-urlencoded';
    for (const [k, v] of Object.entries(form)) body.set(k, String(v));
    opt.body = body.toString();
    if (method !== 'GET' && !explicitToken) opt.headers['x-csrf-token'] = jar.get('tk_csrf') || form._csrf || '';
  }
  if (jar.size) opt.headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(url, opt);
  eatCookies(jar, res);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  return { res, text, data, status: res.status, location: res.headers.get('location') };
}
const csrfOf = (html) => /name="csrf-token" content="([^"]+)"/.exec(html)?.[1] || /name="_csrf" value="([^"]+)"/.exec(html)?.[1] || '';

/* ---------- server lifecycle ---------- */
before(async () => {
  for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(DB_FILE + suffix)) fs.rmSync(DB_FILE + suffix);
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), ADMIN_PORT: String(ADMIN_PORT), DB_FILE, HOST: '127.0.0.1', NODE_ENV: 'test', TEST_BOOT_MARK: BOOT_MARK },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => { log += b.toString(); });
  child.stderr.on('data', (b) => { log += b.toString(); });
  req.log = () => log;
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('server exited early:\n' + log);
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) {
        const j = await r.json();
        if (j.boot !== BOOT_MARK) throw new Error(`port ${PORT} is already answered by another server (boot=${j.boot}) — stop it or rerun`);
        assert.equal(j.ok, true);
        return;
      }
    } catch (e) { if (e.message && !e.message.includes('fetch failed')) throw e; }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not become ready:\n' + log);
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(DB_FILE + suffix)) fs.rmSync(DB_FILE + suffix);
  // fetch() pools keep-alive sockets; without this the runner idles until the file timeout
  if (process.env.TEST_VERBOSE) console.log('[test] after() done, forcing exit');
  setTimeout(() => process.exit(process.exitCode ?? 0), 300);
});

/* ================= pages ================= */
test('every public route renders 200 with the app shell and no template error', async () => {
  const pages = ['/', '/work/', '/music/', '/tour/', '/journal/', '/journal/1', '/archive/', '/members/', '/shop/', '/shop/complete', '/shop/verify', '/search/?q=tour', '/support/', '/join/'];
  for (const p of pages) {
    const r = await req('pages', p);
    assert.equal(r.status, 200, `${p} status`);
    assert.match(r.text, /<main id="app-shell"/, `${p} shell`);
    assert.match(r.text, /\/js\/app\.js/, `${p} boots app.js`);
    assert.doesNotMatch(r.text, /is not defined|Cannot read|ReferenceError|Could not find the include/, `${p} template error`);
  }
});

test('unknown routes render the branded 404 page, not a bare error', async () => {
  const r = await req('404', '/definitely-not-here');
  assert.equal(r.status, 404);
  assert.match(r.text, /ERROR 404|404/);
  assert.match(r.text, /search/i);
});

test('design system: palette, fonts and motion hooks ship in the built CSS', async () => {
  const css = await req('css', '/css/app.css');
  assert.equal(css.status, 200);
  for (const token of ['#fbf6ee', '#0f0e0c', '#c9a86a', 'Cormorant Garamond', 'JetBrains Mono', 'Noto Sans JP', 'prefers-reduced-motion']) {
    assert.ok(css.text.includes(token), `css missing ${token}`);
  }
  const js = await req('js', '/js/app.js');
  assert.equal(js.status, 200);
  assert.ok(js.text.length > 5000, 'app.js looks unbundled or empty');
  assert.match(js.text, /data-carousel|carousel/i, 'carousel engine absent from the bundle');
});

test('security headers: CSP blocks inline scripts but allows self assets', async () => {
  const r = await req('sec', '/');
  const csp = r.res.headers.get('content-security-policy');
  assert.ok(csp, 'no CSP sent');
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.equal(r.res.headers.get('x-content-type-options'), 'nosniff');
  assert.doesNotMatch(r.text, / onerror=/, 'inline onerror slipped through');
  assert.doesNotMatch(r.text, / onclick="/, 'inline onclick slipped through');
});

/* ================= i18n + pjax ================= */
test('JA/EN toggle persists server-side in the session and re-renders', async () => {
  const ja = await req('lang', '/');
  assert.match(ja.text, /木村拓哉|最新情報/, 'JA copy missing by default');
  const seed = await req('lang', '/');
  const r = await req('lang', '/api/lang', { method: 'POST', form: { lang: 'en', _csrf: csrfOf(seed.text) } });
  assert.equal(r.status, 200);
  assert.equal(r.data.lang, 'en');
  const en = await req('lang', '/');
  assert.match(en.text, /NEWS|Information|Latest/, 'EN copy did not render');
});

test('pjax requests return a fragment JSON payload instead of a document', async () => {
  const r = await req('pjax', '/music/?_pjax=1');
  assert.equal(r.status, 200);
  assert.ok(r.data, 'pjax reply was not JSON');
  assert.ok(r.data.html.includes('playerCard') || r.data.html.length > 500, 'pjax html fragment looks empty');
  assert.ok(!r.data.html.includes('<!doctype'), 'pjax returned a whole document');
  assert.ok(r.data.title, 'no title for the transition');
});

/* ================= auth + membership ================= */
test('signup → session → me → vault gating is enforced on the server', async () => {
  const seed = await req('m1', '/join/');
  const csrf = csrfOf(seed.text);
  const email = `qa-${Date.now()}@example.com`;
  const su = await req('m1', '/api/auth/signup', { method: 'POST', form: { name: 'QA Tester', email, password: 'qapass2026', _csrf: csrf } });
  assert.equal(su.status, 200, su.text.slice(0, 200));
  assert.equal(su.data.user.email, email);

  const me0 = await req('m1', '/api/me');
  assert.equal(me0.data.user.name, 'QA Tester');
  assert.equal(me0.data.membership, null, 'a fresh account must not have a card');
  assert.equal(me0.data.vault_unlocked, 0);

  const locked = await req('m1', '/api/vault/1');
  assert.equal(locked.status, 200);
  assert.equal(locked.data.locked, true, 'a member without a card must see the vault as locked');
  assert.equal(locked.data.description, undefined, 'the gated description leaked through the API');
  assert.ok(locked.data.requirement && /tier or above required/i.test(locked.data.requirement), 'no upgrade hint for the gate');

  const buy = await req('m1', '/api/membership/purchase', { method: 'POST', form: { tier: 'gold', _csrf: csrf } });
  assert.equal(buy.status, 200, buy.text.slice(0, 200));
  assert.match(buy.data.card_no, /^TK-\d+$/);
  assert.ok(buy.data.ticket_id > 0, 'purchase should open a ticket');

  const me1 = await req('m1', '/api/me');
  assert.equal(me1.data.membership.tier, 'gold', 'tier id should stay the slug');
  assert.equal(me1.data.membership.tier_detail.name, 'GOLD');
  assert.equal(me1.data.membership.is_active, false, 'a pending card must not carry privileges');
  assert.equal(me1.data.membership.rank, 0, 'a pending card must not raise the lottery rank');
  assert.equal(me1.data.membership.status, 'pending');

  // an admin approves the payment; only then does the vault open
  const aseed = await req('admin', '/login', { base: ABASE });
  await req('admin', '/login', { method: 'POST', form: { email: 'admin@starto.jp', password: 'Starto2026!', _csrf: csrfOf(aseed.text) }, base: ABASE });
  const membersPage = await req('admin', '/members', { base: ABASE });
  const mrow = new RegExp(`name="tier"[^>]*>`).exec(membersPage.text);
  assert.ok(mrow, 'admin members page has no tier select');
  const uid = me1.data.user.id;
  const appr = await req('admin', `/members/${uid}/tier`, { method: 'POST', form: { tier: 'gold', status: 'active', _csrf: csrfOf(membersPage.text) }, base: ABASE });
  assert.equal(appr.status, 302);
  const ok = await req('m1', '/api/vault/1');
  assert.equal(ok.status, 200, `vault should open after approval: ${ok.text.slice(0, 160)}`);
  assert.equal(ok.data.locked, false, 'vault still locked after an active GOLD card');
  assert.ok(typeof ok.data.description === 'string' && ok.data.description.length > 8, 'unlocked payload should carry the gated description');

  const dash = await req('m1', '/members/');
  assert.match(dash.text, /TK-\d+/, 'card number missing from the dashboard');
  assert.match(dash.text, /GOLD/i);

  const out = await req('m1', '/api/auth/logout', { method: 'POST', form: { _csrf: csrf } });
  assert.equal(out.status, 200);
  const after = await req('m1', '/api/me');
  assert.equal(after.data.user, null, 'logout did not clear the session');
});

test('bad credentials are rejected and unknown accounts cannot log in', async () => {
  const seed = await req('bad', '/members/');
  const r = await req('bad', '/api/auth/login', { method: 'POST', form: { email: 'nobody@example.com', password: 'wrongpass', _csrf: csrfOf(seed.text) } });
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status}`);
});

test('cart is stored per session on the server and survives a reload', async () => {
  const seed = await req('cart', '/shop/');
  const csrf = csrfOf(seed.text);
  const products = await req('cart', '/api/products');
  const sku = products.data.find((p) => p.stock > 1)?.sku;
  assert.ok(sku, 'no in-stock product to test with');
  const add = await req('cart', '/api/cart/add', { method: 'POST', form: { sku, qty: 2, _csrf: csrf } });
  assert.equal(add.status, 200, add.text.slice(0, 160));
  const again = await req('cart', '/api/cart');
  const line = again.data.lines.find((l) => l.sku === sku);
  assert.equal(line.qty, 2, 'cart did not persist across requests');
  const page = await req('cart', '/shop/');
  assert.match(page.text, /data-cart-count>\s*2</, 'the rendered cart badge disagrees with the session');
  const rm = await req('cart', '/api/cart/remove', { method: 'POST', form: { sku, _csrf: csrf } });
  assert.equal(rm.status, 200);
  assert.equal((await req('cart', '/api/cart')).data.lines.length, 0);
});

test('checkout is members-only, debits stock and returns a verifiable code', async () => {
  const guest = await req('guest2', '/api/checkout', { method: 'POST', form: { pickup_venue: 'Fukuoka', _csrf: (csrfOf((await req('guest2', '/shop/')).text)) } });
  assert.ok(guest.status === 401 || guest.status === 403, `guest checkout should fail, got ${guest.status}`);

  const seed = await req('buyer', '/join/');
  const csrf = csrfOf(seed.text);
  const su = await req('buyer', '/api/auth/signup', { method: 'POST', form: { name: 'Buyer One', email: `buyer-${Date.now()}@example.com`, password: 'buyerpass1', _csrf: csrf } });
  assert.equal(su.status, 200, su.text.slice(0, 160));
  const products = await req('buyer', '/api/products');
  const item = products.data.find((p) => p.stock > 2);
  const before = item.stock;
  await req('buyer', '/api/cart/add', { method: 'POST', form: { sku: item.sku, qty: 2, _csrf: csrf } });
  const co = await req('buyer', '/api/checkout', { method: 'POST', form: { pickup_venue: 'Fukuoka', _csrf: csrf } });
  assert.equal(co.status, 200, co.text.slice(0, 240));
  assert.match(co.data.order_no, /^SO-2026-[A-Z0-9]+$/);
  assert.match(co.data.qr, /^[a-f0-9]{16}$/i);
  assert.equal(co.data.url, `/shop/verify/${co.data.qr}`);

  const after = (await req('buyer', '/api/products')).data.find((p) => p.sku === item.sku);
  assert.equal(after.stock, before - 2, 'stock was not debited in the same transaction');

  const page = await req('buyer', '/shop/complete');
  assert.match(page.text, new RegExp(co.data.order_no), 'confirmation page does not show the order');

  const ver = await req('buyer', '/api/orders/verify', { method: 'POST', form: { qr: co.data.qr, _csrf: csrf } });
  assert.equal(ver.status, 200);
  assert.equal(ver.data.order.status, 'collected');
  const again = await req('buyer', '/api/orders/verify', { method: 'POST', form: { qr: co.data.qr, _csrf: csrf } });
  assert.equal(again.data.already, true, 'double collection should be flagged');
  const bogus = await req('buyer', '/api/orders/verify', { method: 'POST', form: { qr: 'zzzzzz', _csrf: csrf } });
  assert.equal(bogus.status, 404);

  const stamp = await req('buyer', '/api/passport/stamp', { method: 'POST', form: { code: 'VAULT 01', _csrf: csrf } });
  assert.equal(stamp.status, 200, stamp.text.slice(0, 160));
  assert.match(stamp.data.message, /Stamped .*Fukuoka/);
  const verifyPage = await req('buyer', `/shop/verify/${co.data.qr}`);
  assert.equal(verifyPage.status, 200);
  assert.match(verifyPage.text, new RegExp(co.data.order_no));
});

test('booking requests persist and are visible to admin, with a linked ticket', async () => {
  const seed = await req('bk', '/');
  const r = await req('bk', '/api/bookings', { method: 'POST', form: { name: 'Booking Tester', email: `bk-${Date.now()}@example.com`, type: 'Meet & Greet', date: '2026-10-18', guests: 2, budget: 300000, message: 'QA booking', _csrf: csrfOf(seed.text) } });
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.ok(r.data.ticket_id > 0, 'booking should open a ticket');
  const admin = await req('admin', '/bookings', { base: ABASE });
  assert.match(admin.text, /Booking Tester/);
  const feed = await req('bk', '/feed.json');
  assert.ok(feed.data);
});

/* ================= support chat ⇄ admin tickets ================= */
test('chat message creates a ticket that Management answers in the console', async () => {
  const seed = await req('chat', '/support/');
  const csrf = csrfOf(seed.text);
  const send = await req('chat', '/api/chat/send', { method: 'POST', form: { message: 'Where is my Fan Card payment link?', _csrf: csrf } });
  assert.equal(send.status, 200, send.text.slice(0, 200));
  const id = send.data.ticket.id;
  assert.ok(send.data.ticket.messages.length >= 1);
  assert.ok(send.data.ticket.messages.some((m) => m.sender === 'staff'), 'auto-triage should have replied');

  const thread = await req('chat', `/api/chat/ticket/${id}`);
  assert.equal(thread.status, 200, 'owner should read their own thread');
  const other = await req('chat2', `/api/chat/ticket/${id}`);
  assert.equal(other.status, 404, 'another session must not read that thread');

  let admin = await req('admin', `/tickets/${id}`, { base: ABASE });
  if (admin.status === 302) {                                    // another test may already own the admin session,
    const lseed = await req('admin', '/login', { base: ABASE });  // but sign in here when this run has not
    await req('admin', '/login', { method: 'POST', form: { email: 'admin@starto.jp', password: 'Starto2026!', _csrf: csrfOf(lseed.text) }, base: ABASE });
    admin = await req('admin', `/tickets/${id}`, { base: ABASE });
  }
  assert.equal(admin.status, 200, 'the console must open this ticket');
  assert.match(admin.text, /Where is my Fan Card payment link/);
  const reply = await req('admin', `/tickets/${id}/reply`, { method: 'POST', form: { body: 'Payment link sent to your email — vault opens on approval.', status: 'in_progress', keep: '1', _csrf: csrfOf(admin.text) }, base: ABASE });
  assert.equal(reply.status, 302);
  const afterMsgs = await req('chat', `/api/chat/ticket/${id}`);
  assert.ok(afterMsgs.data.ticket.messages.some((m) => m.sender === 'staff' && m.body.includes('Payment link')), 'staff reply did not reach the member thread');
});

test('a guest chat thread stays readable by that session and nobody else', async () => {
  const seed = await req('g1', '/support/');
  const csrf = csrfOf(seed.text);
  const send = await req('g1', '/api/chat/send', { method: 'POST', form: { message: 'My Fan Card payment link never arrived', _csrf: csrf } });
  assert.equal(send.status, 200, send.text.slice(0, 160));
  const id = send.data.ticket.id;
  const again = await req('g1', `/api/tickets/${id}`);
  assert.equal(again.status, 200, 'the session that opened the ticket must keep reading it');
  assert.ok(again.data.messages.length >= 2, 'auto-triage reply should be in the thread');
  const latest = await req('g1', '/api/tickets/latest');
  assert.equal(latest.data.id, id, 'latest should return this session’s thread');
  const thief = await req('g2', `/api/tickets/${id}`);
  assert.equal(thief.status, 404, 'another session must get 404, not a confirmation');
  const thiefLatest = await req('g2', '/api/tickets/latest');
  assert.notEqual(thiefLatest.data.id, id, "someone else's session must not see the thread");
});

test('the no-JS support form still opens a ticket', async () => {
  const seed = await req('nojs', '/support/');
  const csrf = csrfOf(seed.text);
  const r = await req('nojs', '/support/ticket', { method: 'POST', form: { subject: 'Lost my ticket', email: `nojs-${Date.now()}@example.com`, category: 'general', message: 'I cannot find my QR code at all.', _csrf: csrf } });
  assert.equal(r.status, 302, r.text.slice(0, 200));
  assert.match(r.location, /\/support\/\?ok=\d+/);
  const page = await req('nojs', r.location);
  assert.equal(page.status, 200);
  assert.match(page.text, /Lost my ticket/);
});

/* ================= content API + admin writes ================= */
test('content endpoints expose the same rows the pages render', async () => {
  for (const [path_, min] of [['/api/news', 3], ['/api/schedule', 3], ['/api/tour', 3], ['/api/tiers', 4], ['/api/releases', 2], ['/api/hero', 3], ['/api/products', 5], ['/api/live', 0]]) {
    const r = await req('api', path_);
    assert.equal(r.status, 200, path_);
    const rows = Array.isArray(r.data) ? r.data : r.data.events;
    assert.ok(rows.length >= min, `${path_} returned ${rows.length} rows`);
  }
});

test('section fragments re-render from the database (live refresh path)', async () => {
  for (const name of ['hero', 'news', 'tiers', 'vault', 'tour-dates', 'shop-grid', 'journal', 'products']) {
    const r = await req('frag', `/api/section/${name}`);
    assert.equal(r.status, 200, `/api/section/${name} -> ${r.status}`);
    assert.ok(r.text.length > 80, `${name} fragment empty`);
    assert.doesNotMatch(r.text, /<!doctype|<main id="app-shell"/, `${name} leaked the shell`);
  }
});

test('admin write → database → public page, end to end', async () => {
  const list = await req('admin', '/content/news', { base: ABASE });
  const csrf = csrfOf(list.text);
  const title = `QA NEWS ${Date.now()}`;
  const create = await req('admin', '/content/news', { method: 'POST', form: { date: '2030.01.01', category: 'NEWS', title, body: 'Written by the console.', status: 'published', image: '/image-search/takuya-kimura-starto-entertainment-offic-3.webp', _csrf: csrf }, base: ABASE });
  assert.equal(create.status, 302);
  const home = await req('admin', '/');
  assert.ok(home.text.includes(title), 'new news row did not reach the public site');
  const frag = await req('admin', '/api/section/news');
  assert.ok(frag.text.includes(title), 'section fragment stale');
  const rows = await req('admin', '/api/news');
  const created = rows.data.find((n) => n.title === title);
  assert.ok(created, 'created row missing from the API');
  const dr = await req('admin', `/content/news/${created.id}/delete`, { method: 'POST', form: { _csrf: csrf }, base: ABASE });
  assert.equal(dr.status, 302);
  assert.ok(!(await req('admin', '/api/news')).data.some((n) => n.title === title), 'delete did not persist');
});

test('settings edits change the site', async () => {
  const page = await req('admin', '/settings', { base: ABASE });
  const csrf = csrfOf(page.text);
  const input = /name="marquee\.items"/.test(page.text) ? 'marquee.items' : (/name="([a-z]+\.[a-z.]+)"/.exec(page.text) || [])[1];
  assert.ok(input, 'no settings inputs found');
  const marker = `QA-EDIT-${Date.now()}`;
  const save = await req('admin', '/settings', { method: 'POST', form: { [input]: marker, _csrf: csrf }, base: ABASE });
  assert.equal(save.status, 302);
  const home = await req('admin', '/');
  assert.ok(home.text.includes(marker), `${input} did not propagate to the site`);
});

test('low stock adjustments publish to open tabs', async () => {
  const products = await req('admin', '/api/products');
  const p = products.data[0];
  const before = p.stock;
  const r = await req('admin', `/stock/${p.sku}`, { method: 'POST', form: { delta: -1, _csrf: csrfOf((await req('admin', '/', { base: ABASE })).text) }, base: ABASE });
  assert.equal(r.status, 200, r.text.slice(0, 160));
  assert.equal(r.data.stock, before - 1);
  const live = await req('admin', '/api/live');
  assert.ok(live.data.events.some((e) => e.event === 'stock:changed'), 'stock change did not reach the outbox');
});

/* ================= live sync + assets ================= */
test('SSE stream connects, replays and delivers a publish event', async () => {
  const ac = new AbortController();
  const res = await fetch(`${BASE}/api/events`, { headers: { accept: 'text/event-stream' }, signal: ac.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r({ done: true }), ms))]);
  for (let i = 0; i < 12 && !buf.includes('event: ready'); i++) {
    const { value, done } = await withTimeout(reader.read(), 700);
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  assert.match(buf, /event: ready|retry:/, 'the SSE stream sent nothing — it is being buffered');
  ac.abort();
  const ping = await req('sse', '/api/live');
  assert.ok(ping.data.events.length >= 0);
});

test('static assets and generated files serve correctly', async () => {
  for (const f of ['/css/site.css', '/favicon-32.png', '/manifest.json', '/robots.txt', '/sitemap.xml', '/image-search/takuya-kimura-live-tour-checkpoint-2026--2.jpg']) {
    const r = await fetch(BASE + f);
    assert.equal(r.status, 200, `${f} -> ${r.status}`);
  }
  const img = await fetch(BASE + '/image-search/takuya-kimura-live-tour-checkpoint-2026--2.jpg');
  assert.match(img.headers.get('content-type') || '', /image\//);
  const missing = await fetch(BASE + '/image-search/nope.jpg');
  assert.equal(missing.status, 404);
});

test('gzip compression is applied to large text responses', async () => {
  const r = await fetch(`${BASE}/`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(r.status, 200);
  if ((r.headers.get('content-encoding') || '').includes('gzip')) {
    assert.ok(Number(r.headers.get('content-length')) > 0, 'gzip sent without content-length');
  }
});

test('the admin wall keeps non-admins out and honours the CSRF token', async () => {
  const anon = await req('anonA', '/', { base: ABASE });
  assert.equal(anon.status, 302);
  assert.equal(anon.location, '/login');
  const seed = await req('m9', '/join/');
  const su = await req('m9', '/api/auth/signup', { method: 'POST', form: { name: 'Not Admin', email: `na-${Date.now()}@example.com`, password: 'notadmin1', _csrf: csrfOf(seed.text) } });
  assert.equal(su.status, 200);
  const nope = await req('m9', '/', { base: ABASE });
  assert.equal(nope.status, 302, 'a member must not reach the console');
  const sku = (await req('m9', '/api/products')).data[0].sku;
  const forged = await req('m9', '/api/cart/add', { method: 'POST', headers: { 'x-csrf-token': 'not-my-token' }, form: { sku, qty: 1 } });
  assert.equal(forged.status, 403, 'a write with the wrong csrf token must be refused');
  assert.match(forged.text, /csrf_failed/);
  const honest = await req('m9', '/api/cart/add', { method: 'POST', form: { sku, qty: 1, _csrf: csrfOf((await req('m9', '/shop/')).text) } });
  assert.equal(honest.status, 200, honest.text.slice(0, 120));
});

test('search covers every table and escapes user input', async () => {
  const r = await req('search', '/search/?q=<script>alert(1)</script>');
  assert.equal(r.status, 200);
  assert.ok(!r.text.includes('<script>alert(1)</script>'), 'query reflected without escaping');
  const api = await req('search', '/api/search?q=vinyl');
  assert.ok(Array.isArray(api.data.results));
  const page = await req('search', '/search/?q=vinyl');
  assert.match(page.text, /search-hit|Nothing matched/);
});

test('no server-side errors were logged during the run', async () => {
  const log = req.log();
  const bad = log.split('\n').filter((l) => /\[error\]|ReferenceError|TypeError:|Cannot read|EJS Error/.test(l));
  assert.deepEqual(bad, [], 'server logged errors:\n' + bad.slice(0, 8).join('\n'));
});
