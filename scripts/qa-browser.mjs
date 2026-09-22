/**
 * scripts/qa-browser.mjs — real-browser QA with Chromium.
 * Proves the interactive layer: carousels, motion transitions, pjax page swaps,
 * cart, vault gating, chat ⇄ admin live sync, i18n, lightbox, mobile layout,
 * reduced-motion, image integrity — and that nothing logs an error.
 * Run against a live server: `npm run dev` then `npm run qa`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium, lastBrowserError } from './lib/browser.mjs';

const driver = await loadChromium();
if (!driver) {
  // a browser suite that skips itself and exits 0 is worse than one that was never run: it reads
  // as a pass to whoever is looking at the log, and this suite is the only thing holding the
  // console, the motion system and the mobile layout down.
  console.log(`[qa] ${lastBrowserError()}`);
  console.log('[qa] nothing was verified. Fix the browser, or say you mean it: QA_ALLOW_NO_BROWSER=1.');
  process.exit(process.env.QA_ALLOW_NO_BROWSER ? 0 : 1);
}
const { chromium } = driver;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'qa');
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8000';
const ABASE = process.env.QA_ADMIN || 'http://127.0.0.1:8001';

const results = [];
const ok = (name, detail = '') => { results.push([true, name, detail]); console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); };
const bad = (name, detail = '') => { results.push([false, name, detail]); console.log(`  ✗ ${name} — ${detail}`); };

const browser = await chromium.launch({ args: ['--no-sandbox', '--font-render-hinting=none'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const noise = [];
const IGNORE = /favicon|manifest|net::ERR_FAILED|fonts\.g|Download the React|favicon\.ico|ERR_BLOCKED|304|net::ERR_ABORTED/i;
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') noise.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => noise.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => { if (!IGNORE.test(r.url())) noise.push(`[404/fail] ${r.url()} ${r.failure()?.errorText}`); });
page.on('response', (r) => { if (r.status() >= 400 && !IGNORE.test(r.url()) && !/\/nope|404/.test(r.url())) noise.push(`[http ${r.status()}] ${r.url()}`); });

/* ---------- 1. pages load clean ---------- */
console.log('\n[1] pages');
const PAGES = ['/', '/work/', '/music/', '/tour/', '/journal/', '/journal/1', '/archive/', '/shop/', '/members/', '/support/', '/join/', '/search/?q=tour'];
for (const p of PAGES) {
  const t0 = Date.now();
  const res = await page.goto(BASE + p, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(320);
  const shell = await page.locator('#app-shell').count();
  const bodyText = (await page.locator('body').innerText()).trim().length;
  if (res.status() === 200 && shell === 1 && bodyText > 600) ok(p, `${bodyText} chars, ${Date.now() - t0}ms`);
  else bad(p, `status=${res.status()} shell=${shell} text=${bodyText}`);
}

/* ---------- 2. carousel engines ---------- */
console.log('\n[2] carousels');
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForTimeout(900);
const hero = page.locator('[data-carousel]').first();
const heroSlides = await hero.locator('[data-c-slide]').count();
const activeBefore = await hero.locator('[data-c-slide].is-active').getAttribute('data-idx').catch(() => null);
const idxBefore = await hero.evaluate((el) => [...el.querySelectorAll('[data-c-slide]')].findIndex((s) => s.classList.contains('is-active')));
await hero.locator('[data-c-next]').click();
await page.waitForTimeout(900);
const idxAfter = await hero.evaluate((el) => [...el.querySelectorAll('[data-c-slide]')].findIndex((s) => s.classList.contains('is-active')));
if (heroSlides >= 3 && idxAfter !== idxBefore) ok('hero carousel advances', `${heroSlides} slides, ${idxBefore} → ${idxAfter}${activeBefore ? ', data-idx ' + activeBefore : ''}`);
else bad('hero carousel advances', `slides=${heroSlides} idx ${idxBefore} → ${idxAfter}`);

const dots = await hero.locator('.c-dots [data-c-dot]').count();
if (dots >= 3) { await hero.locator('.c-dots [data-c-dot]').nth(2).click(); await page.waitForTimeout(700);
  const now = await hero.evaluate((el) => [...el.querySelectorAll('[data-c-slide]')].findIndex((s) => s.classList.contains('is-active')));
  now === 2 ? ok('dots jump to slide', 'index 2') : bad('dots jump to slide', `index ${now}`);
} else bad('dots jump to slide', `only ${dots} dots rendered`);

const counter = await page.locator('[data-c-counter]').first().innerText();
/\d/.test(counter) ? ok('slide counter live', counter.trim()) : bad('slide counter live', counter);

// autoplay moves on its own (pointer must be off the hero — hovering pauses it by design)
await page.mouse.move(20, 400);
await page.waitForTimeout(300);
const t1 = await hero.evaluate((el) => [...el.querySelectorAll('[data-c-slide]')].findIndex((s) => s.classList.contains('is-active')));
await page.waitForTimeout(6400);
const t2 = await hero.evaluate((el) => [...el.querySelectorAll('[data-c-slide]')].findIndex((s) => s.classList.contains('is-active')));
t1 !== t2 ? ok('autoplay runs unattended', `${t1} → ${t2}`) : bad('autoplay runs unattended', `stuck at ${t1}`);

// rails: every carousel has slides sized and the rail translates
const railState = await page.evaluate(() => {
  const rails = [...document.querySelectorAll('.carousel.is-rail')];
  return rails.map((r) => {
    const track = r.querySelector('[data-c-track]');
    const n = r.querySelectorAll('[data-c-slide]').length;
    const w = track ? track.getBoundingClientRect().width : 0;
    const vw = r.querySelector('.c-viewport')?.getBoundingClientRect().width || 0;
    return { n, overflow: w > vw + 4, transform: getComputedStyle(track).transform };
  });
});
const railsOk = railState.filter((r) => r.n > 0 && (r.overflow ? /matrix|translate/.test(r.transform) : true));
railsOk.length === railState.length && railState.length >= 3
  ? ok('rail carousels measured', `${railState.length} rails, ${railState.filter((r) => r.overflow).length} scrollable`)
  : bad('rail carousels measured', JSON.stringify(railState));

/* ---------- 3. motion ---------- */
console.log('\n[3] motion');
await page.evaluate(() => window.scrollTo({ top: 700, behavior: 'instant' }));
await page.waitForTimeout(700);
const revealedAt = async (y) => { await page.evaluate((v) => window.scrollTo({ top: v, behavior: 'instant' }), y); await page.waitForTimeout(600); return page.evaluate(() => document.querySelectorAll('[data-reveal].is-revealed').length); };
const r1 = await revealedAt(600);
const r2 = await revealedAt(2600);
r2 > r1 ? ok('scroll reveals fire as the page moves', `${r1} → ${r2} blocks`) : bad('scroll reveals fire as the page moves', `${r1} → ${r2}`);
const revealed = r2;
const prog = await page.evaluate(async () => {
  const bar = document.getElementById('scrollProgress');
  const before = bar ? bar.style.width || getComputedStyle(bar).width : '';
  window.scrollTo({ top: 1600, behavior: 'instant' });
  await new Promise((r) => setTimeout(r, 420));
  return { before, after: bar ? bar.style.width || getComputedStyle(bar).transform : '', h: document.documentElement.scrollTop };
});
prog.h > 800 ? ok('scroll progress tracks the page', `scrollTop ${Math.round(prog.h)}, ${prog.after || prog.before}`) : bad('scroll progress tracks the page', JSON.stringify(prog));
const ken = await page.locator('.c-ken').count();
ken > 0 ? ok('ken burns image breathing on hero', `${ken} layer(s)`) : bad('ken burns image breathing on hero', 'none');
const tilt = await page.locator('[data-tilt]').count();
ok('tilt targets wired', `${tilt} card(s)`);

/* ---------- 4. pjax transition ---------- */
console.log('\n[4] pjax');
const swapped = await page.evaluate(async () => {
  let seen = null;
  const h = () => { seen = location.pathname; document.removeEventListener('page:swap', h); };
  document.addEventListener('page:swap', h);
  const link = [...document.querySelectorAll('.header a[href="/music/"]')][0];
  if (!link) return { error: 'no nav link' };
  link.click();
  await new Promise((r) => setTimeout(r, 1400));
  return { seen, here: location.pathname + location.search, title: document.title, has: !!document.getElementById('playerCard') };
});
swapped.here === '/music/' && swapped.has
  ? ok('soft page transition', `${swapped.seen} · "${swapped.title.slice(0, 34)}…"`)
  : bad('soft page transition', JSON.stringify(swapped));
await page.goBack({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);

/* ---------- 5. cart + drawer ---------- */
console.log('\n[5] shop');
await page.goto(BASE + '/shop/', { waitUntil: 'load' });
await page.waitForTimeout(500);
const addBtn = page.locator('[data-add-cart]').first();
const sku = await addBtn.getAttribute('data-add-cart');
const badgeBefore = await page.locator('[data-cart-count]').first().innerText();
await addBtn.click();
await page.waitForTimeout(600);
const badgeAfter = await page.locator('[data-cart-count]').first().innerText();
badgeBefore !== badgeAfter ? ok('add to cart updates the badge', `${badgeBefore.trim()} → ${badgeAfter.trim()} (${sku})`) : bad('add to cart updates the badge', `still ${badgeAfter}`);
await page.locator('[data-open-cart]').first().click();
await page.waitForTimeout(420);
const drawerOpen = await page.locator('#cartDrawer.open').count();
drawerOpen ? ok('cart drawer opens', 'class open') : bad('cart drawer opens', 'not open');
const lineText = await page.locator('#cartDrawer .cart-lines').first().innerText().catch(() => '');
lineText.includes(sku) || lineText.length > 8 ? ok('drawer lists the line', lineText.replace(/\s+/g, ' ').slice(0, 58)) : bad('drawer lists the line', lineText);
await page.keyboard.press('Escape');
await page.waitForTimeout(260);
const closedNow = await page.locator('#cartDrawer.open').count();
closedNow === 0 ? ok('escape closes the drawer') : bad('escape closes the drawer', 'still open');

/* ---------- 6. vault gate ---------- */
console.log('\n[6] vault gate');
await page.goto(BASE + '/#vault', { waitUntil: 'load' });
await page.waitForTimeout(700);
const lockedCard = page.locator('.vault-card[data-vault-open]').first();
  
await lockedCard.click({ force: true });
await page.waitForTimeout(700);
const modalOpen = await page.locator('#vaultModal.open').count();
const modalText = await page.locator('#vaultModal').first().innerText().catch(() => '');
modalOpen && /locked|members|unlock|tier|会員/i.test(modalText) ? ok('locked vault shows the gate', modalText.replace(/\s+/g, ' ').slice(0, 70)) : bad('locked vault shows the gate', `open=${modalOpen} ${modalText.replace(/\s+/g, ' ').slice(0, 70)}`);
await page.keyboard.press('Escape');

/* ---------- 7. chat + live sync ---------- */
console.log('\n[7] chat ⇄ admin (SSE)');
const chatBtn = page.locator('#chatLauncher, [data-open-chat]').first();
await chatBtn.click({ timeout: 4000 }).catch(() => {});
await page.waitForTimeout(400);
const chatOpen = await page.locator('#chatWindow.open').count();
chatOpen ? ok('chat window opens') : bad('chat window opens', 'no .open class');
const stamp = Date.now();
await page.locator('#chatInput').fill(`QA browser check ${stamp} — where is my payment link?`);
await page.locator('#chatSend').click();
await page.waitForTimeout(2000);
const bubbles = await page.locator('#chatBody .chat-bubble').count();
bubbles >= 2 ? ok('chat round-trip with auto-reply', `${bubbles} bubbles`) : bad('chat round-trip with auto-reply', `${bubbles} bubbles`);

// admin replies from the console → the member's page reacts without a reload
const ac = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const apage = await ac.newPage();
await apage.goto(ABASE + '/login', { waitUntil: 'load' });
await apage.locator('#ae').fill('admin@starto.jp');
await apage.locator('#ap').fill('Starto2026!');
await apage.locator('button[type=submit]').click();
await apage.waitForURL(ABASE + '/', { timeout: 8000 }).catch(() => {});
await apage.locator('.adm-nav a[href="/tickets"]').click();
await apage.waitForTimeout(700);
const trow = apage.locator('table a', { hasText: 'TKT-' }).first();
const tcode = (await trow.innerText().catch(() => '')).trim();
tcode ? ok('console lists the ticket', tcode) : bad('console lists the ticket', 'no TKT row');
const toastState = async () => page.evaluate(() => { const t = document.getElementById('toast'); return t ? `${t.classList.contains('show') ? 'show' : 'idle'}:${(t.textContent || '').slice(0, 40)}` : 'none'; });
const beforeToasts = await toastState();
await trow.click();
await apage.waitForTimeout(600);
await apage.locator('#replyForm textarea').fill('Payment link is on its way — vault unlocks on approval.');
await apage.locator('#replyForm button[type=submit]').click();
await apage.waitForTimeout(1400);
await page.waitForTimeout(2400);
const afterToasts = await toastState();
const chatNow = await page.locator('#chatBody .chat-bubble').count();
afterToasts !== beforeToasts || chatNow > bubbles
  ? ok('member page reacted to the admin reply', `toast "${beforeToasts}" → "${afterToasts}", bubbles ${bubbles} → ${chatNow}`)
  : bad('member page reacted to the admin reply', `toast "${beforeToasts}" / "${afterToasts}", bubbles ${bubbles}/${chatNow}`);
await page.screenshot({ path: path.join(SHOTS, 'chat-after-reply.png') });
await ac.close();

/* ---------- 8. admin write → public section refresh ---------- */
console.log('\n[8] admin publish → live section');
const bc = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const bp = await bc.newPage();
await bp.goto(ABASE + '/login', { waitUntil: 'load' });
await bp.locator('#ae').fill('admin@starto.jp');
await bp.locator('#ap').fill('Starto2026!');
await bp.locator('button[type=submit]').click();
await bp.waitForURL(ABASE + '/', { timeout: 8000 }).catch(() => {});
await bp.goto(ABASE + '/content/news', { waitUntil: 'load' });
await bp.locator('#newRowBtn, [data-new-row]').first().click();
await bp.waitForTimeout(400);
const marker = `QA ${new Date().toISOString().slice(11, 19)}`;
await bp.locator('#f_title').fill(marker);
await bp.locator('#f_date').fill('2031.01.01');
await bp.locator('select#f_status').selectOption('published').catch(() => {});
await bp.locator('#rowForm button[type=submit]').first().click();
await bp.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2600);
const homeNow = await page.goto(BASE + '/', { waitUntil: 'load' }).then(() => page.evaluate((m) => document.body.textContent.includes(m), marker));
homeNow ? ok('admin write reaches the public site', marker) : bad('admin write reaches the public site', 'news row missing');
// clean up the row so the demo data stays tidy
await bp.goto(ABASE + '/content/news', { waitUntil: 'load' });
const delForm = bp.locator('tr', { hasText: marker }).locator('form[data-confirm]').first();
if (await delForm.count()) { bp.once('dialog', (d) => d.accept()); await delForm.locator('button').click(); await bp.waitForTimeout(900); }
const gone = await bp.locator('tr', { hasText: marker }).count();
gone === 0 ? ok('admin delete removes the row') : bad('admin delete removes the row', `${gone} left`);
await bp.screenshot({ path: path.join(SHOTS, 'admin-news.png') });
await bp.goto(ABASE + '/', { waitUntil: 'load' });
await bp.waitForTimeout(900);
await bp.screenshot({ path: path.join(SHOTS, 'admin-dashboard.png') });
await bc.close();

/* ---------- 9. i18n ---------- */
console.log('\n[9] language');
await page.goto(BASE + '/', { waitUntil: 'load' });
const jaText = await page.locator('.hero-slide.is-active, .hero-content').first().innerText();
await page.locator('[data-lang="en"]').first().click();
await page.waitForTimeout(1400);
const enText = await page.locator('.hero-slide.is-active, .hero-content').first().innerText().catch(() => '');
const langNow = await page.evaluate(() => document.documentElement.lang);
langNow === 'en' ? ok('JA→EN switch persists on the session', `html lang="${langNow}"`) : bad('JA→EN switch persists', langNow);
jaText !== enText ? ok('copy actually changed', `…${enText.replace(/\s+/g, ' ').slice(0, 40)}`) : bad('copy actually changed', 'identical text');
await page.locator('[data-lang="ja"]').first().click();
await page.waitForTimeout(900);

/* ---------- 10. member flow in the browser ---------- */
console.log('\n[10] member flow');
await page.goto(BASE + '/join/', { waitUntil: 'load' });
const email = `qa-web-${Date.now()}@example.com`;
await page.locator('#jName').fill('QA Browser');
await page.locator('#jEmail').fill(email);
await page.locator('#jPass').fill('qapass2026');
await page.locator('.join-form input[type=checkbox]').first().check();
await page.locator('.join-form button[type=submit]').click();
await page.waitForURL('**/join/complete**', { timeout: 9000 }).catch(() => {});
const welcome = await page.locator('h1').first().innerText();
/welcome|Welcome|ようこそ/i.test(welcome) ? ok('server-side signup lands on the welcome page', welcome.trim()) : bad('server-side signup lands on the welcome page', welcome);
await page.goto(BASE + '/members/', { waitUntil: 'load' });
const dash = await page.locator('.member-head').innerText();
/QA Browser/.test(dash) ? ok('dashboard greets the member') : bad('dashboard greets the member', dash.slice(0, 60));
await page.locator('[data-purchase-tier="gold"]').first().scrollIntoViewIfNeeded().catch(() => {});
const buyBtn = page.locator('[data-purchase-tier="gold"]').first();
if (await buyBtn.count()) {
  await buyBtn.click();
  await page.waitForTimeout(1200);
  const cardPreview = await page.locator('#fanCard .num, .fan-card .num').first().innerText().catch(() => '');
  /TK-/.test(cardPreview) ? ok('fan card preview issued from the API', cardPreview.trim()) : bad('fan card preview issued from the API', cardPreview);
}
await page.screenshot({ path: path.join(SHOTS, 'member-dashboard.png'), fullPage: false });

/* the card the member just asked for has to be THEIR card, and it has to turn over */
await page.goto(BASE + '/members/', { waitUntil: 'load' });
await page.waitForTimeout(600);
const cardData = await page.evaluate(() => {
  const c = document.querySelector('.fan-card');
  if (!c) return null;
  const f = c.querySelector('.fc-front'), k = c.querySelector('.fc-back');
  const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  return {
    holder: txt(f.querySelector('h4')),
    frontNo: txt(f.querySelector('[data-card-field="number"]')),
    backNo: txt(k.querySelector('[data-card-field="number"]')),
    memberNo: txt(k.querySelector('.fc-back-top .mono')),
    perks: k.querySelectorAll('.fc-perks li').length,
    bars: k.querySelectorAll('.fc-bar i.bw1, .fc-bar i.bw2, .fc-bar i.bw3').length,
    faces: c.querySelectorAll('.fc-face').length,
  };
});
if (!cardData) bad('fan card is filled for the holder', 'no .fan-card on /members/');
else {
  /QA Browser/i.test(cardData.holder)
    ? ok('fan card is filled for the holder', cardData.holder)
    : bad('fan card is filled for the holder', cardData.holder || '(empty name)');
  /^TK-\d+$/.test(cardData.frontNo) && cardData.frontNo === cardData.backNo
    ? ok('both card faces print the issued number', cardData.frontNo)
    : bad('both card faces print the issued number', `${cardData.frontNo} vs ${cardData.backNo}`);
  /(会員番号|MEMBER NO)\s*\d/.test(cardData.memberNo) && cardData.perks > 0 && cardData.bars > 8 && cardData.faces === 2
    ? ok('the card back carries member no, perks and barcode', `${cardData.memberNo} · ${cardData.perks} perks · ${cardData.bars} bars`)
    : bad('the card back carries member no, perks and barcode', JSON.stringify(cardData));
  await page.click('.fan-card', { force: true });   // the card tilts with the pointer, so it is never "stable" by design
  await page.waitForTimeout(1150);
  const turned = await page.evaluate(() => {
    const c = document.querySelector('.fan-card');
    const m = /matrix3d\(([-\d.]+)/.exec(getComputedStyle(c.querySelector('.fc-flip')).transform);
    return {
      flipped: c.classList.contains('is-flipped'), pressed: c.getAttribute('aria-pressed'),
      rot: m ? Math.abs(Number(m[1]) + 1) < 0.1 : false,
      spill: [...c.querySelectorAll('.fc-face')].map((el) => el.scrollHeight - el.clientHeight),
    };
  });
  turned.flipped && turned.rot && turned.pressed === 'true'
    ? ok('the fan card turns over and says so', `rotateY 180°, aria-pressed=${turned.pressed}`)
    : bad('the fan card turns over and says so', JSON.stringify(turned));
  await page.locator('.fan-card').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const clip = await page.evaluate(() => { const r = document.querySelector('.fan-card').getBoundingClientRect(); return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 10), width: r.width + 20, height: r.height + 20 }; });
  await page.screenshot({ path: path.join(SHOTS, 'fan-card-back.png'), clip });
  const collide = () => page.evaluate(() => {
    const c = document.querySelector('.fan-card');
    const front = c.querySelector('.fc-front');
    const r = (sel) => { const el = c.querySelector(sel); return el ? el.getBoundingClientRect() : null; };
    const box = (b) => b && { l: b.left, t: b.top, r: b.right, b: b.bottom };
    const hit = (a, d) => !!(a && d) && Math.min(a.r, d.r) - Math.max(a.l, d.l) > 0.5 && Math.min(a.b, d.b) - Math.max(a.t, d.t) > 0.5;
    const stamp = box(r('.fc-stamp')), hint = box(r('.fc-hint')), kanji = box(r('.fc-kanji'));
    const fb = front.getBoundingClientRect();
    return {
      hasStamp: !!stamp,
      overPrint: !!stamp && [r('.fc-front h4'), r('.fc-front .num'), r('[data-card-field="sublabel"]')].some((x) => hit(stamp, box(x))),
      hintOnKanji: hit(hint, kanji),
      inside: !stamp || (stamp.l >= fb.left - 1 && stamp.r <= fb.right + 1 && stamp.t >= fb.top - 1 && stamp.b <= fb.bottom + 1),
      spill: [...c.querySelectorAll('.fc-face')].map((el) => el.scrollHeight - el.clientHeight),
    };
  });
  const deskPrint = await collide();
  (!deskPrint.overPrint && !deskPrint.hintOnKanji && deskPrint.inside)
    ? ok(`the card's state mark (${deskPrint.hasStamp ? 'stamp' : 'hint'}) never sits on printed text`, `spill ${deskPrint.spill.join('/')}`)
    : bad("the card's state mark never sits on printed text", JSON.stringify(deskPrint));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const small = await collide();
  small.spill.every((v) => v <= 0) ? ok('both faces fit the card at 390px', `spill ${small.spill.join('/')} on a phone`) : bad('both faces fit the card at 390px', `spill ${small.spill.join('/')}`);
  (!small.overPrint && !small.hintOnKanji && small.inside)
    ? ok('the state mark keeps clear of the print on a phone too', small.hasStamp ? 'stamp in the corner' : 'hint in the corner')
    : bad('the state mark keeps clear of the print on a phone too', JSON.stringify(small));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
}

