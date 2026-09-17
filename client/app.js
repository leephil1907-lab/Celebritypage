/**
 * client/app.js — bootstrap. Order matters: motion first (page reveal), then components.
 * Everything is defensive: a missing element is normal, an exception never breaks the page.
 */
import { initCarousels } from './carousel.js';
import { initMotion, revealAll, initTilt, initCounters } from './motion.js';
import { initAmbientVideos } from './player.js';
import * as Site from './site.js';

const safe = (label, fn) => { try { return fn(); } catch (err) { console.warn(`[app] ${label} skipped:`, err?.message || err); } };

function bootFilters() {
  document.querySelectorAll('[data-filter-group]').forEach((group) => {
    if (group.__bound) return;
    group.__bound = true;
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-filter]');
      if (!btn) return;
      e.preventDefault();
      const key = group.dataset.filterGroup;
      const value = btn.dataset.filter;
      group.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('is-active', b === btn));
      const scope = document.querySelector(`[data-filter-scope="${key}"]`) || document;
      scope.querySelectorAll('[data-tags]').forEach((card) => {
        const tags = card.dataset.tags.toLowerCase();
        const show = value === 'all' || tags.includes(value.toLowerCase());
        card.classList.toggle('is-hidden', !show);
        if (show) { card.classList.remove('is-pop'); void card.offsetWidth; card.classList.add('is-pop'); }
      });
      const count = scope.querySelectorAll('[data-tags]:not(.is-hidden)').length;
      const badge = document.querySelector(`[data-filter-count="${key}"]`);
      if (badge) badge.textContent = `${count} item${count === 1 ? '' : 's'}`;
    });
  });
}

function bootSearch() {
  const input = document.getElementById('siteSearch');
  if (!input || input.__bound) return;
  input.__bound = true;
  const out = document.getElementById('searchResults');
  const hint = document.getElementById('searchHint');
  let t = null;
  const run = async () => {
    const q = input.value.trim();
    if (!out) return;
    if (q.length < 2) {
      out.innerHTML = hint ? hint.innerHTML : '';
      return;
    }
    out.classList.add('is-loading');
    try {
      const data = await Site.api(`search?q=${encodeURIComponent(q)}`);
      if (!data.results.length) {
        out.innerHTML = `<div class="empty">Nothing matched “${Site.esc(q)}”. Try “tour”, “vinyl”, “vault”, “1996”…</div>`;
        return;
      }
      out.innerHTML = data.results.map((r) => `<a class="search-hit" href="${r.href}"><span class="k">${r.kind}</span><b>${Site.esc(r.title)}</b><small>${Site.esc(r.meta || '')}</small><span class="arr">→</span></a>`).join('');
    } catch (e) {
      out.innerHTML = `<div class="empty">Search unavailable: ${Site.esc(e.message)}</div>`;
    } finally { out.classList.remove('is-loading'); }
  };
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 180); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); run(); } });
  document.querySelectorAll('[data-search-suggest]').forEach((b) => b.addEventListener('click', () => { input.value = b.dataset.searchSuggest; run(); input.focus(); }));
}

function bootTicker() {
  // countdowns: next draw, lottery close, vault drop
  const els = document.querySelectorAll('[data-countdown]');
  if (!els.length) return;
  const tick = () => {
    els.forEach((el) => {
      const target = Number(el.dataset.countdown);
      if (!Number.isFinite(target)) return;
      let ms = target - Date.now();
      if (ms <= 0) ms = 1000 * 60 * 60 * 3; // rolls for demo-free cadence (server can set absolute)
      const s = Math.floor(ms / 1000);
      el.textContent = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
    });
  };
  tick();
  clearInterval(window.__tkTicker);
  window.__tkTicker = setInterval(tick, 1000);
}

function bootDate() {
  const el = document.getElementById('dailyDate');
  if (el) el.textContent = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' • JST';
}

