/**
 * TAKUYA KIMURA — DB Adapter v3 — Production-only (Postgres + R2 + Stripe + Email)
 * v3: no localStorage demo when !isRemote — returns fallback/empty (zero-fabrication)
 * Drop-in: if window.__KIMURA_API_URL or <meta name="kimura-api" content="https://api.takuya-kimura.jp"> is set,
 *          all legacy st_* keys are transparently proxied to Postgres API; else localStorage fallback.
 * Zero-fabrication: no fake official data — DATA REQUIRED placeholders only.
 * Preserves FRESH='v8-production-no-demo' wipe semantics via BroadcastChannel.
 *
 * New in v2:
 * - R2/S3 assets: hero/news/film/release + product variants (thumb/sm/md/lg/og/blur) via /api/upload
 * - Commerce: products/inventory/orders/payments via /api/products,/orders,/payments (Stripe webhook-verified, no raw card)
 * - Support: tickets thread via /api/support/tickets (Open→Closed)
 * - Notifications & campaigns via /api/notifications & /api/campaigns
 * - Audit logs via /api/audit (append-only, RLS)
 * - i18n: ja primary, en secondary (ko/zh via approved translations, hreflang)
 */
(function(){
  const API = (typeof window !== 'undefined' && window.__KIMURA_API_URL) ||
              (typeof document !== 'undefined' && document.querySelector('meta[name="kimura-api"]')?.content) || '';
  const DB = {
    apiBase: API || null,
    isRemote: !!API,
    _lsGet(k, fb){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):fb }catch{ return fb } },
    _lsSet(k,v){ localStorage.setItem(k, JSON.stringify(v)); try{ new BroadcastChannel('st_tk_sync').postMessage('update')}catch{} },
    async get(key, fallback){
      if(!DB.isRemote) return fallback; // prod: no demo — API required, show DATA REQUIRED/empty
      try{
        const r = await fetch(DB.apiBase + '/api/kv/' + encodeURIComponent(key), { credentials:'include' });
        if(!r.ok) return fallback;
        const j = await r.json(); return j.value ?? fallback;
      }catch{ return fallback }
    },
    async set(key, value){
      if(!DB.isRemote) return false; // prod: no demo write — API required
      try{
        await fetch(DB.apiBase + '/api/kv/' + encodeURIComponent(key), {
          method:'PUT', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ value })
        });
        try{ localStorage.setItem(key, JSON.stringify(value)); }catch{}
        return true;
      }catch{ return false }
    },
    // Legacy st_* → REST (for gradual migration; new code should call REST directly)
    keyMap: {
      'st_tk_news_v2':    '/api/cms/news',
      'st_tk_hero_v2':    '/api/cms/hero',
      'st_tk_sched_v2':   '/api/cms/events?category=regular',
      'st_tk_regular_v2': '/api/cms/works?kind=regular',
      'st_tk_cm_v2':      '/api/cms/works?kind=cm',
      'st_tk_movie_v2':   '/api/cms/works?kind=movie',
      'st_tk_release_v2': '/api/cms/music/releases',
      'st_tk_concert_v2': '/api/cms/tours',
      'st_tk_blog_v2':    '/api/journal',
      'st_tk_announce_v2':'/api/cms/announce',
      'st_tk_payments_v2':'/api/payments',
      'st_member_users':  '/api/auth/me',
      'st_bookings':      '/api/support/tickets?category=tour',
      'st_tickets':       '/api/support/tickets',
      'st_chat_threads':  '/api/support/threads',
      // v7 additions
      'st_shop_products': '/api/products',
      'st_shop_orders':   '/api/orders/mine',
      'st_shop_cart':     null, // client-only
      'st_journal':       '/api/journal',
      'st_archive':       '/api/cms/works?kind=archive',
      'st_notifications': '/api/notifications',
      'st_notif_prefs':   '/api/notifications/preferences',
      'st_passport':      '/api/passports',
    },
    // Direct REST helper (bypasses KV, uses typed routes)
    async api(path, opts={}){
      if(!DB.isRemote) return null;
      const r = await fetch(DB.apiBase + path, { credentials:'include', headers:{'Content-Type':'application/json'}, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
      if(!r.ok) throw new Error(`API ${r.status} ${path}`);
      return r.json();
    }
  };
  window.KimuraDB = DB;

  // Auto-wrap legacy load/save (sync cache + async remote sync + BroadcastChannel)
  const tryWrap = () => {
    if(typeof window.load === 'function' && !window.load._wrapped){
      const origLoad = window.load;
      window.load = function(k, fb){
        if(DB.isRemote && DB.keyMap[k]){
          const mapped = DB.keyMap[k];
          if(mapped) fetch(DB.apiBase + mapped, { credentials:'include' }).then(r=>r.ok?r.json():null).then(j=>{
            if(j && JSON.stringify(j)!==JSON.stringify(origLoad(k, fb))){
              const val = Array.isArray(j) ? j : (j.value ?? j);
              localStorage.setItem(k, JSON.stringify(val));
              try{ new BroadcastChannel('st_tk_sync').postMessage('update')}catch{}
            }
          }).catch(()=>{});
        } else if(DB.isRemote) DB.get(k, fb).then(v=>{
          if(JSON.stringify(v)!==JSON.stringify(origLoad(k, fb))){
            localStorage.setItem(k, JSON.stringify(v));
            try{ new BroadcastChannel('st_tk_sync').postMessage('update')}catch{}
          }
        });
        return origLoad(k, fb);
      };
      window.load._wrapped = true;
    }
    if(typeof window.save === 'function' && !window.save._wrapped){
      const origSave = window.save;
      window.save = function(k, v){
        origSave(k, v);
        if(DB.isRemote){
          if(DB.keyMap[k] && DB.keyMap[k]!==null) {
            // PUT to typed route if possible, else KV
            DB.set(k, v);
          } else DB.set(k, v);
        }
      };
      window.save._wrapped = true;
    }
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryWrap);
  else tryWrap();
  console.info('[KimuraDB] v3 production-only loaded. remote=', DB.isRemote, 'api=', DB.apiBase || '(not configured — returning empty, no demo data)');
})();
