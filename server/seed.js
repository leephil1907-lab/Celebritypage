/**
 * server/seed.js — content seeding (idempotent: only fills empty tables).
 * All copy is ported from the original site so nothing in design/content is lost.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { getDb, insert, tableEmpty, audit } from './db.js';
import { seedExtras } from './seed-extra.js';

const IMG = {
  tour1: '/image-search/takuya-kimura-live-tour-checkpoint-2026--1.gif',
  tour2: '/image-search/takuya-kimura-live-tour-checkpoint-2026--2.jpg',
  tour3: '/image-search/takuya-kimura-live-tour-checkpoint-2026--3.jpg',
  tour4: '/image-search/takuya-kimura-live-tour-checkpoint-2026--4.webp',
  tour5: '/image-search/takuya-kimura-live-tour-checkpoint-2026--5.webp',
  /* roles are size-aware: off1/off2/off4 are the small web crops (284-300px) and live on the
     fan card, avatars and thumbs — every card slot gets a file that can actually fill it */
  off1: '/image-search/takuya-kimura-starto-entertainment-offic-5.jpg',
  off2: '/image-search/takuya-kimura-starto-entertainment-offic-3.webp',
  off3: '/image-search/takuya-kimura-starto-entertainment-offic-3.webp',
  off4: '/image-search/takuya-kimura-live-tour-checkpoint-2026--4.webp',
  off5: '/image-search/takuya-kimura-starto-entertainment-offic-5.jpg',
  thumb1: '/image-search/takuya-kimura-starto-entertainment-offic-1.png',
  thumb2: '/image-search/takuya-kimura-starto-entertainment-offic-2.png',
  thumb3: '/image-search/takuya-kimura-starto-entertainment-offic-4.png',
};

const HERO = [
  /* full-bleed band on a 1440px canvas: only the landscape archive scans carry that, and the
     portrait files (767px, 750px) stay in the portrait frames where they are shown at 1:1 */
  { kicker: 'LIVE TOUR 2026', title: 'TAKUYA KIMURA|Live Tour 2026 Checkpoint', sub: 'Fukuoka • Seoul • Taipei • Nationwide arena tour', img: IMG.tour2, alt: 'Live Tour 2026 Checkpoint — arena', cta: ['Tour Details', '/tour/'], tone: 'light' },
  { kicker: 'CHECKPOINT • ARENA', title: 'ARENA NATIONWIDE|Sep 5 — Nov 23', sub: 'C&C STAGE production — Fan Club pre-sale & Meet & Greet', img: IMG.tour3, alt: 'Arena nationwide — Fukuoka soundcheck', cta: ['Meet & Greet', '/#booking'], tone: 'light' },
  { kicker: 'TOKYO TAXI • KYOJO', title: 'FILM & DRAMA|Next on Screen', sub: 'TOKYO TAXI & Kyojo Requiem — crafted for premium experience', img: IMG.tour5, alt: 'TOKYO TAXI — film still', cta: ['Filmography', '/work/#film'], tone: 'dark' },
];

const TIERS = [
  { id: 'silver', name: 'SILVER', tagline: 'Entry — Fan essentials', price_yen: 300000, icon: '◯', accent: '#b8c0c9', featured: 0, rank: 1, sort: 1, perks: ['Member Fan Card (Digital)', 'Ticket pre-sale (lottery)', 'Member-only journal & photos', 'Shop 5% discount', 'Birthday message'] },
  { id: 'gold', name: 'GOLD', tagline: 'Popular — Enhanced', price_yen: 500000, icon: '◎', accent: '#c9a86a', featured: 0, rank: 2, sort: 2, perks: ['All Silver +', 'Goods pre-sale + bonus', 'Exclusive video & radio', 'Shop 10% discount', 'Meet & Greet entry (lottery)'] },
  { id: 'platinum', name: 'PLATINUM', tagline: 'Premium — Priority', price_yen: 750000, icon: '⬢', accent: '#aeb7c5', featured: 1, rank: 3, sort: 3, perks: ['All Gold +', 'Front-row lottery', 'Annual gift box', 'Shop 15% discount', 'Priority 2x'] },
  { id: 'diamond', name: 'DIAMOND VIP', tagline: 'Ultimate — Front & Private', price_yen: 1000000, icon: '◆', accent: '#ddc28a', featured: 0, rank: 4, sort: 4, perks: ['All Platinum +', 'Guaranteed Meet & Greet (1/year)', 'Private booking access', 'Personal concierge', 'Taipei birthday lottery'] },
];

