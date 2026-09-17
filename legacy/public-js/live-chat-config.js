// live-chat-config.js — choose external live chat for admin real-time replies
// Boss: pick ONE, fill ID, redeploy — we already handle routing so your black-gold chat button stays.
// Recommended rank for your case (Vercel static + STARTO premium):
// 1) Tawk.to — FREE unlimited agents, best for you (we wiring it so members=ticket, guests=Tawk)
// 2) Crisp — premium look, $0 for 2 agents, co-browse
// 3) Smartsupp — as you asked, with visitor video, but paid after trial
// 4) none — keep our custom bot + ticket (already elite with knowledge base)

window.LIVE_CHAT_PROVIDER = '' // '' = custom only (current), 'tawk'|'crisp'|'smartsupp'|'tawk'
window.LIVE_CHAT_IDS = {
  tawk: 'YOUR_TAWK_PROPERTY_ID/KEY', // e.g. '66abc1234a1b2c3d4e5f6a7b8/1hxxx'
  crisp: 'YOUR_CRISP_WEBSITE_ID',    // e.g. 'abcd1234-...-efgh'
  smartsupp: 'YOUR_SMARTSUPP_KEY'      // e.g. 'abc123... '
};

// Auto-loader — if you set provider + id, we load external widget and keep our chat as fallback/ticket
(function(){
  const p = (window.LIVE_CHAT_PROVIDER||'').toLowerCase();
  const ids = window.LIVE_CHAT_IDS||{};
  if(!p || !ids[p] || ids[p].startsWith('YOUR_')){
    console.log('[live-chat] custom bot + ticket only — set LIVE_CHAT_PROVIDER to enable external');
    return;
  }
  console.log('[live-chat] loading', p);
  if(p==='tawk'){
    const s=document.createElement('script'); s.async=true;
    s.src='https://embed.tawk.to/'+ids.tawk; s.charset='UTF-8'; s.setAttribute('crossorigin','*');
    document.head.appendChild(s);
    // Keep our launch button, but when Tawk loads, route click to Tawk maximize
    let tries=0; const iv=setInterval(()=>{
      if(window.Tawk_API && window.Tawk_API.maximize){ clearInterval(iv);
        const launcher=document.getElementById('chatLauncher');
        if(launcher) launcher.addEventListener('click', (e)=>{
          const cur=JSON.parse(localStorage.getItem('st_member_current')||'null');
          // members keep ticket system, guests go to Tawk
          if(!cur){
            e.preventDefault(); e.stopImmediatePropagation();
            try{ window.Tawk_API.maximize(); }catch{}
          }
        }, true);
      } else if(tries++>50) clearInterval(iv);
    },400);
  }
  if(p==='crisp'){
    window.$crisp=[]; window.CRISP_WEBSITE_ID=ids.crisp;
    const s=document.createElement('script'); s.async=true; s.src='https://client.crisp.chat/l.js'; document.head.appendChild(s);
  }
  if(p==='smartsupp'){
    window._smartsupp = window._smartsupp||{}; window._smartsupp.key = ids.smartsupp;
    const s=document.createElement('script'); s.async=true; s.src='https://www.smartsuppchat.com/loader.js'; document.head.appendChild(s);
  }
})();
