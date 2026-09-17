import pathlib, re

head = pathlib.Path("/tmp/head.html").read_text(encoding="utf-8")
topbar = pathlib.Path("/tmp/topbar_header.html").read_text(encoding="utf-8")
footer = pathlib.Path("/tmp/footer.html").read_text(encoding="utf-8")
after = pathlib.Path("/tmp/after_footer.html").read_text(encoding="utf-8")

# head contains css link already, but we need to ensure fonts etc
# after contains scripts including ensureSeeds etc; for subpages we need to keep same after but adjust relative img paths?
# For subpages, image-search paths are relative; need to make absolute /image-search/... or ../?
# Use absolute /image-search/... to work from any depth? Currently index uses image-search/... relative to public. For subpages at /work/, relative would be /work/image-search which doesn't exist. So we need to make them absolute: replace image-search/ with /image-search/
def fix_imgs(html):
    return html.replace('src="image-search/', 'src="/image-search/').replace("src='image-search/", "src='/image-search/")

after = fix_imgs(after)
# also fix head css link already absolute

def make_page(path, title, desc, hero, body, extra_js=""):
    h = head
    h = re.sub(r'<title>.*?</title>', f'<title>{title} | STARTO ENTERTAINMENT</title>', h, count=1)
    h = re.sub(r'<meta name="title" content=".*?">', f'<meta name="title" content="{title} | STARTO ENTERTAINMENT">', h, count=1)
    h = re.sub(r'<meta name="description" content=".*?">', f'<meta name="description" content="{desc}">', h, count=1)
    if '<meta property="og:title"' in h:
        h = re.sub(r'<meta property="og:title" content=".*?">', f'<meta property="og:title" content="{title} | STARTO ENTERTAINMENT">', h, count=1)
        h = re.sub(r'<meta property="og:description" content=".*?">', f'<meta property="og:description" content="{desc}">', h, count=1)
    # nav active
    for href in ["/", "/work/", "/music/", "/tour/", "/journal/", "/archive/", "/members/", "/shop/", "/search/", "/support/"]:
        h = h.replace(f'<a href="{href}" class="active"', f'<a href="{href}"')
    # add active for current
    if path != "/shop/verify.html":
        href = path if path.endswith("/") else "/" + path.split("/")[1] + "/"
        if href in ["/work/","/music/","/tour/","/journal/","/archive/","/members/","/shop/","/search/","/support/"]:
            h = h.replace(f'<a href="{href}"', f'<a href="{href}" class="active"')
        elif path=="/":
            h = h.replace('<a href="/"', '<a href="/" class="active"')
    # For verify, keep shop active
    if path=="/shop/verify.html":
        h = h.replace('<a href="/shop/"', '<a href="/shop/" class="active"')
    tb = topbar
    # fix img paths in hero/body
    hero = fix_imgs(hero)
    body = fix_imgs(body)
    # assemble
    html = h + "\n<body>\n" + after.split("<body>")[0].split("</head>")[-1] if False else "" # placeholder
    # Actually head already includes <head>...</head> and after includes body start? Let's reconstruct more simply:
    # head already is <!DOCTYPE html>... </head>. We need to add <body> + topbar + hero+body + footer + after
    # after currently starts with something like \n\n<div id="loader">... and includes entire body scripts.
    # But topbar is already separate, and after includes loader+pageTrans etc duplicated? Let's check.
    # Simpler: construct from scratch using head + <body> + topbar + hero + body + footer + after
    # after contains everything after footer, which includes modals, chat, toast, scripts. We need to extract body start part from after?
    # after currently after footer extraction is everything after </footer> which includes modals etc plus scripts.
    # But topbar+header+marquee should come before hero. So we have head + <body> + topbar + hero+body + footer + after
    # However head already ends with </head>, we need to open <body>
    # topbar already includes pageTrans? Actually pageTrans is before topbar in after? Let's see structure:
    # Original index after </head> is <body> then <div id="pageTrans"> then <div id="loader"> then <div class="topbar">...
    # Our topbar extraction started at <div class="topbar">, so it missed pageTrans and loader. Those are in after's beginning section before topbar.
    # So we need to include pageTrans+loader which are in after's prefix before topbar. Let's extract them from original file.
    # Simpler: read original index and extract <body> start to topbar start
    orig = pathlib.Path("/home/user/public/index.html").read_text(encoding="utf-8")
    body_start = orig[orig.find("<body>"):orig.find('<div class="topbar">')]
    # body_start includes <body> + pageTrans + loader
    html = h + "\n" + body_start + "\n" + tb + "\n" + hero + "\n" + body + "\n" + footer + "\n" + after
    if extra_js:
        html = html.replace("</body>", f"<script>{extra_js}</script>\n</body>")
    # fix duplicate <body> if any? head ends with </head>, body_start starts with <body>, good
    # write
    out = pathlib.Path(f"/home/user/public{path}") if path.endswith(".html") else pathlib.Path(f"/home/user/public{path}index.html")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out} {len(html)}")

# Hero helper
def hero(kicker, main, sub, img, fallback, extra=""):
    return f'''
<div class="hero-wrap" id="top">
  <div class="hero" id="hero" style="height:66vh;min-height:500px">
    <div class="hero-slides"><div class="hero-slide active"><img src="{img}" alt="" onerror="this.src='{fallback}'"><div class="hero-overlay"></div></div></div>
    <div class="hero-content" style="left:46px;right:46px;bottom:46px">
      <div><div class="hero-kicker"><i></i> {kicker}</div><h1 style="font-family:Cormorant Garamond,serif;font-weight:300;font-size:44px;line-height:.92">{main}</h1><p style="margin-top:12px;max-width:520px;font-size:12.5px;opacity:.9">{sub}</p>{extra}</div>
      <div class="hero-side"><div class="hero-side-card" style="min-width:260px"><small>KIMURA // TRANSITION</small><b>KIMURA // 01 → KIMURA // 02</b><div>Living digital world — masks, parallax, depth</div></div></div>
    </div>
  </div>
</div>
'''

# WORK
make_page("/work/", "Work — Visual Archive", "Film, TV, drama, special projects — verified archive, each with credits, artwork, trailer.",
hero("WORK • FILM • TV", "WORK<br><em>Visual Archive</em>", "Film • TV • Drama • Special — verified credits, artwork, trailer, photography.", "/image-search/takuya-kimura-live-tour-checkpoint-2026--5.webp", "https://images.unsplash.com/photo-1485846234645-a62644f84728?q=80&w=1600&auto=format&fit=crop"),
'''
<section class="section" style="padding-top:18px"><div style="display:flex;gap:8px;flex-wrap:wrap;border:1px solid var(--line);background:var(--paper);padding:12px"><span style="font-size:10px;letter-spacing:.14em">FILTER</span><button class="btn ghost small" onclick="filterWork('all')">All</button><button class="btn ghost small" onclick="filterWork('MOVIE')">Film</button><button class="btn ghost small" onclick="filterWork('DRAMA')">Drama</button><button class="btn ghost small" onclick="filterWork('STAGE')">Stage</button><span style="margin-left:auto;font-size:11px;color:var(--muted)">Admin → Work CMS • No fake data</span></div></section>
<section class="section reveal" style="padding-top:24px"><div class="section-head"><div><h2><span style="display:inline-grid;place-items:center;width:26px;height:26px;border:1px solid var(--line);background:var(--paper);margin-right:8px;font-size:11px">🎬</span>Selected Works</h2><p>Title • Year • Role • Credits • Artwork • Trailer • Photography</p></div></div><div class="regular-grid" id="workGrid"></div><div id="workDetail" style="margin-top:18px;border:1px solid var(--line);background:#fff;padding:18px;display:none"></div></section>
''',
'''
function filterWork(cat){
  const data=load(K.movie,[]);
  const q=cat==='all'?data:data.filter(x=>x.cat===cat);
  const el=document.getElementById('workGrid');
  if(!q.length) el.innerHTML=`<div style="grid-column:1/-1;padding:28px;text-align:center;border:1px dashed var(--line);background:var(--pearl)">No works — Admin publishes verified entries.</div>`;
  else el.innerHTML=q.map(m=>`<div class="regular-card" style="cursor:pointer" onclick="openWork('${m.id}')"><img src="${m.img}"><div class="body"><small>${m.cat} • ${m.date}</small><h4>${m.title}</h4><p style="font-size:11.5px;color:var(--muted)">${m.desc}</p></div></div>`).join('');
}
function openWork(id){
  const d=load(K.movie,[]).find(x=>String(x.id)===String(id));
  const p=document.getElementById('workDetail');
  if(!d) return;
  p.style.display='block';
  p.innerHTML=`<div style="display:grid;grid-template-columns:1.1fr .9fr;gap:18px"><img src="${d.img}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border:1px solid var(--line)"><div><small>${d.cat} • ${d.date}</small><h3 style="font-family:Cormorant Garamond,serif;font-size:24px">${d.title}</h3><p style="font-size:12.5px;color:#4a4a4a">${d.desc}</p><div style="margin-top:12px;font-size:11px;color:var(--muted)"><b>Role:</b> Lead • <b>Credits:</b> STARTO Verified</div><div style="margin-top:12px;display:flex;gap:8px"><button class="btn primary small" onclick="toast('Trailer — licensed')">Play Trailer</button><button class="btn ghost small" onclick="document.getElementById('workDetail').style.display='none'">Close</button></div></div></div>`;
  p.scrollIntoView({behavior:'smooth'});
}
filterWork('all');
'''
)

