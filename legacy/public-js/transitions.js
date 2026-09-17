// transitions.js — 3D motion between pages (no static feel) • 2026-09-15
(function(){
  const trans = document.getElementById('pageTrans');
  const ptNum = document.getElementById('ptNum');
  const ptLabel = document.getElementById('ptLabel');
  if(!trans) return;

  const map = {
    '/': ['01','HOME — Official Digital World'],
    '/work': ['02','WORK — Filmography & Archive'],
    '/music': ['03','MUSIC — Checkpoint Campaign'],
    '/tour': ['04','TOUR — Center & Passport'],
    '/journal': ['05','JOURNAL — Stories & Vault'],
    '/archive': ['06','ARCHIVE — 1990 → Future'],
    '/members': ['07','MEMBERS — Fan Card & Vault'],
    '/shop': ['08','SHOP — Official Merch & QR'],
    '/support': ['09','SUPPORT — Ticket & Management'],
    '/search': ['10','SEARCH — Explore'],
    '/join': ['11','JOIN — Membership Entry']
  };
  function labelFor(path){
    const k = Object.keys(map).find(p=> path===p || path.startsWith(p+'/') || path.startsWith(p+'#'));
    return k ? map[k] : ['—','Official Digital World'];
  }

  // Wrap page content for 3D
  document.addEventListener('DOMContentLoaded', ()=>{
    const main = document.querySelector('.hero-wrap') || document.querySelector('section');
    if(main) main.classList.add('page-3d');
    // entrance
    requestAnimationFrame(()=>{
      if(main){ main.classList.add('in'); setTimeout(()=> main.classList.remove('in'), 900); }
    });
  });

  // Intercept internal navigation
  document.addEventListener('click', (e)=>{
    const a = e.target.closest('a');
    if(!a) return;
    const href = a.getAttribute('href');
    if(!href) return;
    if(href.startsWith('http') && !href.includes(location.host)) return;
    if(href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || a.target==='_blank') return;
    if(href.startsWith('javascript:')) return;
    // only same-origin page navigation: /work/ /music/ etc
    const isPage = href.startsWith('/') && !href.startsWith('//') && !href.includes('.png') && !href.includes('.jpg') && !href.includes('.webp');
    if(!isPage) return;
    // allow hash inside same page without transition
    if(href.includes('#') && href.split('#')[0]===location.pathname) return;
    e.preventDefault();
    const [num, label] = labelFor(href);
    if(ptNum) ptNum.textContent = num;
    if(ptLabel) ptLabel.textContent = label;
    const wrap = document.querySelector('.hero-wrap, section');
    if(wrap) wrap.classList.add('out');
    trans.classList.add('show');
    trans.classList.remove('leaving');
    // haptic
    try{ navigator.vibrate && navigator.vibrate(12); }catch{}
    setTimeout(()=>{ location.href = href; }, 620);
  });

  // On load, hide trans if coming from transition (popstate)
  window.addEventListener('pageshow', ()=>{
    trans.classList.remove('show');
  });
  // Also auto-hide after initial load if still shown
  setTimeout(()=> trans.classList.remove('show'), 1400);
})();
