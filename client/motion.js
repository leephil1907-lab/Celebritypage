/**
 * client/motion.js — the motion layer.
 *  • soft navigation: internal links fetch a page fragment and swap inside a View Transition
 *    with a gold curtain wipe + page label (falls back to a normal navigation on any failure)
 *  • scroll reveals, parallax, magnetic buttons, tilt, counters, cursor glow, scroll progress
 *  • everything is opt-in via data-attributes and fully disabled for prefers-reduced-motion
 */

const REDUCED = () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
const canVT = () => typeof document.startViewTransition === 'function';
/* trailing-slash-normalised pathname: the address bar keeps the slash, comparisons do not care */
const cleanPath = (u) => { const x = new URL(u, location.href); const p = x.pathname.split('/').filter(Boolean).join('/'); return p ? '/' + p + '/' : '/'; };
const ease = 'cubic-bezier(.22,1,.36,1)';

const PAGE_LABELS = {
  '/': ['01', 'HOME — Official Digital World'],
  '/work/': ['02', 'WORK — Film • TV • CM'],
  '/music/': ['03', 'MUSIC — Checkpoint'],
  '/tour/': ['04', 'TOUR — Center & Passport'],
  '/journal/': ['05', 'JOURNAL — Editorial'],
  '/archive/': ['06', 'ARCHIVE — 1987 → Future'],
  '/members/': ['07', 'MEMBERS — Fan Card & Vault'],
  '/shop/': ['08', 'SHOP — Official Goods'],
  '/search/': ['09', 'SEARCH — Explore'],
  '/support/': ['10', 'SUPPORT — Ticket Desk'],
  '/join/': ['11', 'JOIN — Membership'],
};

function curtain() {
  let el = document.getElementById('motionCurtain');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'motionCurtain';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <div class="mc-panel mc-a"></div><div class="mc-panel mc-b"></div><div class="mc-panel mc-c"></div>
    <div class="mc-meta"><span class="mc-num" id="mcNum">01</span><span class="mc-label" id="mcLabel">Official Digital World</span>
      <span class="mc-line"><i></i></span></div>`;
  document.body.appendChild(el);
  return el;
}

export function revealAll(root = document) {
  root.querySelectorAll('[data-reveal]:not(.is-revealed)').forEach((el) => io.observe(el));
}
let io;
function initReveal() {
  io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const el = en.target;
      io.unobserve(el);
      const delay = Number(el.dataset.revealDelay || 0);
      setTimeout(() => { el.classList.add('is-revealed'); }, delay);
      if (el.dataset.revealOnce === 'stagger') {
        [...el.children].forEach((c, i) => {
          c.classList.add('is-staggered');
          c.style.setProperty('--stagger', `${i * 70}ms`);
        });
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  // mark candidates — never hide content when JS is off, so we add the base class here only
  document.querySelectorAll('[data-reveal]').forEach((el) => { el.classList.add('reveal'); io.observe(el); });
}

function initHeader() {
  const header = document.getElementById('header');
  const bar = document.getElementById('scrollProgress');
  const topbar = document.querySelector('.topbar');
  let last = window.scrollY, ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      const h = document.documentElement.scrollHeight - window.innerHeight;
      header?.classList.toggle('is-scrolled', y > 18);
      header?.classList.toggle('is-hidden', y > 320 && y > last + 4);
      header?.classList.toggle('is-down', y > last + 4);
      last = y; ticking = false;
      if (bar) bar.style.transform = `scaleX(${h > 0 ? clamp(y / h, 0, 1) : 0})`;
      if (topbar) topbar.style.setProperty('--tuck', `${Math.min(y, 60) / 60}`);
      parallax(y);
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function parallax(y = window.scrollY) {
  if (REDUCED()) return;
  document.querySelectorAll('[data-parallax]').forEach((el) => {
    const speed = Number(el.dataset.parallax || 0.08);
    const r = el.getBoundingClientRect();
    if (r.bottom < -200 || r.top > window.innerHeight + 200) return;
    const rel = r.top + y - window.scrollY;
    el.style.setProperty('--px', `${((rel + r.height / 2 - window.innerHeight / 2) * -speed).toFixed(2)}px`);
  });
}

function initSmoothAnchors(nav) {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.dataset.noScroll) return;
    const id = a.getAttribute('href').slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    const top = target.getBoundingClientRect().top + window.scrollY - (document.getElementById('header')?.offsetHeight || 0) - 12;
    window.scrollTo({ top, behavior: REDUCED() ? 'auto' : 'smooth' });
    history.replaceState(history.state, '', `#${id}`);
    if (nav?.closeDrawer) nav.closeDrawer();
  });
}

