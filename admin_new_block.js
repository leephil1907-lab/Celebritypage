/* SHOP PRODUCTS */
function filterShopAdmin(cat){
  window._shopFilter=cat;
  renderShopProducts();
  renderShopInventory();
}
function renderShopProducts(){
  const data=load(K.shopProducts,[]);
  const el=document.getElementById('shopProductsAdmin');
  const invEl=document.getElementById('shopInventoryAdmin');
  if(!el) return;
  const q=window._shopFilter && window._shopFilter!=='all' ? data.filter(x=>x.cat===window._shopFilter) : data;
  el.innerHTML=q.map(p=>`
    <div style="border:1px solid var(--line);background:#fff;padding:12px;display:grid;grid-template-columns:80px 1fr auto;gap:12px;align-items:start">
      <img src="${p.img}" style="width:80px;height:80px;object-fit:cover;border:1px solid var(--line)">
      <div>
        <b style="font-size:12px">${p.title}</b> — <span style="font-size:11px;color:var(--muted)">${p.cat} • ¥${p.price.toLocaleString()} • Stock ${p.stock}</span>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">${p.desc}</div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
          <input value="${p.title}" data-shop-title="${p.id}" style="border:1px solid var(--line);padding:6px;font-size:11px;flex:1;min-width:140px">
          <input value="${p.price}" data-shop-price="${p.id}" style="border:1px solid var(--line);padding:6px;font-size:11px;width:90px">
          <input value="${p.stock}" data-shop-stock="${p.id}" style="border:1px solid var(--line);padding:6px;font-size:11px;width:70px">
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <button class="btn ghost small" onclick="editShopProduct('${p.id}')">Edit</button>
        <button class="btn ghost small" onclick="delShopProduct('${p.id}')">Delete</button>
        <span style="font-size:10px;color:${p.stock<20?'#d00':'#6a6a6a'}">${p.stock<20?'Low stock':''}</span>
      </div>
    </div>
  `).join('') || `<div style="padding:18px;border:1px dashed var(--line);text-align:center;color:var(--muted)">No products — add via + Add Product</div>`;
  if(invEl){
    invEl.innerHTML=data.map(p=>`<div style="border:1px solid var(--line);background:#fff;padding:10px;display:flex;justify-content:space-between;align-items:center"><span><b style="font-size:11px">${p.title}</b> <span style="font-size:11px;color:var(--muted)">• ${p.cat}</span></span><span style="font-size:11px;border:1px solid ${p.stock<20?'#d00':'var(--line)'};padding:4px 8px;background:${p.stock<20?'#fff0f0':'var(--pearl)'}">Stock: ${p.stock}</span></div>`).join('');
  }
}
window.saveShopProducts=()=>{
  let data=load(K.shopProducts,[]);
  data.forEach(p=>{
    const t=document.querySelector(`[data-shop-title="${p.id}"]`);
    const pr=document.querySelector(`[data-shop-price="${p.id}"]`);
    const st=document.querySelector(`[data-shop-stock="${p.id}"]`);
    if(t) p.title=t.value.trim()||p.title;
    if(pr) p.price=parseInt(pr.value)||p.price;
    if(st) p.stock=parseInt(st.value)||0;
  });
  save(K.shopProducts,data); audit('UPDATE','Shop products saved'); renderShopProducts(); toastAdmin('Shop products saved — inventory updated');
  try{new BroadcastChannel('st_shop').postMessage('update')}catch{}
};
window.addShopProduct=()=>{
  openModal('Add Product', `<label style="font-size:11px">Category</label><select id="sp_cat" class="input"><option>Apparel</option><option>Tour Merch</option><option>Accessories</option><option>Albums</option><option>Collectibles</option><option>Limited</option></select><label style="display:block;margin-top:8px;font-size:11px">Title</label><input id="sp_title" class="input" placeholder="CHECKPOINT Tour Tee"><label style="display:block;margin-top:8px;font-size:11px">Price (¥)</label><input id="sp_price" class="input" placeholder="8500" type="number"><label style="display:block;margin-top:8px;font-size:11px">Stock</label><input id="sp_stock" class="input" placeholder="100" type="number"><label style="display:block;margin-top:8px;font-size:11px">Image URL</label><input id="sp_img" class="input" placeholder="https://..."><label style="display:block;margin-top:8px;font-size:11px">Description</label><input id="sp_desc" class="input" placeholder="Official tour tee...">`, ()=>{
    const cat=$('#sp_cat').value, title=$('#sp_title').value.trim(), price=parseInt($('#sp_price').value)||0, stock=parseInt($('#sp_stock').value)||0, img=$('#sp_img').value.trim()||'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?q=80&w=400&auto=format&fit=crop', desc=$('#sp_desc').value.trim();
    if(!title) return toastAdmin('Title required');
    const data=load(K.shopProducts,[]); data.push({id:'shop-'+Date.now(), cat, title, price, stock, img, desc, status:'published'});
    save(K.shopProducts,data); closeModal(); renderShopProducts(); toastAdmin('Product added');
  });
};
window.editShopProduct=(id)=>{
  const data=load(K.shopProducts,[]); const p=data.find(x=>x.id===id); if(!p) return;
  openModal('Edit Product', `<label style="font-size:11px">Title</label><input id="sp_title" class="input" value="${p.title.replace(/"/g,'&quot;')}"><label style="display:block;margin-top:8px;font-size:11px">Description</label><input id="sp_desc" class="input" value="${p.desc.replace(/"/g,'&quot;')}"><label style="display:block;margin-top:8px;font-size:11px">Image URL</label><input id="sp_img" class="input" value="${p.img}">`, ()=>{
    p.title=$('#sp_title').value.trim()||p.title; p.desc=$('#sp_desc').value.trim()||p.desc; p.img=$('#sp_img').value.trim()||p.img;
    save(K.shopProducts,data); closeModal(); renderShopProducts(); toastAdmin('Product updated');
  });
};
window.delShopProduct=(id)=>{ openConfirm('Delete product?', ()=>{ let data=load(K.shopProducts,[]); data=data.filter(x=>x.id!==id); save(K.shopProducts,data); renderShopProducts(); toastAdmin('Product deleted'); }); };
window.resetShop=()=>{ openConfirm('Reset shop to demo?', ()=>{ localStorage.removeItem(K.shopProducts); save(K.shopProducts,[
    {id:'shop-001', cat:'Tour Merch', title:'CHECKPOINT Tour Tee — Black / Cream', price:8500, stock:120, img:'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?q=80&w=400&auto=format&fit=crop', desc:'Official tour tee — heavyweight cotton, tour dates back print. Sizes S-XXL.', status:'published'},
    {id:'shop-002', cat:'Apparel', title:'KIMURA // 01 Hoodie — Charcoal', price:14800, stock:60, img:'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=400&auto=format&fit=crop', desc:'Premium hoodie — embroidered KIMURA // 01, gold tip.', status:'published'}
  ]); renderShopProducts(); toastAdmin('Shop reset'); }); };