const NEWS = [
  { date: '2026.09.15', category: 'CONCERT', title: 'Daily Update — Checkpoint Tour Fukuoka Sep 10 at TOTTEI PARK, Fan Club lottery now open', featured: 1, image: IMG.tour2, body: 'Gate 12:00 / Show 14:00. Fan Club lottery closes 2026.09.08 23:59 JST. Meet & Greet remaining: 6 of 20.' },
  { date: '2026.09.14', category: 'RELEASE', title: '“CHECKPOINT” — 12 tracks streaming now, limited vinyl & Vault download for members', image: IMG.off4, body: 'Limited pearl vinyl ships 2026.09.30. Members download the Vault mix from the exclusive player.' },
  { date: '2026.09.13', category: 'MOVIE', title: 'TOKYO TAXI — teaser stills released, premiere November (Kyojo Requiem also updated)', image: IMG.tour5, body: 'Directed by Yoji Yamada. Premiere 2026.11.01 — stage greetings in Tokyo and Fukuoka.' },
  { date: '2026.09.12', category: 'REGULAR', title: 'Flow #414 — Sun 11:30 TOKYO FM, special talk on Checkpoint rehearsal', image: IMG.off1, body: 'Rehearsal stories, setlist whispers and a listener Q&A — vault audio for members afterwards.' },
  { date: '2026.09.11', category: 'NEWS', title: 'Fan Club Daily — Dashboard activity & Ticket chat live, today’s vault drop at midnight JST', image: IMG.off3, body: 'Ticket chat now routes straight to Management; vault drops unlock at 00:00 JST for active cards.' },
  { date: '2026.09.07', category: 'CONCERT', title: 'Seoul (Oct 18) & Taipei (Nov 13 Birthday Special) — Gold+ lottery, Diamond guaranteed', image: IMG.tour3, body: 'Gold and above enter the Seoul lottery; Diamond VIP holds a guaranteed Taipei birthday seat block.' },
];

const SCHEDULE = [
  { starts_on: '2026.09.15', starts_at: '11:30', title: 'Flow — TOKYO FM', meta: 'Radio • Nationwide', kind: 'RADIO', sort: 1 },
  { starts_on: '2026.09.16', starts_at: '21:00', title: 'THE SWARM — Episode', meta: 'Hulu / NTV', kind: 'TV', sort: 2 },
  { starts_on: '2026.09.18', starts_at: '19:00', title: 'Checkpoint Rehearsal Live (Vault)', meta: 'Members Only Stream', kind: 'VAULT', sort: 3 },
  { starts_on: '2026.09.20', starts_at: '18:00', title: 'Magazine Interview — Editorial', meta: 'CREA / AERA', kind: 'MAGAZINE', sort: 4 },
  { starts_on: '2026.09.22', starts_at: '14:00', title: 'Kyojo Requiem — Press Conference', meta: 'Tokyo • Live Stream', kind: 'TV', sort: 5 },
  { starts_on: '2026.09.30', starts_at: '00:00', title: 'Vault Update — Birthday Message Template', meta: 'Exclusive Vault', kind: 'VAULT', sort: 6 },
];