function initMagnetic() {
  if (REDUCED() || matchMedia('(hover: none)').matches) return;
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest('[data-magnetic], .btn, .hero-btn, .c-btn');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
    const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
    el.style.transform = `translate(${clamp(dx, -1, 1) * 5}px, ${clamp(dy, -1, 1) * 3.5}px)`;
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    const el = e.target.closest('[data-magnetic], .btn, .hero-btn, .c-btn');
    if (el) el.style.transform = '';
  }, { passive: true });
}

export function initTilt(root = document) {
  if (REDUCED()) return;
  root.querySelectorAll('[data-tilt]').forEach((card) => {
    if (card.__tilt) return;
    card.__tilt = true;
    const strength = Number(card.dataset.tilt || 9);
    const glare = document.createElement('span');
    glare.className = 'tilt-glare';
    card.appendChild(glare);
    const move = (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      card.style.transform = `perspective(900px) rotateY(${(px - 0.5) * strength * 2}deg) rotateX(${(0.5 - py) * strength * 1.4}deg) translateZ(0) scale(1.012)`;
      glare.style.background = `radial-gradient(340px circle at ${px * 100}% ${py * 100}%, rgba(255,255,255,.24), transparent 55%)`;
      glare.style.opacity = '1';
    };
    const leave = () => { card.style.transform = ''; glare.style.opacity = '0'; };
    card.addEventListener('pointermove', move);
    card.addEventListener('pointerleave', leave);
  });
}

export function initCounters(root = document) {
  const els = root.querySelectorAll('[data-count]');
  if (!els.length) return;
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      obs.unobserve(en.target);
      const el = en.target;
      const target = Number(el.dataset.count);
      if (!Number.isFinite(target) || REDUCED()) return;
      const dur = 1100; const t0 = performance.now();
      const tick = (t) => {
        const p = clamp((t - t0) / dur, 0, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased).toLocaleString('en-US');
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.4 });
  els.forEach((el) => obs.observe(el));
}

function initCursor() {
  if (REDUCED() || matchMedia('(hover: none)').matches) return;
  const dot = document.createElement('div');
  dot.className = 'cursor-glow';
  dot.setAttribute('aria-hidden', 'true');
  document.body.appendChild(dot);
  let x = 0, y = 0, cx = 0, cy = 0, raf = null;
  const loop = () => {
    cx += (x - cx) * 0.12; cy += (y - cy) * 0.12;
    dot.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
    raf = Math.abs(x - cx) > 0.4 || Math.abs(y - cy) > 0.4 ? requestAnimationFrame(loop) : null;
  };
  document.addEventListener('pointermove', (e) => {
    x = e.clientX; y = e.clientY;
    if (!raf) raf = requestAnimationFrame(loop);
    dot.classList.toggle('is-hot', !!e.target.closest('a,button,[data-tilt],input,select,textarea'));
  }, { passive: true });
}