# MUSIC
make_page("/music/", "Music — Checkpoint", "Albums, singles, tracks, videos, artwork, credits, streaming, behind-the-scenes — licensed player.",
hero("MUSIC • CHECKPOINT", "MUSIC<br><em>Checkpoint Campaign</em>", "Albums • Singles • Tracks • Videos • Artwork • Credits • Streaming • Behind-the-scenes.", "/image-search/takuya-kimura-starto-entertainment-offic-4.png", "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?q=80&w=1600&auto=format&fit=crop", '<div style="margin-top:14px;display:flex;gap:8px"><button class="btn primary" onclick="document.getElementById(\'player\').scrollIntoView({behavior:\'smooth\'})">Player →</button><a class="btn ghost" href="#discography" style="background:rgba(255,255,255,.9)">Discography →</a></div>'),
'''
<section class="section" id="player" style="padding-top:18px"><div style="border:1px solid var(--line);background:#0f0e0c;color:#fff;padding:18px;display:grid;grid-template-columns:1.1fr .9fr;gap:18px"><div><small style="letter-spacing:.14em;color:var(--gold)">NOW PLAYING • LICENSED</small><h3 style="font-family:Cormorant Garamond,serif;font-weight:400;font-size:26px;margin:6px 0">CHECKPOINT — Player</h3><div style="border:1px solid #222;background:#111;padding:14px;display:flex;gap:14px"><img id="playerImg" src="/image-search/takuya-kimura-starto-entertainment-offic-4.png" style="width:84px;height:84px;object-fit:cover"><div><b id="playerTitle">CHECKPOINT — Track 01</b><br><span style="font-size:11px;color:#9a9a9a">Takuya Kimura • 2026.08.12</span><div style="margin-top:8px;display:flex;gap:6px"><button class="btn gold small" onclick="playerPlay()">▶ Play Preview</button><button class="btn ghost small" style="background:#111;color:#fff;border-color:#222" onclick="toast('Streaming via CMS links')">Links →</button></div></div></div><div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap" id="playerList"></div></div><div style="border:1px solid #222;background:#111;padding:14px"><b style="font-size:11px">CREDITS • ARTWORK</b><div style="margin-top:10px;font-size:11.5px;color:#d8d5d0;line-height:1.7"><div>Artwork — STARTO Verified</div><div>Credits — Lyrics / Compose via CMS</div><a href="/journal/" style="margin-top:10px;display:inline-block;border:1px solid var(--gold);color:var(--gold);padding:8px 12px">Journal → Track by Track</a></div><div id="playerGallery" style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px"></div></div></div></section>
<section class="section reveal" id="discography"><div class="section-head"><div><h2><span style="display:inline-grid;place-items:center;width:26px;height:26px;border:1px solid var(--line);background:var(--paper);margin-right:8px;font-size:11px">💿</span>Discography</h2><p>Albums • Singles — CMS</p></div></div><div class="release-grid" id="musicReleases"></div></section>
''',
'''
function renderMusic(){
  const data=load(K.release,[]);
  const grid=document.getElementById('musicReleases');
  if(!data.length) grid.innerHTML=`<div style="grid-column:1/-1;padding:28px;text-align:center;border:1px dashed var(--line)">No releases</div>`;
  else grid.innerHTML=data.map(r=>`<div class="release-card" style="cursor:pointer" onclick="selectTrack('${r.id}')"><img src="${r.img}"><div class="body"><small>${r.cat}</small><h4>${r.title}</h4><time style="font-family:JetBrains Mono,monospace;font-size:11px;color:var(--muted)">${r.date} • ${r.artist}</time></div></div>`).join('');
  document.getElementById('playerList').innerHTML=data.slice(0,4).map((r,i)=>`<button class="btn ghost small" onclick="selectTrack('${r.id}')">${i+1}. ${r.title}</button>`).join('');
  document.getElementById('playerGallery').innerHTML=data.slice(0,3).map(r=>`<img src="${r.img}" style="width:100%;aspect-ratio:1/1;object-fit:cover;border:1px solid #222">`).join('');
}
function selectTrack(id){ const r=load(K.release,[]).find(x=>String(x.id)===String(id)); if(!r) return; document.getElementById('playerTitle').textContent=r.title+' — '+r.artist; document.getElementById('playerImg').src=r.img; toast('Selected: '+r.title); }
function playerPlay(){ toast('Preview — 30s licensed (simulated)'); }
renderMusic();
'''
)