const WORKS = [
  // film / drama
  { kind: 'movie', title: 'TOKYO TAXI', role: 'Lead', meta: '2026.11.01 • MOVIE', description: 'Heart-warming road movie directed by Yoji Yamada.', image: IMG.tour5, release_date: '2026.11.01', year: '2026', sort: 1 },
  { kind: 'drama', title: 'Kyojo Requiem / Reunion', role: 'Kazama Kimichika', meta: '2026.09.30 • DRAMA', description: 'The instructor returns — Blu-ray & DVD with exclusive commentary.', image: IMG.off2, release_date: '2026.09.30', year: '2026', sort: 2 },
  { kind: 'movie', title: 'THE SWARM', role: 'Lead', meta: '2025.02.15 • MOVIE', description: 'International co-production — deep sea thriller.', image: IMG.tour3, release_date: '2025.02.15', year: '2025', sort: 3 },
  { kind: 'movie', title: 'Judgment — Yagami', role: 'Voice / Motion', meta: '2021 • GAME/DRAMA', description: 'Lost Judgment — voice and performance capture.', image: IMG.off5, release_date: '2021.09.24', year: '2021', sort: 4 },
  { kind: 'movie', title: 'Masquerade Hotel', role: 'Nitta Makoto', meta: '2019.01.18 • MOVIE', description: 'Box office No.1 — front desk detective.', image: IMG.off1, release_date: '2019.01.18', year: '2019', sort: 5 },
  { kind: 'movie', title: 'Howl’s Moving Castle', role: 'Voice of Howl', meta: '2004.11.20 • ANIMATION', description: 'Studio Ghibli — voice of Howl.', image: IMG.off3, release_date: '2004.11.20', year: '2004', sort: 6 },
  { kind: 'drama', title: 'HERO', role: 'Kuriyu Kaihara', meta: '2001 • DRAMA', description: 'All episodes above 30% ratings — “King of Ratings”.', image: IMG.tour2, release_date: '2001.01.08', year: '2001', sort: 7 },
  { kind: 'drama', title: 'Long Vacation', role: 'Sawada Ryosuke', meta: '1996 • DRAMA', description: 'Lon-bake phenomenon — the cultural turning point.', image: IMG.off4, release_date: '1996.01.08', year: '1996', sort: 8 },
  { kind: 'drama', title: 'Beautiful Life', role: 'Asai Kenji', meta: '2000 • DRAMA', description: 'TBS Friday — designer romance, 30%+ average.', image: IMG.tour4, release_date: '2000.01.14', year: '2000', sort: 9 },
  // regular
  { kind: 'radio', title: 'Flow', role: 'Host', meta: 'RADIO', description: 'Every Sunday 11:30 TOKYO FM — Takuya’s voice, music, guests.', image: IMG.off4, year: '1997→', sort: 1 },
  { kind: 'tv', title: 'THE SWARM', role: 'Lead', meta: 'TV', description: 'International thriller — now streaming. Behind-the-scenes + interview.', image: IMG.tour3, year: '2026', sort: 2 },
  { kind: 'magazine', title: 'Editorial — Cinematic Portrait', role: 'Cover', meta: 'MAGAZINE', description: 'Creamy black & gold editorial, interview and vault photos.', image: IMG.off1, year: '2026', sort: 3 },
  // cm
  { kind: 'cm', title: 'McDonald’s Japan', meta: 'CM', description: 'National campaign', year: '2026', sort: 1 },
  { kind: 'cm', title: 'Levi’s', meta: 'Fashion', description: 'Global face', year: '2025', sort: 2 },
  { kind: 'cm', title: 'NISSAN', meta: 'Auto', description: 'Series ambassador', year: '2024', sort: 3 },
  { kind: 'cm', title: 'SUNTORY', meta: 'Beverage', description: 'On the rocks', year: '2023', sort: 4 },
  { kind: 'cm', title: 'Shiseido', meta: 'Beauty', description: 'Men’s campaign', year: '2022', sort: 5 },
  { kind: 'cm', title: 'TOYOTA', meta: 'Auto', description: 'Mobility films', year: '2021', sort: 6 },
];

