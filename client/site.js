/**
 * client/site.js — domain behaviour. Talks to the real API (no localStorage data store),
 * keeps the member/cart/ticket UI in sync, and live-updates sections over SSE.
 * Every mount() is re-entrant so it can run again after a soft page swap.
 */

import { mountPlayer, initAmbientVideos } from './player.js';

const CSRF = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const opt = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body !== undefined) {
    if (body instanceof FormData) opt.body = body;
    else { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    if (method !== 'GET') opt.headers['x-csrf-token'] = CSRF();
  }
  const res = await fetch(path.startsWith('/') ? path : `/api/${path}`, opt);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `Request failed (${res.status})`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

/* ---------- toast ---------- */
let toastTimer;
export function toast(msg, tone = 'info') {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast show tone-${tone}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

/* ---------- member modal ---------- */
const MODAL = '#memberModal';
export function openMember(tab = 'login') {
  const m = $(MODAL);
  if (!m) return;
  m.classList.add('open');
  document.documentElement.classList.add('modal-open');
  switchMember(tab);
  setTimeout(() => $(`#pane-${tab} input`)?.focus(), 260);
}
export function closeMember() {
  $(MODAL)?.classList.remove('open');
  document.documentElement.classList.remove('modal-open');
}
export function switchMember(tab) {
  $$('.m-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  $$('.m-pane').forEach((p) => p.classList.toggle('is-active', p.id === `pane-${tab}`));
  if (tab === 'dashboard') refreshMe();
}

function msg(sel, text, ok = false) {
  const el = $(sel);
  if (!el) return;
  el.textContent = text || '';
  el.className = `form-msg ${text ? 'show' : ''} ${ok ? 'ok' : ''}`;
}

async function submitMember(form, { okTab, okMsg }) {
  const data = Object.fromEntries(new FormData(form));
  const btn = form.querySelector('button[type=submit]');
  btn?.classList.add('is-busy');
  try {
    if (form.dataset.action === 'signup') await api('auth/signup', { method: 'POST', body: data });
    else await api('auth/login', { method: 'POST', body: data });
    await refreshMe();
    window.dispatchEvent(new Event('session:changed'));
    form.reset();
    if (okMsg) msg(`#${form.dataset.msg}`, okMsg, true);
    if (okTab) setTimeout(() => switchMember(okTab), 350);
    toast(okTab === 'dashboard' ? 'Welcome back — dashboard updated' : 'Account ready');
  } catch (e) {
    msg(`#${form.dataset.msg}`, e.message);
  } finally {
    btn?.classList.remove('is-busy');
  }
}

export async function refreshMe() {
  let me;
  try { me = await api('me'); } catch { return null; }
  const pill = $('#memberPill');
  if (pill) {
    pill.classList.toggle('is-logged', !!me.user);
    if (me.user) {
      $('#pillName').textContent = me.user.name.split(' ')[0];
      $('#pillTier').textContent = me.membership ? me.membership.tier_name : 'FREE MEMBER';
      $('#pillAvatar').textContent = me.user.name.split(' ').map((s) => s[0]).join('').slice(0, 2).toUpperCase();
    }
  }
  $$('[data-guest-only]').forEach((el) => { el.style.display = me.user ? 'none' : ''; });
  $$('[data-member-only]').forEach((el) => { el.style.display = me.user ? '' : 'none'; });

  const box = $('#dashBody');
  if (box) box.innerHTML = renderDash(me);
  const tickets = $('#dashTickets');
  if (tickets) tickets.innerHTML = me.tickets.length
    ? me.tickets.map((t) => `<div class="dash-ticket"><b>#${t.code} — ${esc(t.subject)}</b><span class="st st-${t.status}">${t.status.replace('_', ' ')}</span><p>${esc((t.last_message || '').slice(0, 90))}…</p><a class="btn ghost small" href="/members/#tickets" data-open-chat="${t.id}">Open chat →</a></div>`).join('')
    : `<div class="empty">No tickets yet — purchase a Fan Card or send a booking request to open one.</div>`;
  $$('[data-ticket-count]').forEach((el) => { el.textContent = me.tickets.length; });
  return me;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderDash(me) {
  if (!me.user) return `<div class="empty">Please log in to see your Fan Card, tickets and vault access.</div>`;
  const m = me.membership;
  const card = m
    ? `<div class="fan-card tier-${m.tier}" data-tilt="7"><div class="fan-card-top"><b>STARTO • FAN CARD</b><div class="chip"></div></div>
        <h4>${esc(me.user.name.toUpperCase())}</h4><div class="num">${esc(m.card_no)} • ${esc(m.tier_name)}</div>
        <div style="margin-top:6px;font-size:10px;color:var(--gold2)">MEMBER SINCE ${esc((me.user.created_at || '').slice(0, 10))} • VALID UNTIL ${esc((m.valid_until || '').slice(0, 10))}</div>
        <div class="holder"><div><b>${esc(me.user.name)}</b><br><span>${esc(m.price_label)} / year • ${esc(m.status)}</span></div><span>木村拓哉</span></div></div>`
    : `<div class="fan-card" data-tilt="6"><div class="fan-card-top"><b>STARTO • FAN CARD</b><div class="chip" style="opacity:.3"></div></div>
        <h4 style="opacity:.7">NO CARD YET</h4><div class="num" style="opacity:.6">Account active — choose a tier to issue</div>
        <div class="holder"><div><b>${esc(me.user.name)}</b><br><span>No active membership</span></div><span>木村拓哉</span></div></div>`;
  const rows = [
    ['Tier', m ? m.tier_name : 'NO CARD'],
    ['Valid until', m ? (m.valid_until || '').slice(0, 10) : '—'],
    ['Bookings', String(me.bookings.length)],
    ['Orders', String(me.orders.length)],
  ];
  const bookings = me.bookings.length
    ? me.bookings.map((b) => `<tr><td>${esc(b.date)}</td><td>${esc(b.type)}</td><td>${esc(b.guests)}</td><td>${esc(b.status)}</td></tr>`).join('')
    : `<tr><td colspan="4" class="muted">No booking requests yet.</td></tr>`;
  return `${card}
    <div class="dash-grid">${rows.map(([k, v]) => `<div class="dash-cell"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>
    <div class="dash-block"><h4>Vault access</h4><div class="dash-note ${m ? 'ok' : ''}">${m ? `✓ Unlocked — ${esc(m.tier_name)} tier grants ${esc(String(m.vault_count))} vault item(s).` : esc(me.vault_message)}</div></div>
    <div class="dash-block"><h4>Bookings</h4><table class="mini"><thead><tr><th>Date</th><th>Type</th><th>Guests</th><th>Status</th></tr></thead><tbody>${bookings}</tbody></table></div>
    <div class="dash-block"><h4>Shop orders</h4>${me.orders.length ? me.orders.map((o) => `<div class="order-row"><b>${esc(o.order_no)}</b><span>${esc(o.total_label)}</span><span class="st st-${esc(o.status)}">${esc(o.status)}</span><a href="/shop/verify/${encodeURIComponent(o.qr)}">QR / verify →</a></div>`).join('') : '<div class="empty">No orders yet.</div>'}</div>`;
}

/* ---------- fan card: turn it over ---------- */
export function initFanCards(root = document) {
  $$('[data-fan-card]', root).forEach((card) => {
    if (card.__fcBound) return;
    card.__fcBound = true;
    const set = (flipped) => {
      card.classList.toggle('is-flipped', flipped);
      card.setAttribute('aria-pressed', flipped ? 'true' : 'false');
    };
    const flip = () => set(!card.classList.contains('is-flipped'));
    card.addEventListener('click', (e) => {
      if (e.target.closest('a,button,select,input,textarea,label')) return;   // controls keep their own job
      flip();
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); flip(); }
      else if (e.key === 'Escape' && card.classList.contains('is-flipped')) { e.preventDefault(); set(false); }
    });
  });
}

/* ---------- fan card preview ---------- */
export function initCardPreview() {
  const card = $('#fanCard');
  if (!card) return;
  const sel = $('#cardTierSelect');
  const name = $('#cardHolderInput');
  const tiers = JSON.parse($('#tierData')?.textContent || '[]');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const set = (field, value) => $$(`[data-card-field="${field}"]`, card).forEach((el) => { el.textContent = value; });
  const paint = () => {
    const t = tiers.find((x) => x.id === sel?.value) || tiers[0];
    if (!t) return;
    // classList, never className: the flip state lives on this element too
    ['silver', 'gold', 'platinum', 'diamond'].forEach((id) => card.classList.toggle(`tier-${id}`, id === t.id));
    card.style.setProperty('--accent', t.accent || '#c9a86a');
    const nm = (name?.value || 'YOUR NAME').toUpperCase();
    set('holder', nm);
    set('tier', t.name);
    set('tiername', t.name);
    set('sublabel', `${t.name} • ${t.price_label}`);
    const num = `TK — 48${21 + (Number(t.rank) || 0)}`;   // stable per tier: digits must not dance while typing
    set('number', num);
    set('member', num.replace(/[^0-9]/g, '').padStart(6, '0').split('').join(' '));
    set('stamps', '—');
    const list = $('.fc-perks ul', card);
    if (list) list.innerHTML = (t.perks || []).slice(0, 4).map((x) => `<li><i aria-hidden="true">✓</i><span>${esc(x)}</span></li>`).join('');
    $$('.tier').forEach((el) => el.classList.toggle('is-selected', el.dataset.tier === t.id));
  };
  sel?.addEventListener('change', paint);
  name?.addEventListener('input', paint);
  $$('.tier').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button,a')) return;
      if (sel) { sel.value = el.dataset.tier; paint(); }
      toast(`${el.dataset.tier.toUpperCase()} preview — choose Purchase to open a ticket`);
    });
  });
  paint();

  $$('[data-purchase-tier]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tier = btn.dataset.purchaseTier || sel?.value || 'platinum';
      btn.classList.add('is-busy');
      try {
        const r = await api('membership/purchase', { method: 'POST', body: { tier } });
        toast(r.message || 'Ticket opened — Management will reply in chat');
        await refreshMe();
        window.dispatchEvent(new Event('session:changed'));
        openMember('dashboard');
        document.dispatchEvent(new CustomEvent('live:update', { detail: { section: 'tickets' } }));
      } catch (e) {
        if (e.status === 401) { openMember('signup'); toast('Sign up first — then purchase opens a ticket'); }
        else toast(e.message);
      } finally { btn.classList.remove('is-busy'); }
    });
  });
}

/* ---------- booking ---------- */
export function initBooking() {
  const form = $('#bookingForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.classList.add('is-busy');
    try {
      const r = await api('bookings', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      $('#bookingOk')?.classList.add('show');
      $('#bookingOk').textContent = r.message || '✓ Request received — ticket opened';
      form.reset();
      toast('Booking ticket created — reply arrives in chat');
      document.dispatchEvent(new CustomEvent('live:update', { detail: { section: 'tickets' } }));
    } catch (err) {
      if (err.status === 401) { openMember('signup'); toast('Login required — free signup, then booking'); }
      else toast(err.message);
    } finally { btn.classList.remove('is-busy'); }
  });
  $$('[data-book-slot]').forEach((b) => b.addEventListener('click', () => {
    const d = b.dataset.bookSlot.split('|');
    const set = (id, v) => { const el = form.querySelector(id); if (el) el.value = v; };
    set('#bkType', d[0]); set('#bkDate', d[1]); set('#bkGuests', d[2] || 1);
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Slot copied into the request form');
  }));
}

/* ---------- shop + cart ---------- */
export function initShop() {
  $$('[data-add-cart]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      btn.classList.add('is-busy');
      try {
        const r = await api('cart/add', { method: 'POST', body: { sku: btn.dataset.addCart, qty: Number(btn.dataset.qty || 1) } });
        paintCart(r.cart);
        toast(`${btn.dataset.title || 'Item'} — added to cart`);
        btn.classList.remove('is-added'); void btn.offsetWidth; btn.classList.add('is-added');
      } catch (err) { toast(err.message); } finally { btn.classList.remove('is-busy'); }
    });
  });
  const drawer = $('#cartDrawer');
  if (drawer && /[?&]cart=1/.test(location.search)) { drawer.classList.add('open'); document.documentElement.classList.add('modal-open'); }
  $$('[data-open-cart]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); drawer?.classList.add('open'); document.documentElement.classList.add('modal-open'); }));
  $$('[data-close-cart]').forEach((b) => b.addEventListener('click', () => { drawer?.classList.remove('open'); document.documentElement.classList.remove('modal-open'); }));
  drawer?.addEventListener('click', (e) => { if (e.target === drawer) { drawer.classList.remove('open'); document.documentElement.classList.remove('modal-open'); } });

  document.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-cart-remove]');
    if (rm) { e.preventDefault(); const r = await api('cart/remove', { method: 'POST', body: { sku: rm.dataset.cartRemove } }); paintCart(r.cart); return; }
    const qty = e.target.closest('[data-cart-qty]');
    if (qty) { e.preventDefault(); const r = await api('cart/qty', { method: 'POST', body: { sku: qty.dataset.cartQty, qty: Number(qty.dataset.value) } }); paintCart(r.cart); return; }
    if (e.target.closest('[data-cart-checkout]')) {
      e.preventDefault();
      const btn = e.target.closest('button');
      btn.classList.add('is-busy');
      try {
        const r = await api('checkout', { method: 'POST', body: { pickup_venue: $('#pickupVenue')?.value || '' } });
        window.location.href = r.url || '/shop/complete';
      } catch (err) {
        if (err.status === 401) { openMember('signup'); toast('Login required to check out'); }
        else toast(err.message);
      } finally { btn.classList.remove('is-busy'); }
    }
  });

  $$('[data-filter-cat]').forEach((b) => b.addEventListener('click', () => {
    const cat = b.dataset.filterCat;
    $$('[data-filter-cat]').forEach((x) => x.classList.toggle('is-active', x === b));
    $$('[data-cat]').forEach((card) => {
      const show = cat === 'all' || card.dataset.cat === cat;
      card.classList.toggle('is-hidden', !show);
      if (show) { card.classList.remove('is-pop'); void card.offsetWidth; card.classList.add('is-pop'); }
    });
  }));
}

export function paintCart(cart) {
  const lines = cart?.lines || [];
  $$('[data-cart-count]').forEach((el) => { el.textContent = lines.reduce((s, l) => s + l.qty, 0); });
  const body = $('#cartBody');
  if (body) body.innerHTML = lines.length
    ? lines.map((l) => `<div class="cart-line"><img src="${l.image}" alt=""><div><b>${esc(l.title)}</b><span>${esc(l.unit_label)} × ${l.qty}</span></div>
        <div class="cart-qty"><button data-cart-qty="${l.sku}" data-value="${l.qty - 1}" aria-label="Decrease">−</button><b>${l.qty}</b><button data-cart-qty="${l.sku}" data-value="${l.qty + 1}" aria-label="Increase">+</button></div>
        <button class="cart-x" data-cart-remove="${l.sku}" aria-label="Remove">✕</button></div>`).join('')
    : '<div class="empty">Cart empty — add some goods.</div>';
  const total = $('#cartTotal');
  if (total) total.textContent = cart?.total_label || '¥0';
  const discount = $('#cartDiscount');
  if (discount) discount.textContent = cart?.discount_label || '';
}

/* ---------- chat / tickets ---------- */
let chatThread = null;
export async function openChat(ticketId) {
  const win = $('#chatWindow');
  if (!win) return;
  win.classList.add('open');
  try {
    const t = await api(ticketId ? `tickets/${ticketId}` : 'tickets/latest', { method: 'GET' });
    chatThread = t;
    paintChat(t);
  } catch (e) {
    $('#chatBody').innerHTML = `<div class="chat-note">${esc(e.message)}</div>`;
  }
}
export function closeChat() { $('#chatWindow')?.classList.remove('open'); }

function paintChat(t) {
  const body = $('#chatBody');
  if (!body) return;
  const msgs = t?.messages || [];
  body.innerHTML = `<div class="chat-note">Ticket <b>${esc(t?.code || '—')}</b> • ${esc((t?.status || 'open').replace('_', ' '))} — replies from Official Site / Management only</div>`
    + (msgs.length ? msgs.map((m) => `<div class="chat-bubble ${m.sender === 'user' ? 'me' : 'staff'}">${esc(m.body)}<time>${new Date(m.created_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${m.sender === 'user' ? 'You' : 'Management'}</time></div>`).join('')
      : '<div class="chat-bubble staff">Hello — ask about Fan Club, Vault or Booking and we will open a ticket for you.</div>');
  body.scrollTop = body.scrollHeight;
}

export function initChat() {
  const launcher = $('#chatLauncher');
  launcher?.addEventListener('click', () => { const w = $('#chatWindow'); w && w.classList.contains('open') ? closeChat() : openChat(); });
  const input = $('#chatInput');
  const send = async () => {
    const text = input?.value.trim();
    if (!text) return;
    input.value = '';
    try {
      const r = await api('chat/send', { method: 'POST', body: { message: text, ticket_id: chatThread?.id } });
      chatThread = r.ticket;
      paintChat(r.ticket);
      $('#chatBadge')?.classList.remove('show');
    } catch (e) { toast(e.message); input.value = text; }
  };
  $('#chatSend')?.addEventListener('click', send);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  $$('[data-open-chat]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); openChat(b.dataset.openChat); }));
  $$('[data-quick-reply]').forEach((b) => b.addEventListener('click', () => { if (input) { input.value = b.dataset.quickReply; input.focus(); } }));
}

/* ---------- vault ---------- */
export function initVault() {
  $$('[data-vault-open]').forEach((card) => card.addEventListener('click', async (e) => {
    if (e.target.closest('a,[data-copy],[data-close-modal],[data-stamp]')) return;   // the card itself is a button: let it open
    const id = card.dataset.vaultOpen;
    const modal = $('#vaultModal');
    if (!modal) return;
    $('#vaultBody').innerHTML = '<div class="loading">Opening vault…</div>';
    modal.classList.add('open');
    document.documentElement.classList.add('modal-open');
    try {
      const v = await api(`vault/${id}`);
      $('#vaultTitle').textContent = v.title;
      $('#vaultBody').innerHTML = v.locked
        ? `<div class="vault-locked"><img src="${v.image}" alt=""><div class="lock-inner"><div class="lock-icon">🔒</div><b>${esc(v.requirement)}</b><p>${esc(v.message)}</p><button class="btn gold small" data-purchase-tier="${v.next_tier}">Unlock with ${esc(v.next_tier.toUpperCase())} →</button></div></div>`
        : `<div class="vault-stage"><img class="vault-frame" src="${v.image}" alt="${esc(v.title)}">
            <div class="vault-player" data-vault-player></div>
            <div class="vault-now"><b>${esc(v.code)} — ${esc(v.title)}</b><span class="mono">${esc(v.duration || '')} • members only</span><span class="vp-live">● LIVE</span></div>
          </div><div class="vault-desc"><p>${esc(v.description)}</p><div class="vault-meta"><span>▶ ${esc(v.streams)} plays</span><span>♥ ${esc(v.likes)} likes</span><span>Tier ${esc(v.label)}</span></div><button class="btn ghost small" data-stamp="${v.code}">Stamp passport →</button></div>`;
      if (!v.locked) {
        mountPlayer($('#vaultBody [data-vault-player]'), {
          src: v.video_url, poster: v.image, title: `${v.code} — ${v.title}`,
          note: 'Still preview — attach a clip to this drop in the console and it plays right here.',
        });
        initAmbientVideos($('#vaultBody'));
      }
      const stamp = $('#vaultBody [data-stamp]');
      stamp?.addEventListener('click', async () => {
        try { const r = await api('passport/stamp', { method: 'POST', body: { code: stamp.dataset.stamp } }); toast(r.message); } catch (e2) { toast(e2.message); }
      });
      const unlock = $('#vaultBody [data-purchase-tier]');
      if (unlock) { unlock.dataset.purchaseTier = v.next_tier; initCardPreview(); }
    } catch (err) {
      $('#vaultBody').innerHTML = `<div class="vault-locked"><div class="lock-inner"><b>Vault unavailable</b><p>${esc(err.message)}</p><button class="btn primary small" data-close-modal="vaultModal">Close</button></div></div>`;
    }
  }));
  // (the modal is closed by its own backdrop / [data-close-modal] handler above)
  $('#vaultModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'vaultModal' || e.target.closest('[data-close-modal]')) { $('#vaultModal').classList.remove('open'); document.documentElement.classList.remove('modal-open'); }
  });
}

/* ---------- drawer / lang / shell ---------- */
export function initShell() {
  const burger = $('#hamburger');
  const drawer = $('#drawer');
  const setDrawer = (open) => {
    if (!drawer) return;
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    burger?.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.documentElement.classList.toggle('drawer-open', open);
    if (!open) burger?.focus();
  };
  burger?.addEventListener('click', () => setDrawer(!drawer.classList.contains('open')));
  // the drawer's own close button and every link that hands off to a modal used to be inert
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close-drawer]');
    if (c) { e.preventDefault(); setDrawer(false); return; }
    const inside = e.target.closest('#drawer a[href]');
    if (inside && !inside.hasAttribute('data-open-member')) setDrawer(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer?.classList.contains('open')) setDrawer(false); });
  drawer?.addEventListener('click', (e) => { if (e.target === drawer) drawer.classList.remove('open'); });
  $$('.dropdown > a, .drawer-panel a[data-close]').forEach((a) => a.addEventListener('click', () => drawer?.classList.remove('open')));

  $$('[data-lang]').filter((el) => el !== document.body && el !== document.documentElement && el.dataset.lang).forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault();
    if (b.__langBusy) return;
    b.__langBusy = true;
    try {
      await api('lang', { method: 'POST', body: { lang: b.dataset.lang } });
    } finally { setTimeout(() => { b.__langBusy = false; }, 600); }
    $$('[data-lang]').forEach((x) => { if (x !== document.body) x.classList.toggle('is-active', x === b); });
    document.dispatchEvent(new CustomEvent('page:swap', { detail: { soft: true } }));
    const url = new URL(window.location.href); url.searchParams.delete('lang'); url.searchParams.delete('_pjax');
    await fetchThenSwap(url);
  }));

  $$('[data-open-member]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); openMember(b.dataset.openMember || 'login'); }));
  $$('[data-close-modal]').forEach((b) => b.addEventListener('click', (e) => { const m = $(`#${b.dataset.closeModal}`); m?.classList.remove('open'); document.documentElement.classList.remove('modal-open'); }));
  $$(MODAL)?.forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeMember(); }));
  $$('.m-form').forEach((f) => f.addEventListener('submit', (e) => { e.preventDefault(); submitMember(f, { okTab: f.dataset.action === 'signup' ? 'dashboard' : null }); }));
  $$('.m-tab').forEach((b) => b.addEventListener('click', () => switchMember(b.dataset.tab)));
  $('#logoutBtn')?.addEventListener('click', async () => { await api('auth/logout', { method: 'POST', }); toast('Signed out'); window.dispatchEvent(new Event('session:changed')); await refreshMe(); location.reload(); });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeMember(); closeChat();
    $('#vaultModal')?.classList.remove('open');
    $('#cartDrawer')?.classList.remove('open');
    drawer?.classList.remove('open');
    document.documentElement.classList.remove('modal-open');
  });
}

async function fetchThenSwap(url) {
  const res = await fetch(url.pathname + url.search + (url.search ? '&' : '?') + '_pjax=1', { headers: { 'x-pjax': '1' }, credentials: 'same-origin' });
  if (!res.ok) { location.reload(); return; }
  const data = await res.json();
  const shell = $('#app-shell');
  if (!shell || !data.html) { location.reload(); return; }
  shell.innerHTML = data.html;
  document.title = data.title || document.title;
  const desc = document.querySelector('meta[name="description"]');
  if (desc && data.description) desc.setAttribute('content', data.description);
  document.body.dataset.page = data.page || '';
  if (data.lang) document.documentElement.lang = data.lang;      // the <html> lang must follow the session
  const clean = (u) => { const x = new URL(u, location.href); x.searchParams.delete('_pjax'); return x.pathname + (x.searchParams.toString() ? '?' + x.searchParams.toString() : ''); };
  const dest = clean(data.url || url.pathname + url.search);
  history.replaceState({ pjax: 1, url: dest }, '', dest);
  document.dispatchEvent(new CustomEvent('page:swap', { detail: data }));
}

/* ---------- live updates over SSE ---------- */
export function initLive() {
  if (!window.EventSource) return;
  const src = new EventSource('/api/events', { withCredentials: true });
  const reloadSections = new Set();
  let queued = false;
  const flush = () => {
    queued = false;
    const list = [...reloadSections];
    reloadSections.clear();
    list.forEach(async (section) => {
      const hosts = $$(`[data-section="${section}"]`);
      if (!hosts.length) return;
      try {
        const r = await fetch(`/api/section/${section}`, { headers: { 'x-fragment': '1' } });
        if (!r.ok) return;
        const html = await r.text();
        hosts.forEach((h) => {
          // remember where each carousel inside this section stood, so a live refresh cannot rewind it
          const marks = [...h.querySelectorAll('[data-carousel]')].map((el) => el.__carousel?.i ?? null);
          h.classList.add('is-refreshing');
          h.innerHTML = html;
          document.dispatchEvent(new CustomEvent('dom:refresh', { detail: { section } }));
          [...h.querySelectorAll('[data-carousel]')].forEach((el, k) => {
            const want = marks[k];
            const car = el.__carousel;
            if (car && want != null && want !== car.i) { try { car.go(want, { instant: true }); } catch {} }
          });
          setTimeout(() => h.classList.remove('is-refreshing'), 700);
        });
        document.dispatchEvent(new CustomEvent('dom:refresh', { detail: { section } }));
      } catch { /* ignore — next event retries */ }
    });
  };
  src.addEventListener('content:changed', (e) => {
    const d = JSON.parse(e.data || '{}');
    (d.sections || ['*']).forEach((s) => reloadSections.add(s));
    if (!queued) { queued = true; requestAnimationFrame(flush); }
  });
  src.addEventListener('ticket:reply', (e) => {
    const d = JSON.parse(e.data || '{}');
    toast('Management replied to your ticket');
    $('#chatBadge')?.classList.add('show');
    if ($('#chatWindow')?.classList.contains('open')) openChat(d.ticket_id);
    refreshMe();
  });
  src.addEventListener('cart:changed', (e) => { try { paintCart(JSON.parse(e.data)); } catch {} });
  src.addEventListener('ticket:created', (e) => {
    const d = JSON.parse(e.data || '{}');
    toast('Ticket opened — ' + (d.subject || 'Management has it'));
    refreshMe();
  });
  src.addEventListener('passport:stamp', (e) => {
    const d = JSON.parse(e.data || '{}');
    toast('Passport stamp added at ' + (d.city || 'the venue') + ' — ' + (d.stamps || '') + ' collected', 'ok');
    const row = document.querySelector('[data-passport-count]');
    if (row && d.stamps !== undefined) row.textContent = d.stamps;
  });
  src.addEventListener('stock:changed', (e) => {
    const d = JSON.parse(e.data || '{}');
    $$(`[data-sku="${d.sku}"]`).forEach((el) => {
      el.dataset.stock = d.stock;
      const badge = el.querySelector('[data-stock-badge]');
      if (badge) badge.textContent = d.stock > 0 ? (d.stock <= 6 ? `Only ${d.stock} left` : `${d.stock} in stock`) : 'Sold out';
      el.classList.toggle('is-out', d.stock <= 0);
    });
  });
  src.onerror = () => { /* EventSource auto-reconnects */ };
}

/* ---------- boot ---------- */
export function mount(root = document) {
  initFanCards(root);
  initCardPreview();
  initBooking();
  initShop();
  initChat();
  initVault();
  const shellBooted = document.body.dataset.shellBooted;
  if (!shellBooted) { document.body.dataset.shellBooted = '1'; initShell(); initLive(); }
  else { initShellRebind(); }
  refreshMe();
  api('cart').then((c) => c && paintCart(c)).catch(() => {});   // api() prefixes /api — a bare fetch('cart') 404s below the root
}

function initShellRebind() {
  $$('.m-form').forEach((f) => { if (!f.__bound) { f.__bound = true; f.addEventListener('submit', (e) => { e.preventDefault(); submitMember(f, { okTab: f.dataset.action === 'signup' ? 'dashboard' : null }); }); } });
  $$('.m-tab').forEach((b) => { if (!b.__bound) { b.__bound = true; b.addEventListener('click', () => switchMember(b.dataset.tab)); } });
}

export { esc };