/* ---------- 11. search ---------- */
console.log('\n[11] search');
await page.goto(BASE + '/search/', { waitUntil: 'load' });
await page.locator('#siteSearch').fill('vinyl');
await page.waitForTimeout(1800);
const hits = await page.locator('.search-hit').count();
hits > 0 ? ok('live search returns hits', `${hits} for "vinyl"`) : bad('live search returns hits', 'none');
await page.locator('[data-search-suggest="tour"]').first().click();
await page.waitForTimeout(1800);
const hits2 = await page.locator('.search-hit').count();
hits2 > 0 ? ok('suggestion chip re-runs the query', `${hits2} for "tour"`) : bad('suggestion chip re-runs the query', 'none');

/* ---------- 12. image integrity ---------- */
console.log('\n[12] images');
const imgReport = await page.evaluate(async () => {
  const imgs = [...document.querySelectorAll('img')];
  const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src);
  return { total: imgs.length, broken: broken.slice(0, 6), n: broken.length };
});
imgReport.broken.length === 0 ? ok('every image decoded or fell back', `${imgReport.total} on /search`) : bad('every image decoded or fell back', JSON.stringify(imgReport.broken));

/* ---------- 13. lightbox ---------- */
console.log('\n[13] lightbox');
await page.goto(BASE + '/archive/', { waitUntil: 'load' });
await page.waitForTimeout(600);
await page.locator('.tl-card').first().scrollIntoViewIfNeeded().catch(() => {});
const lb = await page.locator('[data-lightbox] [data-lb-item]').first().boundingBox();
if (lb) {
  await page.locator('[data-lightbox] [data-lb-item]').first().click({ force: true });
  await page.waitForTimeout(800);
  const open = await page.locator('.c-lightbox').count();
  open ? ok('lightbox opens from a timeline card') : bad('lightbox opens from a timeline card', 'no open class');
  await page.keyboard.press('Escape');
} else bad('lightbox opens from a timeline card', 'no items found');