/* SHOP ORDERS */
function renderShopOrders(){
  const el=document.getElementById('shopOrdersAdmin'); if(!el) return;
  const orders=load(K.shopOrders,[]);
  if(!orders.length) el.innerHTML=`<div style="padding:14px;border:1px dashed var(--line);background:var(--pearl);text-align:center;color:var(--muted)">No orders — customer checkout creates QR orders.</div>`;
  else el.innerHTML=orders.map(o=>`<div style="border:1px solid var(--line);background:#fff;padding:12px;display:grid;grid-template-columns:1fr 120px;gap:12px"><div><b style="font-size:11px">${o.id} • ${o.status}</b> — <span style="font-size:11px">${o.deliveryType} • ${o.email}</span><br><span style="font-size:11px;color:var(--muted)">${o.items.map(i=>i.title+'×'+i.qty).join(', ')} • ¥${o.total.toLocaleString()}</span><br><span style="font-size:10px;color:var(--muted)">${new Date(o.created).toLocaleString('ja-JP')} • QR: ${o.qr}</span><div style="margin-top:6px;display:flex;gap:6px"><select data-order-status="${o.id}" style="border:1px solid var(--line);padding:6px;font-size:11px"><option ${o.status==='Paid'?'selected':''}>Paid</option><option ${o.status==='Preparing'?'selected':''}>Preparing</option><option ${o.status==='Ready'?'selected':''}>Ready</option><option ${o.status==='Shipped'?'selected':''}>Shipped</option><option ${o.status==='Collected'?'selected':''}>Collected</option></select><button class="btn ghost small" onclick="updateOrderStatus('${o.id}')">Update</button></div></div><div style="border:1px solid var(--line);background:var(--pearl);padding:8px;text-align:center"><div style="font-size:10px;letter-spacing:.1em">QR</div><div style="font-family:JetBrains Mono,monospace;font-size:10px;word-break:break-all">${o.qr}</div><div style="margin-top:6px;font-size:10px;color:${o.verified?'#1a6a3a':'var(--muted)'}">${o.verified?'Collected ✓':o.status}</div></div></div>`).join('');
}
window.updateOrderStatus=(id)=>{
  const sel=document.querySelector(`[data-order-status="${id}"]`); if(!sel) return;
  let orders=load(K.shopOrders,[]); const o=orders.find(x=>x.id===id); if(!o) return;
  o.status=sel.value; if(sel.value==='Collected') o.verified=true;
  save(K.shopOrders,orders); audit('UPDATE','Order '+id+' → '+sel.value); renderShopOrders(); toastAdmin('Order '+id+' → '+sel.value);
};
window.adminVerifyQR=()=>{
  const v=document.getElementById('scanInputAdmin').value.trim(); if(!v) return toastAdmin('Enter QR');
  let orders=load(K.shopOrders,[]); const o=orders.find(x=>x.qr===v || x.id===v);
  const res=document.getElementById('scanResultAdmin'); res.style.display='block';
  if(!o){ res.style.background='#fff0f0'; res.textContent='✕ QR not found'; return; }
  if(o.verified){ res.style.background='#fff0f0'; res.textContent='✕ Already collected'; return; }
  if(['Paid','Ready','Preparing'].indexOf(o.status)===-1){ res.style.background='#fff0f0'; res.textContent='✕ Not ready: '+o.status; return; }
  o.verified=true; o.status='Collected'; o.collectedAt=Date.now(); save(K.shopOrders,orders); res.style.background='#eef8f1'; res.style.borderColor='#c8ecd8'; res.innerHTML='✓ Verified — '+o.id+' • '+o.items.map(i=>i.title).join(', '); toastAdmin('Verified — ready to collect'); renderShopOrders();
};