# TOUR
make_page("/tour/", "Tour Center — Checkpoint", "Tour Center — campaigns, dates, venues, ticket links, galleries, merchandise, FAQs, map, digital pass.",
hero("TOUR • CHECKPOINT 2026", "TOUR CENTER<br><em>Checkpoint 2026</em>", "Sep 5 – Nov 23 • Fukuoka • Seoul • Taipei • Nationwide • CMS-driven", "/image-search/takuya-kimura-live-tour-checkpoint-2026--1.gif", "https://starto.jp/images/81/b0b/9c913dfa75c509b98471e87038ed3/800_800_102400.png", '<div style="margin-top:14px;display:flex;gap:8px"><a class="btn primary" href="#dates">Dates →</a><a class="btn ghost" href="#pass" style="background:rgba(255,255,255,.9)">Digital Pass →</a></div>'),
'''
<section class="section" style="padding-top:18px"><div style="border:1px solid var(--line);background:var(--paper);padding:14px;display:grid;grid-template-columns:1.1fr .9fr;gap:18px"><div style="border:1px solid var(--line);background:#fff;padding:14px"><b style="font-size:11px">INTERACTIVE MAP • 6 CITIES</b><div style="margin-top:12px;aspect-ratio:16/9;background:linear-gradient(135deg,#0f0e0c 0%,#1a1206 50%,#0f0e0c 100%);border:1px solid #222;display:grid;place-items:center;color:var(--gold)"><svg viewBox="0 0 400 220" style="width:90%"><g fill="none" stroke="#c9a86a"><path d="M80 100 L120 80 L180 90 L220 60 L280 80 L320 110"/><circle cx="80" cy="100" r="6" fill="#c9a86a"/><circle cx="180" cy="90" r="6" fill="#fff"/><circle cx="280" cy="80" r="6" fill="#c9a86a"/><circle cx="320" cy="110" r="8" fill="#c9a86a"/></g><text x="80" y="118" font-size="8" fill="#fff" text-anchor="middle">FUKUOKA</text><text x="180" y="105" font-size="8" fill="#fff" text-anchor="middle">TOKYO</text><text x="280" y="96" font-size="8" fill="#fff" text-anchor="middle">SEOUL</text><text x="320" y="130" font-size="8" fill="#fff" text-anchor="middle">TAIPEI</text></svg></div></div><div style="border:1px solid var(--line);background:#fff;padding:14px"><b style="font-size:11px">CAMPAIGN • GALLERY</b><div id="tourGallery" style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px"></div><a href="/shop/" style="margin-top:10px;display:inline-block;background:var(--gold);color:#fff;padding:8px 12px">Shop Merch →</a></div></div></section>
<section class="section reveal" id="dates"><div class="section-head"><div><h2><span style="display:inline-grid;place-items:center;width:26px;height:26px;border:1px solid var(--line);background:var(--paper);margin-right:8px;font-size:11px">📅</span>Dates</h2><p>Campaign dates • venues • ticket links • FAQs</p></div></div><div style="display:grid;grid-template-columns:1.1fr .9fr;gap:18px"><div id="tourDates" style="display:grid;gap:10px"></div><div style="border:1px solid var(--line);background:var(--paper);padding:16px"><b style="font-size:11px">FAQ</b><div id="tourFaq" style="margin-top:10px;display:grid;gap:8px;font-size:11.5px"></div><div style="margin-top:14px;border:1px solid #222;background:#0f0e0c;color:#fff;padding:12px"><b style="color:var(--gold)">MERCH QR</b><div style="font-size:11px;color:#9a9a9a">Show QR → SCAN → VERIFY → COLLECT</div><a href="/shop/" style="margin-top:8px;display:inline-block;background:var(--gold);color:#fff;padding:8px 12px">Shop →</a></div></div></div></section>
<section class="section reveal" id="pass"><div style="border:1px solid var(--line);background:#0f0e0c;color:#fff;padding:18px;display:grid;grid-template-columns:1fr 1fr;gap:18px"><div style="border:1px solid #222;background:#111;padding:16px"><small style="color:var(--gold)">DIGITAL TOUR PASS • QR</small><h3 style="font-family:Cormorant Garamond,serif;font-size:22px;margin:6px 0">Your Tour Pass</h3><div style="border:1px solid #222;background:#0a0a0a;padding:12px;display:flex;gap:12px"><div id="passQR" style="width:110px;height:110px;background:#fff;display:grid;place-items:center;border:1px solid #222"></div><div><b id="passName">Guest</b><br><span id="passEvent" style="font-size:11px;color:#9a9a9a">Checkpoint — Fukuoka</span><br><span id="passStatus" style="font-size:11px;color:var(--gold)">Pending</span></div></div><div style="margin-top:10px;display:flex;gap:8px"><button class="btn gold small" onclick="generateTourPass()">Generate Pass</button><button class="btn ghost small" style="background:#111;color:#fff;border-color:#222" onclick="verifyTourPass()">Verify</button></div></div><div style="border:1px solid #222;background:#111;padding:16px"><small style="color:var(--gold)">PASSPORT • STAMPS</small><h3 style="font-family:Cormorant Garamond,serif;font-size:22px;margin:6px 0">Collect Stamps</h3><div id="passportStamps" style="margin-top:12px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px"></div></div></div></section>
''',
'''
function renderTourPage(){
  const t=load(K.concert,{});
  document.getElementById('tourGallery').innerHTML=[t.img, t.fallback, '/image-search/takuya-kimura-live-tour-checkpoint-2026--2.jpg','/image-search/takuya-kimura-starto-entertainment-offic-1.png'].map(src=>`<img src="${src}" style="width:100%;aspect-ratio:4/3;object-fit:cover;border:1px solid var(--line)" onerror="this.style.display='none'">`).join('');
  const dates=[{city:'Fukuoka', date:'2026.09.10', venue:'TOTTEI PARK', ticket:'FC lottery', status:'On Sale'},{city:'Tokyo', date:'2026.09.20', venue:'Arena', ticket:'General', status:'Upcoming'},{city:'Seoul', date:'2026.10.18', venue:'Private', ticket:'Gold+ Diamond', status:'Lottery'},{city:'Taipei', date:'2026.11.13', venue:'Birthday', ticket:'Diamond', status:'Lottery'}];
  document.getElementById('tourDates').innerHTML=dates.map(d=>`<div style="border:1px solid var(--line);background:#fff;padding:12px;display:flex;gap:12px"><div style="width:42px;height:42px;background:#0f0e0c;color:var(--gold);display:grid;place-items:center">${d.city.slice(0,2).toUpperCase()}</div><div><b>${d.city} — ${d.date}</b><br><span style="font-size:11px;color:var(--muted)">${d.venue} • ${d.ticket}</span></div><span style="margin-left:auto;border:1px solid #0f0e0c;padding:6px 8px;font-size:10px">${d.status}</span></div>`).join('');
  document.getElementById('tourFaq').innerHTML=['Q: Tickets? — FC lottery + general via CMS','Q: Pass? — Generate below, QR verification','Q: Future tours? — Dynamic without redeploy'].map(s=>`<div style="border:1px solid var(--line);background:#fff;padding:10px">${s}</div>`).join('');
  const stamps=[{name:'Fukuoka',icon:'✓',date:'2026.09.10',got:false},{name:'Seoul',icon:'✈',date:'2026.10.18',got:false},{name:'Birthday',icon:'🎂',date:'2026.11.13',got:false},{name:'Checkpoint',icon:'◆',date:'2026.11.23',got:false},{name:'Anniv',icon:'★',date:'2026.09.15',got:true}];
  const saved=JSON.parse(localStorage.getItem('st_passport')||'[]');
  document.getElementById('passportStamps').innerHTML=stamps.map(s=>{const f=saved.find(x=>x.name===s.name); const got=f?f.got:s.got; return `<div style="border:1px solid ${got?'var(--gold)':'var(--line)'};background:${got?'#0f0e0c':'#fff'};color:${got?'var(--gold)':'#0a0a0a'};padding:12px;text-align:center"><div>${s.icon}</div><b style="font-size:11px">${s.name}</b><div style="font-size:10px">${s.date}</div><div style="font-size:9px">${got?'STAMPED':'Locked'}</div></div>`}).join('');
}
function generateTourPass(){
  const cur=JSON.parse(localStorage.getItem('st_member_current')||'null'); const name=cur?cur.name:'Guest';
  document.getElementById('passName').textContent=name;
  const qr='PASS-'+(cur?cur.id:'guest')+'-FUKUOKA-'+Date.now();
  generateQR(qr, document.getElementById('passQR'));
  document.getElementById('passStatus').textContent='Ready — QR (no sensitive data)';
  let stamps=JSON.parse(localStorage.getItem('st_passport')||'[]'); if(!stamps.find(x=>x.name==='Fukuoka')) stamps.push({name:'Fukuoka',got:true}); localStorage.setItem('st_passport', JSON.stringify(stamps)); toast('Pass generated');
}
function verifyTourPass(){ toast('Scan → VERIFY → Verified (simulated)'); document.getElementById('passStatus').textContent='Verified ✓'; }
renderTourPage();
'''
)

