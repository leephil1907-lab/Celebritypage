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

  // the kiosk stamps against the code on the board by the door — the feed carries it per date
  const dates = await req('buyer', '/api/tour');
  const open = (dates.data || []).find((d) => d.can_check_in);
  assert.ok(open && open.code, 'an in-window date should come back with its door code');
  const stamp = await req('buyer', '/api/passport/stamp', { method: 'POST', form: { code: open.code, _csrf: csrf } });
  assert.equal(stamp.status, 200, stamp.text.slice(0, 160));
  assert.match(stamp.data.message, new RegExp(`Stamped .* ${open.city}`));
  const twice = await req('buyer', '/api/passport/stamp', { method: 'POST', form: { code: open.code, _csrf: csrf } });
  assert.equal(twice.data.already, true, 'a date is stamped once per member');
  const nope = await req('buyer', '/api/passport/stamp', { method: 'POST', form: { code: 'NOPE-9999', _csrf: csrf } });
  assert.equal(nope.status, 404, 'a code that is not on this tour is refused');
  const row = (await req('buyer', '/api/me')).data.stamps.find((x) => x.id === open.id);
  assert.ok(row && row.stamped, 'the passport should show the stamp it just took');
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

/* ============ phase 6: the waitlist, the locator, and what an account is for ============ */
const comingSoon = async (who) => (await req(who, '/api/tour')).data.find((d) => d.sale_state === 'coming_soon');