/* ---------- soft navigation ---------- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function initNavigation({ onSwap } = {}) {
  const root = document.documentElement;
  root.classList.add('motion-ready');
  const cur = curtain();
  let busy = false;
  /* a tiny trail so Back feels like Back: the curtain wipes the other way */
  const trail = [location.pathname];
  const direction = (path) => {
    const i = trail.lastIndexOf(path);
    if (i === -1) return 'fwd';
    return i >= trail.length - 1 ? 'fwd' : 'back';
  };

  const internal = (a) => {
    const href = a.getAttribute('href');
    if (!href) return false;
    if (a.target === '_blank' || a.hasAttribute('download') || a.dataset.noTransition !== undefined) return false;
    if (/^(mailto:|tel:|javascript:)/.test(href)) return false;
    if (href.startsWith('#')) return false;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return false;
    if (/\.(png|jpe?g|webp|gif|svg|css|js|pdf|ico|json|xml|txt|zip|mp4|webm)$/i.test(url.pathname)) return false;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads')) return false;
    if (url.pathname.startsWith('/admin')) return false;
    if (url.search.includes('_pjax=0')) return false;
    return true;
  };

  async function fetchFragment(url) {
    const qs = new URLSearchParams(url.search);
    qs.set('_pjax', '1');
    const res = await fetch(`${url.pathname}?${qs}`, { headers: { 'x-pjax': '1' }, credentials: 'same-origin' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    if (!data?.html) throw new Error('no fragment');
    return data;
  }

  function apply(data, url, { replace = false } = {}) {
    const shell = document.getElementById('app-shell');
    if (!shell) throw new Error('no shell');
    shell.innerHTML = data.html;
    document.title = data.title || document.title;
    const desc = document.querySelector('meta[name="description"]');
    if (desc && data.description) desc.setAttribute('content', data.description);
    document.body.dataset.page = data.page || '';
    markNav(url.pathname);   // the highlight has to move with the page, not stay where the server drew it
    if (data.lang) document.documentElement.lang = data.lang;
    const clean = (u) => { const x = new URL(u, location.href); x.searchParams.delete('_pjax'); return x.pathname + (x.searchParams.toString() ? `?${x.searchParams.toString()}` : ''); };
    const dest = (data.url ? clean(data.url) : clean(url.pathname + url.search)) + (url.hash || '');
    // a popstate-driven swap has to REPLACE: pushState here would truncate the forward list and
    // 'forward' would then dead-end, which is exactly how soft navigation usually feels broken
    if (replace) history.replaceState({ pjax: 1, url: dest }, '', dest);
    else history.pushState({ pjax: 1, url: dest }, '', dest);
    if (trail[trail.length - 1] !== url.pathname) trail.push(url.pathname);
    const top = url.hash ? document.getElementById(url.hash.slice(1)) : null;
    if (top) top.scrollIntoView({ behavior: REDUCED() ? 'auto' : 'smooth', block: 'start' });
    else window.scrollTo({ top: 0, behavior: 'auto' });
    document.dispatchEvent(new CustomEvent('page:swap', { detail: data }));
    onSwap?.(data);
  }

  /**
   * The curtain and the fetch run at the same time — that is the difference between a transition
   * that reads as designed and one that reads as a delay. Nothing is ever shown for less than
   * COVER_MS, so the wipe cannot half-play on a warm cache.
   */
  const COVER_MS = 250;
  /* A navigation that arrives while the curtain is mid-flight is queued, never dropped. The old
     `if (busy) return false` swallowed clicks: the first second of a cold page felt dead. */
  let queued = null, queuedOpts = null;
  function drain() {
    if (!queued || busy) return;
    const h = queued, o = queuedOpts;
    queued = queuedOpts = null;
    go(h, o);
  }
  async function go(href, { push = true } = {}) {
    if (busy) { queued = href; queuedOpts = { push }; return true; }
    if (REDUCED()) { location.href = href; return true; }
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return false;
    if (!push && cleanPath(url.href) === cleanPath(location.href) && !url.hash) { queued = queuedOpts = null; busy = false; return false; }
    busy = true;
    cur.dataset.dir = push ? direction(url.pathname) : (direction(url.pathname) === 'back' ? 'fwd' : 'back');
    const [num, label] = PAGE_LABELS[url.pathname] || ['—', 'Official Digital World'];
    cur.querySelector('#mcNum').textContent = num;
    cur.querySelector('#mcLabel').textContent = label;
    if (push) cur.classList.add('is-in');
    document.getElementById('app-shell')?.setAttribute('aria-busy', 'true');
    const t0 = performance.now();
    let data = null;
    try {
      [data] = await Promise.all([fetchFragment(url), wait(COVER_MS)]);
    } catch (err) {
      console.warn('[motion] full navigation instead:', err.message);
      cur.classList.remove('is-in');
      queued = queuedOpts = null;
      queued = null;
      document.getElementById('app-shell')?.removeAttribute('aria-busy');
      busy = false;
      location.href = href;
      return true;
    }
    try {
      const run = () => apply(data, url, { replace: !push });
      const settle = () => { if (canVT() && !REDUCED()) document.startViewTransition(run); else run(); };
      settle();
    } catch (err) {
      console.warn('[motion] swap failed:', err.message);
      busy = false;
      location.href = href;
      return true;
    }
    /* let the covered frame hold just long enough to be read, then lift */
    await wait(push ? Math.max(90, (queued ? 40 : 150) - (performance.now() - t0)) : 60);
    document.getElementById('app-shell')?.removeAttribute('aria-busy');
    cur.classList.remove('is-in');
    cur.classList.add('is-out');
    setTimeout(() => cur.classList.remove('is-out'), 360);
    busy = false;
    drain();
    return true;
  }

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a');
    if (!a || !internal(a)) return;
    const href = a.getAttribute('href');
    if (!href) return;
    const url = new URL(href, location.href);
    const sameDoc = url.pathname === location.pathname && url.search === location.search;
    if (sameDoc && url.hash) {
      e.preventDefault();
      document.getElementById(url.hash.slice(1))?.scrollIntoView({ behavior: REDUCED() ? 'auto' : 'smooth', block: 'start' });
      history.replaceState(history.state, '', url.hash);
      return;
    }
    if (sameDoc && !url.hash) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: REDUCED() ? 'auto' : 'smooth' });
      return;
    }
    e.preventDefault();
    go(href);
  });

  window.addEventListener('popstate', (e) => {
    if (!e.state?.pjax && !document.documentElement.classList.contains('motion-ready')) return;
    if (trail[trail.length - 1] === location.pathname) return;
    if (trail.length > 1 && trail[trail.length - 2] === location.pathname) trail.pop();
    else if (!e.state?.pjax) return;
    else trail.push(location.pathname);
    go(location.href, { push: false });
  });

  // first paint: gentle entrance
  requestAnimationFrame(() => root.classList.add('motion-in'));
  return { go };
}

