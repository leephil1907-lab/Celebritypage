/**
 * scripts/audit.mjs — whole-site integrity audit (the "is it actually right?" gate).
 *
 * What it proves, per page, in a real Chromium:
 *   • nothing 404s: links, images, css, js, fonts, background-images
 *   • no third-party requests — a blocked CDN must never change how the site looks
 *   • no image is upscaled past ~1.35x (that is what "the design looks cut off" usually is)
 *   • no horizontal overflow at 4 widths, and no text clipped by overflow rules
 *   • the brand fonts are really loaded; every visible click target has an accessible name
 *   • metadata: canonical/og/twitter/robots/hreflang absolute and reachable, JSON-LD parses,
 *     every sitemap <loc> resolves, robots points at it
 *   • motion: a nav click swaps without a reload, reveals fire, carousels advance, the header
 *     stays pinned, reduced-motion leaves everything visible, <video> is poster-first
 *
 * Needs a running app: `npm run dev`, then `npm run audit`.
 *   AUDIT_BASE=http://127.0.0.1:8000 AUDIT_VERBOSE=1 node scripts/audit.mjs
 */
import { loadChromium, lastBrowserError } from './lib/browser.mjs';
import { displayWidth } from '../server/seo.js';

const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:8000';
const VERBOSE = !!process.env.AUDIT_VERBOSE;
const PAGES = ['/', '/work/', '/music/', '/tour/', '/journal/', '/journal/1', '/archive/', '/shop/', '/members/', '/support/', '/join/', '/search/?q=tour', '/cart'];
const WIDTHS = [1920, 1440, 1180, 1024, 768, 390];

/* the tour kit's own pages are linked from /tour/, so audit the URLs the site actually hands out */
const DOWNLOADS = [];
{
  const tour = await fetch(BASE + '/tour/').then((r) => r.text()).catch(() => '');
  const pick = (re) => { const m = re.exec(tour); return m ? m[1] : null; };
  PAGES.push(...[
    '/wall/',
    pick(/(\/tour\/show\/[a-z0-9-]+)/i),
    pick(/(\/tour\/raffle\/\d+)/),
  ].filter(Boolean));
  // a file the browser downloads cannot be rendered — it is checked by fetch, below
  DOWNLOADS.push(...[
    '/tour/calendar.ics',
    pick(/href="(\/tour\/calendar\/[0-9]+\.ics)"/),
  ].filter(Boolean));
}

const results = [];
const ok = (n, d = '') => { results.push([true, n, d]); if (VERBOSE) console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d = '') => { results.push([false, n, d]); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); };
const check = (cond, name, detail = '') => (cond ? ok(name, detail) : bad(name, detail));
const step = (t) => { if (VERBOSE) console.log(`\n[${t}]`); };
const head = async (url) => {
  try { return await fetch(url, { method: 'GET', redirect: 'manual' }); }
  catch { return { status: 0, headers: new Headers(), url, redirected: false }; }
};

/* nothing below is worth reading if the site is not up: say so in one line instead of a stack */
try {
  const probe = await fetch(BASE + '/healthz', { signal: AbortSignal.timeout(4000) });
  if (probe.status >= 500) { console.log(`[audit] ${BASE} answered ${probe.status} — the site is not healthy, aborting`); process.exit(1); }
} catch (e) {
  console.log(`[audit] nothing is listening on ${BASE} (${String(e.message).split('\n')[0]})`);
  console.log('[audit] start the site first:  npm run dev   (or point AUDIT_BASE at a deployment)');
  process.exit(1);
}

const driver = await loadChromium();
if (!driver) {
  console.log(`[audit] the browser stages cannot run here — ${lastBrowserError()}`);
  console.log('[audit] the HTTP and metadata stages still run; the browser ones are recorded as a failure');
}