test('a coming-soon row carries the waitlist form and a map that is drawn, not fetched', async () => {
  const page = await req('p6page', '/tour/');
  assert.equal(page.status, 200);
  assert.match(page.text, /data-notify-form/, 'the waitlist form must be in the markup, not added by JS');
  assert.match(page.text, /<svg class="vm-svg"/, 'the venue locator must render server-side');
  assert.ok(!/tile|openstreetmap\.org\/[^"]*\.(png|jpg)/.test(page.text), 'no tile server may be referenced');
  const i = page.text.indexOf('is-coming_soon');
  assert.ok(i > 0, 'the pre_sale row has to be on the list at all');
  const row = page.text.slice(i, i + 12000);
  assert.match(row, /name="email"/);
  assert.match(row, /name="company"/, 'the honeypot field ships with the form');
  assert.match(row, /data-notify-msg/, 'and there is somewhere to put the answer');
  assert.match(row, /osm\.org\/map|google\.com\/maps/, 'directions links point at the real maps');
});

test('the priority window is removed from the anonymous feed rather than hidden', async () => {
  const soon = await comingSoon('p6anon');
  assert.ok(soon, 'the seeded tour has a pre_sale date');
  assert.equal(soon.presale_at, undefined);
  assert.equal(soon.presale_ms, undefined);
  assert.equal(soon.presale_visible, false);
  assert.equal(soon.gate_open, false);
  assert.ok(soon.map && soon.map.lat && soon.map.lng, 'where the room is stays public');
  const page = await req('p6anon', '/tour/');
  assert.ok(!page.text.includes(soon.presale_at), 'nothing can leak a window it never received');
});

test('a member below the required tier stays locked out; the tier that qualifies sees the date', async () => {
  const seedLow = await req('p6gold', '/join/');
  const inLow = await req('p6gold', '/api/auth/login', { method: 'POST', form: { email: 'marc@example.com', password: 'Starto2026!', _csrf: csrfOf(seedLow.text) } });
  assert.equal(inLow.status, 200, inLow.text.slice(0, 140));
  const low = (await req('p6gold', '/api/tour')).data.find((d) => d.sale_state === 'coming_soon');
  assert.equal(low.gate_open, false, 'gold must not open a platinum window');
  assert.equal(low.presale_at, undefined);
  const seedHigh = await req('p6plat', '/join/');
  await req('p6plat', '/api/auth/login', { method: 'POST', form: { email: 'aiko@example.com', password: 'Starto2026!', _csrf: csrfOf(seedHigh.text) } });
  const high = (await req('p6plat', '/api/tour')).data.find((d) => d.sale_state === 'coming_soon');
  assert.equal(high.gate_open, true);
  assert.equal(high.presale_visible, true);
  assert.match(String(high.presale_at), /^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}$/, 'the window is a date and an hour, not a boolean');
  const page = await req('p6plat', '/tour/');
  assert.ok(page.text.includes(String(high.presale_at).slice(0, 10)), 'and the page shows it');
});

test('an address is captured once, answered with the key to leave, and the marker puts the row back', async () => {
  const soon = await comingSoon('p6join');
  const email = `wait-${Date.now()}@example.com`;
  const join = await req('p6join', '/api/notify', { method: 'POST', json: { email, tour_date_id: soon.id } });
  assert.equal(join.status, 201, join.text.slice(0, 160));
  assert.equal(join.data.ok, true);
  assert.ok(join.data.token, 'the reply has to hand back the capability to unsubscribe');
  const dupe = await req('p6join', '/api/notify', { method: 'POST', json: { email, tour_date_id: soon.id } });
  assert.equal(dupe.status, 200);
  assert.equal(dupe.data.already, true);
  assert.equal(dupe.data.ok, true, 'a second ask is not an error, it is the same answer');
  const listed = (await req('p6join', '/api/tour')).data.find((d) => d.id === soon.id);
  assert.equal(listed.on_list, true, 'the browser marker must be honoured by the row');
  assert.equal(listed.waiting, (soon.waiting || 0) + 1);
  const off = await req('p6join', '/api/notify/leave', { method: 'POST', json: { token: join.data.token, tour_date_id: soon.id } });
  assert.equal(off.status, 200, off.text.slice(0, 140));
  const after = (await req('p6join', '/api/tour')).data.find((d) => d.id === soon.id);
  assert.equal(after.on_list, false, 'leaving has to be real, not cosmetic');
  await req('p6leave', '/tour/');                                  // a jar needs its csrf cookie before it may write
  const ghost = await req('p6leave', '/api/notify/leave', { method: 'POST', json: { token: 'nw_nobody_here' } });
  assert.equal(ghost.status, 404);
});

test('bad input, a bot and a date already on sale are refused; five asks in a day is the end of it', async () => {
  const soon = await comingSoon('p6refuse');
  const bad = await req('p6refuse', '/api/notify', { method: 'POST', json: { email: 'not-an-address', tour_date_id: soon.id } });
  assert.equal(bad.status, 422);
  assert.equal(bad.data.field, 'email');
  const bot = await req('p6refuse', '/api/notify', { method: 'POST', json: { email: `bot-${Date.now()}@example.com`, tour_date_id: soon.id, company: 'CLICK-TICKETS-FAST' } });
  assert.equal(bot.status, 201, 'a bot must be thanked, not told it was caught');
  const onSale = (await req('p6refuse', '/api/tour')).data.find((d) => d.sale_state === 'on_sale' && !d.is_past);
  assert.ok(onSale, 'the tour has a date on sale to refuse');
  const early = await req('p6refuse', '/api/notify', { method: 'POST', json: { email: `early-${Date.now()}@example.com`, tour_date_id: onSale.id } });
  assert.equal(early.status, 409);
  assert.equal(early.data.error, 'on_sale');
  assert.ok(early.data.href, 'and it says where to go instead');

  const spam = `many-${Date.now()}@example.com`;
  const eligible = (await req('p6refuse', '/api/tour')).data
    .filter((d) => ['coming_soon', 'waitlist', 'sold_out'].includes(d.sale_state) && !d.is_past)
    .slice(0, 5);
  assert.ok(eligible.length >= 4, 'the seeded tour needs enough waiting dates to prove the cap');
  await req('p6many', '/tour/');                                    // fresh jar, so it needs its own csrf cookie
  for (const d of eligible) {
    const r = await req('p6many', '/api/notify', { method: 'POST', json: { email: spam, tour_date_id: d.id } });
    assert.equal(r.status, 201, `${d.city}: ${r.text.slice(0, 120)}`);
  }
  const last = await req('p6many', '/api/notify', { method: 'POST', json: { email: spam, tour_date_id: soon.id } });
  assert.equal(last.status, 429, `the ${eligible.length + 1}th ask in a day should be refused, got ${last.status}`);
  assert.equal(last.data.error, 'rate_limited');
});

test('the no-JS door takes the same rules and lands back on the row', async () => {
  const seed = await req('p6njs', '/tour/');
  const soon = (await req('p6njs', '/api/tour')).data.find((d) => d.sale_state === 'coming_soon');
  const door = await req('p6njs', '/tour/notify', { method: 'POST', form: { email: `njs-${Date.now()}@example.com`, tour_date_id: soon.id, back: '/tour/', _csrf: csrfOf(seed.text) } });
  assert.equal(door.status, 302);
  assert.match(door.location, /\/tour\/\?flash=notify_in#date-\d+$/, door.location);
  const again = await req('p6njs', '/tour/');
  assert.match(again.text, /ON THE LIST|待機リスト登録済み/, 'the row has to admit it is on the list');
  assert.match(again.text, /data-leave-form/, 'and hand back the way off without a reload');
});

test('the desk queue is readable, exportable, and read-only', async () => {
  const aseed = await req('p6admin', '/login', { base: ABASE });
  const li = await req('p6admin', '/login', { method: 'POST', base: ABASE, form: { email: 'admin@starto.jp', password: 'Starto2026!', _csrf: csrfOf(aseed.text) } });
  assert.equal(li.status, 302, 'admin login must work for the queue to be judged');
  const screen = await req('p6admin', '/content/notify', { base: ABASE });
  assert.equal(screen.status, 200);
  assert.match(screen.text, /read-only/);
  assert.ok(!screen.text.includes('id="rowForm"'), 'no editor may be offered on a queue the desk does not write');
  const csv = await req('p6admin', '/content/notify/export.csv', { base: ABASE });
  assert.equal(csv.status, 200);
  assert.match(csv.res.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text, /^date,city,email,status,source,tier_hint,added_at/);
  const write = await req('p6admin', '/content/notify', { method: 'POST', base: ABASE, form: { email: 'forged@example.com', _csrf: csrfOf(screen.text) } });
  assert.equal(write.status, 405, 'a read-only resource must refuse a write');
});

test('a single-origin host serves the site and the console side by side', async () => {
  const cport = PORT + 30;
  const cbase = `http://127.0.0.1:${cport}`;
  const cdb = path.join(ROOT, 'data', `test-combined-${process.pid}.db`);
  for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(cdb + suffix)) fs.rmSync(cdb + suffix);
  const extra = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { ...process.env, COMBINED: '1', PORT: String(cport), ADMIN_PORT: String(cport + 1), DB_FILE: cdb, HOST: '127.0.0.1', NODE_ENV: 'test', TEST_BOOT_MARK: `${BOOT_MARK}-c` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let clog = '';
  extra.stdout.on('data', (b) => { clog += b.toString(); });
  extra.stderr.on('data', (b) => { clog += b.toString(); });
  try {
    const deadline = Date.now() + 25000;
    let up = false;
    while (Date.now() < deadline && !up) {
      if (extra.exitCode !== null) throw new Error('combined server exited:\n' + clog);
      try { up = (await fetch(`${cbase}/healthz`)).ok; } catch { await new Promise((r) => setTimeout(r, 150)); }
    }
    assert.ok(up, 'the combined server never came up:\n' + clog.slice(0, 400));

    const home = await req('comb', '/', { base: cbase });
    assert.equal(home.status, 200, 'the public site must answer on the same origin');
    assert.match(home.text, /tour-card|is-coming_soon|tour-grid/);

    const gate = await req('comb', '/admin/', { base: cbase });
    assert.equal(gate.status, 302, 'the console is behind a login even when mounted');
    assert.match(gate.location, /^\/admin\/login/, `the redirect has to stay under the mount, got ${gate.location}`);
    const anon = await req('comb', '/admin/content/tour', { base: cbase });
    assert.equal(anon.status, 302, 'no session, no content');

    const seedPage = await req('comb', '/admin/login', { base: cbase });
    assert.equal(seedPage.status, 200);
    assert.match(seedPage.text, /href="\/admin\/static\/css\/admin\.css"/, 'assets have to be asked for under the mount');
    const css = await req('comb', '/admin/static/css/admin.css', { base: cbase });
    assert.equal(css.status, 200, 'the console stylesheet must resolve on the shared origin');
    const js = await req('comb', '/admin/static/js/admin.js', { base: cbase });
    assert.equal(js.status, 200, 'the console script must resolve on the shared origin');

    const signed = await req('comb', '/admin/login', { method: 'POST', base: cbase, form: { email: 'admin@starto.jp', password: 'Starto2026!', _csrf: csrfOf(seedPage.text) } });
    assert.equal(signed.status, 302, 'login has to land back inside the mount');
    assert.match(signed.location, /^\/admin\/?$/, signed.location);

    const dash = await req('comb', '/admin/', { base: cbase });
    assert.equal(dash.status, 200);
    const hrefs = [...new Set([...dash.text.matchAll(/href="(\/admin\/[^"#]*)"/g)].map((m) => m[1]))];
    assert.ok(hrefs.length >= 6, `the mounted console has to emit its links under the mount — got ${hrefs.length}`);
    for (const href of hrefs) {
      const r = await req('comb', href, { base: cbase });
      assert.ok(r.status < 400, `${href} answered ${r.status} on the mounted console`);
    }
    const editor = await req('comb', '/admin/content/notify', { base: cbase });
    assert.equal(editor.status, 200);
    assert.match(editor.text, /read-only/);

    // a write has to survive the shared request too: the body stream is read once, by whoever gets it first
    const mk = await req('comb', '/admin/content/tour', { method: 'POST', base: cbase, form: { tour: 'Live Tour 2026 Checkpoint', date: '2027.09.09', time: '18:00', city: 'Test City', venue: 'Test Hall', status: 'pre_sale', capacity: 10, remaining: 10, sort: 99, _csrf: csrfOf(dash.text) } });
    assert.equal(mk.status, 302, `a console write over the mount must succeed, got ${mk.status}`);
    const back = await req('comb', '/admin/content/tour', { base: cbase });
    const rowId = [...back.text.matchAll(/data-row="(\d+)"[^>]*data-text="2027\.09\.09 test city/g)].map((m) => m[1])[0];
    assert.ok(rowId, 'the row the console just wrote has to be in the list');
    const rm = await req('comb', `/admin/content/tour/${rowId}/delete`, { method: 'POST', base: cbase, form: { _csrf: csrfOf(back.text) } });
    assert.equal(rm.status, 302);
    const gone = await req('comb', '/admin/content/tour', { base: cbase });
    assert.ok(!gone.text.includes('Test City'), 'and deleting it removes it again');

    const missing = await req('comb', '/admin/no-such-screen', { base: cbase });
    assert.equal(missing.status, 404, 'a bad console path is a 404, not a crash');
    const deadSite = await req('comb', '/no-such-page/', { base: cbase });
    assert.equal(deadSite.status, 404);
    assert.ok(!/ReferenceError|TypeError:|Cannot read/.test(clog), 'combined server logged:\n' + clog.split('\n').filter((l) => /Error/.test(l)).slice(0, 4).join('\n'));
  } finally {
    if (extra.exitCode === null) extra.kill('SIGKILL');
    for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(cdb + suffix)) fs.rmSync(cdb + suffix);
  }
});

test('a read-only project directory still boots — state moves to the scratch tree', async () => {
  /* what a Vercel (or any readOnlyRootFilesystem) host does to the app: the code dir cannot be
     written, so the database must be created somewhere the process may still touch, and the boot
     has to say so instead of failing quietly on the first request. */
  const rport = PORT + 61;
  const rbase = `http://127.0.0.1:${rport}`;
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', `starto-ro-${process.pid}-`));
  const ro = path.join(tmp, 'task');
  const scratch = path.join(tmp, 'scratch');
  fs.mkdirSync(path.join(ro, 'data'), { recursive: true });
  fs.mkdirSync(path.join(ro, 'uploads'), { recursive: true });
  fs.mkdirSync(scratch, { recursive: true });
  fs.chmodSync(path.join(ro, 'data'), 0o500);
  fs.chmodSync(path.join(ro, 'uploads'), 0o500);

  const rolog = [];
  const child2 = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATA_DIR: path.join(ro, 'data'),
      UPLOAD_DIR: path.join(ro, 'uploads'),
      TMPDIR: scratch,                                   // the fallback has to land in this test's own tree
      DB_FILE: '',                                       // no override: the app must choose
      PORT: String(rport),
      ADMIN_PORT: String(rport + 1),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      TEST_BOOT_MARK: `${BOOT_MARK}-ro`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child2.stdout.on('data', (b) => rolog.push(b.toString()));
  child2.stderr.on('data', (b) => rolog.push(b.toString()));
  try {
    const deadline = Date.now() + 25000;
    let up = false;
    while (Date.now() < deadline && !up) {
      if (child2.exitCode !== null) throw new Error('the read-only boot exited:\n' + rolog.join(''));
      try { up = (await fetch(`${rbase}/healthz`)).ok; } catch { await new Promise((r) => setTimeout(r, 150)); }
    }
    assert.ok(up, 'the server never answered with an unwritable data dir:\n' + rolog.join('').slice(0, 500));

    const log = rolog.join('');
    assert.match(log, /data\/ dir is not writable here/, 'the boot line has to admit it is running on scratch state');

    const home = await fetch(rbase + '/');
    const text = await home.text();
    assert.equal(home.status, 200, 'a page must render even when the repo is read-only');
    assert.match(text, /<title>/);
    const api = await fetch(rbase + '/api/tour');
    assert.equal(api.status, 200);
    assert.ok(Array.isArray(await api.json()), '/api/tour still answers from the scratch database');

    const found = fs.readdirSync(path.join(scratch, 'starto-celebritypage', 'data'), { recursive: true }).map(String);
    assert.ok(found.some((f) => f.endsWith('celebrity.db')), `the database was not created under the temp tree — found ${found.join(', ') || 'nothing'}`);
    assert.ok(!/\[error\]|TypeError:|ENOENT/.test(log), 'read-only boot logged:\n' + log.split('\n').filter((l) => /Error|ENOENT/.test(l)).slice(0, 4).join('\n'));
  } finally {
    if (child2.exitCode === null) child2.kill('SIGKILL');
    for (const d of [path.join(ro, 'data'), path.join(ro, 'uploads'), ro]) { try { fs.chmodSync(d, 0o700); } catch { /* already gone */ } }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('no server-side errors were logged during the run', async () => {
  const log = req.log();
  const bad = log.split('\n').filter((l) => /\[error\]|ReferenceError|TypeError:|Cannot read|EJS Error/.test(l));
  assert.deepEqual(bad, [], 'server logged errors:\n' + bad.slice(0, 8).join('\n'));
});