function bootMarqueeSpeed() {
  const track = document.querySelector('.marquee-track');
  if (!track) return;
  let raf = null;
  const set = () => {
    const v = Math.min(1, Math.abs(window.scrollY) / 600);
    track.style.setProperty('--marq-dur', `${(28 - v * 12).toFixed(2)}s`);
    raf = null;
  };
  window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(set); }, { passive: true });
}

function bootLightboxGalleries() {
  document.querySelectorAll('[data-carousel-mode="coverflow"]').forEach((el) => {
    el.addEventListener('carousel:change', (e) => {
      const idx = e.detail.index;
      const sync = el.closest('[data-carousel-sync]');
      if (!sync) return;
      const key = sync.dataset.carouselSync;
      document.querySelectorAll(`[data-sync-group="${key}"] [data-carousel]`).forEach((other) => {
        if (other === el || !other.__carousel) return;
        other.__carousel.go(idx, { instant: false });
      });
    });
  });
}

/* ===================================================================
   Boot modules added for the dynamic build. All of them are delegated
   once on the document (CSP forbids inline handlers) and stay quiet
   when their markup is absent.
   =================================================================== */

/* ---------- image fallbacks: a broken src never leaves a hole ---------- */
function bootImages() {
  if (document.body.dataset.imgFallbackBoot) return;
  document.body.dataset.imgFallbackBoot = '1';
  const fix = (img) => {
    const fb = img.dataset.imgFallback;
    if (!fb || img.dataset.fbTried === '1') return;
    img.dataset.fbTried = '1';
    img.src = fb;
    img.addEventListener('load', () => img.classList.add('is-fallback'), { once: true });
  };
  document.addEventListener('error', (e) => {
    const el = e.target;
    if (el && el.tagName === 'IMG' && el.dataset.imgFallback) fix(el);
  }, true);
  // images that already failed before this script ran
  document.querySelectorAll('img[data-img-fallback]').forEach((img) => {
    if (img.complete && img.naturalWidth === 0) fix(img);
  });
  // any <img> without an explicit fallback: mark it so CSS can keep the frame tidy
  document.querySelectorAll('img:not([data-img-fallback])').forEach((img) => {
    img.addEventListener('error', () => img.classList.add('is-broken'), { once: true });
  });
}

/* ---------- copy buttons: [data-copy="text"] or the element's href ---------- */
function bootCopy() {
  if (document.body.dataset.copyBoot) return;
  document.body.dataset.copyBoot = '1';
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    e.preventDefault();
    const text = btn.dataset.copy || btn.getAttribute('href') || window.location.href;
    let ok = true;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
      }
    } catch { ok = false; }
    btn.classList.add('is-copied');
    const prev = btn.getAttribute('aria-label') || '';
    btn.setAttribute('aria-label', ok ? 'Copied' : 'Copy failed');
    if (ok) Site.toast('Copied — ' + (text.length > 42 ? text.slice(0, 42) + '…' : text), 'ok');
    else Site.toast('Copy blocked by the browser — select it manually', 'warn');
    setTimeout(() => { btn.classList.remove('is-copied'); if (prev) btn.setAttribute('aria-label', prev); }, 1800);
  });
}

/* ---------- release player: real <audio> when a source exists, cue-sheet otherwise ---------- */
let releasesCache = null;
async function releases() {
  if (releasesCache) return releasesCache;
  try { releasesCache = await Site.api('releases', {}); } catch { releasesCache = []; }
  return releasesCache || [];
}

const fmtTime = (s) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