# JOURNAL
make_page("/journal/", "Journal — Editorial", "Music / Film / Style / Tour / Creative / Behind the Scenes — editorial.",
hero("JOURNAL • EDITORIAL", "KIMURA JOURNAL<br><em>Music / Film / Style</em>", "Photography • Video • Audio • Galleries • Related", "/image-search/takuya-kimura-live-tour-checkpoint-2026--3.jpg", "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=1600&auto=format&fit=crop"),
'''
<section class="section" style="padding-top:18px"><div style="display:flex;gap:8px;border:1px solid var(--line);background:var(--paper);padding:12px"><button class="btn ghost small" onclick="filterJournal('all')">All</button><button class="btn ghost small" onclick="filterJournal('MUSIC')">Music</button><button class="btn ghost small" onclick="filterJournal('FILM')">Film</button><button class="btn ghost small" onclick="filterJournal('STYLE')">Style</button><button class="btn ghost small" onclick="filterJournal('TOUR')">Tour</button></div></section>
<section class="section reveal" style="padding-top:18px"><div class="section-head"><div><h2><span style="display:inline-grid;place-items:center;width:26px;height:26px;border:1px solid var(--line);background:var(--paper);margin-right:8px;font-size:11px">📖</span>Latest Stories</h2><p>Photography, video, audio, galleries</p></div></div><div id="journalGrid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px"></div><div id="journalDetail" style="margin-top:18px;border:1px solid var(--line);background:#fff;padding:18px;display:none"></div></section>
''',
'''
function filterJournal(cat){
  let data=load('st_journal',[]);
  const q=cat==='all'?data:data.filter(x=>x.cat===cat);
  const el=document.getElementById('journalGrid');
  if(!q.length) el.innerHTML=`<div style="grid-column:1/-1;padding:28px;text-align:center;border:1px dashed var(--line)">No journal — Admin adds via Journal CMS</div>`;
  else el.innerHTML=q.map(j=>`<div style="border:1px solid var(--line);background:var(--paper);overflow:hidden;cursor:pointer" onclick="openJournal('${j.id}')"><img src="${j.img}" style="width:100%;aspect-ratio:16/9;object-fit:cover"><div style="padding:14px"><small>${j.cat} • ${j.date}</small><h3 style="font-family:Cormorant Garamond,serif">${j.title}</h3><p style="font-size:12px;color:var(--muted)">${j.excerpt}</p></div></div>`).join('');
}
function openJournal(id){
  const j=load('st_journal',[]).find(x=>x.id===id); if(!j) return;
  const d=document.getElementById('journalDetail'); d.style.display='block';
  d.innerHTML=`<div style="display:grid;grid-template-columns:1.1fr .9fr;gap:18px"><img src="${j.img}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border:1px solid var(--line)"><div><small>${j.cat} • ${j.date}</small><h3 style="font-family:Cormorant Garamond,serif;font-size:24px">${j.title}</h3><p style="font-size:12.5px;color:#4a4a4a">${j.excerpt}</p><div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px"><div style="border:1px solid var(--line);padding:10px;background:var(--pearl)">🎥 Video</div><div style="border:1px solid var(--line);padding:10px;background:var(--pearl)">🎵 Audio</div><div style="border:1px solid var(--line);padding:10px;background:var(--pearl)">🖼 Gallery</div><div style="border:1px solid var(--line);padding:10px;background:var(--pearl)">🔗 Related</div></div></div></div>`;
}
filterJournal('all');
'''
)

# ARCHIVE
make_page("/archive/", "Archive — 1990 → Future", "Career archive 1990s → Future — verified works, music, photography, interviews, milestones.",
hero("ARCHIVE • 1990 → FUTURE", "ARCHIVE<br><em>1990 → Future</em>", "Works • Music • Photography • Interviews • Events • Milestones", "/image-search/takuya-kimura-starto-entertainment-offic-1.png", "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?q=80&w=1600&auto=format&fit=crop"),
'''
<section class="section" style="padding-top:18px"><div style="display:flex;gap:8px;overflow:auto"><button class="btn ghost small" onclick="filterArchive('all')">All</button><button class="btn ghost small" onclick="filterArchive('1990s')">1990s</button><button class="btn ghost small" onclick="filterArchive('2000s')">2000s</button><button class="btn ghost small" onclick="filterArchive('2010s')">2010s</button><button class="btn ghost small" onclick="filterArchive('2020s')">2020s</button><button class="btn ghost small" onclick="filterArchive('FUTURE')">FUTURE</button></div><div class="horizontal-gallery" id="archiveGallery" style="margin-top:12px"></div></section>
<section class="section reveal"><div id="archiveTimeline" style="border-left:1px solid var(--line);margin-left:12px;padding-left:18px;display:grid;gap:14px"></div></section>
''',
'''
function filterArchive(decade){
  const data=load('st_archive',[]);
  const q=decade==='all'?data:data.filter(x=>x.decade===decade);
  document.getElementById('archiveGallery').innerHTML=q.length? q.map(a=>`<div style="border:1px solid var(--line);background:var(--paper);min-width:340px"><img src="${a.img}" style="width:100%;aspect-ratio:16/9;object-fit:cover"><div style="padding:14px"><small>${a.decade} • ${a.year}</small><h4>${a.title}</h4><p style="font-size:11.5px;color:var(--muted)">${a.desc}</p></div></div>`).join('') : `<div style="padding:28px;border:1px dashed var(--line)">No archive — Admin adds via Archive CMS</div>`;
  document.getElementById('archiveTimeline').innerHTML=q.map(a=>`<div style="position:relative;border:1px solid var(--line);background:#fff;padding:14px"><div style="position:absolute;left:-23px;top:14px;width:10px;height:10px;background:var(--gold);border:2px solid #fff"></div><small>${a.year} • ${a.decade}</small><h4>${a.title}</h4><p style="font-size:11.5px;color:var(--muted)">${a.desc}</p></div>`).join('');
}
filterArchive('all');
'''
)

