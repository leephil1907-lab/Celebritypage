// chat-knowledge.js — Support Live Chat now answers with site knowledge, then ticket to Management • 2026-09-15
(function(){
  // Knowledge base — curated from crawled STARTO/official site structure
  const KB = [
    { q: ["tour","concert","date","fukuoka","seoul","taipei","checkpoint"], a: "Live Tour 2026 Checkpoint runs Sep 5–Nov 23 — C&C STAGE production. Fukuoka Sep 10 TOTTEI PARK (20 Meet & Greet), Seoul Oct 18, Taipei Nov 13 Birthday Special. Fan Club lottery priority: Diamond guaranteed, Platinum/ Gold higher rank. Tap BOOKING → Purchase Fan Card → lottery dashboard shows your live rank." },
    { q: ["fan card","member","tier","silver","gold","platinum","diamond","price"], a: "4 Fan Cards: Silver ¥300k, Gold ¥500k, Platinum ¥750k, Diamond VIP ¥1M per year. Purchase opens a support ticket + direct chat with Management — payment details sent via chat (VISA/MC/JCB, Apple Pay, Google Pay, PayPay, Konbini, Bank MUFG). Vault & birthday video unlock by tier: Vault 01 all, 02 Gold+, 03 Platinum/Diamond." },
    { q: ["vault","exclusive","video","private","birthday","wallpaper","rehearsal"], a: "Exclusive Vault: 01 Rehearsal Checkpoint (4-min stream + photos) — any member, 02 Private Gallery (4K wallpapers + handwritten notes) — Gold+, 03 Surprise Stream (monthly private live Q&A acoustic) — Platinum/Diamond invite + replay. Tap vault cards — blurred preview if locked, player if unlocked. Birthday video auto-unlocks in Vault on your birth month." },
    { q: ["shop","merch","goods","qr","verify","collect","delivery","order"], a: "Official Shop → Products → Inventory → Checkout → Payment → QR → Venue SCAN → VERIFY → COLLECT (MERCH QR SYSTEM). Orders → Delivery or Venue Pickup QR. Digital QR verifiable at venue — no screenshot exchange. See SHOP → My Orders → Show QR → staff scans." },
    { q: ["passport","stamp","tour pass"], a: "Digital Tour Pass + Tour Passport: QR verification, no sensitive data. Each attended city stamps your Passport (Fukuoka, Seoul, Taipei). 3 stamps = gift at venue. Stamps show in Dashboard → Passport after QR-verify. Show Passport at merch booth for bonus." },
    { q: ["notification","email","push","in-app","prefer"], a: "Notifications: In-App / Email / Push per category (tour/music/journal/membership/ticket/merchandise/support). Set in MEMBERS → Notifications. Email uses backend /api/notifications/email → EmailJS fallback → localStorage. You’re already subscribed to Fan Club Daily at midnight JST." },
    { q: ["journal","archive","work","film","drama","movie","1990"], a: "WORK: 20 verified films 1994 Shoot! → 2026 Kyojo Requiem, incl. 2046, Howl’s Castle (Howl voice), Love and Honor, Space Battleship Yamato, Blade of the Immortal, Masquerade Hotel/Night, The Legend & Butterfly, Tokyo Taxi (Yoji Yamada). ARCHIVE: 1990→Future timeline 1972 born → 1987 Johnny’s → 1988 SMAP → 1996 Long Vacation phenomenon → 2000 marriage Shizuka Kudo → 2016 SMAP解散 → 2026 Checkpoint. Dramas incl. Long Vacation, Love Generation, Beautiful Life, HERO, Good Luck!!, Kyojo." },
    { q: ["music","album","checkpoint","flow","radio","discography"], a: "Music: Albums Next Destination 2022.01.19, See You There 2024.08.14, CHECKPOINT 2026.08.12 (12 tracks, vinyl + Vault download). Licensed player in MUSIC → Player (CMS-controlled). Radio Flow Sundays 11:30 TOKYO FM — 2018→present + YouTube Kimura Saaaan! 2018-2023. SANTAKU annual with Sanma Akashiya." },
    { q: ["support","management","ticket","chat","admin"], a: "Support is ticket-based → Official Site / Management replies here (bottom-right chat). No ‘not Takuya’ disclaimer — replies are from Management only. Describe your question; bot answers instantly. Want a human? Tap ‘Open ticket → Management’ — creates #ID ticket linked to your email, admin replies via this chat + email." },
    { q: ["language","ja","en","korean","chinese","translate"], a: "International: JA primary, EN secondary via JA/EN toggle (top header). Future Korean/Chinese via approved translations — no auto-scrape. Switch at any time; CMS keeps both locales synced." },
    { q: ["login","signup","account","password","reset"], a: "JOIN → Sign Up Free → Purchase Fan Card. Forgot password: Member modal → Forgot → reset email via EmailJS (simulated + backend when deployed). Account shows Digital Fan Card (metallic/grain/lighting/motion, no private data). Logout clears local session; tickets persist per email." },
    { q: ["admin","cms","kimura admin"], a: "KIMURA ADMIN (back-office): manages Homepage NOW campaign, Work/music/tours/journal/archive, Members/fan cards, Fan content, Shop/support, Notifications, Media/campaigns/analytics — all without code. Roles: Super Admin, Management, Editor, Tour Mgr, Membership Mgr, Support Agent, Shop Mgr, Moderator, Analyst, Developer — strict perms + audit logs." }
  ];

  function findAnswer(text){
    const low = text.toLowerCase();
    // quick exact FAQ phrases
    for(const item of KB){
      if(item.q.some(k=> low.includes(k))){
        return item.a;
      }
    }
    return null;
  }

  // Wrap existing sendChat after DOM ready
  function enhance(){
    const input = document.getElementById('chatInput');
    const body = document.getElementById('chatBody');
    const win = document.getElementById('chatWindow');
    if(!input || !body || !window.sendChat) return;

    const origSend = window.sendChat;
    // Add quick chips
    if(win && !document.getElementById('kbSuggest')){
      const bar = document.createElement('div');
      bar.id = 'kbSuggest';
      bar.className = 'chat-suggest';
      bar.style.padding = '8px 12px';
      bar.style.borderTop = '1px solid var(--line)';
      bar.style.background = 'var(--pearl)';
      const chips = ['Tour dates?','Fan Card ¥?','Vault?','Shop QR?','Passport stamps?','Talk to Management'];
      bar.innerHTML = chips.map(c=> `<button data-q="${c}">${c}</button>`).join('');
      win.insertBefore(bar, win.querySelector('div[style*="display:flex;gap:8px"]') || win.lastElementChild);
      bar.addEventListener('click', (e)=>{
        const b = e.target.closest('button');
        if(!b) return;
        input.value = b.dataset.q;
        input.focus();
        if(b.dataset.q.includes('Management')) {
          openTicketPrompt();
        } else {
          window.sendChat();
        }
      });
    }

    window.sendChat = function(){
      const txt = (document.getElementById('chatInput').value||'').trim();
      if(!txt){ origSend(); return; }
      const low = txt.toLowerCase();
      // if asking for human/management directly, go ticket
      if(low.includes('management') || low.includes('human') || low.includes('talk to') || low.includes('staff') || low.includes('contact')){
        origSend();
        setTimeout(()=> replyManagementTicket(txt), 500);
        return;
      }
      const ans = findAnswer(txt);
      if(ans){
        // First, push user message via orig
        origSend();
        // Then bot knowledge answer
        setTimeout(()=>{
          const threadsKey = (()=>{
            try{
              const cur = JSON.parse(localStorage.getItem('st_member_current')||'null');
              return cur ? 'st_chat_threads:'+cur.email : 'st_chat_threads:guest';
            }catch{ return 'st_chat_threads:guest'; }
          })();
          const key = 'st_tk_chat_v2';
          // Append bot message to thread + UI
          const addBot = (text)=>{
            const el = document.getElementById('chatBody');
            if(!el) return;
            const div = document.createElement('div');
            div.style.cssText = "max-width:78%;padding:10px 12px;font-size:12.5px;line-height:1.6;border:1px solid var(--line);background:#fff;border-radius:14px 14px 14px 2px;align-self:flex-start";
            div.innerHTML = `${text.replace(/</g,'&lt;')}<div style="margin-top:4px;font-size:10px;opacity:.7">Official Site / Management • ${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} • auto-answer</div><div style="margin-top:8px;display:flex;gap:6px"><button class="btn gold small" style="padding:6px 10px;font-size:10px" onclick="window.openTicketFromChat()">Open ticket → Management</button><button class="btn ghost small" style="padding:6px 10px;font-size:10px" onclick="document.getElementById('chatInput').focus()">Ask follow-up</button></div>`;
            el.appendChild(div);
            el.scrollTop = el.scrollHeight;
            // also store in threads for persistence
            try{
              const cur = JSON.parse(localStorage.getItem('st_member_current')||'null');
              const email = cur ? cur.email : 'guest@local';
              const threads = JSON.parse(localStorage.getItem('st_chat_threads')||'{}');
              const k = cur ? JSON.stringify(['user',email]) : JSON.stringify(['guest',email]);
            }catch{}
          };
          addBot(ans);
          // badge
          const b = document.getElementById('chatBadge');
          if(b && !document.getElementById('chatWindow').classList.contains('open')){
            const n = parseInt(b.textContent||'0',10)+1;
            b.textContent = n>9?'9+':n;
            b.classList.add('show');
          }
        }, 600);
      } else {
        origSend();
        // fallback bot help after short delay
        setTimeout(()=>{
          const el = document.getElementById('chatBody');
          if(!el) return;
          // Only if last was user and no bot answered yet — suggest ticket
          const last = el.lastElementChild;
          if(last && last.textContent.includes('You')){
            const div = document.createElement('div');
            div.style.cssText = "max-width:78%;padding:10px 12px;font-size:12px;line-height:1.6;border:1px solid var(--line);background:var(--pearl);border-radius:12px;align-self:flex-start";
            div.innerHTML = `Got it — I’ll forward this to <b>Management</b>. Tap <b>Open ticket → Management</b> to create a ticket #ID; admin replies here + via email.<div style="margin-top:8px"><button class="btn gold small" style="padding:6px 10px;font-size:10px" onclick="window.openTicketFromChat()">Open ticket → Management</button></div>`;
            el.appendChild(div);
            el.scrollTop = el.scrollHeight;
          }
        }, 1100);
      }
    };

    window.openTicketFromChat = function(){
      const cur = JSON.parse(localStorage.getItem('st_member_current')||'null');
      if(!cur){ alert('Please sign up / login first — then your ticket will be linked to your email.'); window.openMember && window.openMember('signup'); return; }
      const input = document.getElementById('chatInput');
      const msg = (input && input.value.trim()) || 'Request to talk with Management';
      // Create ticket like booking does
      const tickets = JSON.parse(localStorage.getItem('st_tickets')||'[]');
      const id = Date.now();
      tickets.unshift({id, userId:cur.id, userName:cur.name, userEmail:cur.email, subject: msg.slice(0,48) || 'Chat → Management', tier:null, price:null, status:'Open', messages:[{from:'user',text:msg,ts:Date.now()}], created:Date.now()});
      localStorage.setItem('st_tickets', JSON.stringify(tickets));
      try{new BroadcastChannel('st_ticket').postMessage('update')}catch{}
      try{new BroadcastChannel('st_tk_chat').postMessage('update')}catch{}
      const el = document.getElementById('chatBody');
      if(el){
        const div = document.createElement('div');
        div.style.cssText = "max-width:78%;padding:10px 12px;font-size:12.5px;line-height:1.6;border:1px solid #0a0a0a;background:#0a0a0a;color:#fff;border-radius:14px 14px 2px 14px;align-self:flex-end";
        div.textContent = `✓ Ticket #${id} opened — Management will reply here.`;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
      }
      if(window.toast) toast(`Ticket #${id} opened → Management`);
      if(input) input.value='';
      window.renderDashTickets && window.renderDashTickets();
      window.renderChat && window.renderChat();
    };
    function openTicketPrompt(){ window.openTicketFromChat(); }
    function replyManagementTicket(txt){
      const el = document.getElementById('chatBody');
      if(!el) return;
      const div = document.createElement('div');
      div.style.cssText = "max-width:78%;padding:10px 12px;font-size:12.5px;line-height:1.6;border:1px solid var(--line);background:#fff;border-radius:14px 14px 14px 2px;align-self:flex-start";
      div.innerHTML = `Opening your request <em>"${txt.replace(/</g,'&lt;').slice(0,80)}"</em> as a ticket for Management.<div style="margin-top:8px"><button class="btn gold small" style="padding:6px 10px;font-size:10px" onclick="window.openTicketFromChat()">Confirm — Open ticket</button></div>`;
      el.appendChild(div);
      el.scrollTop = el.scrollHeight;
    }
    console.log("Chat knowledge enhanced");
  }

  // Hook after main script loads
  let tries=0;
  const iv = setInterval(()=>{
    if(window.sendChat && document.getElementById('chatInput')){ clearInterval(iv); enhance(); }
    else if(tries++>50) clearInterval(iv);
  }, 400);

  document.addEventListener('DOMContentLoaded', ()=>{
    setTimeout(enhance, 900);
  });
})();
