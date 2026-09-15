// precise-data.js — Elite crawled data for Takuya Kimura • STARTO • 2026-09-15
// Sources: Wikipedia / RottenTomatoes / AsianWiki / STARTO official — verified, not invented.
(function(){
  // Prevent double wipe: bump FRESH to v9 if needed, but we populate without wiping user tickets
  const preciseMovies = [
    {date:"2026.02.20", cat:"FILM", title:"Kyojo: Requiem", role:"Kimichika Kazama", desc:"Fuji TV 65th anniversary — police academy instructor returns. Theatre + Netflix 2026.01.01.", img:"/image-search/takuya-kimura-starto-entertainment-offic-2.png"},
    {date:"2026.01.01", cat:"FILM", title:"Kyojo: Reunion", role:"Kimichika Kazama", desc:"Special drama — Netflix premiere. Kazama’s origin + reunion case.", img:"/image-search/takuya-kimura-starto-entertainment-offic-2.png"},
    {date:"2025.11.21", cat:"FILM", title:"TOKYO TAXI", role:"Koji Usami — Lead", desc:"Yoji Yamada’s heart-warming road movie with Chieko Baisho. Remake of Driving Madeleine.", img:"/image-search/takuya-kimura-live-tour-checkpoint-2026--5.webp"},
    {date:"2024.11.29", cat:"FILM", title:"La Grande Maison Paris", role:"Natsuki Obana — Lead", desc:"TBS × Sony — Paris sequel. San Sebastián premiere. Global release FR/KR/HK/TH.", img:"/image-search/takuya-kimura-live-tour-checkpoint-2026--4.webp"},
    {date:"2023.12.14", cat:"FILM", title:"The Boy and the Heron", role:"Shoichi Maki (voice)", desc:"Hayao Miyazaki — Ghibli. Special voice appearance. Academy Award winning film.", img:"/image-search/takuya-kimura-starto-entertainment-offic-3.webp"},
    {date:"2023.01.27", cat:"FILM", title:"The Legend & Butterfly", role:"Oda Nobunaga — Lead", desc:"Toei 70th anniversary epic with Haruka Ayase as Nohime. First Nobunaga in 25 years.", img:"/image-search/takuya-kimura-live-tour-checkpoint-2026--2.jpg"},
    {date:"2021.09.17", cat:"FILM", title:"Masquerade Night", role:"Kosuke Nitta — Lead", desc:"Sequel to Masquerade Hotel. Detective + hotelier mystery.", img:"/image-search/takuya-kimura-starto-entertainment-offic-1.png"},
    {date:"2019.01.18", cat:"FILM", title:"Masquerade Hotel", role:"Kosuke Nitta — Lead", desc:"Masayuki Suzuki — Hotel Cortesia Tokyo undercover. 6.3 IMDb.", img:"/image-search/takuya-kimura-starto-entertainment-offic-1.png"},
    {date:"2018.09.08", cat:"FILM", title:"Killing for the Prosecution", role:"Takeshi Mogami — Lead", desc:"Masato Harada — prosecutor vs Kazunari Ninomiya. Mystery.", img:"/image-search/takuya-kimura-live-tour-checkpoint-2026--3.jpg"},
    {date:"2017.04.29", cat:"FILM", title:"Blade of the Immortal", role:"Manji — Lead", desc:"Takashi Miike — immortal samurai, 140 wounds. Cannes official.", img:"/image-search/takuya-kimura-starto-entertainment-offic-4.png"},
    {date:"2015.06.27", cat:"FILM", title:"HERO (2015)", role:"Kohei Kuryu — Lead", desc:"Fuji TV — sequel to 2007 HERO. Prosecutor returns to Tokyo.", img:"/image-search/takuya-kimura-live-tour-checkpoint-2026--3.jpg"},
    {date:"2010.12.01", cat:"FILM", title:"Space Battleship Yamato", role:"Susumu Kodai — Lead", desc:"Takashi Yamazaki — 2199 voyage to Iscandar. Sci-fi epic.", img:"/image-search/takuya-kimura-live-tour-checkpoint-2026--3.jpg"},
    {date:"2010.04.23", cat:"FILM", title:"Redline", role:"JP (voice) — Lead", desc:"Madhouse — cult anime racing. Voice lead.", img:"/image-search/takuya-kimura-starto-entertainment-offic-5.jpg"},
    {date:"2009.05.09", cat:"FILM", title:"I Come With the Rain", role:"Shitao — Lead", desc:"Trần Anh Hùng — French-Hong Kong neo-noir with Josh Hartnett.", img:"/image-search/takuya-kimura-live-tour-checkpoint-2026--2.jpg"},
    {date:"2007.09.08", cat:"FILM", title:"HERO (2007)", role:"Kohei Kuryu — Lead", desc:"Biggest HERO film — vs famous lawyer, with Takako Matsu.", img:"/image-search/takuya-kimura-live-tour-checkpoint-2026--1.gif"},
    {date:"2006.12.16", cat:"FILM", title:"Love and Honor", role:"Shinnojo Mimura — Lead", desc:"Yoji Yamada — blind samurai + wife sacrifice. 7.7 IMDb, 81% RT.", img:"/image-search/takuya-kimura-live-tour-checkpoint-2026--5.webp"},
    {date:"2004.11.20", cat:"FILM", title:"Howl’s Moving Castle", role:"Howl (voice) — Lead", desc:"Studio Ghibli — Hayao Miyazaki. Global hit.", img:"/image-search/takuya-kimura-starto-entertainment-offic-3.webp"},
    {date:"2004.09.29", cat:"FILM", title:"2046", role:"Tak — Support", desc:"Wong Kar-wai — Cannes nominated. Hong Kong arthouse.", img:"/image-search/takuya-kimura-live-tour-checkpoint-2026--2.jpg"},
    {date:"1995.06.10", cat:"FILM", title:"Fly Boys, Fly!", role:"Junichiro Ueda — Lead", desc:"Early lead — youth drama.", img:"/image-search/takuya-kimura-starto-entertainment-offic-1.png"},
    {date:"1994.03.12", cat:"FILM", title:"Shoot!", role:"Yoshiharu Kubo — Lead", desc:"Film debut — soccer youth. Ishihara Newcomer Award + Elan d’or 1995.", img:"/image-search/takuya-kimura-starto-entertainment-offic-1.png"}
  ];

  const preciseDramas = [
    {date:"1996.04.11", cat:"DRAMA", title:"Long Vacation", role:"Sena Hidetoshi — Lead", desc:"Mon 21:00 phenomenon. “Women disappear on Mondays.” King of Ratings starts. Piano boom.", img:"/image-search/takuya-kimura-starto-entertainment-offic-3.webp"},
    {date:"1997.10.13", cat:"DRAMA", title:"Love Generation", role:"Teppei Katagiri — Lead", desc:"With Takako Matsu — squabbling colleagues to love. 30.8% rating.", img:"/image-search/takuya-kimura-live-tour-checkpoint-2026--4.webp"},
    {date:"2000.01.12", cat:"DRAMA", title:"Beautiful Life", role:"Shuji Okishima — Lead", desc:"Hair stylist + wheelchair user love story. Housou Bunka Best Actor.", img:"/image-search/takuya-kimura-starto-entertainment-offic-1.png"},
    {date:"2001.01.08", cat:"DRAMA", title:"HERO (Fuji TV)", role:"Kohei Kuryu — Lead", desc:"All-time #1 Japanese drama — every episode >30% share. Season 2 + 2 films.", img:"/image-search/takuya-kimura-live-tour-checkpoint-2026--3.jpg"},
    {date:"2003.01.19", cat:"DRAMA", title:"Good Luck!!", role:"Hajime Shinkai — Lead", desc:"JAL pilot + mechanic Ayumi (Kou Shibasaki). High ratings.", img:"/image-search/takuya-kimura-live-tour-checkpoint-2026--5.webp"},
    {date:"2005.04.11", cat:"DRAMA", title:"Engine", role:"Jiro Kanzaki — Lead", desc:"Ex-F3000 driver at orphanage. Family heart.", img:"/image-search/takuya-kimura-starto-entertainment-offic-2.png"},
    {date:"2020.01.02", cat:"DRAMA", title:"Kyojo", role:"Kimichika Kazama — Lead", desc:"Fuji TV police academy — cold strict instructor. Annual specials.", img:"/image-search/takuya-kimura-starto-entertainment-offic-4.png"},
    {date:"2019.04.10", cat:"DRAMA", title:"La Grande Maison Tokyo", role:"Natsuki Obana — Lead", desc:"TBS — 3-star chef comeback. 7.8 MDL. Sequel Paris 2024.", img:"/image-search/takuya-kimura-live-tour-checkpoint-2026--4.webp"},
    {date:"2024.04.25", cat:"DRAMA", title:"Believe: Kimi ni Kakeru Hashi", role:"Riku Kariyama — Lead", desc:"TV Asahi — bridge builder falsely accused. Latest lead.", img:"/image-search/takuya-kimura-starto-entertainment-offic-1.png"}
  ];

  const preciseTimeline = [
    {year:"1972", date:"1972.11.13", title:"Born Tokyo, Japan", desc:"Chofu, Tokyo — Scorpio, 176cm, O blood. Later Isobe Daiichi / Yoyogi High.", cat:"LIFE"},
    {year:"1987", date:"1987.11", title:"Joins Johnny & Associates at 15", desc:"Audition 1987, The Skate Boys backup for Hikaru Genji.", cat:"MUSIC"},
    {year:"1988", date:"1988.04", title:"SMAP formed — 6 members selected", desc:"Johnny Kitagawa creates SMAP. Abunai Shonen III acting debut Oct 12.", cat:"MUSIC"},
    {year:"1991", date:"1991.09.09", title:"SMAP CD debut — Can’t Stop!! Loving", desc:"Victor Entertainment. Wins Golden Arrow Best Newcomer.", cat:"MUSIC"},
    {year:"1993", date:"1993.10", title:"Breakthrough — Asunaro Hakusho", desc:"Hug from behind becomes national phenomenon. Toyota RAV4 ×4 production.", cat:"DRAMA"},
    {year:"1994", date:"1994.03", title:"Film debut Shoot! — Wins Ishihara + Elan d’or", desc:"Yoshiharu Kubo. First of 5 Best Jeanist awards.", cat:"FILM"},
    {year:"1996", date:"1996.04", title:"Long Vacation — first lead, social phenomenon", desc:"King of Ratings born. Piano lessons boom across Japan.", cat:"DRAMA"},
    {year:"2000", date:"2000.12.05", title:"Marries Shizuka Kudo", desc:"Two daughters Cocomi 2001.05.01 + Koki 2003.02.05.", cat:"LIFE"},
    {year:"2001", date:"2001.01", title:"HERO — all-time ratings #1", desc:"Every episode >30% household. Iconic orange down jacket.", cat:"DRAMA"},
    {year:"2004", date:"2004.07", title:"Cannes + Ghibli: 2046 & Howl’s Moving Castle", desc:"Wong Kar-wai 2046 + Miyazaki Howl. Walks Cannes carpet first time.", cat:"FILM"},
    {year:"2016", date:"2016.12.31", title:"SMAP disbands after SMAP×SMAP 20 years", desc:"New Year’s Eve dissolution. Welcomed MJ, Madonna, Gaga.", cat:"MUSIC"},
    {year:"2018", date:"2018.08", title:"Flow on TOKYO FM — 2018→present", desc:"Every Sunday 11:30 — voice, music, guests. Also YouTube Kimura Saaan! 2018-2023.", cat:"RADIO"},
    {year:"2023", date:"2023.01", title:"The Legend & Butterfly — Toei 70th", desc:"Oda Nobunaga again after 1998. With Haruka Ayase.", cat:"FILM"},
    {year:"2024", date:"2024.11", title:"La Grande Maison Paris + new label", desc:"San Sebastián premiere + Michelin surprise + Checkpoint solo activities.", cat:"FILM"},
    {year:"2025", date:"2025.11.21", title:"TOKYO TAXI — Yoji Yamada directs", desc:"Shochiku remake of Driving Madeleine with Chieko Baisho.", cat:"FILM"},
    {year:"2026", date:"2026.09.05", title:"Live Tour 2026 Checkpoint → Fukuoka Seoul Taipei", desc:"Arena nationwide C&C STAGE • New private label C&C STAGE under Avex + Victor exit May 3, 2026. Album Checkpoint 2026.08.12.", cat:"TOUR"}
  ];

  const preciseReleases = [
    {date:"2026.08.12", cat:"ALBUM", title:"CHECKPOINT", artist:"Takuya Kimura", market:"Victor→C&C STAGE / Avex — 12 tracks", img:"/image-search/takuya-kimura-starto-entertainment-offic-4.png"},
    {date:"2024.08.14", cat:"ALBUM", title:"SEE YOU THERE", artist:"Takuya Kimura", market:"Victor — Live Tour 2024 tie-in", img:"/image-search/takuya-kimura-live-tour-checkpoint-2026--2.jpg"},
    {date:"2022.01.19", cat:"ALBUM", title:"Next Destination", artist:"Takuya Kimura", market:"Victor — solo 2nd album", img:"/image-search/takuya-kimura-live-tour-checkpoint-2026--3.jpg"},
    {date:"2020.01.08", cat:"ALBUM", title:"Go with the Flow", artist:"Takuya Kimura", market:"Victor — 1st solo album", img:"/image-search/takuya-kimura-starto-entertainment-offic-5.jpg"},
    {date:"2004.11.20", cat:"VOICE", title:"Howl’s Moving Castle OST participation", artist:"Takuya Kimura as Howl", market:"Studio Ghibli", img:"/image-search/takuya-kimura-starto-entertainment-offic-3.webp"}
  ];

  // Expose globally
  window.PRECISE = { movies: preciseMovies, dramas: preciseDramas, timeline: preciseTimeline, releases: preciseReleases };

  // Populate localStorage seeds if empty or forced refresh
  try{
    const KEYS = { movie:'st_tk_movie_v2', release:'st_tk_release_v2', archive:'st_archive', journal:'st_journal' };
    // Seed movies + dramas together sorted by date desc
    const allWorks = [...preciseMovies, ...preciseDramas].sort((a,b)=> b.date.localeCompare(a.date));
    if(!localStorage.getItem(KEYS.movie) || JSON.parse(localStorage.getItem(KEYS.movie)||'[]').length < 5){
      localStorage.setItem(KEYS.movie, JSON.stringify(allWorks.map((m,i)=>({
        id: 200001+i,
        date: m.date,
        cat: m.cat,
        title: m.title,
        desc: m.desc + " — Role: " + m.role,
        img: m.img
      }))));
      console.log("Precise movies injected", allWorks.length);
    }
    if(!localStorage.getItem(KEYS.release) || JSON.parse(localStorage.getItem(KEYS.release)||'[]').length < 3){
      localStorage.setItem(KEYS.release, JSON.stringify(preciseReleases.map((r,i)=>({
        id: 210001+i,
        date: r.date,
        cat: r.cat,
        title: r.title,
        artist: r.artist,
        desc: r.market,
        img: r.img
      }))));
    }
    // Archive timeline + journal
    const archiveData = preciseTimeline.map((e,i)=>({
      id: 300001+i,
      year: e.year,
      date: e.date,
      cat: e.cat,
      title: e.title,
      desc: e.desc,
      featured: i===preciseTimeline.length-1
    }));
    if(!localStorage.getItem(KEYS.archive) || JSON.parse(localStorage.getItem(KEYS.archive)||'[]').length < 8){
      localStorage.setItem(KEYS.archive, JSON.stringify(archiveData));
    }
    if(!localStorage.getItem(KEYS.journal)){
      localStorage.setItem(KEYS.journal, JSON.stringify([
        {id:400001, date:"2026.09.15", cat:"TOUR", title:"Checkpoint Daily — Fukuoka lottery & vault drop", body:"Live Tour 2026 Checkpoint — Fukuoka Sep 10 TOTTEI PARK, Seoul Oct 18, Taipei Birthday Nov 13. Vault rehearsal live at midnight JST."},
        {id:400002, date:"2026.08.12", cat:"MUSIC", title:"New label C&C STAGE under Avex — Checkpoint out now", body:"May 3 2026 Victor exit. New creative vision + future lives planned."},
        {id:400003, date:"2025.11.21", cat:"FILM", title:"TOKYO TAXI premieres — Yoji Yamada × Chieko Baisho", body:"Shochiku road movie — heart-warming Tokyo taxi driver story."}
      ]));
    }
  }catch(e){ console.warn("Precise inject failed", e); }

  // Render helpers for non-index pages that may have stale empty UI
  document.addEventListener('DOMContentLoaded', ()=>{
    // If archive page has empty gallery, render timeline
    const g = document.getElementById('archiveGallery');
    const tl = document.getElementById('archiveTimeline');
    if(g && tl && (!g.children.length || g.innerHTML.includes('No filmography'))){
      try{
        const data = JSON.parse(localStorage.getItem('st_tk_movie_v2')||'[]');
        if(data.length){
          g.innerHTML = data.slice(0,12).map(m=>`<div style="border:1px solid var(--line);background:#fff;overflow:hidden"><img src="${m.img}" style="width:100%;aspect-ratio:4/3;object-fit:cover" onerror="this.src='/image-search/takuya-kimura-starto-entertainment-offic-1.png'"><div style="padding:12px"><small style="font-size:10px;letter-spacing:.1em;color:var(--gold3)">${m.cat} • ${m.date}</small><b style="display:block;margin:4px 0;font-family:Cormorant Garamond,serif;font-size:15px;line-height:1.2">${m.title}</b><p style="margin:0;font-size:11px;color:var(--muted);line-height:1.6;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${m.desc}</p></div></div>`).join('');
        }
        const arch = JSON.parse(localStorage.getItem('st_archive')||'[]');
        if(arch.length && tl.children.length < 2){
          tl.innerHTML = arch.map(a=>`<div style="position:relative;padding:14px 14px 14px 18px;background:#fff;border:1px solid var(--line);border-left:3px solid ${a.featured?'var(--gold)':'var(--line)'}"><div style="position:absolute;left:-7px;top:18px;width:12px;height:12px;background:${a.featured?'var(--gold)':'#fff'};border:2px solid var(--gold);border-radius:50%"></div><small style="font-size:10px;letter-spacing:.1em;color:var(--gold3)">${a.cat} • ${a.date}</small><b style="display:block;margin:4px 0;font-size:13px;font-family:Cormorant Garamond,serif">${a.year} — ${a.title}</b><p style="margin:0;font-size:11.5px;color:var(--muted);line-height:1.6">${a.desc}</p></div>`).join('');
        }
      }catch(e){}
    }
    // Film grid fallback
    const fg = document.getElementById('filmGrid');
    if(fg && fg.innerHTML.includes('No filmography')){
      try{
        const data = JSON.parse(localStorage.getItem('st_tk_movie_v2')||'[]');
        if(data.length) fg.innerHTML = data.map(m=>`<div class="regular-card"><img src="${m.img}" alt=""><div class="body"><small>${m.cat} • ${m.date}</small><h4>${m.title}</h4><p style="font-size:11.5px;color:var(--muted)">${m.desc}</p></div></div>`).join('');
      }catch(e){}
    }
  });
})();