const RELEASES = [
  { kind: 'album', title: 'CHECKPOINT', release_date: '2026.08.12', cover: IMG.tour3, blurb: '12 tracks — tour anchors, vault edits, one acoustic bonus.', price_yen: 4800, product_sku: 'CKPT-VINYL', sort: 1, tracks: ['Checkpoint Overture', 'Nationwide', 'Lonely Highway', 'Seoul Nights', 'Taipei Rain', 'Checkpoint Reprise', 'Gold Static', 'Flow Into You', 'Arena Lights', 'Never Enough', 'Vault Edit', 'See You There (Acoustic)'] },
  { kind: 'album', title: 'SEE YOU THERE', release_date: '2024.08.14', cover: IMG.tour2, blurb: 'Warm band record — tour closing anthem.', price_yen: 3300, product_sku: 'SYT-CD', sort: 2, tracks: ['See You There', 'Rearview', 'Summer Static', 'One More Lap', 'Pearl Avenue', 'Late Show'] },
  { kind: 'album', title: 'Next Destination', release_date: '2022.01.19', cover: IMG.tour3, blurb: 'Road-side sketches and brass.', price_yen: 3300, sort: 3, tracks: ['Next Destination', 'Airport 5AM', 'Coastline', 'Quiet Engine', 'Return Ticket'] },
  { kind: 'single', title: 'Flow Theme — Vault Edit', release_date: '2026.06.10', cover: IMG.off1, blurb: 'TOKYO FM Flow open — members get the vault edit.', sort: 4, tracks: ['Flow Theme (Vault Edit)', 'Flow Theme (Radio)'] },
];

const TOUR = [
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.09.10', time: '12:00', city: 'Fukuoka', venue: 'TOTTEI PARK', note: 'Fan Club pre-sale • 6 left / 20', capacity: 20, remaining: 6, tier_required: 'silver', status: 'on_sale', sort: 1 },
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.09.20', time: '18:00', city: 'Tokyo', venue: 'Arena Tokyo', note: 'Two nights • Sep 20–23', capacity: 40, remaining: 18, tier_required: 'silver', status: 'on_sale', sort: 2 },
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.10.18', time: '18:00', city: 'Seoul', venue: 'Gocheok Hall', note: 'Lottery • Gold+ only', capacity: 20, remaining: 0, tier_required: 'gold', status: 'lottery', sort: 3 },
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.11.13', time: '17:00', city: 'Taipei', venue: 'Arena Taipei', note: 'Birthday Special • Diamond guaranteed', capacity: 12, remaining: 3, tier_required: 'diamond', status: 'lottery', sort: 4 },
];

const VAULT = [
  { code: 'VAULT 01', title: 'Rehearsal — Checkpoint', description: 'Unseen studio moments, soundcheck whispers. 4-min private stream + photos.', image: IMG.off1, min_tier: 'silver', duration: '04:12', streams: 1284, likes: 512, sort: 1 },
  { code: 'VAULT 02', title: 'Private Gallery', description: 'High-res Polaroids, handwritten notes, 4K wallpapers.', image: IMG.off2, min_tier: 'gold', duration: 'GALLERY · 24 frames', streams: 903, likes: 421, sort: 2 },
  { code: 'VAULT 03', title: 'Surprise Stream', description: 'Monthly private live — Q&A + acoustic. Invite + replay for Platinum/Diamond.', image: IMG.off1, min_tier: 'platinum', duration: 'LIVE · monthly', streams: 512, likes: 388, sort: 3 },
];