function bootPlayer() {
  const card = document.getElementById('playerCard');
  if (!card || card.dataset.playerBoot) return;
  card.dataset.playerBoot = '1';
  const art = card.querySelector('#pcArt');
  const title = card.querySelector('#pcTitle');
  const meta = card.querySelector('#pcMeta');
  const bar = card.querySelector('#pcProg');
  const cur = card.querySelector('#pcCur');
  const dur = card.querySelector('#pcDur');
  const list = card.querySelector('#pcTracks');
  const toggle = card.querySelector('#pcToggle');
  const prevBtn = card.querySelector('#pcPrev');
  const nextBtn = card.querySelector('#pcNext');

  const state = { release: null, track: 0, playing: false, t: 0, tick: null, audio: new Audio(), src: '' };
  state.audio.preload = 'none';
  const hasRealAudio = () => !!(state.src && !state.audio.error);
  const trackSeconds = () => (state.release ? 180 + ((state.track * 37) % 60) : 0);

  function paint() {
    const secs = trackSeconds();
    const pos = Math.min(secs, state.t);
    if (bar) bar.style.width = secs ? (pos / secs * 100).toFixed(2) + '%' : '0%';
    if (cur) cur.textContent = fmtTime(pos);
    if (dur) dur.textContent = fmtTime(secs);
    list?.querySelectorAll('li').forEach((li, i) => li.classList.toggle('is-current', i === state.track));
    if (toggle) { toggle.textContent = state.playing ? '❚❚' : '▶'; toggle.setAttribute('aria-pressed', String(state.playing)); }
    card.classList.toggle('is-playing', state.playing);
  }

  function stopTick() { if (state.tick) { clearInterval(state.tick); state.tick = null; } }
  function startTick() {
    stopTick();
    if (!state.playing) return;
    state.tick = setInterval(() => {
      const len = trackSeconds();
      state.t = hasRealAudio() ? state.audio.currentTime : state.t + 1;
      if (state.t >= len) { state.t = 0; state.track = (state.track + 1) % Math.max(1, (state.release?.tracks || []).length || 1); paint(); }
      else paint();
    }, 1000);
  }

  function play(on = !state.playing) {
    state.playing = on;
    if (hasRealAudio()) { if (on) state.audio.play().catch(() => { state.src = ''; }); else state.audio.pause(); }
    startTick();
    paint();
  }

  function load(release, { autoplay = false } = {}) {
    if (!release) return;
    state.release = release;
    state.track = 0; state.t = 0;
    if (title) title.textContent = release.title;
    if (meta) meta.textContent = `${release.artist || 'Takuya Kimura'} • ${release.release_date || ''} • ${release.kind || 'album'}`;
    if (art && release.cover) art.style.backgroundImage = `url(${JSON.stringify(release.cover)})`;
    const tracks = release.tracks || [];
    if (list) {
      list.innerHTML = tracks.length
        ? tracks.map((tr, i) => `<li data-track="${i}"><span class="mono dim">${String(i + 1).padStart(2, '0')}</span><span>${Site.esc(tr)}</span><span class="mono dim small">${fmtTime(180 + ((i * 37) % 60))}</span></li>`).join('')
        : `<li class="dim">—</li>`;
    }
    const preview = (release.preview || '').trim();
    if (preview) {
      state.src = preview; state.audio.src = preview; state.audio.currentTime = 0;
    } else {
      state.src = ''; state.audio.pause(); state.audio.removeAttribute('src'); state.audio.load();
    }
    if (autoplay) { state.playing = true; startTick(); if (hasRealAudio()) state.audio.play().catch(() => { state.src = ''; }); }
    paint();
    card.classList.remove('is-swap'); void card.offsetWidth; card.classList.add('is-swap');
  }

  async function pick(id) {
    const all = await releases();
    const rel = all.find((r) => String(r.id) === String(id)) || all[0];
    load(rel, { autoplay: true });
    document.dispatchEvent(new CustomEvent('dom:refresh', { detail: { scope: card } }));
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-play-release]');
    if (btn) { e.preventDefault(); pick(btn.dataset.playRelease); return; }
    if (e.target.closest('#pcToggle')) { e.preventDefault(); play(); return; }
    if (e.target.closest('#pcPrev')) { e.preventDefault(); state.t = 0; state.track = Math.max(0, state.track - 1); paint(); return; }
    if (e.target.closest('#pcNext')) { e.preventDefault(); state.t = 0; state.track = Math.min(((state.release?.tracks || []).length || 1) - 1, state.track + 1); paint(); return; }
    const li = e.target.closest('#pcTracks li[data-track]');
    if (li) { state.track = Number(li.dataset.track) || 0; state.t = 0; paint(); if (!state.playing) play(true); }
  });

  state.audio.addEventListener('ended', () => { state.t = 0; state.track += 1; paint(); });
  window.addEventListener('page:swap', () => { stopTick(); state.playing = false; });

  releases().then((all) => {
    if (all && all.length) {
      state.release = all.find((r) => r.id === Number(card.dataset.release)) || all[0];
      load(state.release);
    } else {
      paint();
    }
  });
  paint();
}