/* JOURNAL */
function renderJournalAdmin(){
  const el=document.getElementById('journalAdmin'); if(!el) return;
  const data=load(K.journal,[]);
  el.innerHTML=data.map(j=>`<div style="border:1px solid var(--line);background:#fff;padding:12px;display:grid;grid-template-columns:80px 1fr auto;gap:12px"><img src="${j.img}" style="width:80px;height:80px;object-fit:cover;border:1px solid var(--line)"><div><b style="font-size:12px">${j.title}</b> — <span style="font-size:11px;color:var(--muted)">${j.cat} • ${j.date}</span><div style="font-size:11px;color:var(--muted);margin-top:4px">${j.excerpt.slice(0,80)}…</div><div style="margin-top:6px"><input value="${j.title}" data-j-title="${j.id}" style="border:1px solid var(--line);padding:6px;font-size:11px;width:100%"></div></div><div style="display:flex;flex-direction:column;gap:6px"><button class="btn ghost small" onclick="editJournal('${j.id}')">Edit</button><button class="btn ghost small" onclick="delJournal('${j.id}')">Delete</button></div></div>`).join('') || `<div style="padding:14px;border:1px dashed var(--line);text-align:center;color:var(--muted)">No journal — add story</div>`;
}
window.addJournal=()=>{
  openModal('Add Journal Story', `<label style="font-size:11px">Category</label><select id="jr_cat" class="input"><option>MUSIC</option><option>FILM</option><option>STYLE</option><option>TOUR</option><option>CREATIVE</option><option>BEHIND THE SCENES</option></select><label style="display:block;margin-top:8px;font-size:11px">Title</label><input id="jr_title" class="input" placeholder="Inside Checkpoint Rehearsal"><label style="display:block;margin-top:8px;font-size:11px">Date</label><input id="jr_date" class="input" placeholder="2026.09.14"><label style="display:block;margin-top:8px;font-size:11px">Excerpt</label><input id="jr_excerpt" class="input" placeholder="Soundcheck whispers..."><label style="display:block;margin-top:8px;font-size:11px">Image URL</label><input id="jr_img" class="input" placeholder="https://...">`, ()=>{
    const cat=$('#jr_cat').value, title=$('#jr_title').value.trim(), date=$('#jr_date').value.trim()||new Date().toLocaleDateString('ja-JP').replace(/\//g,'.'), excerpt=$('#jr_excerpt').value.trim(), img=$('#jr_img').value.trim()||'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?q=80&w=400&auto=format&fit=crop';
    if(!title) return toastAdmin('Title required');
    const data=load(K.journal,[]); data.push({id:'jrnl-'+Date.now(), cat, title, date, excerpt, img, status:'published'});
    save(K.journal,data); closeModal(); renderJournalAdmin(); toastAdmin('Journal added');
  });
};
window.editJournal=(id)=>{ const data=load(K.journal,[]); const j=data.find(x=>x.id===id); if(!j) return; openModal('Edit Journal', `<label style="font-size:11px">Title</label><input id="jr_title" class="input" value="${j.title.replace(/"/g,'&quot;')}"><label style="display:block;margin-top:8px;font-size:11px">Excerpt</label><input id="jr_excerpt" class="input" value="${j.excerpt.replace(/"/g,'&quot;')}">`, ()=>{ j.title=$('#jr_title').value.trim()||j.title; j.excerpt=$('#jr_excerpt').value.trim()||j.excerpt; save(K.journal,data); closeModal(); renderJournalAdmin(); toastAdmin('Journal updated'); }); };
window.delJournal=(id)=>{ openConfirm('Delete story?', ()=>{ let data=load(K.journal,[]); data=data.filter(x=>x.id!==id); save(K.journal,data); renderJournalAdmin(); toastAdmin('Journal deleted'); }); };

/* ARCHIVE */
function renderArchiveAdmin(){
  const el=document.getElementById('archiveAdmin'); if(!el) return;
  const data=load(K.archive,[]);
  el.innerHTML=data.map(a=>`<div style="border:1px solid var(--line);background:#fff;padding:12px;display:grid;grid-template-columns:80px 1fr auto;gap:12px"><img src="${a.img}" style="width:80px;height:80px;object-fit:cover"><div><b style="font-size:12px">${a.title}</b> — <span style="font-size:11px;color:var(--muted)">${a.decade} • ${a.year}</span><div style="font-size:11px;color:var(--muted)">${a.desc}</div></div><div style="display:flex;flex-direction:column;gap:6px"><button class="btn ghost small" onclick="editArchive('${a.id}')">Edit</button><button class="btn ghost small" onclick="delArchive('${a.id}')">Delete</button></div></div>`).join('') || `<div style="padding:14px;border:1px dashed var(--line);text-align:center">No archive</div>`;
}
window.addArchive=()=>{
  openModal('Add Archive Entry', `<label style="font-size:11px">Decade</label><select id="arc_decade" class="input"><option>1990s</option><option>2000s</option><option>2010s</option><option>2020s</option><option>FUTURE</option></select><label style="display:block;margin-top:8px;font-size:11px">Year</label><input id="arc_year" class="input" placeholder="2026"><label style="display:block;margin-top:8px;font-size:11px">Title</label><input id="arc_title" class="input" placeholder="CHECKPOINT"><label style="display:block;margin-top:8px;font-size:11px">Description</label><input id="arc_desc" class="input" placeholder="Checkpoint tour..."><label style="display:block;margin-top:8px;font-size:11px">Image URL</label><input id="arc_img" class="input" placeholder="https://...">`, ()=>{
    const decade=$('#arc_decade').value, year=$('#arc_year').value.trim(), title=$('#arc_title').value.trim(), desc=$('#arc_desc').value.trim(), img=$('#arc_img').value.trim()||'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?q=80&w=400&auto=format&fit=crop';
    if(!title) return toastAdmin('Title required');
    const data=load(K.archive,[]); data.push({id:'arc-'+Date.now(), decade, year, title, desc, img});
    save(K.archive,data); closeModal(); renderArchiveAdmin(); toastAdmin('Archive added');
  });
};
window.editArchive=(id)=>{ const data=load(K.archive,[]); const a=data.find(x=>x.id===id); if(!a) return; openModal('Edit Archive', `<label style="font-size:11px">Title</label><input id="arc_title" class="input" value="${a.title.replace(/"/g,'&quot;')}">`, ()=>{ a.title=$('#arc_title').value.trim()||a.title; save(K.archive,data); closeModal(); renderArchiveAdmin(); toastAdmin('Archive updated'); }); };
window.delArchive=(id)=>{ openConfirm('Delete entry?', ()=>{ let data=load(K.archive,[]); data=data.filter(x=>x.id!==id); save(K.archive,data); renderArchiveAdmin(); toastAdmin('Archive deleted'); }); };

/* FAN VOICES */
function renderFanVoices(){
  const el=document.getElementById('fanVoicesAdmin'); if(!el) return;
  const data=load(K.fanVoices,[]);
  el.innerHTML=data.map(f=>`<div style="border:1px solid var(--line);background:#fff;padding:12px;display:grid;grid-template-columns:1fr auto;gap:12px"><div><b style="font-size:12px">${f.name}</b> — <span style="font-size:11px;color:var(--muted)">${f.type} • ${new Date(f.ts).toLocaleString('ja-JP')}</span><div style="font-size:11.5px;margin-top:4px">${f.text}</div><div style="margin-top:6px;font-size:10px;border:1px solid ${f.status==='Approved'?'#c8ecd8':'var(--line)'};padding:4px 8px;display:inline-block;background:${f.status==='Approved'?'#eef8f1':'var(--pearl)'}">${f.status}</div></div><div style="display:flex;flex-direction:column;gap:6px"><button class="btn primary small" onclick="approveVoice(${f.id})">Approve → Publish</button><button class="btn ghost small" onclick="rejectVoice(${f.id})">Reject</button><button class="btn ghost small" onclick="delVoice(${f.id})">Delete</button></div></div>`).join('') || `<div style="padding:14px;border:1px dashed var(--line);text-align:center">No submissions — fans submit via My Kimura (future) or Support.</div>`;
}
window.approveVoice=(id)=>{ let data=load(K.fanVoices,[]); const f=data.find(x=>x.id===id); if(f){ f.status='Approved'; save(K.fanVoices,data); audit('UPDATE','Fan voice approved '+id); renderFanVoices(); toastAdmin('Approved → Published (never auto-published before)'); } };
window.rejectVoice=(id)=>{ let data=load(K.fanVoices,[]); const f=data.find(x=>x.id===id); if(f){ f.status='Rejected'; save(K.fanVoices,data); renderFanVoices(); toastAdmin('Rejected'); } };
window.delVoice=(id)=>{ openConfirm('Delete voice?', ()=>{ let data=load(K.fanVoices,[]); data=data.filter(x=>x.id!==id); save(K.fanVoices,data); renderFanVoices(); }); };

/* TOUR PASS */
function renderTourPassAdmin(){
  const pEl=document.getElementById('tourPassAdmin'); if(pEl){
    const orders=load(K.shopOrders,[]).slice(0,5);
    pEl.innerHTML=orders.length? orders.map(o=>`<div style="border:1px solid var(--line);background:#fff;padding:8px"><b style="font-size:11px">${o.id}</b> • ${o.qr.slice(0,16)}<br><span style="font-size:11px;color:var(--muted)">${o.email} • ${o.status}</span></div>`).join('') : `<div style="padding:10px;border:1px dashed var(--line);text-align:center;color:var(--muted)">No passes/orders</div>`;
  }
  const passEl=document.getElementById('passportAdmin'); if(passEl){
    const stamps=JSON.parse(localStorage.getItem('st_passport')||'[]');
    passEl.innerHTML=stamps.length? stamps.map(s=>`<div style="border:1px solid var(--line);background:#fff;padding:8px;display:flex;justify-content:space-between"><span><b style="font-size:11px">${s.name||s.title}</b></span><span style="font-size:11px;color:var(--muted)">${s.got?'STAMPED':'Locked'}</span></div>`).join('') : `<div style="padding:10px;border:1px dashed var(--line);text-align:center;color:var(--muted)">No stamps — generates on pass scan</div>`;
  }
}
window.addStamp=()=>{
  openModal('Add Stamp', `<label style="font-size:11px">Name</label><input id="st_name" class="input" placeholder="Anniversary"><label style="display:block;margin-top:8px;font-size:11px">Year</label><input id="st_year" class="input" placeholder="2026">`, ()=>{
    const name=$('#st_name').value.trim(), year=$('#st_year').value.trim();
    if(!name) return toastAdmin('Name required');
    let stamps=JSON.parse(localStorage.getItem('st_passport')||'[]'); stamps.push({name, year, got:true}); localStorage.setItem('st_passport', JSON.stringify(stamps)); closeModal(); renderTourPassAdmin(); toastAdmin('Stamp added');
  });
};

/* NOTIFICATIONS */
function renderNotificationsAdmin(){
  const el=document.getElementById('notificationsAdmin'); if(!el) return;
  const inbox=JSON.parse(localStorage.getItem('st_notifications')||'[]');
  if(!inbox.length) el.innerHTML=`<div style="padding:14px;border:1px dashed var(--line);background:var(--pearl);text-align:center;color:var(--muted)">No notifications — test via buttons above or triggers (tour, merch, support).</div>`;
  else el.innerHTML=inbox.slice(0,10).map(n=>`<div style="border:1px solid var(--line);background:#fff;padding:10px"><b style="font-size:11px;text-transform:uppercase;color:var(--gold)">${n.type}</b> • <span style="font-size:10px;color:var(--muted)">${new Date(n.ts).toLocaleString('ja-JP')}</span><div style="font-size:12px"><b>${n.title}</b><br>${n.body}</div></div>`).join('');
}
window.sendTestNotif=(type)=>{
  const map={tour:'Tour — new date added: Fukuoka TOTTEI PARK', music:'Music — new track preview in Vault', journal:'Journal — new story published', merchandise:'Merch — shop order update', support:'Support — ticket status changed'};
  const inbox=JSON.parse(localStorage.getItem('st_notifications')||'[]');
  inbox.unshift({id:Date.now(), type, title:'Test — '+type, body:map[type]||'Test notification', ts:Date.now(), read:false});
  localStorage.setItem('st_notifications', JSON.stringify(inbox)); renderNotificationsAdmin(); toastAdmin('Notification sent — '+type+' (In-App/Email/Push per prefs)');
};
window.clearNotifications=()=>{ localStorage.setItem('st_notifications', JSON.stringify([])); renderNotificationsAdmin(); toastAdmin('Inbox cleared'); };

/* CAMPAIGNS NOW */
window.saveNowCampaign=()=>{
  const type=$('#nowType').value, title=$('#nowTitle').value.trim(), desc=$('#nowDesc').value.trim();
  if(!title) return toastAdmin('Title required');
  const hero=load(K.hero,[]); if(hero.length){ hero[0].kicker=type+' • NOW'; hero[0].title=title; hero[0].sub=desc; save(K.hero, hero); }
  const concert=load(K.concert,{}); concert.title=title; concert.desc=desc; save(K.concert, concert);
  audit('UPDATE','NOW campaign → '+type+' : '+title);
  document.getElementById('nowPreview').innerHTML=`<b>${type}</b> — ${title}<br><span style="color:var(--muted)">${desc}</span><br><span style="font-size:10px;color:var(--gold)">Homepage hero + concert updated without redeploy</span>`;
  toastAdmin('NOW campaign saved — homepage updated');
};

/* ROLES */
const ROLES = {
  "Super Admin": {all:true},
  "Management": {dashboard:true, analytics:true, audit:true, news:true, schedule:true, concert:true, movie:true, release:true, hero:true, media:true, blog:true, fanclub:true, cm:true, social:true, announce:true, i18n:true, seo:true, settings:true, chat:true, quick:true, members:true, bookings:true, tiers:true, payments:true, shopProducts:true, shopOrders:true, shopInventory:true, journal:true, archive:true, fanVoices:true, tourPass:true, notifications:true, campaigns:true, users:true},
  "Editor": {news:true, schedule:true, movie:true, release:true, hero:true, blog:true, cm:true, journal:true, archive:true, media:true},
  "Tour Manager": {concert:true, tourPass:true, campaigns:true, schedule:true},
  "Membership Manager": {members:true, tiers:true, fanVoices:true, tourPass:true},
  "Support Agent": {chat:true, bookings:true, members:true, quick:true},
  "Shop Manager": {shopProducts:true, shopOrders:true, shopInventory:true, media:true},
  "Moderator": {fanVoices:true, blog:true, chat:true, members:true},
  "Analyst": {dashboard:true, analytics:true, audit:true},
  "Developer": {all:true}
};
window._currentRole = localStorage.getItem('st_admin_role') || 'Super Admin';
function applyRole(role){
  window._currentRole=role; localStorage.setItem('st_admin_role', role);
  const perms=ROLES[role]||ROLES["Super Admin"];
  const allow = (sec)=> perms.all || perms[sec];
  document.querySelectorAll('[data-section]').forEach(btn=>{
    const sec=btn.dataset.section;
    const show = allow(sec);
    btn.style.display = show ? '' : 'none';
    btn.style.opacity = show ? '1' : '.4';
  });
  // also hide sections
  document.querySelectorAll('.section').forEach(sec=>{
    const id=sec.id.replace('sec-','');
    if(!allow(id)) sec.style.display='none';
  });
  const sel=document.getElementById('roleSelect'); if(sel) sel.value=role;
  toastAdmin('Role: '+role+' — permissions applied (audit logged)');
  audit('ROLE_SWITCH','Switched to '+role);
}
window.addEventListener('DOMContentLoaded', ()=>{
  const headerActions = document.querySelector('.topbar') || document.querySelector('header');
  // inject role selector if not exists
  if(!document.getElementById('roleSelect')){
    const bar=document.createElement('div');
    bar.style.cssText='position:fixed;top:10px;right:14px;z-index:999;background:#0f0e0c;color:var(--gold);border:1px solid #222;padding:6px 8px;display:flex;gap:6px;align-items:center;font-size:11px';
    bar.innerHTML=`<span style="letter-spacing:.1em">KIMURA ADMIN</span><select id="roleSelect" style="background:#111;color:#fff;border:1px solid #333;padding:6px;font-size:11px">${Object.keys(ROLES).map(r=>`<option ${r===window._currentRole?'selected':''}>${r}</option>`).join('')}</select>`;
    document.body.appendChild(bar);
    document.getElementById('roleSelect').addEventListener('change', e=>applyRole(e.target.value));
    setTimeout(()=>applyRole(window._currentRole), 400);
  }
});

// Extend renderAll