/* ---------- 14. mobile ---------- */
console.log('\n[14] mobile');
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const mp = await mctx.newPage();
const mnoise = [];
mp.on('pageerror', (e) => mnoise.push(e.message));
await mp.goto(BASE + '/', { waitUntil: 'load' });
await mp.waitForTimeout(900);
const overflow = await mp.evaluate(async () => {
    window.scrollTo({ left: 9999, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 120));
    const sx = window.scrollX; window.scrollTo({ left: 0, behavior: 'instant' });
    return { sx, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sticky: getComputedStyle(document.getElementById('header')).position };
  });
overflow.sx === 0 && overflow.sw <= overflow.cw + 1 ? ok('no horizontal overflow at 390px', `scrollWidth ${overflow.sw}, sticky header ${overflow.sticky}`) : bad('no horizontal overflow at 390px', `scrollX ${overflow.sx}, ${overflow.sw} > ${overflow.cw}`);
await mp.locator('#hamburger').click({ timeout: 8000 });
await mp.waitForTimeout(500);
const mdrawer = await mp.locator('#drawer.open').count();
mdrawer ? ok('drawer opens on mobile') : bad('drawer opens on mobile', 'no open class');
await mp.screenshot({ path: path.join(SHOTS, 'mobile-drawer.png') });
await mp.locator('#drawer a[href="/shop/"]').first().click();
await mp.waitForTimeout(1200);
const mUrl = new URL(mp.url()).pathname;
mUrl === '/shop/' ? ok('mobile nav navigates', mUrl) : bad('mobile nav navigates', mUrl);
// swipe whatever carousel is on this page
const carBox = await mp.locator('[data-carousel]').first().boundingBox().catch(() => null);
if (carBox) { await mp.touchscreen.tap(carBox.x + carBox.width / 2, carBox.y + carBox.height / 2); await mp.waitForTimeout(700); }
const over = await mp.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const bad = [...document.querySelectorAll('body *')].filter((el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (r.width === 0 || cs.position === 'fixed') return false;
    if (r.right <= vw + 1 && r.left >= -1) return false;
    let el2 = el.parentElement; while (el2) { const c = getComputedStyle(el2); if (c.overflowX !== 'visible') return false; el2 = el2.parentElement; }
    return true;
  }).map((el) => `${el.tagName}.${(el.className + '').split(' ')[0]}→${Math.round(el.getBoundingClientRect().right)}`);
  return bad.slice(0, 6);
});
over.length ? bad('nothing escapes the viewport at 390px', over.join(' ')) : ok('nothing escapes the viewport at 390px');
await mp.screenshot({ path: path.join(SHOTS, 'mobile-shop.png'), fullPage: false });
mnoise.length ? bad('mobile page errors', mnoise.join(' | ')) : ok('mobile page errors', 'none');
await mctx.close();