/* ---------- forms that post to the API: verify, support, password ---------- */
function bootForms() {
  if (document.body.dataset.formsBoot) return;
  document.body.dataset.formsBoot = '1';

  // venue kiosk / order check
  const verify = document.getElementById('verifyForm');
  verify?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = document.getElementById('verifyOut');
    const code = (verify.querySelector('[name=qr]')?.value || '').trim();
    if (!code) return;
    out.className = 'verify-out is-busy';
    out.textContent = 'Checking…';
    try {
      const r = await Site.api('orders/verify', { method: 'POST', body: { qr: code } });
      const o = r.order || {};
      out.className = 'verify-out is-ok';
      out.innerHTML = `<b>${o.pickup_venue ? 'Pickup · ' + Site.esc(o.pickup_venue) : 'Order found'}</b>`
        + `<span>${Site.esc(o.status || 'collected')} · ${(r.items || []).length} item(s) · ${Site.esc(o.order_no || '')}</span>`
        + (r.already ? `<span class="tagchip gold">already collected</span>` : `<span class="tagchip gold">stamped</span>`);
    } catch (err) {
      out.className = 'verify-out is-bad';
      out.innerHTML = `<b>${Site.esc(err.message || 'Verification failed')}</b>`;
    }
  });

  // support desk — chat path first, native POST stays as the no-JS route
  const support = document.getElementById('supportForm');
  support?.addEventListener('submit', async (e) => {
    if (support.dataset.native === '1') return;
    e.preventDefault();
    const fd = new FormData(support);
    const message = [`RE: ${fd.get('subject') || 'Support'} [${fd.get('category') || 'general'}]`, fd.get('message')].join('\n');
    const btn = support.querySelector('button[type=submit]');
    btn?.setAttribute('disabled', '');
    try {
      const r = await Site.api('chat/send', { method: 'POST', body: { message } });
      const ok = document.getElementById('supportOk');
      if (ok) {
        ok.className = 'ok-banner show';
        ok.innerHTML = `<b>${Site.esc(r.ticket.code || 'Ticket opened')}</b><span>${Site.esc((r.ticket.messages || []).slice(-1)[0]?.body || 'Management has your ticket.')}</span>`;
      }
      support.reset();
      Site.toast('Ticket ' + (r.ticket.code || '') + ' opened — chat is live', 'ok');
      document.dispatchEvent(new CustomEvent('dom:refresh'));
      Site.openChat?.(r.ticket.id);
      window.dispatchEvent(new Event('session:changed'));
    } catch (err) {
      // the plain POST route (/support/ticket) still works, so let the next submit go native
      support.dataset.native = '1';
      Site.toast((err.message || 'Ticket API unavailable') + ' — the form will post directly now', 'warn');
    } finally { btn?.removeAttribute('disabled'); }
  });

  // password change on the member dashboard
  const pass = document.getElementById('passForm');
  pass?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = document.getElementById('passMsg');
    const body = Object.fromEntries(new FormData(pass).entries());
    try {
      const r = await Site.api('auth/password', { method: 'POST', body });
      if (out) { out.className = 'form-msg show ok'; out.textContent = r.message || 'Password updated.'; }
      pass.reset();
      Site.toast('Password updated', 'ok');
    } catch (err) {
      if (out) { out.className = 'form-msg show bad'; out.textContent = err.message || 'Could not update.'; }
    }
  });

  // booking form lives in site.js (initBooking) — nothing to do here
}