# MEMBERS
make_page("/members/", "My Kimura — Members", "My Card • Passport • Events • Exclusive • Content • Orders • Notifications • Support • Account — Digital Fan Card.",
hero("MEMBERS • MY KIMURA", "MY KIMURA<br><em>Members</em>", "My Card • Passport • Events • Exclusive • Content • Orders • Notifications • Support • Account", "/image-search/takuya-kimura-starto-entertainment-offic-2.png", "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=1600&auto=format&fit=crop", '<div style="margin-top:14px;display:flex;gap:8px"><button class="btn primary" onclick="openMember(\'dashboard\')">Dashboard →</button><a class="btn ghost" href="/shop/" style="background:rgba(255,255,255,.9)">Shop →</a></div>'),
'''
<section class="section" style="padding-top:18px"><div style="display:flex;gap:8px;flex-wrap:wrap;border:1px solid var(--line);background:var(--paper);padding:10px"><button class="btn primary small" onclick="showMy('card')">My Card</button><button class="btn ghost small" onclick="showMy('passport')">Passport</button><button class="btn ghost small" onclick="showMy('orders')">My Orders</button><button class="btn ghost small" onclick="showMy('notifications')">Notifications <span id="notifBadge" style="background:#ff2e2e;color:#fff;font-size:9px;padding:2px 6px;display:none">0</span></button><button class="btn ghost small" onclick="showMy('account')">Account</button><button class="btn ghost small" onclick="showMy('exclusive')">Exclusive</button></div></section>
<section class="section reveal" id="my-card" style="padding-top:18px"><div style="display:grid;grid-template-columns:1.1fr .9fr;gap:18px"><div id="myCardDisplay"></div><div style="border:1px solid var(--line);background:#fff;padding:16px"><h3 style="font-family:Cormorant Garamond,serif;font-size:22px">Digital Fan Card</h3><p style="font-size:11.5px;color:var(--muted)">Branding • Member # • Status • Join/Renewal • QR • Badges • metallic grain</p><div id="myCardQr" style="margin-top:12px;width:140px;height:140px;background:#fff;border:1px solid var(--line);display:grid;place-items:center"></div><div style="margin-top:10px;display:flex;gap:8px"><button class="btn gold small" onclick="toast('Download simulated')">Download</button><button class="btn ghost small" onclick="showMy('passport')">Passport →</button></div></div></div></section>
<section class="section reveal" id="my-passport" style="display:none"><div style="border:1px solid var(--line);background:var(--paper);padding:16px"><h3>Passport • Stamps</h3><div id="myPassportGrid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:12px"></div></div></section>
<section class="section reveal" id="my-orders" style="display:none"><div class="section-head"><div><h2>My Orders</h2><p>Shop orders • QR → venue</p></div></div><div id="myOrdersList" style="display:grid;gap:10px"></div></section>
<section class="section reveal" id="my-notifications" style="display:none"><div style="display:grid;grid-template-columns:.9fr 1.1fr;gap:18px"><div style="border:1px solid var(--line);background:#fff;padding:16px"><h3>Preferences</h3><div id="notifPrefs" style="margin-top:12px;display:grid;gap:10px"></div><button class="btn primary small" style="margin-top:12px" onclick="saveNotifPrefs()">Save →</button></div><div style="border:1px solid var(--line);background:var(--paper);padding:16px"><h3>Inbox <span id="inboxCount" style="font-size:11px;color:var(--muted)"></span></h3><div id="notifInbox" style="margin-top:12px;display:grid;gap:8px;max-height:420px;overflow:auto"></div><button class="btn ghost small" style="margin-top:10px" onclick="Notifications.markAll();renderMyNotif()">Mark all read</button></div></div></section>
<section class="section reveal" id="my-account" style="display:none"><div style="border:1px solid var(--line);background:#fff;padding:16px;max-width:520px"><h3>Account</h3><div id="myAccountInfo" style="margin-top:12px"></div></div></section>
<section class="section reveal" id="my-exclusive" style="display:none"><div class="section-head"><div><h2>Exclusive</h2><p>Members-only — backend permission</p></div></div><div id="exclusiveGrid" class="vault" style="margin-top:12px"></div></section>
''',
'''
function showMy(tab){
  document.querySelectorAll('#my-card, #my-passport, #my-orders, #my-notifications, #my-account, #my-exclusive').forEach(el=>el.style.display='none');
  const map={card:'my-card', passport:'my-passport', orders:'my-orders', notifications:'my-notifications', account:'my-account', exclusive:'my-exclusive'};
  const id=map[tab]||'my-card';
  document.getElementById(id).style.display='block';
  if(tab==='card') renderMyCard();
  if(tab==='passport') renderMyPassport();
  if(tab==='orders') renderMyOrders();
  if(tab==='notifications') renderMyNotif();
  if(tab==='account') renderMyAccount();
  if(tab==='exclusive') renderMyExclusive();
}
function renderMyCard(){
  const cur=JSON.parse(localStorage.getItem('st_member_current')||'null');
  const el=document.getElementById('myCardDisplay');
  if(!cur){ el.innerHTML=`<div style="border:1px dashed var(--line);background:var(--pearl);padding:28px;text-align:center">Please <a href="#" onclick="openMember('signup');return false" style="text-decoration:underline">sign up / login</a></div>`; return; }
  const tier = cur.tier && cur.tier!=='none'? cur.tier:'silver';
  el.innerHTML=`<div class="fan-card tier-${tier}"><div class="fan-card-top"><b>STARTO • FAN CARD</b><div class="chip"></div></div><h4>${cur.name.toUpperCase()}</h4><div class="num">${cur.cardNo} • ${tier.toUpperCase()}</div><div style="margin-top:6px;font-size:10px;color:var(--gold2)">MEMBER SINCE ${new Date(cur.created).toLocaleDateString('ja-JP')}</div><div class="holder"><div><b>${cur.name}</b><br><span>${tier}</span></div><span>木村拓哉</span></div></div>`;
  generateQR('CARD-'+cur.cardNo, document.getElementById('myCardQr'));
}
function renderMyPassport(){
  const saved=JSON.parse(localStorage.getItem('st_passport')||'[]');
  const data=saved.length? saved : [{name:'Fukuoka Attendance', got:true},{name:'Anniversary', got:true}];
  document.getElementById('myPassportGrid').innerHTML=data.map(s=>`<div style="border:1px solid var(--line);background:#fff;padding:12px;text-align:center"><div>${s.got?'✓':'○'}</div><b style="font-size:11px">${s.name}</b><div style="font-size:10px">${s.got?'STAMPED':'Locked'}</div></div>`).join('');
}
function renderMyOrders(){
  const orders=Shop.getOrders().filter(o=>{ const cur=JSON.parse(localStorage.getItem('st_member_current')||'null'); return cur && o.email===cur.email; });
  const el=document.getElementById('myOrdersList');
  if(!orders.length) el.innerHTML=`<div style="border:1px dashed var(--line);background:var(--pearl);padding:28px;text-align:center">No orders — <a href="/shop/" style="text-decoration:underline">Shop</a></div>`;
  else el.innerHTML=orders.map(o=>`<div style="border:1px solid var(--line);background:#fff;padding:14px;display:grid;grid-template-columns:1fr 120px;gap:12px"><div><b>${o.id} • ${o.status}</b> — ${o.deliveryType}<br><span style="font-size:11px;color:var(--muted)">${o.items.map(i=>i.title).join(', ')} • ¥${o.total.toLocaleString()}</span></div><div id="qr-${o.qr}" style="width:110px;height:110px;border:1px solid var(--line)"></div></div>`).join('');
  orders.forEach(o=> generateQR(o.qr, document.getElementById('qr-'+o.qr)));
}
function renderMyNotif(){
  const prefs=Notifications.getPrefs();
  document.getElementById('notifPrefs').innerHTML=Object.entries(prefs).map(([cat,v])=>`<div style="border:1px solid var(--line);padding:10px;background:var(--pearl);display:grid;grid-template-columns:110px 1fr"><b style="font-size:11px;text-transform:uppercase">${cat}</b><div style="display:flex;gap:6px"><label style="font-size:11px"><input type="checkbox" data-pref="${cat}-inapp" ${v.inapp?'checked':''}> In-App</label><label style="font-size:11px"><input type="checkbox" data-pref="${cat}-email" ${v.email?'checked':''}> Email</label><label style="font-size:11px"><input type="checkbox" data-pref="${cat}-push" ${v.push?'checked':''}> Push</label></div></div>`).join('');
  const inbox=Notifications.getInbox();
  document.getElementById('inboxCount').textContent=`(${inbox.length})`;
  const ie=document.getElementById('notifInbox');
  if(!inbox.length) ie.innerHTML=`<div style="border:1px dashed var(--line);padding:18px;text-align:center;font-size:11px;color:var(--muted)">No notifications</div>`;
  else ie.innerHTML=inbox.map(n=>`<div style="border:1px solid var(--line);background:#fff;padding:12px"><b style="font-size:11px;color:var(--gold)">${n.type}</b> <span style="font-size:10px;color:var(--muted)">${new Date(n.ts).toLocaleString('ja-JP')}</span><div style="font-size:12px"><b>${n.title}</b><br>${n.body}</div></div>`).join('');
  Notifications.renderBadge();
}
window.saveNotifPrefs=function(){
  const prefs=Notifications.getPrefs();
  Object.keys(prefs).forEach(cat=>{
    const ia=document.querySelector(`[data-pref="${cat}-inapp"]`), em=document.querySelector(`[data-pref="${cat}-email"]`), pu=document.querySelector(`[data-pref="${cat}-push"]`);
    if(ia) prefs[cat].inapp=ia.checked;
    if(em) prefs[cat].email=em.checked;
    if(pu) prefs[cat].push=pu.checked;
  });
  Notifications.setPrefs(prefs); toast('Preferences saved');
};
function renderMyAccount(){
  const cur=JSON.parse(localStorage.getItem('st_member_current')||'null');
  const el=document.getElementById('myAccountInfo');
  if(!cur) el.innerHTML=`<div>Not logged — <a href="#" onclick="openMember('login');return false" style="text-decoration:underline">Login</a></div>`;
  else el.innerHTML=`<div><b>Name:</b> ${cur.name}<br><b>Email:</b> ${cur.email}<br><b>#:</b> ${cur.cardNo}<br><b>Tier:</b> ${cur.tier}</div>`;
}
function renderMyExclusive(){
  const cur=JSON.parse(localStorage.getItem('st_member_current')||'null'); const has=cur && cur.tier && cur.tier!=='none';
  const el=document.getElementById('exclusiveGrid');
  if(!has) el.innerHTML=`<div style="grid-column:1/-1;border:1px dashed var(--line);background:var(--pearl);padding:28px;text-align:center">Members only — purchase Fan Card</div>`;
  else el.innerHTML=[{title:'Rehearsal',img:'/image-search/takuya-kimura-starto-entertainment-offic-1.png'},{title:'Gallery',img:'/image-search/takuya-kimura-starto-entertainment-offic-2.png'}].map(v=>`<div class="vault-card unlocked"><img src="${v.img}"><div class="body"><b>${v.title}</b></div></div>`).join('');
}
renderMyCard(); renderMyNotif();
'''
)