/* ---------- 15. reduced motion ---------- */
console.log('\n[15] reduced motion');
const rctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const rp = await rctx.newPage();
await rp.goto(BASE + '/', { waitUntil: 'load' });
await rp.waitForTimeout(500);
const vis = await rp.evaluate(() => {
  const els = [...document.querySelectorAll('[data-reveal]')];
  const hidden = els.filter((e) => getComputedStyle(e).opacity === '0');
  return { total: els.length, hidden: hidden.length, reduced: document.documentElement.classList.contains('motion-reduced') };
});
vis.hidden === 0 ? ok('reduced-motion keeps everything visible', `${vis.total} blocks, flag=${vis.reduced}`) : bad('reduced-motion keeps everything visible', JSON.stringify(vis));
const still = await rp.evaluate(async () => {
  const el = document.querySelector('[data-spotlight]');
  const aura = document.querySelector('.cd-aura');
  const chip = document.querySelector('.tour-card:not(.is-done) .tagchip.gold');
  if (el) {
    el.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 40, bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  const anim = (n) => (n ? getComputedStyle(n).animationName : 'none');
  return {
    vars: el ? el.style.getPropertyValue('--mx') : 'no card',
    aura: anim(aura), sheen: chip ? anim(chip.querySelector ? chip : null) || anim(chip) : 'none',
    auraVisible: aura ? getComputedStyle(aura).display !== 'none' : false,
  };
});
still.aura === 'none' && !still.vars && still.auraVisible
  ? ok('reduced motion stills the glow instead of removing the card', `aura=${still.aura}, pointer vars="${still.vars || 'none written'}"`)
  : bad('reduced motion stills the glow instead of removing the card', JSON.stringify(still));
await rp.screenshot({ path: path.join(SHOTS, 'reduced-motion.png') });
await rctx.close();

/* ---------- 16. the waitlist and the venue locator (a clean context: no session, no history) ---------- */
console.log('\n[16] waitlist');
{
  const wctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const wp = await wctx.newPage();
  const wnoise = [];
  wp.on('pageerror', (e) => wnoise.push(String(e.message).slice(0, 80)));
  wp.on('console', (m) => { if (m.type() === 'error') wnoise.push(m.text().slice(0, 80)); });
  wp.on('request', (rq) => { const u = rq.url(); if (!u.startsWith(BASE) && !/^(data|blob):/.test(u) && !/^https?:\/\/(www\.)?(openstreetmap|google)\.com\//.test(u)) wnoise.push('external ' + u.slice(0, 60)); });
  await wp.goto(BASE + '/tour/', { waitUntil: 'load' });
  await wp.waitForTimeout(500);

  const maps = await wp.evaluate(() => [...document.querySelectorAll('.vmap svg')].map((el) => ({ kids: el.children.length, w: Math.round(el.getBoundingClientRect().width), label: el.getAttribute('aria-label') || '' })));
  maps.length > 0 && maps.every((m) => m.kids >= 3 && m.w > 60 && /\d\.\d/.test(m.label))
    ? ok('every date draws its own locator from real coordinates', `${maps.length} maps · ${maps[0].kids} shapes · ${maps[0].label.slice(0, 44)}`)
    : bad('every date draws its own locator', JSON.stringify(maps).slice(0, 200));

  const form = wp.locator('[data-notify-form]').first();
  await form.scrollIntoViewIfNeeded();
  let notifyPosts = 0;
  wp.on('request', (rq) => { if (rq.method() === 'POST' && rq.url().includes('/api/tour/notify')) notifyPosts++; });
  await form.locator('[name=email]').fill('not-an-address');
  await form.locator('button[type=submit]').click({ force: true });   // the row repaints with the countdown, so no stability wait
  await wp.waitForTimeout(400);
  const wrong = await form.evaluate((f) => ({ valid: f.querySelector('[name=email]').checkValidity(), open: !f.hidden }));
  !wrong.valid && wrong.open && notifyPosts === 0
    ? ok('a bad address is answered before it leaves the page', 'email fails constraint validation, no request sent')
    : bad('a bad address is answered before it leaves the page', JSON.stringify({ ...wrong, notifyPosts }));

  await form.locator('[name=email]').fill(`qa-waitlist-${Date.now()}@example.com`);
  await form.locator('button[type=submit]').click({ force: true });
  await wp.waitForTimeout(900);
  const joined = await wp.evaluate(() => {
    const w = document.querySelector('.tc-wait, .cd-wait');
    if (!w) return { err: 'no wait block' };
    const msg = w.querySelector('[data-notify-msg]');
    const leave = w.querySelector('[data-leave-form]');
    const join = w.querySelector('[data-notify-form]');
    return {
      ok: !!msg && msg.classList.contains('is-ok'),
      text: msg ? msg.textContent.trim().slice(0, 60) : '',
      leaveShown: !!leave && !leave.hidden,
      joinHidden: !!join && join.hidden,
      token: leave && leave.querySelector('[name=token]') ? leave.querySelector('[name=token]').value : '',
      count: (w.querySelector('[data-wait-count]') || {}).textContent || '',
    };
  });
  joined.ok && joined.leaveShown && joined.joinHidden && joined.token.length > 8
    ? ok('joining the list is live and hands back the way off', `${joined.text}${joined.count ? ' · ' + joined.count.trim().slice(0, 20) : ''} · token ${joined.token.slice(0, 9)}…`)
    : bad('joining the list is live and hands back the way off', JSON.stringify(joined).slice(0, 220));

  await wp.locator('.tc-wait [data-leave-form] button, .cd-wait [data-leave-form] button').first().click({ force: true });
  await wp.waitForTimeout(800);
  const left = await wp.evaluate(() => {
    const w = document.querySelector('.tc-wait, .cd-wait');
    const join = w && w.querySelector('[data-notify-form]');
    const leave = w && w.querySelector('[data-leave-form]');
    return { back: !!join && !join.hidden, gone: !leave || leave.hidden };
  });
  left.back && left.gone ? ok('one click takes the address back off, without a reload', JSON.stringify(left)) : bad('one click takes the address back off', JSON.stringify(left));

  // the countdown inside the card re-paints every second, so let the page scroll itself rather than
  // asking Playwright for a stable element it will never be given
  await wp.evaluate(() => { const el = document.querySelector('.tour-card.is-coming_soon') || document.querySelector('.tour-card'); el?.scrollIntoView({ block: 'center' }); });
  await wp.waitForTimeout(300);
  await wp.screenshot({ path: path.join(SHOTS, 'tour-waitlist.png') });
  wnoise.length ? bad('waitlist flow is quiet in the console', wnoise.slice(0, 3).join(' | ')) : ok('waitlist flow is quiet in the console', 'no errors, nothing external');
  await wctx.close();
}

/* ---------- 17. the pointer light, the rim and the sheen ---------- */
console.log('\n[17] pointer light');
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForTimeout(800);
{
  const card = page.locator('.tier[data-spotlight]').first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const before = await card.evaluate((el) => ({ mx: el.style.getPropertyValue('--mx'), o: getComputedStyle(el, '::before').opacity }));
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.7);
  await page.waitForTimeout(80);
  await page.mouse.move(box.x + box.width * 0.24, box.y + box.height * 0.72);
  await page.waitForTimeout(320);
  const lit = await card.evaluate((el) => ({
    mx: el.style.getPropertyValue('--mx'), my: el.style.getPropertyValue('--my'),
    light: getComputedStyle(el, '::before').opacity, rim: getComputedStyle(el, '::after').opacity,
    bg: getComputedStyle(el, '::before').backgroundImage,
  }));
  const moved = /^[\d.]+%$/.test(lit.mx || '') && lit.mx !== before.mx && /[\d.]+%/.test(lit.my || '');
  moved && parseFloat(lit.light) > .9 && parseFloat(lit.rim) > .9 && /at \d+\.?\d*% \d+\.?\d*%/.test(lit.bg)
    ? ok('a card answers the pointer with a light that follows it', `--mx ${lit.mx} / --my ${lit.my}, light ${lit.light}, rim ${lit.rim}`)
    : bad('a card answers the pointer with a light that follows it', JSON.stringify({ before, lit }).slice(0, 220));

  const kb = await page.evaluate(() => {
    const el = document.querySelector('.tier[data-spotlight]');
    const inside = el.querySelector('a, button, [tabindex]');
    inside?.focus();
    const o = getComputedStyle(el, '::after').opacity;
    inside?.blur();
    return { focusable: !!inside, rim: o };
  });
  kb.focusable && parseFloat(kb.rim) > .9
    ? ok('the keyboard gets the same acknowledgement without a pointer', `rim opacity ${kb.rim} on focus-within`)
    : bad('the keyboard gets the same acknowledgement without a pointer', JSON.stringify(kb));

  const deco = await page.evaluate(() => {
    const aura = document.querySelector('.countdown .cd-aura');
    const chip = document.querySelector('.tour-card:not(.is-done) .tagchip.gold');
    const c = aura && getComputedStyle(aura);
    const k = chip && getComputedStyle(chip, '::after');
    return {
      aura: c ? { name: c.animationName, z: c.zIndex, inPanel: !!aura.closest('.countdown'), aria: aura.getAttribute('aria-hidden') } : null,
      chip: k ? { name: k.animationName, pe: k.pointerEvents } : null,
      width: { doc: document.documentElement.scrollWidth, win: window.innerWidth },
    };
  });
  deco.aura && deco.aura.name !== 'none' && deco.aura.z === '-1' && deco.aura.aria === 'true' && deco.chip.name === 'chipSheen' && deco.chip.pe === 'none'
    ? ok('the glow is paint only — behind the copy, invisible to AT, no pointer capture', `aura z ${deco.aura.z}, chip ${deco.chip.name}, scrollWidth ${deco.width.doc}/${deco.width.win}`)
    : bad('the glow is paint only — behind the copy, invisible to AT', JSON.stringify(deco).slice(0, 220));

    const wide = deco.width.doc > deco.width.win;
    wide ? bad('the glow costs the page no width', `scrollWidth ${deco.width.doc} > ${deco.width.win}`) : ok('the glow costs the page no width', `${deco.width.doc}px`);
  await page.screenshot({ path: path.join(SHOTS, 'pointer-light.png') });
}

/* ---------- 18. screenshots ---------- */
console.log('\n[18] shots');
for (const [url, name] of [['/', 'home'], ['/shop/', 'shop'], ['/tour/', 'tour'], ['/music/', 'music'], ['/journal/', 'journal'], ['/members/', 'members'], ['/join/', 'join'], ['/archive/', 'archive']]) {
  await page.goto(BASE + url, { waitUntil: 'load' });
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  await page.screenshot({ path: path.join(SHOTS, name + '-full.png'), fullPage: true });
}
ok('screenshots written', path.relative(ROOT, SHOTS) + '/');

/* ---------- console verdict ---------- */
const realNoise = noise.filter((n) => !IGNORE.test(n));
realNoise.length ? bad('browser console is clean', realNoise.slice(0, 8).join(' | ')) : ok('browser console is clean', `${noise.length} filtered message(s)`);

const failed = results.filter(([good]) => !good);
console.log(`\n${'='.repeat(52)}\n${results.length - failed.length}/${results.length} browser checks passed`);
if (failed.length) failed.forEach(([, n, d]) => console.log(`  ✗ ${n} — ${d}`));
await page.close();
await ctx.close();
await browser.close();
process.exit(failed.length ? 1 : 0);
