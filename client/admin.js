/**
 * client/admin.js — console behaviour. Everything here is additive: the console
 * works with JS disabled (forms are real POSTs), JS only makes it faster and live.
 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const CSRF = () => $('meta[name="csrf-token"]')?.content || '';
/* the console rides the site's own origin under /admin on a single-host deploy (api/index.js),
   and sits at the root when it runs on its own port — every URL here goes through at(). */
const BASE = /^\/admin(?:\/|$)/.test(location.pathname) ? '/admin' : '';
const at = (p) => BASE + p;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg, tone = '') {
  const host = $('#admToast');
  if (!host) return;
  const el = document.createElement('div');
  el.className = tone;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s, transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; setTimeout(() => el.remove(), 320); }, 3200);
}

async function api(path, { method = 'GET', body } = {}) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opt.headers['content-type'] = 'application/json';
    opt.headers['x-csrf-token'] = CSRF();
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(at('/api/' + path.replace(/^\//, '')), opt);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

const key = document.body.dataset.resourceKey || (location.pathname.match(/\/content\/([a-z_]+)/) || [])[1] || '';

/** same contract, but for the console routes that live outside /api */
async function raw(path, { method = 'POST', body } = {}) {
  const res = await fetch(at(path), {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-csrf-token': CSRF() },
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
  return data;
}

/* ---------- badges + live KPIs ---------- */
async function paintBadges() {
  try {
    const { kpis } = await api('state', {});
    $$('[data-badge]').forEach((el) => {
      const v = kpis[el.dataset.badge];
      if (v === undefined) return;
      el.textContent = String(v).padStart(2, '0');
      el.classList.toggle('zero', !v);
    });
  } catch { /* console still usable without the API */ }
}

/* ---------- SSE: same bus the public site listens to ---------- */
function listen() {
  if (!window.EventSource) return;
  let src;
  try { src = new EventSource(at('/events')); } catch { return; }
  const dot = $('[data-live-dot]');
  src.addEventListener('open', () => dot?.classList.remove('off'));
  src.onerror = () => dot?.classList.add('off');
  const setCount = (e) => {
    try { const d = JSON.parse(e.data || '{}'); const c = $('[data-live-count]'); if (c && d.clients !== undefined) c.textContent = d.clients; } catch {}
  };
  src.addEventListener('ping', setCount);
  src.addEventListener('ready', setCount);
  src.addEventListener('passport:stamp', (e) => { let d = {}; try { d = JSON.parse(e.data || '{}'); } catch {} toast('Passport stamped — ' + (d.city || '') , 'ok'); });
  src.addEventListener('content:changed', (e) => {
    let d = {}; try { d = JSON.parse(e.data || '{}'); } catch {}
    toast('Site cache refreshed — ' + (d.reason || 'content changed'), 'ok');
    if (location.pathname.includes('/content/') && key && d.resource && d.resource !== key) location.reload();
  });
  src.addEventListener('ticket:message', (e) => {
    let d = {}; try { d = JSON.parse(e.data || '{}'); } catch {}
    if (/(^|\/)tickets(\/\d*)?$/.test(location.pathname) || location.search.includes('id=')) {
      toast('New member message — reloading thread');
      setTimeout(() => location.reload(), 900);
    } else toast('New ticket message #' + (d.ticket_id || ''), 'ok');
  });
  src.addEventListener('member:joined', () => { toast('New member signed up', 'ok'); paintBadges(); if (location.pathname.includes('/members')) setTimeout(() => location.reload(), 1200); });
  src.addEventListener('order:created', (e) => { let d = {}; try { d = JSON.parse(e.data || '{}'); } catch {} toast('Order ' + (d.order_no || '') + ' paid', 'ok'); paintBadges(); });
  src.addEventListener('order:collected', () => toast('Order collected at the venue'));
  src.addEventListener('stock:changed', (e) => {
    let d = {}; try { d = JSON.parse(e.data || '{}'); } catch {}
    const row = $(`[data-stock="${d.sku}"] [data-stock-n]`);
    if (row) { row.textContent = d.stock; row.classList.remove('is-updated'); void row.offsetWidth; row.classList.add('is-updated'); }
  });
  src.addEventListener('booking:created', () => { toast('New booking request', 'ok'); paintBadges(); });
}

/* ---------- editor helpers ---------- */
function bootEditor() {
  $('#newRowBtn')?.addEventListener('click', () => {
    const ed = $('#editor');
    if (!ed) { location.href = at('/content/' + key + '#editor'); return; }
    if (location.search.includes('edit=')) { location.href = at('/content/' + key + '#editor'); return; }
    ed.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => ed.querySelector('input:not([type=hidden]), textarea, select')?.focus(), 320);
  });
  $('#closeEditor')?.addEventListener('click', () => {
    if (location.search.includes('edit=')) location.href = at('/content/' + key);
    else $('#rowForm')?.reset();
  });
  // any form without a token gets one from the page meta — the console must never 403 on a good session
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (!f || f.method !== 'post' || f.querySelector('input[name=_csrf]')) return;
    const token = document.querySelector('meta[name="csrf-token"]')?.content;
    if (!token) return;
    const i = document.createElement('input');
    i.type = 'hidden'; i.name = '_csrf'; i.value = token;
    f.appendChild(i);
  }, true);

  const form = $('#rowForm');
  form?.addEventListener('submit', (e) => {
    const empty = $$('[name]', form).filter((i) => i.type !== 'hidden' && i.type !== 'checkbox' && i.type !== 'file' && !i.value.length && i.required);
    if (empty.length) {
      e.preventDefault();
      empty[0].focus();
      toast(empty[0].previousElementSibling?.textContent?.trim().split('—')[0] || 'required field', 'bad');
      return;
    }
    const btn = form.querySelector('button[type=submit]');
    if (btn) { btn.setAttribute('disabled', ''); btn.textContent = 'Saving…'; }
    setTimeout(() => { if (btn) { btn.removeAttribute('disabled'); btn.textContent = btn.name === '__publish' ? 'Save & publish' : ($('input[name=id]', form) ? 'Save row' : 'Create row'); } }, 4000);
  });
  // "Save & publish" also pings the bus
  form?.querySelector('[name="__publish"]')?.closest('form')?.addEventListener('submit', () => {
    setTimeout(() => { api('publish', { method: 'POST', body: {} }).catch(() => {}); }, 50);
  });
}

/* ---------- images: picker + upload to /api/media ---------- */
function bootMedia() {
  $$('[data-pick-image]').forEach((b) => b.addEventListener('click', () => {
    const wrap = b.closest('.field-image');
    const input = wrap?.querySelector('input');
    if (!input) return;
    input.value = b.dataset.pickImage.replace(/^\/static/, '');
    const img = wrap.querySelector('[data-preview-for]');
    if (img) { img.src = b.dataset.pickImage; img.removeAttribute('data-img-guard'); }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  $$('[data-upload-for]').forEach((input) => input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const isVideo = /^video\//.test(file.type);
    const cap = isVideo ? 24 * 1024 * 1024 : 8 * 1024 * 1024;
    if (!/^(image|video)\//.test(file.type)) { toast('Only images and mp4/webm clips can be uploaded', 'bad'); input.value = ''; return; }
    if (file.size > cap) { toast(`${isVideo ? 'Clip' : 'Image'} is over ${Math.round(cap / 1024 / 1024)} MB`, 'bad'); input.value = ''; return; }
    const target = $('#' + input.dataset.uploadFor.replace(/^#/, '')) || $(`[id="${input.dataset.uploadFor}"]`);
    if (!target) return;
    target.value = 'uploading…';
    try {
      const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
      target.value = 'uploading…';
      const r = await api('media', { method: 'POST', body: { data: dataUrl, name: file.name } });
      target.value = r.url;
      /* swap the preview in place — a clip needs a <video>, a picture needs an <img> */
      const box = input.closest('.field-image');
      const prev = box?.querySelector('[data-preview-for]');
      if (prev && isVideo === (prev.tagName === 'VIDEO')) prev.src = r.url;
      else if (prev) {
        const el = document.createElement(isVideo ? 'video' : 'img');
        if (isVideo) { el.muted = true; el.loop = true; el.playsInline = true; el.preload = 'metadata'; }
        else el.alt = '';
        el.setAttribute('data-preview-for', prev.getAttribute('data-preview-for'));
        el.src = r.url;
        prev.replaceWith(el);
      }
      toast(`Uploaded ${(r.bytes / 1024).toFixed(0)} kB → ${r.url}`, 'ok');
    } catch (err) {
      target.value = '';
      toast(err.message, 'bad');
    }
  }));
  $$('[data-preview-for]').forEach((img) => {
    img.addEventListener('error', () => { img.dataset.imgGuard = 'broken'; }, { once: true });
  });
}

/* ---------- inline row actions ---------- */
function bootRows() {
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-toggle-row]');
    if (t) {
      e.preventDefault();
      const id = t.dataset.toggleRow;
      const k = t.dataset.key || key;
      t.setAttribute('disabled', '');
      try {
        const r = await raw(`/content/${k}/${id}/toggle`, { method: 'POST', body: { field: 'status' } });
        const pill = t.closest('tr')?.querySelector('.pill');
        if (pill) {
          pill.textContent = String(r.value);
          pill.className = 'pill mono ' + (r.value === 'published' || r.value === 1 || r.value === 'active' ? 'ok' : 'warn');
          pill.classList.remove('is-updated'); void pill.offsetWidth; pill.classList.add('is-updated');
        }
        toast(`${k} #${id} → ${r.value}`, 'ok');
      } catch (err) { toast(err.message, 'bad'); }
      finally { t.removeAttribute('disabled'); }
      return;
    }
    const stock = e.target.closest('[data-delta]');
    if (stock) {
      e.preventDefault();
      const form = stock.closest('[data-stock]');
      try {
        const r = await raw(`/stock/${form.dataset.stock}`, { method: 'POST', body: { delta: Number(stock.dataset.delta) } });
        const n = form.querySelector('[data-stock-n]');
        if (n) { n.textContent = r.stock; n.classList.remove('is-updated'); void n.offsetWidth; n.classList.add('is-updated'); }
        paintBadges();
      } catch (err) { toast(err.message, 'bad'); }
      return;
    }
    const chip = e.target.closest('[data-bf], [data-tf]');
    if (chip) {
      e.preventDefault();
      const table = chip.closest('.card')?.querySelector('table');
      if (!table) return;
      chip.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c === chip));
      const want = chip.dataset.bf || chip.dataset.tf;
      const rows = [...table.querySelectorAll('tbody tr[data-status]')];
      let shown = 0;
      rows.forEach((tr) => {
        const on = want === 'all' || tr.dataset.status === want;
        tr.style.display = on ? '' : 'none';
        if (on) shown++;
      });
      toast(`${shown} row(s)`, '');
      return;
    }
    const pub = e.target.closest('#publishBtn');
    if (pub) {
      e.preventDefault();
      pub.setAttribute('disabled', '');
      api('publish', { method: 'POST', body: {} })
        .then(() => toast('Every open site tab was told to re-render', 'ok'))
        .catch((err) => toast(err.message, 'bad'))
        .finally(() => pub.removeAttribute('disabled'));
      return;
    }
    if (e.target.closest('#refreshBtn')) { e.preventDefault(); paintBadges(); location.reload(); }
  });

  $$('#rowFilter, #auditFilter').forEach((input) => input.addEventListener('input', () => {
    const table = input.closest('.card')?.querySelector('table');
    if (!table) return;
    const q = input.value.trim().toLowerCase();
    let n = 0;
    $$('tbody tr', table).forEach((tr) => {
      const text = (tr.dataset.text || tr.textContent).toLowerCase();
      const on = !q || text.includes(q);
      tr.style.display = on ? '' : 'none';
      if (on) n++;
    });
    const count = $('[data-row-count]');
    if (count && table.id === 'rows') count.textContent = String(n);
  }));

  $$('form[data-confirm]').forEach((f) => f.addEventListener('submit', (e) => {
    if (!window.confirm(f.dataset.confirm)) e.preventDefault();
  }));
}

/* ---------- ticket thread ---------- */
function bootThread() {
  const thread = $('#thread');
  if (!thread) return;
  thread.scrollTop = thread.scrollHeight;
  const ta = $('#replyForm textarea');
  if (ta) {
    ta.focus();
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); $('#replyForm').requestSubmit(); }
    });
  }
}