# SHOP
make_page("/shop/", "Official Shop", "Apparel, tour merch, accessories, albums, collectibles, limited — inventory live, QR collect.",
hero("SHOP • OFFICIAL", "OFFICIAL SHOP<br><em>Apparel • Tour • Collectibles</em>", "Tour Merch • Apparel • Accessories • Albums • Collectibles • Limited • Inventory • QR", "/image-search/takuya-kimura-live-tour-checkpoint-2026--2.jpg", "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?q=80&w=1600&auto=format&fit=crop", '<div style="margin-top:14px;display:flex;gap:8px"><a class="btn primary" href="#products">Browse →</a><button class="btn ghost" style="background:rgba(255,255,255,.9)" onclick="document.getElementById(\'cartDrawer\').classList.add(\'open\');document.getElementById(\'cartDrawer\').style.opacity=\'1\';document.getElementById(\'cartDrawer\').style.pointerEvents=\'auto\';document.querySelector(\'#cartDrawer > div\').style.transform=\'none\'">Cart (<span id="cartCount">0</span>)</button></div>'),
'''
<section class="section" style="padding-top:18px"><div style="display:flex;gap:8px;flex-wrap:wrap;border:1px solid var(--line);background:var(--paper);padding:12px"><span style="font-size:10px">CATEGORY</span><button class="btn ghost small" onclick="filterShop('all')">All</button><button class="btn ghost small" onclick="filterShop('Apparel')">Apparel</button><button class="btn ghost small" onclick="filterShop('Tour Merch')">Tour Merch</button><button class="btn ghost small" onclick="filterShop('Accessories')">Accessories</button><button class="btn ghost small" onclick="filterShop('Albums')">Albums</button><button class="btn ghost small" onclick="filterShop('Collectibles')">Collectibles</button><button class="btn ghost small" onclick="filterShop('Limited')">Limited</button><span style="margin-left:auto;font-size:11px;color:var(--muted)">Admin → Shop CMS</span><button class="btn primary small" onclick="document.getElementById('cartDrawer').classList.add('open');document.getElementById('cartDrawer').style.opacity='1';document.getElementById('cartDrawer').style.pointerEvents='auto';document.querySelector('#cartDrawer > div').style.transform='none'">Cart → <span id="cartCount2">0</span></button></div></section>
<section class="section reveal" id="products" style="padding-top:18px"><div class="section-head"><div><h2><span style="display:inline-grid;place-items:center;width:26px;height:26px;border:1px solid var(--line);background:var(--paper);margin-right:8px;font-size:11px">🛍</span>Products</h2><p>Inventory → Checkout → Payment → Orders → Delivery/Pickup</p></div><span style="font-size:11px" id="shopCount"></span></div><div id="shopGrid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px"></div></section>
<section class="section reveal"><div style="border:1px solid var(--line);background:#0f0e0c;color:#fff;padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:18px"><div><h3 style="font-family:Cormorant Garamond,serif">ORDER → PAYMENT → QR → VENUE → SCAN → VERIFY → COLLECT</h3><p style="font-size:11.5px;color:#9a9a9a">Merch QR System — optional venue workflow. After payment, QR generated. Present at venue, staff scans to verify.</p><div style="margin-top:12px;display:flex;gap:8px"><a class="btn gold small" href="/shop/verify.html">Venue Scan → Verify</a><a class="btn ghost small" href="/members/#orders" style="background:#111;color:#fff;border-color:#222">My Orders →</a></div></div><div style="border:1px solid #222;background:#111;padding:12px"><b style="font-size:11px;color:var(--gold)">RECENT ORDERS</b><div id="shopRecentOrders" style="margin-top:10px;display:grid;gap:8px"></div></div></div></section>
<div id="cartDrawer" style="position:fixed;inset:0;z-index:70;background:rgba(10,10,10,.42);backdrop-filter:blur(4px);opacity:0;pointer-events:none;transition:opacity .25s"><div style="position:absolute;right:0;top:0;bottom:0;width:92%;max-width:420px;background:var(--paper);transform:translateX(100%);transition:transform .34s;display:flex;flex-direction:column" id="cartPanel"><div style="padding:16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;background:#fff"><b style="font-size:11px">CART • CHECKOUT</b><button class="icon-btn" onclick="document.getElementById('cartDrawer').style.opacity='0';document.getElementById('cartDrawer').style.pointerEvents='none';document.querySelector('#cartDrawer > div').style.transform='translateX(100%)'" style="width:32px;height:32px">✕</button></div><div id="cartBody" style="flex:1;overflow:auto;padding:16px;display:grid;gap:10px;background:var(--pearl)"></div><div style="padding:16px;border-top:1px solid var(--line);background:#fff"><div style="display:flex;justify-content:space-between"><span>Subtotal</span><b id="cartTotal">¥0</b></div><div style="margin-top:12px;display:grid;gap:8px"><label style="font-size:10px">Delivery / Pickup</label><select id="deliveryType" style="border:1px solid var(--line);padding:10px"><option value="pickup">Pickup at Venue (QR)</option><option value="delivery">Delivery</option></select><input id="deliveryInput" placeholder="Venue: Fukuoka TOTTEI PARK or Address" style="border:1px solid var(--line);padding:10px"><label style="font-size:10px">Payment (admin-provided)</label><select id="payMethod" style="border:1px solid var(--line);padding:10px"></select><div id="payDetails" style="font-size:11px;color:var(--muted)"></div><button class="btn primary" style="width:100%" onclick="doCheckout()">Checkout → Payment → QR</button></div></div></div></div>
''',
'''
function filterShop(cat){
  let data=Shop.getProducts();
  if(cat!=='all') data=data.filter(p=>p.cat===cat);
  document.getElementById('shopCount').textContent=data.length+' products';
  const grid=document.getElementById('shopGrid');
  if(!data.length) grid.innerHTML=`<div style="grid-column:1/-1;padding:28px;text-align:center;border:1px dashed var(--line)">No products — Admin adds via Shop CMS</div>`;
  else grid.innerHTML=data.map(p=>`<div style="border:1px solid var(--line);background:var(--paper);overflow:hidden;display:flex;flex-direction:column"><img src="${p.img}" style="width:100%;aspect-ratio:1/1;object-fit:cover"><div style="padding:12px;flex:1;display:flex;flex-direction:column"><small style="font-size:9px;color:var(--muted)">${p.cat} • Stock ${p.stock}</small><b style="font-size:12px;margin-top:4px">${p.title}</b><p style="font-size:11px;color:var(--muted);flex:1">${p.desc}</p><div style="display:flex;justify-content:space-between;margin-top:8px"><b>¥${p.price.toLocaleString()}</b><button class="btn gold small" onclick="Shop.addToCart('${p.id}')" ${p.stock===0?'disabled':''}>${p.stock===0?'Sold Out':'Add'}</button></div></div></div>`).join('');
}
function renderCart(){
  const cart=Shop.getCart();
  const body=document.getElementById('cartBody');
  if(!cart.length) body.innerHTML=`<div style="border:1px dashed var(--line);background:var(--paper);padding:18px;text-align:center;font-size:11px;color:var(--muted)">Cart empty</div>`;
  else body.innerHTML=cart.map(i=>`<div style="border:1px solid var(--line);background:#fff;padding:10px;display:flex;gap:10px"><img src="${i.img}" style="width:56px;height:56px;object-fit:cover"><div style="flex:1"><b style="font-size:12px">${i.title}</b><br><span style="font-size:11px;color:var(--muted)">¥${i.price.toLocaleString()} × ${i.qty}</span></div><div style="display:flex;gap:6px"><button class="icon-btn" style="width:28px;height:28px" onclick="changeQty('${i.id}',-1)">−</button><span>${i.qty}</span><button class="icon-btn" style="width:28px;height:28px" onclick="changeQty('${i.id}',1)">+</button><button class="icon-btn" style="width:28px;height:28px" onclick="removeCart('${i.id}')">✕</button></div></div>`).join('');
  const total=cart.reduce((s,x)=>s+x.price*x.qty,0);
  document.getElementById('cartTotal').textContent='¥'+total.toLocaleString();
  document.getElementById('cartCount').textContent=cart.reduce((s,x)=>s+x.qty,0);
  document.getElementById('cartCount2').textContent=document.getElementById('cartCount').textContent;
}
function changeQty(id, d){
  let cart=Shop.getCart(); const it=cart.find(x=>x.id===id); if(!it) return;
  const prod=Shop.getProducts().find(p=>p.id===id);
  if(d>0 && it.qty >= prod.stock) return toast('Stock insufficient');
  it.qty+=d; if(it.qty<=0) cart=cart.filter(x=>x.id!==id);
  Shop.setCart(cart); renderCart();
}
function removeCart(id){ Shop.setCart(Shop.getCart().filter(x=>x.id!==id)); renderCart(); }
function renderPay(){
  const methods=load(K.payments,[]);
  const sel=document.getElementById('payMethod');
  sel.innerHTML=methods.filter(m=>m.enabled).map(m=>`<option value="${m.id}">${m.name}</option>`).join('') || '<option>None</option>';
  const det=document.getElementById('payDetails');
  function upd(){ const m=methods.find(x=>x.id===sel.value); if(m) det.textContent=m.details+' — '+m.instructions; }
  sel.addEventListener('change', upd); upd();
}
function doCheckout(){
  const t=document.getElementById('deliveryType').value, v=document.getElementById('deliveryInput').value.trim();
  if(!v) return toast('Enter venue or address');
  const pay=document.getElementById('payMethod').value;
  const order=Shop.checkout({deliveryType:t, address:v, pickupVenue:v});
  if(order){ order.paymentMethod=pay; let orders=Shop.getOrders(); orders[0].paymentMethod=pay; localStorage.setItem('st_shop_orders', JSON.stringify(orders)); renderCart(); renderRecent(); document.getElementById('cartDrawer').style.opacity='0'; document.getElementById('cartDrawer').style.pointerEvents='none'; setTimeout(()=>location.href='/members/#orders', 800); }
}
function renderRecent(){
  const orders=Shop.getOrders().slice(0,3);
  const el=document.getElementById('shopRecentOrders');
  if(!orders.length) el.innerHTML=`<div style="border:1px dashed #222;padding:14px;color:#9a9a9a;font-size:11px">No orders</div>`;
  else el.innerHTML=orders.map(o=>`<div style="border:1px solid #222;background:#111;padding:10px"><b style="font-size:11px">${o.id}</b><br><span style="font-size:11px;color:#9a9a9a">${o.qr.slice(0,18)}…</span></div>`).join('');
}
filterShop('all'); renderCart(); renderPay(); renderRecent();
document.getElementById('cartDrawer').addEventListener('click', e=>{ if(e.target.id==='cartDrawer'){ e.target.style.opacity='0'; e.target.style.pointerEvents='none'; document.querySelector('#cartDrawer > div').style.transform='translateX(100%)'; } });
document.getElementById('deliveryType').addEventListener('change', e=>{ document.getElementById('deliveryInput').placeholder=e.target.value==='delivery'?'Address':'Venue — Fukuoka'; });
try{ new BroadcastChannel('st_shop').onmessage=()=>{filterShop('all'); renderCart(); renderRecent();}; }catch{}
'''
)

