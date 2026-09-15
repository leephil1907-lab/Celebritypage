/* KIMURA — Shared site logic v3: Production only, no demo/fake/localStorage fallback */
(function(){
  // i18n — ja primary, en secondary, ko/zh future via CMS approved translations only
  const dict = {
    ja: {
      "nav.work":"ワーク", "nav.music":"ミュージック", "nav.tour":"ツアー", "nav.journal":"ジャーナル", "nav.archive":"アーカイブ", "nav.members":"メンバー", "nav.shop":"ショップ", "nav.search":"検索", "nav.account":"アカウント",
      "hero.kicker":"STARTO ENTERTAINMENT • 公式", "hero.title":"木村拓哉", "hero.camp":"Live Tour 2026 Checkpoint",
      "shop.title":"オフィシャルショップ", "shop.empty":"商品はまだありません — 管理者が追加します",
      "support.title":"サポートセンター"
    },
    en: {
      "nav.work":"WORK", "nav.music":"MUSIC", "nav.tour":"TOUR", "nav.journal":"JOURNAL", "nav.archive":"ARCHIVE", "nav.members":"MEMBERS", "nav.shop":"SHOP", "nav.search":"SEARCH", "nav.account":"ACCOUNT"
    }
  };
  window.I18N = { t(k){ const lang=localStorage.getItem('st_tk_lang')||'ja'; return (dict[lang]&&dict[lang][k])|| dict.en[k]||k } };
  window.setLang = function(lang){
    localStorage.setItem('st_tk_lang', lang);
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el=>{ const k=el.dataset.i18n; if(dict[lang]&&dict[lang][k]) el.textContent=dict[lang][k]; });
    const ja=document.getElementById('langJa'), en=document.getElementById('langEn');
    if(ja){ ja.style.background=lang==='ja'?'#0a0a0a':'#fff'; ja.style.color=lang==='ja'?'#fff':'#0a0a0a'; ja.style.borderColor=lang==='ja'?'#0a0a0a':'var(--line)'; }
    if(en){ en.style.background=lang==='en'?'#0a0a0a':'#fff'; en.style.color=lang==='en'?'#fff':'#0a0a0a'; en.style.borderColor=lang==='en'?'#0a0a0a':'var(--line)'; }
    try{ new BroadcastChannel('st_lang').postMessage(lang)}catch{}
    document.documentElement.setAttribute('data-lang', lang);
  };
  const initLang = localStorage.getItem('st_tk_lang')||'ja';
  document.documentElement.lang = initLang;
  setTimeout(()=>setLang(initLang),30);

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pageMap = {"/":"01 HOME", "/work/":"02 WORK", "/music/":"03 MUSIC", "/tour/":"04 TOUR", "/journal/":"05 JOURNAL", "/archive/":"06 ARCHIVE", "/members/":"07 MEMBERS", "/shop/":"08 SHOP", "/search/":"09 SEARCH", "/support/":"10 SUPPORT", "/join/":"09 JOIN"};
  window.navigateWithTransition = function(href){
    if(prefersReduced) { location.href=href; return; }
    const n = pageMap[href]||href.toUpperCase();
    const pt=document.getElementById('pageTrans'); if(pt){ const num=pt.querySelector('#ptNum'), lab=pt.querySelector('#ptLabel'); if(num) num.textContent=n.split(' ')[0]; if(lab) lab.textContent=n; pt.classList.add('show'); setTimeout(()=>location.href=href,620); } else location.href=href;
  };
  document.addEventListener('click', e=>{
    const a=e.target.closest('a[href^="/"]'); if(!a) return;
    const href=a.getAttribute('href'); if(href.startsWith('/work/')||href.startsWith('/music/')||href.startsWith('/tour/')||href.startsWith('/journal/')||href.startsWith('/archive/')||href.startsWith('/members/')||href.startsWith('/shop/')||href.startsWith('/search/')||href.startsWith('/support/')||href.startsWith('/join/')||href==='/'){
      if(href.includes('#')) return;
      e.preventDefault(); navigateWithTransition(href);
    }
  });

  const API = () => window.KimuraDB?.apiBase || document.querySelector('meta[name="kimura-api"]')?.content || '';
  const isRemote = () => !!API();

  // Shop — PRODUCTION ONLY: Postgres + R2 + Stripe, no localStorage demo, no fake inventory
  const SK = { cart:'st_shop_cart' }; // cart kept locally for UX until order, but products/orders are remote
  window.Shop = {
    async getProducts(){
      if(!isRemote()){
        // No demo — return empty until API is configured (deploying)
        return [];
      }
      const r=await fetch(API() + '/api/products', { credentials:'include' });
      if(!r.ok) throw new Error('Products fetch failed');
      return await r.json();
    },
    // setProducts is Management-only via /api/upload + /api/products — no localStorage
    getCart(){ try{ return JSON.parse(localStorage.getItem(SK.cart))||[] }catch{ return [] } },
    setCart(v){ localStorage.setItem(SK.cart, JSON.stringify(v)); try{ new BroadcastChannel('st_shop').postMessage('cart')}catch{} },
    async addToCart(id, qty=1){
      const products = await Shop.getProducts();
      const p=products.find(x=>String(x.id)===String(id) || String(x.sku)===String(id));
      if(!p){ toast('Product not found — awaiting Management publish'); return; }
      const variant = p.variants?.find(v=>String(v.id)===String(id)) || p;
      const stock = variant.inventory?.quantity ?? variant.quantity ?? p.quantity ?? 0;
      const reserved = variant.inventory?.reserved ?? variant.reserved ?? 0;
      const available = stock - reserved;
      if(available < qty){ alert('Insufficient stock — inventory limited. Available: '+available); return; }
      let cart=Shop.getCart(); const ex=cart.find(x=>String(x.id)===String(id));
      if(ex) ex.qty+=qty; else cart.push({id: p.id, variant_id: variant.id || p.id, title:p.title, price:p.price_yen||p.base_price_yen||0, img:p.cover_s3||p.img||'', qty});
      Shop.setCart(cart); toast((p.title||'Item')+' added to cart'); Shop.renderCartCount();
    },
    renderCartCount(){ const c=Shop.getCart().reduce((s,x)=>s+x.qty,0); document.querySelectorAll('#cartCount').forEach(el=>el.textContent=c); },
    async checkout({deliveryType, address, pickupVenue}){
      const cart=Shop.getCart(); if(!cart.length) return alert('Cart empty');
      if(!isRemote()){
        alert('Shop is deploying — products are not yet published. No demo order will be created.');
        return null;
      }
      const curRaw=localStorage.getItem('st_member_current');
      const cur=curRaw?JSON.parse(curRaw):null;
      if(!cur){ toast('Please sign up / login to checkout'); if(typeof openMember==='function') openMember('signup'); return null; }
      // Create order (reserve inventory) → Stripe Checkout
      const r = await fetch(API() + '/api/orders', {
        method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ items: cart.map(c=>({ variant_id: c.variant_id || c.id, qty: c.qty })), deliveryType, shipping_address: address, pickupVenue })
      });
      if(!r.ok){ const t=await r.text(); alert('Order failed: '+t); throw new Error(t); }
      const order = await r.json();
      const s = await fetch(API() + '/api/payments/shop/checkout', {
        method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ orderNo: order.order_no })
      });
      if(!s.ok){ const t=await s.text(); alert('Payment init failed: '+t); throw new Error(t); }
      const sess = await s.json();
      if(sess.url){ location.href = sess.url; return order; }
      toast('Order '+order.order_no+' created — awaiting payment');
      Shop.setCart([]);
      return order;
    },
    async getOrders(){
      if(!isRemote()) return [];
      const r=await fetch(API() + '/api/orders/mine', { credentials:'include' });
      if(!r.ok) return [];
      return await r.json();
    },
    async verifyQR(qr){
      if(!isRemote()){
        return {ok:false, msg:'Verification requires production API — no demo'};
      }
      const r=await fetch(API() + '/api/orders/verify', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ qr }) });
      return await r.json();
    }
  };

  // Notifications — production only, no fake inbox
  const defaultPrefs = {tour:{inapp:true,email:true,push:false}, music:{inapp:true,email:true,push:false}, journal:{inapp:true,email:false,push:false}, membership:{inapp:true,email:true,push:true}, ticket:{inapp:true,email:true,push:true}, merchandise:{inapp:true,email:true,push:false}, support:{inapp:true,email:true,push:false}};
  window.Notifications = {
    async getPrefs(){
      if(!isRemote()) return JSON.parse(JSON.stringify(defaultPrefs));
      const r=await fetch(API()+'/api/notifications/preferences', { credentials:'include'});
      if(!r.ok) return JSON.parse(JSON.stringify(defaultPrefs));
      return await r.json();
    },
    async setPrefs(v){
      if(!isRemote()){ alert('Notifications require production API'); return; }
      await fetch(API()+'/api/notifications/preferences', { method:'PUT', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify(v)});
    },
    async getInbox(){
      if(!isRemote()) return [];
      const r=await fetch(API()+'/api/notifications', { credentials:'include'});
      if(!r.ok) return [];
      return await r.json();
    },
    push(){ /* no local push in prod — server creates notifications */ },
    async renderBadge(){
      if(!isRemote()){ document.querySelectorAll('#notifBadge').forEach(b=>b.style.display='none'); return; }
      try{
        const inbox=await Notifications.getInbox();
        const unread=inbox.filter(x=>!x.read_at).length;
        document.querySelectorAll('#notifBadge').forEach(b=>{b.textContent=unread>9?'9+':unread; b.style.display=unread?'grid':'none';});
      }catch{}
    },
    async markAll(){
      if(!isRemote()) return;
      await fetch(API()+'/api/notifications/read-all', { method:'PUT', credentials:'include'});
      Notifications.renderBadge();
    }
  };

  window.toast = window.toast || function(m){ const t=document.getElementById('toast'); if(!t) return alert(m); t.textContent=m; t.style.opacity='1'; t.style.transform='translateX(-50%) translateY(0)'; clearTimeout(t._tm); t._tm=setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(-50%) translateY(8px)'},2800); };
  window.Support = {
    statuses:['Open','In Progress','Waiting','Resolved','Closed'],
    async updateStatus(ticketId, newStatus){
      if(!isRemote()){ alert('Support requires production API'); return false; }
      const r=await fetch(API()+`/api/support/${ticketId}/messages`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ body: `Status → ${newStatus}`, status: newStatus.toLowerCase() })});
      return r.ok;
    }
  };
  window.generateQR = function(text, el){
    const img = document.createElement('img');
    img.style.width='100%'; img.style.aspectRatio='1/1'; img.style.objectFit='contain'; img.style.border='1px solid #222'; img.style.background='#fff';
    img.src='https://quickchart.io/qr?text='+encodeURIComponent(text)+'&size=300&dark=0f0e0c&light=fdfbf7';
    img.alt=`QR for ${text}`;
    img.onerror=()=>{
      el.innerHTML=`<div style="width:100%;aspect-ratio:1/1;border:1px solid #222;background:#fff;display:grid;place-items:center;padding:12px;text-align:center"><div style="width:92%;height:92%;border:2px solid #0f0e0c;display:grid;place-items:center;position:relative;"><div style="position:absolute;inset:8px;border:1px dashed #c9a86a"></div><div><div style="font-size:10px;letter-spacing:.14em;color:#9a958f">QR • VERIFY</div><div style="font-family:JetBrains Mono,monospace;font-size:11px;word-break:break-all;margin-top:6px">${text}</div><div style="font-size:9px;color:#c9a86a;margin-top:8px">Present at venue — SCAN → VERIFY → COLLECT</div></div></div></div>`;
    };
    el.innerHTML=''; el.appendChild(img);
  };

  document.addEventListener('DOMContentLoaded', ()=>{
    Shop.renderCartCount(); Notifications.renderBadge();
    try{ new BroadcastChannel('st_shop').onmessage=()=>{Shop.renderCartCount();}; }catch{}
    try{ new BroadcastChannel('st_notif').onmessage=()=>Notifications.renderBadge(); }catch{}
    try{ new BroadcastChannel('st_lang').onmessage=e=>setLang(e.data);}catch{}
  });
})();