/* ---------- moderation + draw verbs ---------- */
/* The buttons come from the resource descriptor (RESOURCES[x].actions) and post to the same
   /content/:key/:id/:verb endpoint the console documents, so nothing here is a second implementation. */
function bootActions() {
  const btns = $$('[data-action][data-row-id]');
  if (!btns.length) return;
  btns.forEach((b) => {
    if (b.__verb) return;
    b.__verb = true;
    b.addEventListener('click', async (ev) => {
      ev.preventDefault();
      const say = b.getAttribute('data-confirm');
      if (say && !window.confirm(say)) return;
      const token = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
      b.classList.add('is-busy');
      try {
        const r = await fetch(at(`/content/${b.dataset.key}/${b.dataset.rowId}/${b.dataset.action}`, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-csrf-token': token },
          body: '{}',
        }));
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.message || `Refused (${r.status})`);
        toast(d.message || 'done', 'ok');
        setTimeout(() => location.reload(), 500);
      } catch (err) {
        toast(err.message || 'that action failed', 'bad');
        b.classList.remove('is-busy');
      }
    });
  });
}

/* ---------- boot ---------- */
function start() {
  paintBadges();
  listen();
  bootEditor();
  bootMedia();
  bootRows();
  bootActions();
  bootThread();
  setInterval(paintBadges, 45000);
  const flash = $('.flash');
  if (flash) setTimeout(() => { flash.style.transition = 'opacity .6s'; flash.style.opacity = '0'; setTimeout(() => flash.remove(), 700); }, 6000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();

export { esc, toast };