/* the nav has to follow soft navigation: .active is rendered server-side, so after a curtain swap
   the highlight would stay on the page you came from */
export function markNav(pathname) {
  const target = cleanPath(pathname);
  document.querySelectorAll('#header nav a, #drawer nav a').forEach((a) => {
    const raw = a.getAttribute('href') || '';
    if (raw.indexOf('#') !== -1) return;              // in-page links belong to the scroll spy
    const path = cleanPath(raw.split('?')[0]);
    const on = path === target || (path.length > 1 && path !== '/' && target.slice(0, path.length) === path);
    a.classList.toggle('active', on);
    a.classList.toggle('is-current', on);
    if (on) a.setAttribute('aria-current', 'page');
    else if (a.getAttribute('aria-current') === 'page') a.removeAttribute('aria-current');
    const li = a.closest('li');
    if (li) li.classList.toggle('is-active', on);
  });
}

/* ---------- scroll-spy: the nav knows where you are ---------- */
export function initSpy() {
  const sections = [...document.querySelectorAll('main [id]')].filter((el) => el.offsetHeight > 90);
  if (!sections.length) return;
  const links = [...document.querySelectorAll('a[href^="#"], a[href^="/#"], a[href*="/#"]')];
  if (!links.length) return;
  const byId = new Map();
  links.forEach((a) => {
    const href = a.getAttribute('href') || '';
    const id = href.slice(href.indexOf('#') + 1);
    if (!id) return;
    if (!byId.has(id)) byId.set(id, new Set());
    byId.get(id).add(a);
  });
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      const set = byId.get(en.target.id);
      if (!set) return;
      set.forEach((a) => {
        a.classList.toggle('is-current', en.isIntersecting);
        if (en.isIntersecting) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
    });
  }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
  sections.forEach((el) => io.observe(el));
  return () => sections.forEach((el) => io.unobserve(el));
}

/* ---------- keyboard: "/" finds the search field from anywhere ---------- */
export function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (e.key === '/' && !typing) {
      const input = document.getElementById('siteSearch') || document.querySelector('input[type="search"]');
      if (input) { e.preventDefault(); input.focus(); input.select?.(); }
    }
  });
}

export function initMotion(nav) {
  const reduced = REDUCED();
  if (reduced) document.documentElement.classList.add('motion-reduced');
  // soft navigation stays on even with reduced motion (it is a navigation, not an animation)
  const { go } = initNavigation(nav);
  if (!reduced) {
    initReveal();
    initSmoothAnchors(nav);
    initMagnetic();
    initCounters();
    initCursor();
    initSpy();
    window.addEventListener('load', () => parallax(), { once: true });
  }
  initHeader();
  markNav(location.pathname);
  initShortcuts();
  initTilt();
  return { go };
}

export { PAGE_LABELS, ease };