/* ---------- search page: suggestions + live results, server is the source ---------- */
function bootSearchPage() {
  if (document.body.dataset.searchPageBoot) return;
  document.body.dataset.searchPageBoot = '1';
  const input = document.getElementById('siteSearch');
  const box = document.getElementById('searchResults');
  if (!input || !box) return;
  let timer = null;
  const paint = (rows, q) => {
    const count = document.querySelector('[data-result-count]');
    if (count) count.textContent = String(rows.length);
    box.innerHTML = rows.length
      ? rows.map((r) => `<a class="search-hit" href="${Site.esc(r.href)}"><span class="k">${Site.esc(r.kind)}</span><b>${Site.esc(r.title)}</b><small>${Site.esc(r.meta || '')}</small><span class="arr" aria-hidden="true">→</span></a>`).join('')
      : `<div class="empty">Nothing matched “${Site.esc(q)}”.</div>`;
    document.dispatchEvent(new CustomEvent('dom:refresh', { detail: { scope: box } }));
  };
  const run = async (q) => {
    if (!q || q.length < 2) { paint([], q); return; }
    try { const r = await Site.api('search?q=' + encodeURIComponent(q), {}); paint(r.results || [], q); } catch {}
  };
  input.addEventListener('input', () => { clearTimeout(timer); const q = input.value.trim(); timer = setTimeout(() => run(q), 220); });
  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-search-suggest]');
    if (!s) return;
    e.preventDefault();
    input.value = s.dataset.searchSuggest;
    run(input.value);
    input.focus();
  });
}

/* ---------- shop: instant client-side narrowing on top of the server list ---------- */
function bootCatalogue() {
  if (document.body.dataset.catalogueBoot) return;
  document.body.dataset.catalogueBoot = '1';
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter-cat]');
    if (!btn) return;
    const scope = btn.closest('section') || document;
    const want = btn.dataset.filterCat;
    scope.querySelectorAll('[data-filter-cat]').forEach((b) => b.classList.toggle('is-active', b === btn));
    scope.querySelectorAll('[data-cat]').forEach((el) => {
      const show = want === 'all' || el.dataset.cat === want;
      el.classList.toggle('is-hidden', !show);
      if (show) { el.classList.remove('is-in'); void el.offsetWidth; el.classList.add('is-in'); }
    });
  });
}

function refresh() {
  safe('carousels', () => initCarousels(document));
  safe('ambient media', () => initAmbientVideos(document));
  safe('reveal', () => revealAll(document));
  safe('tilt', () => initTilt(document));
  safe('counters', () => initCounters(document));
  safe('filters', () => bootFilters());
  safe('search', () => bootSearch());
  safe('countdown', () => bootTicker());
  safe('marquee', () => bootMarqueeSpeed());
  safe('sync', () => bootLightboxGalleries());
  safe('catalogue', () => bootCatalogue());
  safe('searchpage', () => bootSearchPage());
  safe('forms', () => bootForms());
  safe('site', () => Site.mount(document));
}

function start() {
  safe('images', () => bootImages());
  safe('copy', () => bootCopy());
  safe('player', () => bootPlayer());
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  document.documentElement.classList.add('js-on');
  safe('motion', () => initMotion({ closeDrawer: () => document.getElementById('drawer')?.classList.remove('open') }));
  refresh();
  bootDate();
  if (reduced) document.documentElement.classList.add('motion-reduced');
  document.addEventListener('page:swap', refresh);
  document.addEventListener('dom:refresh', refresh);
  // if the browser back/forward fires without our state, keep components fresh
  window.addEventListener('pageshow', (e) => { if (e.persisted) refresh(); });
  document.body.classList.add('is-ready');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