# VERIFY
make_page("/shop/verify.html", "Verify QR — Venue", "Merch QR verification — SCAN → VERIFY → COLLECT for venue staff.",
hero("SHOP • VERIFY", "VERIFY QR<br><em>Venue Scan</em>", "Scan QR — verify order, collect at venue.", "/image-search/takuya-kimura-live-tour-checkpoint-2026--1.gif", "https://images.unsplash.com/photo-1511512578047-dfb367046420?q=80&w=1600&auto=format&fit=crop"),
'''
<section class="section" style="padding-top:18px"><div style="border:1px solid var(--line);background:var(--paper);padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:18px"><div style="border:1px solid var(--line);background:#fff;padding:16px"><h3>Scan / Enter QR</h3><input id="qrInput" placeholder="QR-... or ORD-..." style="width:100%;border:1px solid var(--line);padding:12px;margin-top:10px"><div style="margin-top:12px;display:flex;gap:8px"><button class="btn primary" onclick="doVerify()">Verify →</button><button class="btn ghost" onclick="document.getElementById('qrInput').value=''">Clear</button></div><div id="verifyResult" style="margin-top:14px;padding:12px;border:1px solid var(--line);background:var(--pearl);display:none"></div></div><div style="border:1px solid var(--line);background:#0f0e0c;color:#fff;padding:16px"><h3 style="color:var(--gold)">Recent Orders</h3><div id="verifyList" style="margin-top:12px;display:grid;gap:8px;max-height:420px;overflow:auto"></div></div></div></section>
''',
'''
function renderVerifyList(){
  const orders=Shop.getOrders();
  const el=document.getElementById('verifyList');
  if(!orders.length) el.innerHTML=`<div style="border:1px dashed #222;padding:14px;color:#9a9a9a">No orders</div>`;
  else el.innerHTML=orders.map(o=>`<div style="border:1px solid #222;background:#111;padding:10px"><b>${o.id}</b> • <span style="color:${o.verified?'#1ec760':'var(--gold)'}">${o.verified?'Collected':'Paid'}</span><br><span style="font-size:11px;color:#9a9a9a">${o.qr}</span><br><button class="btn gold small" style="margin-top:6px" onclick="document.getElementById('qrInput').value='${o.qr}';doVerify()">Scan this</button></div>`).join('');
}
function doVerify(){
  const v=document.getElementById('qrInput').value.trim(); if(!v) return toast('Enter QR');
  const res=Shop.verifyQR(v);
  const el=document.getElementById('verifyResult'); el.style.display='block';
  if(res.ok){ el.style.borderColor='#c8ecd8'; el.style.background='#eef8f1'; el.style.color='#1a6a3a'; el.innerHTML=`✓ Verified — <b>${res.order.id}</b>`; toast('Verified — collect'); }
  else { el.style.borderColor='#ffd1d1'; el.style.background='#fff0f0'; el.style.color='#8a1a1a'; el.textContent='✕ '+res.msg; }
  renderVerifyList();
}
renderVerifyList();
'''
)