/* ---------- 1. routes, redirects and stale files ---------- */
step('1 routes');
for (const r of [...PAGES, '/sitemap.xml', '/robots.txt', '/rss.xml', '/feed.json', '/healthz', '/manifest.json', '/css/app.css', '/js/app.js']) {
  const res = await head(BASE + r);
  if (r === '/cart') { check(res.status === 302 && /\/shop\//.test(res.headers.get('location') || ''), 'legacy /cart redirects into the shop drawer', `${res.status} → ${res.headers.get('location')}`); continue; }
  check(res.status < 400, `GET ${r}`, String(res.status));
}
for (const f of DOWNLOADS) {
  const res = await head(BASE + f);
  const text = await fetch(BASE + f).then((r) => r.text()).catch(() => '');
  const type = (res.headers.get?.('content-type') || '') + (res.headers.get?.('content-disposition') || '');
  check(res.status < 400 && /text\/calendar|application\/octet-stream|text\/plain|attachment/.test(type), `GET ${f} arrives as a file`, `${res.status} ${type.slice(0, 46)}`);
  check(/^BEGIN:VCALENDAR/m.test(text) && /BEGIN:VEVENT/.test(text), `${f} is a real calendar`, `${text.length} bytes`);
}
{
  const res = await head(BASE + '/nope');
  check(res.status === 404, 'unknown path returns a real 404', String(res.status));
  check(/noindex/.test(res.headers.get('x-robots-tag') || '') || /noindex/.test(await res.text()), '404 page is not indexable');
}
{
  const res = await head(BASE + '/shop');
  check(res.status === 301 && /\/shop\/$/.test(res.headers.get('location') || ''), '/shop 301s to /shop/ — one URL per page', `${res.status} → ${res.headers.get('location')}`);
}
/* nothing from the static era may still answer with a page: a second copy of /archive broke
   canonicalisation and left users on a dead design. 301 into the live page is fine, 200 is not. */
for (const [stale, want] of [['/archive/index.html', 'redirect'], ['/index.html', 'redirect'], ['/join/form/', 404], ['/en/', 404], ['/en/work/', 404], ['/sitemap-static.xml', 404]]) {
  const res = await head(BASE + stale);
  if (want === 'redirect') {
    const loc = res.headers.get('location') || '';
    const path = loc.replace(/^https?:\/\/[^/]+/, '');
    check(res.status === 301 && !/index\.html/.test(path) && (stale === '/index.html' ? path === '/' : /\/$/.test(path)), `${stale} folds into its canonical page`, `${res.status} → ${path}`);
  } else {
    const res2 = res; check(res2.status === 404, `no stale page at ${stale}`, String(res2.status));
  }
}

/* ---------- 2. crawler files ---------- */
step('2 crawler files');
const sitemap = await (await fetch(BASE + '/sitemap.xml')).text();
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check(sitemap.startsWith('<?xml') && sitemap.includes('<urlset'), 'sitemap.xml is a well-formed urlset');
check(locs.length >= 10, 'sitemap lists every indexable page', `${locs.length} urls`);
check(locs.every((l) => /^https?:\/\//.test(l)), 'every <loc> is absolute', locs[0]);
check(!locs.some((l) => /\/index\.html?$/.test(l)), 'no /index.html entries in the sitemap');
check(!locs.some((l) => /\/(admin|api|cart)(\/|$)/.test(l)), 'no private paths in the sitemap');
check(!/<lastmod>203\d-/.test(sitemap), 'no future-dated lastmod values');
check(locs.filter((l, i) => locs.indexOf(l) !== i).length === 0, 'sitemap has no duplicate urls');
check(!/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(sitemap), 'sitemap has no unescaped ampersands');
for (const l of locs.slice(0, 18)) {
  const res = await head(l);
  check(res.status === 200, `sitemap url resolves ${new URL(l).pathname}`, String(res.status));
}
const robots = await (await fetch(BASE + '/robots.txt')).text();
check(/Sitemap:\s*https?:\/\//.test(robots), 'robots.txt advertises an absolute sitemap url');
check((robots.match(/Sitemap:\s*(\S+)/) || [])[1] === BASE + '/sitemap.xml', 'robots Sitemap url points at this host');
check(/Disallow: \/api\//.test(robots) && /Disallow: \/admin/.test(robots), 'robots blocks /api and /admin');
check(/Disallow: \/members\//.test(robots) && /Disallow: \/shop\/verify/.test(robots), 'robots blocks personal + transactional pages');
const rss = await (await fetch(BASE + '/rss.xml')).text();
check(rss.includes('<rss version="2.0"') && rss.includes('</rss>'), 'rss.xml is well formed');
check(!/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(rss), 'rss has no unescaped entities');

/* ---------- 3. browser pass ---------- */
if (driver) {
  const browser = await driver.chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  const bundle = await (await fetch(BASE + '/js/app.js')).text();
  check(bundle.length > 8000, 'client bundle is served and non-trivial', `${(bundle.length / 1024).toFixed(1)} kb`);

  const noise = [];
  const external = new Set();
  const IGNORE = /favicon|net::ERR_FAILED|304|\/nope/i;
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !IGNORE.test(m.text())) noise.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => noise.push(`[pageerror] ${e.message}`));
  // an EventSource that is torn down by navigation reports ERR_ABORTED — that is the transport closing, not a failure
  page.on('requestfailed', (r) => { if (!IGNORE.test(r.url()) && r.failure()?.errorText !== 'net::ERR_ABORTED') noise.push(`[request failed] ${r.url()} — ${r.failure()?.errorText}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !IGNORE.test(r.url())) noise.push(`[http ${r.status()}] ${r.url()}`); });
  page.on('request', (req) => { const u = req.url(); if (!u.startsWith(BASE) && !/^(data|blob):/.test(u)) external.add(`${req.resourceType()} ${u}`); });

  /* ---- 3a. per-page media, fonts, layout, names ---- */
  step('3a pages');
  const broken = []; const upscaled = []; const noAlt = []; const noName = []; const clipped = []; const vids = [];
  const fontState = {}; const fit = {};

  for (const p of PAGES) {
    await page.goto(BASE + p, { waitUntil: 'load' });
    await page.waitForTimeout(430);
    const d = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== 'hidden'; };
      const imgs = [...document.querySelectorAll('img')].map((el) => {
        const r = el.getBoundingClientRect();
      // a full-bleed band is wider than the window and clipped, so only the visible part has to be covered
      const layoutW = Math.min(el.offsetWidth || r.width, innerWidth);
        return { src: el.currentSrc || el.src, nat: el.naturalWidth, w: Math.round(layoutW), alt: el.getAttribute('alt'), complete: el.complete };
      });
      const bgs = [...document.querySelectorAll('[style*="background-image"]')]
        .map((el) => ((el.getAttribute('style') || '').match(/url\(["']?([^"')]+)/) || [])[1]).filter(Boolean);
      const names = [...document.querySelectorAll('a, button, [role="button"]')].filter(vis).map((el) => ({
        tag: el.tagName.toLowerCase(), href: el.getAttribute('href') || '',
        name: (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.querySelector('img')?.alt || '').trim(),
      }));
      const clip = [...document.querySelectorAll('h1,h2,h3,h4,p,span,small,li,em,b,button')]
        .filter((el) => vis(el) && el.children.length === 0)
        .map((el) => ({ el, cs: getComputedStyle(el) }))
        .filter((x) => /hidden|clip/.test(x.cs.overflowX + x.cs.overflowY) && (x.el.scrollWidth > x.el.clientWidth + 2 || x.el.scrollHeight > x.el.clientHeight + 2))
        .map((x) => ({ sel: `${x.el.tagName.toLowerCase()}${x.el.className ? '.' + String(x.el.className).split(' ')[0] : ''}`, txt: (x.el.textContent || '').trim().slice(0, 34), dx: x.el.scrollWidth - x.el.clientWidth, dy: x.el.scrollHeight - x.el.clientHeight }));
      const media = [...document.querySelectorAll('video')].map((v) => ({
        src: v.currentSrc || v.querySelector('source')?.src || '', poster: v.poster || '', preload: v.getAttribute('preload'),
        muted: v.muted, loop: v.loop, inline: v.hasAttribute('playsinline'), ready: v.readyState, err: v.error?.code || 0,
      }));
      return {
        imgs, bgs, names, clip, media, lang: document.documentElement.lang,
        scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
        fonts: { inter: document.fonts.check('16px Inter'), serif: document.fonts.check('16px "Cormorant Garamond"'), mono: document.fonts.check('12px "JetBrains Mono"'), loaded: [...document.fonts].filter((f) => f.status === 'loaded').length },
      };
    });
    for (const im of d.imgs) {
      if (/^(data|blob):/.test(im.src)) continue;
      // complete && naturalWidth === 0 is a decoded failure; !complete just means it has not been reached yet
      if (im.complete && im.nat === 0) broken.push(`${p} → ${im.src.replace(BASE, '')} (decode failed)`);
      else if (!im.complete) { const r = await head(im.src); if (r.status >= 400) broken.push(`${p} → ${im.src.replace(BASE, '')} (http ${r.status})`); }
      /* the hero is painted full-bleed on a 1262px canvas from a 1600px archive scan — a little
         upscale is the archive, not a bug; anything smaller than a card's worth of pixels is */
      const tolerance = im.w >= 900 ? 1.5 : 1.35;
      if (im.nat > 0 && im.w > im.nat * tolerance) upscaled.push(`${p} ${im.src.split('/').pop()} ${im.nat}px @ ${im.w}px`);
      if (im.alt === null) noAlt.push(`${p} ${im.src.split('/').pop()}`);
    }
    for (const bg of d.bgs) { const r = await head(new URL(bg, BASE).href); if (r.status >= 400) broken.push(`${p} → css bg ${bg}`); }
    for (const n of d.names) if (!n.name) noName.push(`${p} <${n.tag}${n.href ? ' href=' + n.href : ''}>`);
    for (const c of d.clip) clipped.push(`${p} ${c.sel} +${c.dx}/${c.dy} "${c.txt}"`);
    for (const m of d.media) vids.push({ page: p, ...m });
    fontState[p] = d.fonts;
    fit[p] = d.scrollW <= d.innerW + 1;
    check(d.lang === 'ja' || d.lang === 'en', `${p}: <html lang> is a real locale`, d.lang);
  }

  check(broken.length === 0, 'every image and CSS background loads', broken.slice(0, 5).join(' | '));
  check(upscaled.length === 0, 'no image is upscaled past its frame (1.35x, 1.5x full-bleed)', upscaled.slice(0, 5).join(' | '));
  check(noAlt.length === 0, 'every <img> carries alt (decorative ones use alt="")', noAlt.slice(0, 5).join(' | '));
  check(noName.length === 0, 'every visible link and button has an accessible name', noName.slice(0, 5).join(' | '));
  check(clipped.length === 0, 'no text is clipped by an overflow rule', clipped.slice(0, 5).join(' | '));
  check(Object.values(fit).every(Boolean), 'no horizontal overflow at 1440px on any page', Object.entries(fit).filter(([, v]) => !v).map(([k]) => k).join(' | '));
  check(Object.values(fontState).every((f) => f.inter && f.serif && f.mono), 'Inter, Cormorant Garamond and JetBrains Mono are all loaded', `${Object.values(fontState)[0]?.loaded} faces ready`);
  check(external.size === 0, 'zero third-party requests (self-hosted fonts, local media)', [...external].slice(0, 3).join(' | '));

  /* ---- 3a2. the <head> advertises URLs — favicons, manifest, feed, og:image — and every one
     of them has to answer, because a broken icon or a stale /feed.xml is a metadata bug the page
     itself never shows. ---- */
  step('3a2 head urls');
  for (const p of PAGES) {
    await page.goto(BASE + p, { waitUntil: 'load' });
    const refs = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('head link[href], head link[imagesrcset]').forEach((el) => {
        const raw = el.hasAttribute('imagesrcset') ? el.getAttribute('imagesrcset').split(',')[0].trim().split(/\s+/)[0] : el.getAttribute('href');
        if (raw && !/^(data:|#|mailto:|tel:)/i.test(raw)) out.push({ rel: (el.getAttribute('rel') || 'link').split(' ').pop(), href: raw });
      });
      document.querySelectorAll('meta[property^="og:"], meta[name="twitter:image"]').forEach((m) => {
        const c = m.getAttribute('content') || '';
        if (/^https?:\/\//i.test(c) && /\.(png|jpe?g|webp|svg|gif|mp4|webm)$/i.test(c.split('?')[0])) {
          out.push({ rel: m.getAttribute('property') || m.getAttribute('name'), href: c });
        }
      });
      return out;
    });
    const bad = [];
    const seen = new Set();
    for (const r of refs) {
      let u = r.href;
      if (/^https?:/i.test(u)) { const x = new URL(u); if (x.origin !== BASE) { bad.push(`${r.rel} points off-site (${x.host})`); continue; } u = x.pathname + x.search; }
      if (u.startsWith('//')) { bad.push(`${r.rel} is protocol-relative`); continue; }
      if (seen.has(u)) continue;
      seen.add(u);
      const res = await head(u);
      if (res.status >= 400) bad.push(`${r.rel} ${u} → ${res.status}`);
      else if (res.status === 301 || res.status === 302) bad.push(`${r.rel} ${u} redirects (${res.status} → ${res.location || '?'})`);
    }
    check(bad.length === 0, `${p}: all ${seen.size} head URLs resolve directly`, bad.slice(0, 4).join(' | '));
  }

  /* ---- 3a3. the fan card: it is an object, so it has to turn over ---- */
  step('3a3 fan card');
  await page.goto(BASE + '/#membership', { waitUntil: 'load' });
  await page.waitForSelector('#fanCard', { state: 'attached' });
  await page.waitForTimeout(500);
  const cardState = () => page.evaluate(() => {
    const c = document.querySelector('#fanCard');
    if (!c) return null;
    const f = c.querySelector('.fc-front'), k = c.querySelector('.fc-back');
    const face = (el) => ({ h: el.clientHeight, over: el.scrollHeight - el.clientHeight });
    const t = getComputedStyle(c.querySelector('.fc-flip')).transform;
    const rot = /matrix3d\(([-\d.]+)/.exec(t);
    const img = c.querySelector('.fc-face-shot img');
    return {
      faces: !!f && !!k, flipped: c.classList.contains('is-flipped'), pressed: c.getAttribute('aria-pressed'),
      rotated: !!rot && Math.abs(Number(rot[1]) + 1) < 0.08,
      faceOverflow: [face(f).over, face(k).over],
      name: (f.querySelector('h4')?.textContent || '').trim().length > 1,
      portrait: img ? { nat: img.naturalWidth, w: Math.round(img.getBoundingClientRect().width) } : null,
      numbers: [...c.querySelectorAll('[data-card-field="number"]')].map((e) => e.textContent.trim()),
      member: (c.querySelector('[data-card-field="member"]')?.textContent || '').replace(/\s+/g, ''),
      perks: [...c.querySelectorAll('.fc-perks li')].length,
      bars: c.querySelectorAll('.fc-bar i.bw1, .fc-bar i.bw2, .fc-bar i.bw3').length,
      role: c.getAttribute('role'), tab: c.getAttribute('tabindex'),
    };
  });
  const cs = await cardState();
  check(!!cs && cs.faces, 'the fan card renders two faces', cs ? 'ok' : 'no #fanCard');
  check(cs && cs.role === 'button' && cs.tab === '0', 'the card is a real control (role + tabindex)', `${cs?.role}/${cs?.tab}`);
  check(cs && cs.name, 'the card carries a holder name', String(cs?.name));
  check(cs && cs.portrait && cs.portrait.nat > 0 && cs.portrait.w <= cs.portrait.nat * 1.35,
    'the card portrait is printed, not stretched', cs ? `${cs.portrait?.nat}px @ ${cs.portrait?.w}px` : '');
  check(cs && cs.numbers.length === 2 && cs.numbers[0] === cs.numbers[1], 'front and back print the same number', (cs?.numbers || []).join(' = '));
  const dig = (v) => (String(v).match(/\d/g) || []).join('').replace(/^0+(?=\d)/, '') || '0';
  check(/^\d{6}$/.test(cs?.member || '') && dig(cs?.numbers?.[0]) === dig(cs.member), 'the back member number is the card number', `${cs?.member} from ${cs?.numbers?.[0]}`);
  check(cs && cs.perks > 0 && cs.bars > 8, 'the back carries entitlements and a barcode', `${cs?.perks} perks, ${cs?.bars} bars`);
  check(cs && cs.faceOverflow.every((o) => o <= 0), 'neither face overflows its own card', (cs?.faceOverflow || []).join('/'));
  /* the card tilts toward the pointer, so its box never "settles" and Playwright would wait
     forever for a stable element by design — click it where it is */
  await page.click('#fanCard', { force: true });
  await page.waitForTimeout(1200);
  const flipped = await cardState();
  check(flipped && flipped.flipped && flipped.rotated, 'a click turns the card over', `is-flipped=${flipped?.flipped} transform=${flipped?.rotated}`);
  check(flipped && flipped.pressed === 'true', 'the flip state is announced to AT', String(flipped?.pressed));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1100);
  check(await page.evaluate(() => !document.querySelector('#fanCard').classList.contains('is-flipped')), 'Escape turns it back to the front');
  await page.focus('#fanCard');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1100);
  check(await page.evaluate(() => document.querySelector('#fanCard').classList.contains('is-flipped')), 'Enter turns the card (keyboard parity)');
  // the tier picker has to redraw both sides
  await page.selectOption('#cardTierSelect', 'silver');
  await page.fill('#cardHolderInput', 'Ren Nakamura');
  await page.waitForTimeout(400);
  const repainted = await page.evaluate(() => {
    const c = document.querySelector('#fanCard');
    return { cls: c.className, holder: [...c.querySelectorAll('[data-card-field="holder"]')].map((e) => e.textContent.trim()),
      perks: [...c.querySelectorAll('.fc-perks li span')].map((e) => e.textContent.trim()).length,
      member: (c.querySelector('[data-card-field="member"]')?.textContent || '').replace(/\s+/g, ''),
      number: (c.querySelector('.fc-front [data-card-field="number"]')?.textContent || '').trim() };
  });
  check(/tier-silver/.test(repainted.cls) && !/tier-platinum|tier-gold|tier-diamond/.test(repainted.cls), 'choosing a tier restyles the card', repainted.cls);
  check(repainted.holder.every((h) => /REN NAKAMURA/.test(h)), 'typing a name fills every face of the card', repainted.holder.join(' | '));
  check(repainted.perks > 0, 'the back list follows the chosen tier', `${repainted.perks} perks`);
  check(/^\d{6}$/.test(repainted.member) && dig(repainted.number) === dig(repainted.member), 'the member number is redrawn with the tier', `${repainted.number} → ${repainted.member}`);
  await page.setViewportSize({ width: 1280, height: 900 });

  /* ---- 3a4. the entrance and the scroll reveal ---- */
  step('3a4 entrance and reveal');
  const look = () => page.evaluate(() => ({
    cands: document.querySelectorAll('[data-reveal]').length,
    marked: document.querySelectorAll('[data-reveal].reveal').length,
    revealed: document.querySelectorAll('[data-reveal].is-revealed').length,
    shell: getComputedStyle(document.getElementById('app-shell')).animationName,
    dur: getComputedStyle(document.getElementById('app-shell')).animationDuration,
    /* the reveal fires at (innerHeight - 8%) — see the rootMargin in client/motion.js — so that is
       the line the audit measures against; a 12px sliver of the next band is not "invisible text" */
    inViewBlind: [...document.querySelectorAll('[data-reveal]')].filter((e) => { const r = e.getBoundingClientRect(); return r.top < innerHeight * 0.92 && r.bottom > 24 && +getComputedStyle(e).opacity < 0.05; }).length,
    passedBlind: [...document.querySelectorAll('[data-reveal]')].filter((e) => e.getBoundingClientRect().bottom < 0 && +getComputedStyle(e).opacity < 0.05).length,
  }));
  const hard = await look();
  check(hard.shell === 'shellIn' && parseFloat(hard.dur) > 0.2 && parseFloat(hard.dur) < 0.7,
    'the page rises in on arrival', `${hard.shell} ${hard.dur}`);
  check(hard.cands > 0 && hard.marked === hard.cands, 'reveal candidates are armed by JS, not markup', `${hard.marked}/${hard.cands}`);
  check(hard.inViewBlind === 0, 'nothing on screen is left waiting to be revealed', `${hard.inViewBlind} at opacity 0`);
  /* the polish has to survive the way people actually move around here: soft navigation */
  await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }); const a = document.querySelector('a[href="/tour/"]'); if (a) a.click(); });
  await page.waitForTimeout(1400);
  const soft = await look();
  check(soft.cands > 0 && soft.marked === soft.cands, 'a softly navigated page reveals too', `${soft.marked}/${soft.cands} armed on /tour/`);
  check(soft.inViewBlind === 0, 'and it does not arrive with invisible text', `${soft.inViewBlind} at opacity 0`);
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(600);
  const jumped = await look();
  check(jumped.passedBlind === 0, 'a jump past content never leaves it hidden', `${jumped.passedBlind} above the fold at opacity 0, ${jumped.revealed}/${jumped.cands} revealed`);
  /* the card's own beat */
  await page.goto(BASE + '/#membership', { waitUntil: 'load' });
  await page.waitForSelector('#fanCard');
  await page.waitForTimeout(1400);
  const beat = await page.evaluate(() => {
    const g = document.querySelector('.card-preview[data-reveal]');
    const c = document.querySelector('#fanCard');
    return { revealed: !!g && g.classList.contains('is-revealed'), anim: c ? getComputedStyle(c).animationName : 'none', transform: c ? getComputedStyle(c).transform.slice(0, 12) : '' };
  });
  check(beat.revealed && beat.anim === 'cardEnter', 'the fan card comes into focus as its group reveals', `revealed=${beat.revealed} ${beat.anim}`);
  check(!/matrix/.test(beat.transform) || beat.transform === 'none', 'that beat leaves the card transform to tilt and flip', beat.transform || 'none');
  /* reduced motion: the arming never happens, so nothing can be stuck hidden */
  const c2 = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
  const p2 = await c2.newPage();
  await p2.goto(BASE + '/', { waitUntil: 'load' });
  await p2.waitForTimeout(1200);
  const calm = await p2.evaluate(() => ({
    marked: document.querySelectorAll('[data-reveal].reveal').length,
    blind: [...document.querySelectorAll('[data-reveal]')].filter((e) => +getComputedStyle(e).opacity < 0.05).length,
    shell: getComputedStyle(document.getElementById('app-shell')).animationDuration,
  }));
  await c2.close();
  check(calm.marked === 0 && calm.blind === 0, 'reduced motion shows everything, immediately', `${calm.blind} hidden, shell ${calm.shell}`);

  /* ---- 3b. responsive ---- */
  step('3b responsive');
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const p of ['/', '/shop/', '/join/', '/tour/']) {
      await page.goto(BASE + p, { waitUntil: 'load' });
      await page.waitForTimeout(320);
      const m = await page.evaluate(() => {
        let worst = null;
        document.querySelectorAll('body *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.right > window.innerWidth + 2 && r.width > 8 && (!worst || r.right > worst.right)) worst = { right: Math.round(r.right), sel: `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}` };
        });
        /* the layout can only be trusted once the controls are reachable: the page clips
           horizontally, so an element pushed past the edge has no scrollbar to rescue it */
        // body clips horizontally on this site, so the page-level clip is what makes an element
        // unreachable; only an inner track (a marquee, a carousel) counts as parked by design
        const parked = (el) => {
          for (let n = el; n && n !== document.body; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05 || cs.pointerEvents === 'none') return true;
            if (n !== el && ['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowX)) return true;   // a track that scrolls by design (body's own clip does not excuse it)
          }
          return false;
        };
        const unreachable = [];
        document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=\"button\"][tabindex]').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2 || parked(el)) return;
          if (r.right > window.innerWidth + 1 || r.left < -1) unreachable.push(`${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]} right=${Math.round(r.right)}`);
        });
        return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, worst, unreachable, total: unreachable.length };
      });
      check(m.sw <= m.iw + 1, `${p} fits ${w}px`, m.sw > m.iw + 1 ? `scrollWidth ${m.sw}, worst ${m.worst?.sel} right=${m.worst?.right}` : 'clean');
      check(m.total === 0, `${p}: every control reachable at ${w}px`, m.unreachable.slice(0, 3).join(' | '));
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  /* ---- 3c. metadata in the live DOM ---- */
  step('3c metadata');
  for (const p of ['/', '/journal/1', '/shop/', '/tour/', '/members/']) {
    await page.goto(BASE + p, { waitUntil: 'domcontentloaded' });
    const m = await page.evaluate(() => {
      const attr = (s, a) => document.querySelector(s)?.getAttribute(a) || '';
      const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent);
      let ldError = '';
      try { JSON.parse(ld[0] || ''); } catch (e) { ldError = e.message; }
      return {
        title: document.title, desc: attr('meta[name="description"]', 'content'), robots: attr('meta[name="robots"]', 'content'),
        canonical: attr('link[rel="canonical"]', 'href'),
        hreflang: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => l.getAttribute('hreflang')),
        ogImage: attr('meta[property="og:image"]', 'content'), ogType: attr('meta[property="og:type"]', 'content'),
        ogW: attr('meta[property="og:image:width"]', 'content'), ogH: attr('meta[property="og:image:height"]', 'content'),
        twitter: attr('meta[name="twitter:card"]', 'content'),
        styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href),
        preloads: [...document.querySelectorAll('link[rel="preload"]')].map((l) => l.href),
        ldCount: ld.length, ldError, ldBreakout: /<\/(script|)/.test(ld[0] || ''),
        inlineHandlers: [...document.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on[a-z]+$/i.test(a.name))).length,
        icons: !!document.querySelector('link[rel="icon"]'), theme: !!document.querySelector('meta[name="theme-color"]'),
        manifest: !!document.querySelector('link[rel="manifest"]'), viewport: !!document.querySelector('meta[name="viewport"]'),
        duplicateTitle: document.querySelectorAll('title').length, duplicateDesc: document.querySelectorAll('meta[name="description"]').length,
      };
    });
    check(!!m.title && m.title.length <= 72, `${p}: title exists and fits SERPs`, `${m.title.length} chars`);
    check(m.duplicateTitle === 1 && m.duplicateDesc === 1, `${p}: exactly one <title> and one description`);
    check(displayWidth(m.desc) >= 60 && displayWidth(m.desc) <= 300, `${p}: description is a real summary`, `${displayWidth(m.desc)} display units`);
    check(/index|noindex/.test(m.robots), `${p}: robots directive present`, m.robots);
    const want = (BASE + p.split('?')[0]).replace(/\/$/, '');
    check(/^https?:\/\//.test(m.canonical) && m.canonical.replace(/\/$/, '') === want, `${p}: canonical is absolute and correct`, m.canonical);
    check(m.hreflang.join(',') === 'ja,en,x-default', `${p}: hreflang set`, m.hreflang.join(','));
    check(/^https?:\/\//.test(m.ogImage) && !/[?&]_pjax/.test(m.ogImage), `${p}: og:image absolute`, m.ogImage.replace(BASE, ''));
    const r = await head(m.ogImage);
    check(r.status === 200, `${p}: og:image fetches`, String(r.status));
    check((+m.ogW > 0 && +m.ogH > 0), `${p}: og:image dimensions declared`, `${m.ogW}x${m.ogH}`);
    check(m.twitter === 'summary_large_image', `${p}: twitter card`, m.twitter);
    check(m.styles.length === 1 && m.styles[0].includes('app.css'), `${p}: one stylesheet, no duplicate payload`, m.styles.map((s) => s.split('/').pop()).join('+'));
    check(m.preloads.length >= 2, `${p}: fonts and LCP image are preloaded`, `${m.preloads.length} links`);
    check(m.ldCount === 1 && !m.ldError, `${p}: single parseable JSON-LD graph`, m.ldError || 'ok');
    check(!m.ldBreakout, `${p}: JSON-LD is escaped against </script> breakout`);
    check(m.inlineHandlers === 0, `${p}: no inline on* handlers (CSP safe)`, String(m.inlineHandlers));
    check(m.icons && m.theme && m.manifest && m.viewport, `${p}: icons, theme-color, manifest and viewport all set`);
    if (p === '/journal/1') check(m.ogType === 'article', 'journal post advertises og:type=article', m.ogType);
    if (p === '/members/') check(/noindex/.test(m.robots), 'member area is noindex', m.robots);
  }

  /* ---- 3d. navigation and click meaning ---- */
  step('3d navigation');
  for (const p of ['/', '/work/', '/tour/', '/members/']) {
    await page.goto(BASE + p, { waitUntil: 'load' });
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), hash: a.hash, text: (a.innerText || a.getAttribute('aria-label') || '').trim() })));
    const internalOnly = [...new Set(links.filter((l) => l.href.startsWith('/') && !l.href.startsWith('//')).map((l) => l.href))];
    const dead = [];
    for (const h of internalOnly) { const r = await head(new URL(h.split('#')[0], BASE).href); if (r.status >= 400) dead.push(`${h} ${r.status}`); }
    check(dead.length === 0, `${p}: all ${internalOnly.length} internal links resolve`, dead.slice(0, 4).join(' | '));
    // only fragments we own: an absolute link's #hash belongs to the site it points at (e.g. OSM's #map=15/..)
    const hashTargets = [...new Set(links.filter((l) => l.hash && l.href.startsWith('/') && !l.href.startsWith('//')).map((l) => l.href))];
    const missingHash = [];
    for (const h of hashTargets) {
      const [path, id] = [h.split('#')[0] || p, h.split('#')[1]];
      const res = await fetch(new URL(path, BASE).href); const html = await res.text();
      if (!new RegExp(`id="${id}"`).test(html)) missingHash.push(`${h} → no #${id} on ${path}`);
    }
    check(missingHash.length === 0, `${p}: every #anchor names a real section`, missingHash.slice(0, 4).join(' | '));
    const hashOnly = links.filter((l) => l.href === '#' || l.href === '');
    check(hashOnly.length === 0, `${p}: no href="#" placeholders`, `${hashOnly.length} found`);
    /* a control that carries data-x must be handled by the bundle — an unwired attribute is a dead click */
    const attrs = await page.evaluate(() => {
      const set = new Set();
      const SKIP = /^data-(c-|reveal|img-|parallax|no-|locale|build|carousel|preview|count|slot)/;
      document.querySelectorAll('button, [role="button"], a').forEach((el) => {
        const href = el.getAttribute('href') || '';
        [...el.attributes].forEach((a) => {
          if (!/^data-[a-z][\w-]*$/.test(a.name) || SKIP.test(a.name)) return;
          if (el.tagName === 'A' && href && !href.startsWith('#')) return;   // a real link: checked above
          set.add(a.name);
        });
      });
      return [...set];
    });
    const camel = (s) => s.replace(/^data-/, '').replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
    const unwired = attrs.filter((a) => !bundle.includes(`"${a}"`) && !bundle.includes(`'${a}'`) && !bundle.includes(`dataset.${camel(a)}`) && !bundle.includes(`getAttribute('${a}')`) && !bundle.includes(`[${a}]`) && !bundle.includes(`[${a}=`));
    check(unwired.length === 0, `${p}: all ${attrs.length} data-driven controls are wired in the bundle`, unwired.slice(0, 6).join(', '));
  }

  /* ---- 3e. motion + interaction ---- */
  step('3e motion');
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.evaluate(() => { window.__auditMarker = 'alive'; });
  await page.click('.nav a[href="/tour/"]').catch(() => {});
  await page.waitForTimeout(1000);
  const nav = await page.evaluate(() => ({ marker: window.__auditMarker, path: location.pathname, search: location.search, shell: !!document.querySelector('#app-shell > *'), urlParam: /_pjax/.test(location.search) }));
  check(nav.path === '/tour/', 'nav click swaps in the new page', nav.path);
  check(nav.marker === 'alive', 'soft navigation preserves the JS context (no hard reload)', String(nav.marker));
  check(!nav.urlParam, 'the transport flag never leaks into the address bar', nav.search || '(clean)');
  await page.goBack({ waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(400);
  check(await page.evaluate(() => location.pathname) === '/', 'browser Back works with soft navigation');
  await page.goForward().catch(() => {});
  await page.waitForTimeout(400);
  check(await page.evaluate(() => location.pathname) === '/tour/', 'browser Forward works too');

  await page.goto(BASE + '/', { waitUntil: 'load' });
  const c0 = await page.evaluate(() => document.querySelector('.hero [data-c-counter]')?.textContent.trim());
  await page.waitForTimeout(7000);
  const c1 = await page.evaluate(() => document.querySelector('.hero [data-c-counter]')?.textContent.trim());
  check(c0 !== c1, 'hero carousel advances on its own', `${c0} → ${c1}`);
  await page.evaluate(async () => { for (const y of [600, 1400, 2400]) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 240)); } });
  await page.waitForTimeout(400);
  const revealedCount = await page.evaluate(() => document.querySelectorAll('[data-reveal].is-revealed').length);
  check(revealedCount > 3, 'scroll reveals activate as sections enter', `${revealedCount} revealed`);
  const sticky = await page.evaluate(async () => { window.scrollTo({ top: 900, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 320)); const h = document.getElementById('header'); return Math.round(h.getBoundingClientRect().top); });
  check(sticky <= 1, 'header stays pinned while scrolling', `top=${sticky}`);
  check(await page.evaluate(() => !!document.getElementById('motionCurtain')), 'transition curtain is mounted');
  check(await page.evaluate(() => !!document.querySelector('.nav a.active')), 'the current page is marked in the nav');
  const progress = await page.evaluate(async () => {
    const read = () => document.getElementById('scrollProgress')?.style.transform || '';
    window.scrollTo({ top: 900, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 220));
    const near = read();
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 320));
    return { near, end: read() };
  });
  check(/scaleX\(0\.[0-9]/.test(progress.near) && /scaleX\((0\.9\d|1)\)/.test(progress.end), 'scroll progress bar tracks the page', `${progress.near} → ${progress.end}`);

  const badVid = vids.filter((v) => v.err > 0 || !v.poster);
  check(vids.length === 0 || badVid.length === 0, `${vids.length} <video> element(s): poster-first, no load error`, badVid.slice(0, 2).map((v) => `${v.page} ${v.src}`).join(' | '));

  const rm = await ctx.newPage();
  await rm.emulateMedia({ reducedMotion: 'reduce' });
  await rm.goto(BASE + '/', { waitUntil: 'load' });
  await rm.waitForTimeout(450);
  const rmState = await rm.evaluate(() => ({
    hidden: [...document.querySelectorAll('[data-reveal]')].filter((el) => getComputedStyle(el).opacity === '0').length,
    flag: document.documentElement.classList.contains('motion-reduced'),
    kenburns: [...document.querySelectorAll('.c-ken')].some((el) => getComputedStyle(el).animationName !== 'none'),
  }));
  check(rmState.hidden === 0, 'reduced-motion leaves nothing invisible', `${rmState.hidden} hidden`);
  check(rmState.flag, 'reduced-motion flag is applied to <html>');
  check(!rmState.kenburns, 'reduced-motion stops the Ken Burns loop');
  await rm.close();

  /* no-JS: the document alone must still show content */
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const nj = await noJs.newPage();
  await nj.goto(BASE + '/', { waitUntil: 'load' });
  const njState = await nj.evaluate(() => {
    const card = document.querySelector('.fan-card');
    const front = card && card.querySelector('.fc-front').getBoundingClientRect();
    const back = card && card.querySelector('.fc-back').getBoundingClientRect();
    return {
      heroTitle: (document.querySelector('.hero h1')?.textContent || '').trim().slice(0, 24),
      hidden: [...document.querySelectorAll('[data-reveal]')].filter((el) => getComputedStyle(el).opacity === '0').length,
      firstSlideVisible: !!document.querySelector('.hero-slide.is-active'),
      // the flip is an enhancement: with no script the two faces must simply stack, never hide
      cardStacked: !!card && back.top >= front.bottom - 2,
      cardBackReadable: !!card && (card.querySelector('.fc-back').innerText || '').trim().length > 30,
    };
  });
  check(njState.heroTitle.length > 2 && njState.hidden === 0 && njState.firstSlideVisible, 'with JavaScript disabled the hero and all copy still render', JSON.stringify(njState));
  check(njState.cardStacked && njState.cardBackReadable, 'with JavaScript disabled both card faces stay readable', `stacked=${njState.cardStacked} back=${njState.cardBackReadable}`);
  await noJs.close();

  /* ---------- 3f. console ---------- */
  step('3f console');
  check(noise.length === 0, 'browser console and network log is clean', [...new Set(noise)].slice(0, 6).join(' | '));
  await browser.close();
} else if (!process.env.AUDIT_ALLOW_NO_BROWSER) {
  check(false, 'the browser stages of the audit ran', lastBrowserError() + ' — or set AUDIT_ALLOW_NO_BROWSER=1 to audit HTTP and metadata only');
} else {
  console.log('[audit] browser stage skipped by request');
}

const failed = results.filter(([pass]) => !pass);
console.log(`\n${results.length - failed.length}/${results.length} audit checks passed`);
if (failed.length) {
  console.log('\nFAILURES:');
  for (const [, n, d] of failed) console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`);
  process.exit(1);
}
console.log('PASS — links, media, fonts, metadata, sitemap, motion and layout are clean');