const JOURNAL = [
  { category: 'TOUR', title: 'Checkpoint Rehearsal Diaries', excerpt: 'Inside the soundcheck — what the vault cameras caught the night before Fukuoka.', body: 'Two amps, one piano, and a setlist that kept changing until 2AM. The Fukuoka run opens with Checkpoint Overture played against a single follow-spot; the vault cameras stayed rolling. What follows is the rehearsal in seven frames — the quiet ones are the ones that matter.', image: IMG.off1, published_at: '2026.09.15', read_minutes: 4, visibility: 'public', sort: 1 },
  { category: 'FILM', title: 'TOKYO TAXI — On Set with Yoji Yamada', excerpt: 'The road movie’s quiet heart — first stills inside the Journal.', body: 'Yamada-san shoots in takes, not fragments. A cab, a driver, a passenger who changes the trip. Still released here for the first time — the night sequence on the Shuto Expressway, filmed with one practical lamp.', image: IMG.tour3, published_at: '2026.09.14', read_minutes: 6, visibility: 'public', sort: 2 },
  { category: 'STYLE', title: 'Creamy Black & Gold — Editorial', excerpt: 'Portrait series, interview and vault Polaroids — premium Japandi.', body: 'The brief was simple: warmth without gloss. Pearl paper, ink black, one gold line. Shot on medium format, printed on uncoated stock.', image: IMG.off3, published_at: '2026.09.12', read_minutes: 3, visibility: 'public', sort: 3 },
  { category: 'TOUR', title: 'Checkpoint — Fukuoka to Taipei', excerpt: 'Arena guide, QR passport and meet & greet lottery explained.', body: 'Six cities, one passport. Bring your fan card to the venue kiosk, scan the QR at the merch line, and the stamp lands in your Tour Passport. Miss a city and the vault keeps the replay.', image: IMG.tour2, published_at: '2026.09.11', read_minutes: 5, visibility: 'public', sort: 4 },
  { category: 'MUSIC', title: 'Flow #414 — Sunday 11:30', excerpt: 'Every Sunday TOKYO FM — behind-the-scenes in Vault.', body: 'Forty minutes with a live band in the room. The vault audio adds the pre-show chatter and the second take nobody heard.', image: IMG.off4, published_at: '2026.09.10', read_minutes: 2, visibility: 'members', sort: 5 },
  { category: 'FILM', title: 'Kyojo Requiem — Kazama Returns', excerpt: 'The instructor walks back into the classroom, ten years later.', body: 'Reunion special in three parts. Commentary track recorded with the original crew; the rehearsal room footage is in the vault.', image: IMG.off2, published_at: '2026.09.07', read_minutes: 4, visibility: 'members', sort: 6 },
];

const ARCHIVE = [
  { year: '1987', era: 'STARTO', title: 'Debut — STARTO', description: 'Johnny’s • The Skate Boys → SMAP', image: IMG.off1, sort: 1 },
  { year: '1991', era: 'SMAP', title: 'SMAP — Can’t Stop Loving', description: 'Debut single', image: IMG.off2, sort: 2 },
  { year: '1996', era: 'DRAMA', title: 'Long Vacation', description: 'Lon-bake • King of Ratings', image: IMG.off3, sort: 3 },
  { year: '2001', era: 'DRAMA', title: 'HERO', description: 'All episodes >30%', image: IMG.tour2, sort: 4 },
  { year: '2004', era: 'FILM', title: 'Howl’s Moving Castle', description: 'Voice of Howl', image: IMG.off4, sort: 5 },
  { year: '2019', era: 'FILM', title: 'Masquerade Hotel', description: 'Box office No.1', image: IMG.off5, sort: 6 },
  { year: '2026', era: 'TOUR', title: 'Checkpoint Tour', description: 'Arena nationwide • TOKYO TAXI', image: IMG.tour1, sort: 7 },
];