# SEARCH
make_page("/search/", "Search — Official", "Search across Work, Music, Tour, Journal, Archive, Shop.",
hero("SEARCH • DISCOVER", "SEARCH<br><em>Official Archive</em>", "Search verified work, music, tour, journal, archive, shop — no scraping.", "/image-search/takuya-kimura-starto-entertainment-offic-3.webp", "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?q=80&w=1600&auto=format&fit=crop"),
'''
<section class="section" style="padding-top:18px"><div style="border:1px solid var(--line);background:#fff;padding:16px;display:flex;gap:12px"><input id="searchInput" placeholder="Search — film, music, tour, journal, shop..." style="flex:1;border:1px solid var(--line);padding:14px"><button class="btn primary" onclick="doSearch()">Search →</button></div><div id="searchResults" style="margin-top:18px;display:grid;gap:12px"></div></section>
''',
'''
function doSearch(){
  const q=(document.getElementById('searchInput').value||'').toLowerCase().trim();
  const all=[ ...load(K.movie,[]).map(x=>({type:'WORK', title:x.title, desc:x.desc, href:'/work/'})),
    ...load(K.release,[]).map(x=>({type:'MUSIC', title:x.title, desc:x.artist, href:'/music/'})),
    ...load('st_journal',[]).map(x=>({type:'JOURNAL', title:x.title, desc:x.excerpt, href:'/journal/'})),
    ...load('st_archive',[]).map(x=>({type:'ARCHIVE', title:x.title, desc:x.desc, href:'/archive/'})),
    ...Shop.getProducts().map(x=>({type:'SHOP', title:x.title, desc:x.desc, href:'/shop/'}))];
  const res=q? all.filter(x=> (x.title+x.desc).toLowerCase().includes(q)) : [];
  const el=document.getElementById('searchResults');
  if(!q) el.innerHTML=`<div style="border:1px dashed var(--line);background:var(--pearl);padding:28px;text-align:center;color:var(--muted)">Enter keyword</div>`;
  else if(!res.length) el.innerHTML=`<div style="border:1px dashed var(--line);padding:28px;text-align:center">No results for "${q}"</div>`;
  else el.innerHTML=res.slice(0,20).map(r=>`<a href="${r.href}" style="border:1px solid var(--line);background:var(--paper);padding:14px;display:flex;gap:12px"><span style="font-size:10px;border:1px solid var(--line);padding:4px 8px;background:#fff">${r.type}</span><div><b>${r.title}</b><div style="font-size:11px;color:var(--muted)">${r.desc.slice(0,80)}</div></div><span style="margin-left:auto">→</span></a>`).join('');
}
document.getElementById('searchInput').addEventListener('keydown', e=>{ if(e.key==='Enter') doSearch(); });
doSearch();
'''
)

# SUPPORT
make_page("/support/", "Support Center", "Account, membership, payments, tickets, tours, merchandise, cards, technical — workflow Open → Closed.",
hero("SUPPORT • KIMURA", "KIMURA SUPPORT<br><em>Official Help</em>", "Account • Membership • Payments • Tickets • Tours • Merch • Cards • Technical", "/image-search/takuya-kimura-starto-entertainment-offic-1.png", "https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?q=80&w=1600&auto=format&fit=crop", '<div style="margin-top:14px;display:flex;gap:8px"><button class="btn primary" onclick="openChat()">Open Chat →</button><a class="btn ghost" href="/members/" style="background:rgba(255,255,255,.9)">My Orders →</a></div>'),
'''
<section class="section" style="padding-top:18px"><div style="display:grid;grid-template-columns:1.1fr .9fr;gap:18px"><div style="border:1px solid var(--line);background:#fff;padding:16px"><h3>Create Ticket</h3><div style="display:grid;gap:10px;margin-top:12px"><select id="supportCat" style="border:1px solid var(--line);padding:10px"><option>Account</option><option>Membership</option><option>Payments</option><option>Tickets</option><option>Tours</option><option>Merchandise</option><option>Digital Cards</option><option>Technical</option><option>General</option></select><input id="supportSubject" placeholder="Subject" style="border:1px solid var(--line);padding:10px"><textarea id="supportMsg" placeholder="Describe issue..." style="border:1px solid var(--line);padding:10px;min-height:84px"></textarea><button class="btn primary" onclick="createSupport()">Create Ticket → Open</button></div></div><div style="border:1px solid var(--line);background:var(--paper);padding:16px"><h3>Help Topics</h3><div style="margin-top:12px;display:grid;gap:8px;font-size:11.5px"><div style="border:1px solid var(--line);background:#fff;padding:10px"><b>Fan Card</b> — via ticket + admin</div><div style="border:1px solid var(--line);background:#fff;padding:10px"><b>Tour Pass</b> — QR at /tour/#pass</div><div style="border:1px solid var(--line);background:#fff;padding:10px"><b>Shop QR</b> — SCAN → VERIFY → COLLECT</div></div></div></div></section>
<section class="section reveal"><div class="section-head"><div><h2>My Tickets</h2><p>Workflow: Open → In Progress → Waiting → Resolved → Closed</p></div></div><div id="supportTickets" style="display:grid;gap:10px"></div></section>
''',
'''
function createSupport(){
  const cur=JSON.parse(localStorage.getItem('st_member_current')||'null'); if(!cur) return toast('Please login'), openMember('signup');
  const cat=document.getElementById('supportCat').value, subject=document.getElementById('supportSubject').value.trim(), msg=document.getElementById('supportMsg').value.trim();
  if(!subject||!msg) return toast('Fill subject and message');
  const tickets=JSON.parse(localStorage.getItem('st_tickets')||'[]');
  const t={id:Date.now(), userId:cur.id, userName:cur.name, userEmail:cur.email, subject:`[${cat}] ${subject}`, category:cat, status:'Open', messages:[{from:'user',text:msg,ts:Date.now()}], created:Date.now()};
  tickets.unshift(t); localStorage.setItem('st_tickets', JSON.stringify(tickets));
  let threads=JSON.parse(localStorage.getItem('st_chat_threads')||'{}'); if(!threads[cur.email]) threads[cur.email]=[]; threads[cur.email].push({from:'user', text:`Ticket #${t.id} [${cat}] ${subject} — ${msg}`, ts:Date.now(), ticketId:t.id}); localStorage.setItem('st_chat_threads', JSON.stringify(threads));
  try{new BroadcastChannel('st_ticket').postMessage('update')}catch{}; try{new BroadcastChannel('st_tk_chat').postMessage('update')}catch{};
  Notifications.push({type:'support', title:'Ticket #'+t.id+' opened', body:subject, ts:Date.now()}); toast('Ticket #'+t.id+' created'); renderSupportTickets();
}
function renderSupportTickets(){
  const cur=JSON.parse(localStorage.getItem('st_member_current')||'null');
  const el=document.getElementById('supportTickets');
  if(!cur){ el.innerHTML=`<div style="border:1px dashed var(--line);padding:28px;text-align:center">Please <a href="#" onclick="openMember('login');return false" style="text-decoration:underline">login</a></div>`; return; }
  const tickets=JSON.parse(localStorage.getItem('st_tickets')||'[]').filter(t=>t.userEmail===cur.email);
  if(!tickets.length) el.innerHTML=`<div style="border:1px dashed var(--line);padding:28px;text-align:center">No tickets</div>`;
  else el.innerHTML=tickets.map(t=>`<div style="border:1px solid var(--line);background:#fff;padding:14px"><div style="display:flex;justify-content:space-between"><b>#${t.id} — ${t.subject}</b><span style="font-size:10px;border:1px solid #0f0e0c;padding:4px 8px;background:#0f0e0c;color:var(--gold)">${t.status}</span></div><div style="font-size:11px;color:var(--muted)">${(t.messages.slice(-1)[0]?.text||'').slice(0,120)}</div></div>`).join('');
}
renderSupportTickets();
try{ new BroadcastChannel('st_ticket').onmessage=()=>renderSupportTickets(); }catch{}
'''
)

print("all done")

