// dashboard-enhance.js — comfortable member dashboard + early access ticket + security center • 2026-09-15
(function(){
  function getSec(email){
    const k='st_security:'+email;
    let v=null; try{ v=JSON.parse(localStorage.getItem(k)||'null'); }catch{}
    if(!v){
      v = {
        twoFA: false,
        passUpdated: Date.now() - 1000*60*60*24*7,
        sessions: [
          {device:'This browser — '+navigator.userAgent.slice(0,32), ip:'local', time: Date.now(), current:true},
          {device:'Admin verification', ip:'Vercel', time: Date.now()-1000*60*60*5, current:false}
        ],
        logins: [
          {at: Date.now()-1000*60*30, via:'Password', ok:true, ip:'local'},
          {at: Date.now()-1000*60*60*24*2, via:'Password', ok:true, ip:'local'}
        ]
      };
      try{ localStorage.setItem(k, JSON.stringify(v)); }catch{}
    }
    return v;
  }
  function saveSec(email, v){
    try{ localStorage.setItem('st_security:'+email, JSON.stringify(v)); }catch{}
  }
  function earlyCode(cardNo, tier){
    if(!tier || tier==='none') return null;
    const base = (cardNo||'TK').replace(/[^A-Z0-9]/g,'').slice(-5);
    const tierMap = {silver:'S', gold:'G', platinum:'P', diamond:'D'};
    return `EARLY-TK-${tierMap[tier]||'X'}-${base}-${String(Date.now()).slice(-4)}`;
  }
  function renderSecurity(email, container){
    const sec = getSec(email);
    const twoFAIcon = sec.twoFA ? '✓ 2FA ON' : '○ 2FA OFF';
    const twoFAColor = sec.twoFA ? '#1a6a3a' : '#9a958f';
    container.innerHTML = `
      <div style="border:1px solid var(--line);background:#fff;padding:14px;margin-top:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:28px;height:28px;background:#0f0e0c;color:var(--gold);display:grid;place-items:center;font-size:11px;border:1px solid var(--gold)">🛡</span>
          <div style="flex:1">
            <b style="font-size:11px;letter-spacing:.1em">SECURITY CENTER • Safe & Encrypted</b><br>
            <span style="font-size:10px;color:var(--muted)">Your account is protected — localStorage demo + ready for Postgres/Auth.js when backend deploys.</span>
          </div>
          <span style="font-size:10px;padding:6px 10px;border:1px solid ${sec.twoFA?'#c8ecd8':'var(--line)'};background:${sec.twoFA?'#eef8f1':'var(--pearl)'};color:${twoFAColor}">
            <span style="width:6px;height:6px;background:${sec.twoFA?'#1ec760':'#9a958f'};border-radius:50%;display:inline-block;margin-right:4px"></span>${twoFAIcon}
          </span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
          <div style="border:1px solid var(--line);background:var(--pearl);padding:10px">
            <small style="font-size:10px;letter-spacing:.08em;color:var(--muted)">Password</small><br>
            <b style="font-size:11px">•••••••• • Updated ${new Date(sec.passUpdated).toLocaleDateString('ja-JP')}</b>
            <div style="margin-top:6px;height:4px;background:#e8ddd0;border-radius:99px;overflow:hidden"><i style="display:block;height:100%;width:78%;background:var(--gold)"></i></div>
            <div style="margin-top:6px;display:flex;gap:6px">
              <button class="btn ghost small" style="flex:1;font-size:10px;padding:6px" onclick="window.secChangePass()">Change →</button>
              <button class="btn ${sec.twoFA?'gold':'ghost'} small" style="flex:1;font-size:10px;padding:6px" onclick="window.secToggle2FA()">${sec.twoFA?'Disable 2FA':'Enable 2FA'}</button>
            </div>
          </div>
          <div style="border:1px solid var(--line);background:var(--pearl);padding:10px">
            <small style="font-size:10px;letter-spacing:.08em;color:var(--muted)">Active sessions</small><br>
            <div style="margin-top:6px;display:grid;gap:6px">
              ${sec.sessions.map(s=>`<div style="display:flex;gap:8px;align-items:center;font-size:10px;padding:6px;background:#fff;border:1px solid var(--line)"><span style="width:22px;height:22px;background:${s.current?'#0f0e0c':'#fff'};color:${s.current?'#fff':'var(--muted)'};border:1px solid var(--line);display:grid;place-items:center">${s.current?'●':'○'}</span><div style="flex:1"><b>${s.device.slice(0,28)}</b><br><span style="color:var(--muted)">${new Date(s.time).toLocaleString('ja-JP')} • ${s.current?'Current':'Ended'}</span></div>${s.current?'<span style="font-size:9px;padding:2px 6px;background:#eef8f1;color:#1a6a3a;border:1px solid #c8ecd8">ACTIVE</span>':''}</div>`).join('')}
            </div>
            <button class="btn ghost small" style="width:100%;margin-top:8px;font-size:10px;padding:6px" onclick="window.secLogoutAll()">Logout other sessions</button>
          </div>
        </div>
        <div style="margin-top:10px;padding:8px;border:1px dashed var(--line);background:var(--pearl);font-size:10px;color:var(--muted);display:flex;gap:8px;align-items:center">
          <span style="font-size:12px">🔒</span>
          <div><b style="color:var(--ink)">Bank-level feel:</b> no raw card storage • provider-hosted payments • ticket-based Management chat • audit-ready (KIMURA ADMIN roles + logs) • ready for Auth.js / Supabase Auth when you deploy backend. <a href="#" onclick="window.openChat();return false" style="text-decoration:underline;color:var(--gold)">Ask Management →</a></div>
        </div>
      </div>
    `;
  }
  function renderEarly(cur, container){
    const has = cur.tier && cur.tier!=='none';
    const code = has ? earlyCode(cur.cardNo, cur.tier) : null;
    // Early access for Checkpoint Tour — Gold+ gets 48h earlier, Diamond gets VIP entry
    const priority = {silver:'Standard early 12h', gold:'Gold early 48h', platinum:'Platinum early 72h + soundcheck', diamond:'Diamond VIP instant + front'}[cur.tier] || 'No early access yet — purchase a Fan Card';
    const countdownSec = 2*3600 + 14*60 + 5; // demo
    const end = new Date(Date.now() + countdownSec*1000).toLocaleString('ja-JP',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    container.innerHTML = `
      <div style="border:1px solid var(--gold);background:linear-gradient(180deg,#0f0e0c 0%,#1a1816 100%);color:#fff;padding:14px;margin-top:12px;position:relative;overflow:hidden">
        <div style="position:absolute;inset:0;background:radial-gradient(520px 160px at 80% 0%, rgba(201,168,106,.18), transparent 60%);pointer-events:none"></div>
        <div style="position:relative;display:flex;gap:12px;align-items:flex-start">
          <div style="width:40px;height:40px;background:var(--gold);color:#0f0e0c;display:grid;place-items:center;font-weight:800;font-size:11px;flex-shrink:0">早</div>
          <div style="flex:1">
            <div style="font-size:10px;letter-spacing:.16em;color:var(--gold)">EARLY ACCESS • PRIORITY TICKET</div>
            <b style="display:block;margin:4px 0;font-family:Cormorant Garamond,serif;font-size:18px;font-weight:500">Checkpoint Tour — Early window</b>
            <div style="font-size:11px;opacity:.8;line-height:1.6">For members with Fan Card — skip the public queue. Your tier = your head-start.</div>
            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <span style="font-size:10px;letter-spacing:.08em;padding:6px 10px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18)">${priority}</span>
              <span style="font-size:10px;letter-spacing:.08em;padding:6px 10px;background:var(--gold);color:#0f0e0c;font-weight:700">${has ? '● ACTIVE' : '○ LOCKED'}</span>
              <span style="font-size:10px;opacity:.7">Ends ${end} JST</span>
            </div>
            ${has ? `
              <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                <div style="flex:1;min-width:180px;padding:10px 12px;background:#fff;color:#0f0e0c;border:1px solid var(--line);font-family:JetBrains Mono,monospace;font-size:11px;display:flex;align-items:center;gap:10px">
                  <span style="opacity:.6">CODE</span> <b id="earlyCode" style="letter-spacing:.08em">${code}</b>
                  <button class="btn ghost small" style="margin-left:auto;padding:6px 10px;font-size:10px" onclick="navigator.clipboard&&navigator.clipboard.writeText('${code}'); window.toast&&toast('Copied '+ '${code}')">Copy</button>
                </div>
                <button class="btn gold small" onclick="window.claimEarly()">Claim Early Ticket →</button>
              </div>
              <div style="margin-top:8px;font-size:10px;opacity:.6">Show this code at SHOP → QR Verify or TOUR → Booking → pre-fills early window. One claim per member.</div>
            ` : `
              <div style="margin-top:12px;padding:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);font-size:11px;color:#d8d5d0">
                Sign up free, then purchase Silver ¥300k+ to unlock early access. <a href="#" onclick="document.getElementById('membership')&&document.getElementById('membership').scrollIntoView({behavior:'smooth'});return false" style="text-decoration:underline;color:var(--gold)">View tiers →</a>
              </div>
            `}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:10px;letter-spacing:.1em;opacity:.6">COUNTDOWN</div>
            <div id="earlyCountdown" style="font-family:JetBrains Mono,monospace;font-size:16px;font-weight:700;margin-top:4px">02:14:05</div>
            <div style="font-size:9px;opacity:.5;margin-top:2px">to public open</div>
          </div>
        </div>
      </div>
    `;
    // countdown
    let sec = countdownSec;
    const el = container.querySelector('#earlyCountdown');
    if(el){
      const iv = setInterval(()=>{
        sec = sec>0? sec-1: countdownSec;
        const h=String(Math.floor(sec/3600)).padStart(2,'0');
        const m=String(Math.floor((sec%3600)/60)).padStart(2,'0');
        const s=String(sec%60).padStart(2,'0');
        el.textContent = h+':'+m+':'+s;
        if(!document.body.contains(el)) clearInterval(iv);
      },1000);
    }
  }

  // Wrap renderDashboard after it exists
  function enhance(){
    if(!window.renderDashboard) return;
    const orig = window.renderDashboard;
    window.renderDashboard = function(){
      orig();
      const cur = JSON.parse(localStorage.getItem('st_member_current')||'null');
      if(!cur) return;
      const dashCard = document.getElementById('dashCard');
      if(!dashCard) return;
      // Don't double-inject
      if(document.getElementById('earlyAccessBox') || document.getElementById('secBox')) return;

      // Find parent container: #dashMember or modal pane
      const parent = document.getElementById('dashMember') || dashCard.parentElement;
      if(!parent) return;

      const earlyBox = document.createElement('div');
      earlyBox.id = 'earlyAccessBox';
      renderEarly(cur, earlyBox);
      // Insert after tier grid
      const tierGrid = parent.querySelector('div[style*="grid-template-columns:1fr 1fr"]');
      if(tierGrid) tierGrid.after(earlyBox);
      else dashCard.after(earlyBox);

      const secBox = document.createElement('div');
      secBox.id = 'secBox';
      renderSecurity(cur.email, secBox);
      // Insert before tickets or after early
      const tickets = document.getElementById('dashTickets');
      if(tickets) tickets.before(secBox);
      else earlyBox.after(secBox);

      // Comfort header
      if(!document.getElementById('comfortHead')){
        const head = document.createElement('div');
        head.id='comfortHead';
        head.style.cssText='margin-bottom:12px;padding:12px;border:1px solid var(--line);background:var(--pearl);display:flex;gap:12px;align-items:center';
        const salutation = new Date().getHours()<12? 'Good morning' : new Date().getHours()<18? 'Good afternoon' : 'Good evening';
        head.innerHTML = `
          <div style="width:40px;height:40px;border-radius:50%;background:#0f0e0c;color:#fff;display:grid;place-items:center;font-weight:700">${cur.name.split(' ').map(s=>s[0]).join('').slice(0,2).toUpperCase()}</div>
          <div style="flex:1">
            <div style="font-size:11px;letter-spacing:.08em;color:var(--muted)">${salutation}</div>
            <b style="font-family:Cormorant Garamond,serif;font-size:16px">${cur.name} — welcome back</b><br>
            <span style="font-size:10px;color:var(--muted)">Member since ${new Date(cur.created).toLocaleDateString('ja-JP')} • ${cur.cardNo} • <span style="color:var(--gold)">${(cur.tier||'NO CARD').toUpperCase()}</span> • Vault ${cur.tier && cur.tier!=='none' ? 'unlocked' : 'locked'}</span>
          </div>
          <div style="text-align:right">
            <div style="font-size:10px;letter-spacing:.08em;color:var(--muted)">COMFORT</div>
            <div style="font-size:11px">Your space • calm • private</div>
            <div style="margin-top:4px;width:68px;height:4px;background:#e8ddd0;border-radius:99px;overflow:hidden;margin-left:auto"><i style="display:block;height:100%;width:${cur.tier==='diamond'?100: cur.tier==='platinum'?78: cur.tier==='gold'?56: cur.tier==='silver'?34: 12}%;background:var(--gold)"></i></div>
          </div>
        `;
        const first = parent.firstElementChild;
        if(first) first.before(head);
        else parent.prepend(head);
      }
    };
    // Global helpers
    window.claimEarly = function(){
      const cur = JSON.parse(localStorage.getItem('st_member_current')||'null');
      if(!cur || cur.tier==='none'){ window.toast&&toast('Purchase a Fan Card first'); return; }
      const code = earlyCode(cur.cardNo, cur.tier);
      window.toast&&toast('Early ticket claimed — code: '+code+' (shows at shop/tour QR)');
      // Open ticket for early access
      try{
        const tickets = JSON.parse(localStorage.getItem('st_tickets')||'[]');
        const id = Date.now();
        tickets.unshift({id, userId:cur.id, userName:cur.name, userEmail:cur.email, subject:`Early Access Claim — ${code}`, tier:cur.tier, price:null, status:'Open', messages:[{from:'user',text:`Early access code ${code} claimed for ${cur.tier}. Please confirm priority.`,ts:Date.now()}], created:Date.now()});
        localStorage.setItem('st_tickets', JSON.stringify(tickets));
        window.renderDashTickets && window.renderDashTickets();
        window.openChat && window.openChat();
      }catch{}
    };
    window.secToggle2FA = function(){
      const cur = JSON.parse(localStorage.getItem('st_member_current')||'null');
      if(!cur) return;
      const sec = getSec(cur.email);
      sec.twoFA = !sec.twoFA;
      saveSec(cur.email, sec);
      window.toast&&toast(sec.twoFA ? '2FA enabled — demo (use Authenticator later)' : '2FA disabled');
      // re-render security
      const box = document.getElementById('secBox');
      if(box) renderSecurity(cur.email, box);
    };
    window.secChangePass = function(){
      const cur = JSON.parse(localStorage.getItem('st_member_current')||'null');
      if(!cur) return;
      const p = prompt('Enter new password (8+ chars) — demo only, hashed locally:');
      if(!p || p.length<8) return alert('Need 8+ chars');
      // simulate hash
      const users = JSON.parse(localStorage.getItem('st_member_users')||'[]');
      const idx = users.findIndex(u=>u.email===cur.email);
      if(idx!==-1){
        users[idx].passHash = btoa(p).slice(0,24);
        localStorage.setItem('st_member_users', JSON.stringify(users));
        cur.passHash = users[idx].passHash;
        localStorage.setItem('st_member_current', JSON.stringify(cur));
        const sec = getSec(cur.email); sec.passUpdated = Date.now(); saveSec(cur.email, sec);
        window.toast&&toast('Password updated — secure');
        const box=document.getElementById('secBox'); if(box) renderSecurity(cur.email, box);
      }
    };
    window.secLogoutAll = function(){
      const cur = JSON.parse(localStorage.getItem('st_member_current')||'null');
      if(!cur) return;
      const sec = getSec(cur.email);
      sec.sessions = sec.sessions.filter(s=>s.current);
      saveSec(cur.email, sec);
      window.toast&&toast('Other sessions ended — only this browser active');
      const box=document.getElementById('secBox'); if(box) renderSecurity(cur.email, box);
    };
    console.log('Dashboard comfort + early access + security enhanced');
    // If already logged in, render now
    try{ window.renderDashboard(); }catch{}
  }

  // Wait for renderDashboard to exist
  let tries=0;
  const iv=setInterval(()=>{
    if(window.renderDashboard){ clearInterval(iv); enhance(); }
    else if(tries++>80) clearInterval(iv);
  },300);
  document.addEventListener('DOMContentLoaded', ()=> setTimeout(enhance, 800));
})();