const PRODUCTS = [
  { sku: 'CKPT-TEE-BK', title: 'CHECKPOINT Tour Tee — Black', category: 'Apparel', price_yen: 8800, stock: 42, image: IMG.off1, blurb: 'Organic cotton • Gold print', member_discount: 10, images: [IMG.off1, IMG.off3], sort: 1 },
  { sku: 'CKPT-PHOTO6', title: 'Tour Photo Set (6)', category: 'Tour Merch', price_yen: 3500, stock: 18, image: IMG.tour2, blurb: 'Polaroids + message card', member_discount: 5, images: [IMG.tour2, IMG.tour3], sort: 2 },
  { sku: 'CKPT-VINYL', title: 'CHECKPOINT — Vinyl', category: 'Albums', price_yen: 4800, stock: 6, image: IMG.off3, blurb: 'Limited pearl vinyl', member_discount: 10, images: [IMG.off3, IMG.off1], sort: 3 },
  { sku: 'TK-CAP-GLD', title: 'Gold Logo Cap', category: 'Accessories', price_yen: 6200, stock: 25, image: IMG.off2, blurb: 'Embroidered TK', member_discount: 15, images: [IMG.off2, IMG.off3], sort: 4 },
  { sku: 'TK-JKT-PRL', title: 'Portfolio Jacket', category: 'Apparel', price_yen: 18000, stock: 4, image: IMG.off3, blurb: 'Creamy pearl • Member patch', member_discount: 10, images: [IMG.off3, IMG.off2], sort: 5 },
  { sku: 'CKPT-LNYRD', title: 'Lanyard — Checkpoint', category: 'Accessories', price_yen: 2800, stock: 0, image: IMG.tour4, blurb: 'Woven + QR holder', member_discount: 5, images: [IMG.tour4], sort: 6 },
  { sku: 'TK-TWL-26', title: 'Tour Towel — 2026', category: 'Tour Merch', price_yen: 3200, stock: 30, image: IMG.tour1, blurb: 'Fukuoka • Seoul • Taipei', member_discount: 5, images: [IMG.tour1, IMG.tour5], sort: 7 },
  { sku: 'SYT-CD', title: 'SEE YOU THERE — CD', category: 'Albums', price_yen: 3300, stock: 55, image: IMG.tour5, blurb: 'Standard edition', member_discount: 10, images: [IMG.tour5, IMG.tour2], sort: 8 },
];

const STATS = [
  { icon: '◉', value: '1987→', label: 'Debut — STARTO', note: '38 years active', sort: 1 },
  { icon: '🎬', value: '83', label: 'Film / Drama Credits', note: 'Live metric', sort: 2 },
  { icon: '🎤', value: '6', label: 'Tour Cities 2026', note: 'Fukuoka • Seoul • Taipei +3', sort: 3 },
  { icon: '💿', value: '12', label: 'Releases', note: 'Checkpoint out now', sort: 4 },
];

const SETTINGS = {
  /* empty on purpose: canonical, OG and sitemap URLs then follow the request host, which is right
     on every preview and on localhost. Set it (here or via SITE_URL) for the production domain. */
  'site.url': '',
  'site.brand': 'STARTO ENTERTAINMENT',
  'site.brandSub': 'TAKUYA KIMURA • OFFICIAL',
  'site.title': 'Takuya Kimura — Official Digital World | STARTO ENTERTAINMENT',
  'site.description': 'Evolving digital home for Takuya Kimura — Live Tour 2026 Checkpoint (Fukuoka→Seoul→Taipei), Fan Club Vault, Tour Passport, private Meet & Greet. Premium cream & gold, ticket-based support from Official Site / Management.',
  'topbar.live': 'Live Tour 2026 Checkpoint — On Sale',
  'daily.text': 'Checkpoint Tour Fukuoka Sep 10 at TOTTEI PARK — Fan Club lottery now open',
  'marquee.items': 'TAKUYA KIMURA • LIVE TOUR 2026 CHECKPOINT • ON SALE •|NEW ALBUM “CHECKPOINT” — 2026.08.12 •|FAN CLUB MEMBERSHIP ¥300,000 — ¥1,000,000 • MEET & GREET TICKET OPEN •|EXCLUSIVE VAULT FOR MEMBERS • BIRTHDAY SURPRISE •',
  'hero.sideTitle': 'TAKUYA KIMURA Live Tour 2026',
  'hero.sideKicker': 'Next Up — Fukuoka',
  'hero.sideBody': 'Sep 5 – Nov 23 • C&C STAGE\nFan Club pre-sale & Meet & Greet ticket.',
  'about.name': 'Takuya Kimura',
  'about.kanji': '木村拓哉',
  'about.lead': 'From SMAP (1991–2016) to solo stardom — Long Vacation, HERO, Beautiful Life, Good Luck!!, La Grande Maison and THE SWARM. “King of Ratings”, voice of Howl, Judgment’s Yagami, now TOKYO TAXI & Kyojo Requiem.',
  'about.body': 'Known as Kimutaku — Best Jeanist, Levi’s global face, host of Flow every Sunday 11:30 TOKYO FM. Agency: STARTO ENTERTAINMENT.',
  'about.caption': '木村拓哉 • Takuya Kimura — Born 1972.11.13 • 176cm • O',
  'about.image': IMG.off3,
  'booking.note': 'Creates a support ticket → Management replies via chat.',
  'contact.email': 'support@celebritypage.app',
  'social.x': 'https://x.com/CandC_STAGE',
  'social.ig': 'https://www.instagram.com/takuya.kimura_tak/',
  'social.yt': 'https://www.youtube.com/@takuya.kimura.official',
  'link.starto': 'https://starto.jp/s/p/artist/35?lang=en',
  'footer.tagline': 'Cinematic • Elegant • Japanese • Premium.\nAn evolving digital home for Takuya Kimura — Fan Club, Vault, Tour Pass & private sessions. Ticket-based support from Official Site / Management.',
  'footer.legal': 'Tribute concept — not affiliated until management licensing approved. All titles/assets shown as DATA REQUIRED until licensed. Payments via compliant providers — no raw card storage.',
  'vault.nextDrop': '2026.09.30',
  'vault.surpriseTitle': 'Birthday Video Message',
  'vault.surpriseBody': 'Members receive a personal birthday video & handwritten digital card on their special day — a one-of-a-kind memory, only for Fan Club family.',
  'shop.banner': 'Official Shop — Apparel • Tour Merch • Accessories • Albums — Inventory live',
  'chat.greeting': 'Hello — Official Site / Management here. Ask about Fan Club, Vault, or Booking.',
  'kpi.nextDrawSec': '8073',
};

function seedIfEmpty() {
  const db = getDb();
  const put = (table, rows, json = []) => {
    if (!tableEmpty(table)) return 0;
    rows.forEach((r, i) => {
      const obj = { ...r };
      if (obj.sort === undefined && !('sort' in (rows[0] || {}))) obj.sort = i + 1;
      json.forEach((k) => { if (obj[k] !== undefined) obj[k] = JSON.stringify(obj[k]); });
      insert(table, obj);
    });
    return rows.length;
  };

  const counts = {};
  counts.hero_slides = put('hero_slides', HERO.map((h) => ({ kicker: h.kicker, title: h.title, subtitle: h.sub, image: h.img, alt: h.alt, cta_label: h.cta[0], cta_href: h.cta[1], tone: h.tone, active: 1 })));
  counts.tiers = put('tiers', TIERS, ['perks']);
  counts.news = put('news', NEWS);
  counts.schedule = put('schedule', SCHEDULE);
  counts.works = put('works', WORKS);
  counts.releases = put('releases', RELEASES, ['tracks']);
  counts.tour_dates = put('tour_dates', TOUR);
  counts.vault_items = put('vault_items', VAULT);
  counts.journal_posts = put('journal_posts', JOURNAL.map(({ sort, ...j }) => ({ ...j, sort })));
  counts.archive_items = put('archive_items', ARCHIVE);
  counts.products = put('products', PRODUCTS, ['images']);
  counts.stats = put('stats', STATS);

  Object.entries(SETTINGS).forEach(([key, value]) => {
    db.prepare(`INSERT INTO settings (key, value, label) VALUES (?,?,?) ON CONFLICT(key) DO NOTHING`).run(key, String(value), key);
  });

  return counts;
}

function seedUsers() {
  const db = getDb();
  const hasAdmin = db.prepare(`SELECT 1 FROM users WHERE role='admin' LIMIT 1`).get();
  if (!hasAdmin) {
    insert('users', { name: 'STARTO Management', email: 'admin@starto.jp', pass_hash: bcrypt.hashSync('Starto2026!', 10), role: 'admin' });
    audit('system', 'SEED', 'users', 'admin created');
  }
  const demo = [
    { name: 'Aiko Tanaka', email: 'aiko@example.com', tier: 'platinum', status: 'active' },
    { name: 'Marc Dubois', email: 'marc@example.com', tier: 'gold', status: 'active' },
    { name: 'Yuki Sato', email: 'yuki@example.com', tier: 'none', status: null },
  ];
  demo.forEach((d, i) => {
    const exists = db.prepare(`SELECT 1 FROM users WHERE email=?`).get(d.email);
    if (exists) return;
    const info = insert('users', { name: d.name, email: d.email, pass_hash: bcrypt.hashSync('Starto2026!', 10), role: 'member', created_at: '2026-0' + (7 + i) + '-1' + i + ' 09:00:00' });
    const uid = info.lastInsertRowid;
    if (d.tier !== 'none') {
      const t = TIERS.find((x) => x.id === d.tier);
      insert('memberships', { user_id: uid, tier: d.tier, card_no: 'TK-482' + (i + 1), price_yen: t.price_yen, status: 'active', issued_at: '2026-08-01 10:00:00', valid_until: '2027-08-01' });
      const tk = insert('tickets', { code: 'TKT-2026-' + (410 + i), user_id: uid, email: d.email, name: d.name, subject: 'Purchase Fan Card — ' + t.name + ' ¥' + t.price_yen.toLocaleString(), category: 'membership', status: i === 0 ? 'in_progress' : 'open' });
      insert('ticket_messages', { ticket_id: tk.lastInsertRowid, sender: 'user', body: 'I want to purchase ' + t.name + ' Fan Card ¥' + t.price_yen + '/year. Please assist with ticket & payment.' });
      insert('ticket_messages', { ticket_id: tk.lastInsertRowid, sender: 'staff', body: 'Welcome — payment details sent to your registered email. Meet & Greet priority is already applied.' });
      insert('notifications', { user_id: uid, title: 'Fan Card issued', body: t.name + ' card TK-482' + (i + 1) + ' is active until 2027.08.', kind: 'membership' });
    }
    if (i === 1) {
      insert('bookings', { user_id: uid, name: d.name, email: d.email, type: 'Meet & Greet', date: '2026-10-18', guests: 2, budget_yen: 500000, message: 'Seoul — hoping for a photo after the show.', status: 'Pending Review' });
    }
  });
}

export function seed() {
  const counts = seedIfEmpty();
  seedUsers();
  counts.extras = seedExtras();      // live-show content: tour dates, shows, wall, lotteries (additive, needs users)
  const written = Object.entries(counts).filter(([, n]) => n > 0).map(([t, n]) => `${t}:${n}`);
  if (written.length) console.log('[seed] ' + written.join('  '));
  return counts;
}

/* ---------- CLI: `node server/seed.js` (also used by npm run db:seed) ---------- */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  getDb();
  const c = seed();
  const total = Object.values(c).reduce((s, n) => s + n, 0);
  console.log(total ? `[seed] ${total} rows ready` : '[seed] database already populated — nothing to do');
}
