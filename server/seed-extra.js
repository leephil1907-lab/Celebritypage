/**
 * server/seed-extra.js — the content layer the live-show features need: a full tour, a show
 * archive with setlists, fan-wall notes, open lotteries and the passport records that go with them.
 *
 * Everything here is ADDITIVE and idempotent: it inserts what a database does not have yet
 * (matched on the natural key of each table) instead of only filling empty tables, so an
 * existing site gains the new content on the next boot and a reset database gets it the same way.
 * Copy stays inside the site's own fiction — titles, venues and numbers are invented for the demo.
 */
import { getDb, all, get, run, insert, tableEmpty } from './db.js';
import { drawRaffle, entryCode, venueCode, venueGeo, parseJst } from './lib/tourkit.js';

const IMG = {
  tour1: '/image-search/takuya-kimura-live-tour-checkpoint-2026--1.gif',
  tour2: '/image-search/takuya-kimura-live-tour-checkpoint-2026--2.jpg',
  tour3: '/image-search/takuya-kimura-live-tour-checkpoint-2026--3.jpg',
  tour4: '/image-search/takuya-kimura-live-tour-checkpoint-2026--4.webp',
  tour5: '/image-search/takuya-kimura-live-tour-checkpoint-2026--5.webp',
  off1: '/image-search/takuya-kimura-starto-entertainment-offic-5.jpg',
  off2: '/image-search/takuya-kimura-starto-entertainment-offic-3.webp',
  off3: '/image-search/takuya-kimura-starto-entertainment-offic-4.png',
  off4: '/image-search/takuya-kimura-live-tour-checkpoint-2026--4.webp',
  off5: '/image-search/takuya-kimura-starto-entertainment-offic-5.jpg',
};

const CHECKPOINT = ['Checkpoint Overture', 'Nationwide', 'Lonely Highway', 'Seoul Nights', 'Taipei Rain', 'Checkpoint Reprise', 'Gold Static', 'Flow Into You', 'Arena Lights', 'Never Enough', 'Vault Edit', 'See You There (Acoustic)'];
const ENCORE = ['Pearl Avenue', 'One More Lap'];
const BRASS = ['Checkpoint Overture (Brass Mix)', 'Arena Lights'];

/* ------------------------------------------------------------------ tour */

/** dates, doors, the code on the passport card at the door, and what the night opened with */
export const TOUR_EXTRA = [
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.09.23', time: '18:00', doors: '17:00', city: 'Tokyo', venue: 'Arena Tokyo', capacity: 40, remaining: 9, tier: 'silver', status: 'on_sale', code: 'CKPT-TKY-0923', note: 'Tour broadcast capture • live edit screened for members', teaser: 'Opens with Checkpoint Overture under a single follow-spot' },
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.09.27', time: '18:00', doors: '17:00', city: 'Osaka', venue: 'Grand Cube', capacity: 36, remaining: 0, tier: 'silver', status: 'sold_out', code: 'CKPT-OSK-0927', note: 'Sold out in 40 minutes • waitlist open', teaser: 'The Osaka band adds a nine-piece horn section' },
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.09.28', time: '17:00', doors: '16:00', city: 'Osaka', venue: 'Grand Cube', capacity: 36, remaining: 12, tier: 'silver', status: 'on_sale', code: 'CKPT-OSK-0928', note: 'Second night • afternoon merch queue opens 13:30', teaser: 'Taipei Rain played for the first time with the strings' },
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.10.04', time: '18:30', doors: '17:30', city: 'Nagoya', venue: 'Sky Hall', capacity: 30, remaining: 7, tier: 'silver', status: 'on_sale', code: 'CKPT-NGY-1004', note: 'Home-town night — the encore is chosen by the room', teaser: 'A three-song acoustic block in the middle of the set' },
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.10.11', time: '17:30', doors: '16:30', city: 'Sapporo', venue: 'Park Arena', capacity: 24, remaining: 4, tier: 'gold', status: 'on_sale', code: 'CKPT-SPR-1011', note: 'Gold+ pre-sale closed, general release small', teaser: 'Cold open on the rotating stage, no lights up' },
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.10.19', time: '18:00', doors: '17:00', city: 'Seoul', venue: 'Nexus Hall', capacity: 20, remaining: 0, tier: 'gold', status: 'waitlist', code: 'CKPT-SOL-1019', note: 'Second Seoul night added after the lottery oversubscribed', teaser: 'Seoul Nights with a guest vocalist — announced at soundcheck' },
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.10.24', time: '18:00', doors: '17:00', city: 'Sendai', venue: 'Wave Hall', capacity: 22, remaining: 11, tier: 'silver', status: 'on_sale', code: 'CKPT-SND-1024', note: 'Tohoku benefit block — 200 seats held for schools', teaser: 'Never Enough sung from the thrust, no band' },
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.11.01', time: '17:30', doors: '16:30', city: 'Hiroshima', venue: 'River Hall', capacity: 20, remaining: 3, tier: 'gold', status: 'on_sale', code: 'CKPT-HRS-1101', note: 'TOKYO TAXI premiere day — the cast attends the show', teaser: 'An interlude scored for shamisen and one amp' },
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.11.07', time: '18:00', doors: '17:00', city: 'Kanazawa', venue: 'Ishikawa Hall', capacity: 18, remaining: 6, tier: 'silver', status: 'on_sale', code: 'CKPT-KNZ-1107', note: 'Smallest room of the tour • 400 lottery applications', teaser: 'The whole set played twice as loud in the balcony' },
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.11.14', time: '17:00', doors: '16:00', city: 'Taipei', venue: 'Summit Arena', capacity: 14, remaining: 2, tier: 'diamond', status: 'lottery', code: 'CKPT-TPE-1114', note: 'Birthday weekend, night two — Diamond VIP holds a block', teaser: 'A Mandarin verse of Flow Into You, learned in rehearsal' },
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.11.23', time: '17:00', doors: '16:00', city: 'Fukuoka', venue: 'Bay Arena', capacity: 20, remaining: 5, tier: 'silver', status: 'on_sale', code: 'CKPT-FUK-1123', note: 'Tour closer — the band plays the full vault encore', teaser: 'Where the tour opened, and where the film crew stays all night' },
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.12.05', time: '19:00', doors: '18:00', city: 'Bangkok', venue: 'Golden Hall', capacity: 16, remaining: 0, tier: 'gold', status: 'sold_out', code: 'CKPT-BKK-1205', note: 'Sold out • local string section joins for Taipei Rain', teaser: 'Rehearsed in the afternoon, played in the evening' },
  { tour: 'Live Tour 2026 Checkpoint', date: '2026.12.12', time: '19:00', doors: '18:00', city: 'Singapore', venue: 'Marina Arena', capacity: 16, remaining: 8, tier: 'gold', status: 'on_sale', code: 'CKPT-SIN-1212', note: 'Fan club booth opens two hours early for members', teaser: 'Arena Lights on a 200-metre walkway of house lights' },
  { tour: 'Checkpoint — Encore Nights', date: '2027.01.10', time: '18:00', doors: '17:00', city: 'Tokyo', venue: 'Dome City Hall', capacity: 24, remaining: 24, tier: 'platinum', status: 'pre_sale', code: 'ENCR-TKY-0110', note: 'Platinum pre-sale opens 2026.12.20 12:00 JST', teaser: 'An acoustic-only running order, no second set' },
  { tour: 'Checkpoint — Encore Nights', date: '2027.02.14', time: '18:30', doors: '17:30', city: 'Osaka', venue: 'Grand Cube', capacity: 30, remaining: 30, tier: 'platinum', status: 'pre_sale', code: 'ENCR-OSK-0214', note: 'String Night — Valentine show, brass and 12 strings', teaser: 'Every song rearranged for one microphone and a quartet' },
];

/* ------------------------------------------------------------ appearances */

export const SCHEDULE_EXTRA = [
  { starts_on: '2026.09.19', starts_at: '21:00', title: 'Kyojo Requiem — Episode 1', meta: 'NTV • Nationwide', kind: 'TV', sort: 11 },
  { starts_on: '2026.09.21', starts_at: '13:00', title: 'Checkpoint Tokyo — Rehearsal Stream', meta: 'Vault • Members only', kind: 'VAULT', sort: 12 },
  { starts_on: '2026.09.22', starts_at: '11:30', title: 'Flow #416 — Tour Week Special', meta: 'TOKYO FM', kind: 'RADIO', sort: 13 },
  { starts_on: '2026.09.26', starts_at: '18:30', title: 'CREA — Cover Release Week', meta: 'Interview + portrait', kind: 'MAGAZINE', sort: 14 },
  { starts_on: '2026.10.03', starts_at: '19:00', title: 'TOKYO TAXI — Preview Screening', meta: 'Roppongi • Stage greeting', kind: 'EVENT', sort: 15 },
  { starts_on: '2026.10.09', starts_at: '22:00', title: '27 Hour TV — Charity Block', meta: 'NTV • Live', kind: 'TV', sort: 16 },
  { starts_on: '2026.10.17', starts_at: '15:00', title: 'Seoul Soundcheck — Vault Clip', meta: 'Members Only Stream', kind: 'VAULT', sort: 17 },
  { starts_on: '2026.10.25', starts_at: '11:30', title: 'Flow #420 — Sendai Road Diary', meta: 'TOKYO FM', kind: 'RADIO', sort: 18 },
  { starts_on: '2026.11.01', starts_at: '10:00', title: 'TOKYO TAXI — Premiere & Greetings', meta: 'Roppongi • Two stages', kind: 'EVENT', sort: 19 },
  { starts_on: '2026.11.08', starts_at: '19:30', title: 'SUNTORY — New CM Reveal', meta: 'Nationwide • Digital first', kind: 'TV', sort: 20 },
  { starts_on: '2026.11.13', starts_at: '17:00', title: 'Birthday Session — Taipei Night', meta: 'Fan Club Event • Diamond', kind: 'EVENT', sort: 21 },
  { starts_on: '2026.11.21', starts_at: '12:00', title: 'Checkpoint Photo Book — Press Talk', meta: 'Tokyo • Media only', kind: 'MAGAZINE', sort: 22 },
  { starts_on: '2026.12.06', starts_at: '11:30', title: 'Flow #425 — Bangkok Notes', meta: 'TOKYO FM', kind: 'RADIO', sort: 23 },
  { starts_on: '2026.12.19', starts_at: '20:00', title: 'Live Tour Documentary — Part 1', meta: 'Hulu • Members first', kind: 'TV', sort: 24 },
  { starts_on: '2027.01.04', starts_at: '18:00', title: 'Encore Nights — Pre-sale Briefing', meta: 'Fan Club Live', kind: 'VAULT', sort: 25 },
  { starts_on: '2027.01.24', starts_at: '15:00', title: 'Checkpoint Remixes — Listening Room', meta: 'Shibuya • 300 seats', kind: 'EVENT', sort: 26 },
  { starts_on: '2027.02.13', starts_at: '19:00', title: 'String Night — Dress Rehearsal Stream', meta: 'Members Only', kind: 'VAULT', sort: 27 },
  { starts_on: '2027.03.06', starts_at: '13:00', title: 'Fan Club Anniversary — Hall & Live', meta: 'Yokohama • 4,000 seats', kind: 'EVENT', sort: 28 },
];

export const NEWS_EXTRA = [
  { date: '2026.09.17', category: 'CONCERT', title: 'Tour Passport live at every gate — check in with the code on your card', featured: 1, image: IMG.tour2, body: 'Show your fan card at the venue desk or enter the date code (on the passport board by the door) and the stamp lands in your Tour Passport. Twelve cities, one book — the vault unlocks the city replay the next morning.' },
  { date: '2026.09.16', category: 'RELEASE', title: 'CHECKPOINT — Live at Osaka Grand Cube, double LP pressed for December', image: IMG.tour4, body: 'Recorded across both Osaka nights with the nine-piece horns. Two discs, 22 minutes per side, gateau sleeve — members get the soundcheck EP as a download.' },
  { date: '2026.09.15', category: 'FAN CLUB', title: 'Meet & Greet lottery — Tokyo Night 2 and Osaka open for entries', image: IMG.off2, body: 'One entry per member per draw, tiers as listed. The draw is run on the ticket codes with a published seed, so the order can be checked afterwards.' },
  { date: '2026.10.02', category: 'NEWS', title: 'Fan Wall opens — leave a note, the desk reads every one', image: IMG.off1, body: 'Members post up to two notes a day, 280 characters, reviewed before publishing. Notes with a city on them are printed for the venue board on that night.' },
  { date: '2026.11.24', category: 'CONCERT', title: 'Fukuoka closer filmed in full — documentary part one in December', image: IMG.tour3, body: 'Nine cameras, the whole vault encore, and the band walking the arena floor for One More Lap. Part one lands on Hulu for members first.' },
  { date: '2027.01.05', category: 'RELEASE', title: 'Checkpoint Remixes — twelve reworks, listening room in Shibuya', image: IMG.off5, body: 'Limited to 300 seats, entry by fan club lottery. The digital release follows on 2027.01.22 with the Osaka string sessions as a bonus.' },
];

/* ------------------------------------------------------------- show archive */

export const SHOWS = [
  {
    slug: 'ckpt-2026-fukuoka-0910', tour: 'Live Tour 2026 Checkpoint', date: '2026.09.10', city: 'Fukuoka', venue: 'TOTTEI PARK',
    capacity: 2000, attended: 1940, duration_min: 138,
    setlist: [...CHECKPOINT.slice(0, 8), 'Long Vacation Interlude', ...CHECKPOINT.slice(8)], encore: ENCORE,
    gallery: [IMG.tour2, IMG.tour1, IMG.off4], status: 'published', sort: 20,
    note: 'The tour opening night — follow-spot only for the first three songs.',
    report: 'Two amps, one piano and a setlist that kept changing until 2AM. The room opened dark: a single follow-spot on the upstage ramp for Checkpoint Overture, no band risers until Nationwide. The Fukuoka brass came in for Gold Static and never left. Midway, the piano version of Taipei Rain was played to a phone-light field — the crew stopped moving for that one. The encore was decided in the wings: Pearl Avenue first, then One More Lap walked into the floor, which is why the second disc of the live LP sounds like the room is on top of the stage.',
  },
  {
    slug: 'ckpt-2026-fukuoka-0911', tour: 'Live Tour 2026 Checkpoint', date: '2026.09.11', city: 'Fukuoka', venue: 'TOTTEI PARK',
    capacity: 2000, attended: 1985, duration_min: 144,
    setlist: ['Checkpoint Overture', 'Arena Lights', 'Lonely Highway', 'Seoul Nights', 'Flow Into You', 'Gold Static', 'Vault Edit', 'Never Enough', 'See You There (Acoustic)', 'Checkpoint Reprise'], encore: ['One More Lap', 'Pearl Avenue'],
    gallery: [IMG.tour3, IMG.tour1], status: 'published', sort: 19,
    note: 'Day two — the only night the vault edit was played second.',
    report: 'The band swapped the running order at the soundcheck without telling anyone, which is how Kimutaku works a two-night room. Vault Edit moved up to slot seven and the room caught it cold. The birthday letter from the fan club was read before See You There; nobody in the front row sat down afterwards.',
  },
  {
    slug: 'syt-2025-yokohama-0816', tour: 'See You There — Arena Run', date: '2025.08.16', city: 'Yokohama', venue: 'Kanto Arena',
    capacity: 9000, attended: 8620, duration_min: 126,
    setlist: ['See You There', 'Rearview', 'Summer Static', 'One More Lap', 'Pearl Avenue', 'Late Show', 'Airport 5AM', 'Coastline', 'Quiet Engine', 'Return Ticket'], encore: ['See You There (Full Band Reprise)'],
    gallery: [IMG.tour5, IMG.tour2], status: 'published', sort: 18,
    note: 'The warm band record, played with the curtains open.',
    report: 'A four-piece, a Hammond and no orchestra, which made the summer songs louder than they are on the record. Rearview was dedicated to the crew who had driven the whole coast road with the truck. The reprise at the end ran three minutes long because the band would not stop.',
  },
  {
    slug: 'syt-2025-osaka-0830', tour: 'See You There — Arena Run', date: '2025.08.30', city: 'Osaka', venue: 'Grand Cube',
    capacity: 8000, attended: 7910, duration_min: 118,
    setlist: ['Summer Static', 'See You There', 'Late Show', 'Next Destination', 'One More Lap', 'Return Ticket', 'Coastline', 'Gold Static', 'Pearl Avenue'], encore: ['Never Enough'],
    gallery: [IMG.tour4, IMG.tour1], status: 'published', sort: 17,
    note: 'Typhoon detour — the show started 40 minutes late and ran to the last row.',
    report: 'Half the audience was stuck at the station, so the house band played a 25-minute set and he went out in a rehearsal T-shirt to talk them through it. When the show started properly, the room sang Late Show from the first line to the last.',
  },
  {
    slug: 'nd-2022-nagoya-0213', tour: 'Next Destination', date: '2022.02.13', city: 'Nagoya', venue: 'Sky Hall',
    capacity: 5000, attended: 4820, duration_min: 104,
    setlist: ['Next Destination', 'Airport 5AM', 'Coastline', 'Quiet Engine', 'Return Ticket', 'Lonely Highway', 'Flow Into You'], encore: ['Quiet Engine (Reprise)'],
    gallery: [IMG.off5, IMG.tour3], status: 'published', sort: 16,
    note: 'Brass on a riser behind the stage, one lamp each.',
    report: 'The smallest arena of the run and the loudest. The brass section was seated on the floor at the front of the stage because the riser was late, and the whole set was played around them.',
  },
  {
    slug: 'ckpt-2026-rehearsal-vault', tour: 'Live Tour 2026 Checkpoint', date: '2026.09.05', city: 'Tokyo', venue: 'C&C Stage Rehearsal Room',
    capacity: 0, attended: 0, duration_min: 76,
    setlist: ['Checkpoint Overture (run 1)', 'Nationwide (run 3)', 'Taipei Rain (strings only)', 'Arena Lights (no lights)', 'One More Lap (walkthrough)'], encore: ['Never Enough (acoustic, one mic)'],
    gallery: [IMG.off1, IMG.off4], status: 'published', sort: 15,
    note: 'Streamed to members the night before the tour opened.',
    report: 'No audience, five cameras and a folding chair. The vault cut keeps the between-song talk: the count-in arguments, the piano being tuned mid-song, and the moment the band decides the encore is One More Lap.',
  },
  {
    slug: 'syt-2025-sapporo-0719', tour: 'See You There — Arena Run', date: '2025.07.19', city: 'Sapporo', venue: 'Park Arena',
    capacity: 7000, attended: 6740, duration_min: 121,
    setlist: ['Rearview', 'See You There', 'Summer Static', 'Return Ticket', 'Coastline', 'Pearl Avenue', 'Quiet Engine', 'Late Show'], encore: ['One More Lap', 'See You There'],
    gallery: [IMG.tour2, IMG.off2], status: 'published', sort: 14,
    note: 'The one where the balcony sang the whole second set standing.',
    report: 'The north was 12 degrees and the arena doors opened early. From the third song the upper tiers stayed on their feet, which changed how the band played the second half — longer, looser, one repeated tag on Summer Static that nobody signalled.',
  },
  {
    slug: 'nd-2022-taipei-0320', tour: 'Next Destination', date: '2022.03.20', city: 'Taipei', venue: 'Summit Arena',
    capacity: 6000, attended: 5905, duration_min: 112,
    setlist: ['Next Destination', 'Seoul Nights', 'Coastline', 'Flow Into You', 'Airport 5AM', 'Return Ticket'], encore: ['Pearl Avenue (Mandarin verse)'],
    gallery: [IMG.tour5, IMG.off3], status: 'published', sort: 13,
    note: 'First time the Pearl Avenue verse was sung in Mandarin.',
    report: 'Learned in the afternoon, performed that night, printed on the fan-made banners by the door. The recording of it is the reason the Taipei birthday show keeps a Mandarin block in the running order.',
  },
];

/* -------------------------------------------------------------- lotteries */

export const RAFFLES = [
  {
    title: 'Meet & Greet — Fukuoka Opening Night', prize: 'Handshake + group photo, 40 places', status: 'drawn',
    tier_min: 'silver', winners: 5, alternates: 3, seed: 'CKPT-FUK-2026-01',
    opens_at: '2026.08.20 12:00', closes_at: '2026.09.05 23:59',
    note: 'The draw was run with the published seed; the entry order can be replayed.',
    cities: 'Fukuoka', date: '2026.09.10',
  },
  {
    title: 'Meet & Greet — Tokyo Night 2', prize: 'Greet + signed tour poster, 30 places', status: 'open',
    tier_min: 'gold', winners: 6, alternates: 4, seed: 'CKPT-TKY-2026-02',
    opens_at: '2026.09.14 12:00', closes_at: '2026.09.21 23:59',
    note: 'One entry per member. Winners are notified on the site and by ticket chat.',
    cities: 'Tokyo', date: '2026.09.23',
  },
  {
    title: 'Osaka Strings — Soundcheck Seats', prize: 'Six seats at the string rehearsal, 12 places', status: 'open',
    tier_min: 'silver', winners: 12, alternates: 6, seed: 'CKPT-OSK-2026-03',
    opens_at: '2026.09.16 12:00', closes_at: '2026.09.26 23:59',
    note: 'Members who attend the Osaka nights are eligible for both days.',
    cities: 'Osaka', date: '2026.09.28',
  },
  {
    title: 'Birthday Seat Draw — Taipei Night Two', prize: 'Diamond VIP seat block + birthday session', status: 'open',
    tier_min: 'diamond', winners: 3, alternates: 2, seed: 'CKPT-TPE-2026-11',
    opens_at: '2026.10.20 12:00', closes_at: '2026.11.06 23:59',
    note: 'Diamond VIP holds one guaranteed seat per year; this draw is the additional block.',
    cities: 'Taipei', date: '2026.11.14',
  },
];

/* ---------------------------------------------------------------- fan wall */

export const WALL = [
  { name: 'Aiko N.', city: 'Fukuoka', mood: 'LIVE', status: 'approved', featured: 1, message: 'Second row at TOTTEI PARK on the 10th. He looked at our section during Taipei Rain and I have not recovered. The tour passport stamp is the first thing I have ever framed.', applause: 46, reply: 'Fukuoka was a warm room. The framing is a good idea — send a photo and it goes on the venue board.' },
  { name: 'Marc D.', city: 'Osaka', mood: 'LIVE', status: 'approved', message: 'The Osaka night that started 40 minutes late was the best show of the year. Nobody complained once, and then the room sang Late Show by itself.', applause: 31 },
  { name: 'Yuki S.', city: 'Sapporo', mood: 'MERCH', status: 'approved', featured: 1, message: 'Bought the tour photo set at the Sapporo booth. The Polaroid is slightly out of focus and it is my favourite picture of the year.', applause: 27, reply: 'The out-of-focus batch was a mistake on our side — the next run is sharper, and we will keep this one in the vault as is.' },
  { name: 'Hana K.', city: 'Sendai', mood: 'LOTTERY', status: 'approved', message: 'Lost the Sendai lottery, waited on the waitlist, got a seat in the third release. Thank you to whoever moved the 200 school seats aside at the door.', applause: 22 },
  { name: 'Rin T.', city: 'Tokyo', mood: 'RADIO', status: 'approved', message: 'Flow #414 — the story about tuning the piano mid-song is now the reason I bought the vinyl. Please keep the tour chatter on the vault edits.', applause: 19 },
  { name: 'Sofia L.', city: 'Taipei', mood: 'BIRTHDAY', status: 'approved', featured: 1, message: 'We sang the Mandarin verse back to him at Summit Arena. He stopped, waited, and started it again from the top. I have never heard 6,000 people get it right on the second try.', applause: 58, reply: 'That was the moment the tour was about.' },
  { name: 'Kenji M.', city: 'Nagoya', mood: 'LIVE', status: 'approved', message: 'Encore chosen by the room, and the room chose Quiet Engine. My wife cried. I did not, but I noticed she did.', applause: 14 },
  { name: 'Priya S.', city: 'Singapore', mood: 'MERCH', status: 'approved', message: 'The lanyard sold out in a morning and the booth still found me a spare. The QR holder on it now holds my passport card, which is the correct use of it.', applause: 11 },
  { name: 'Noor A.', city: 'Bangkok', mood: 'LOTTERY', status: 'approved', message: 'First concert, first lottery win, first time hearing Seoul Nights with a guest vocalist. The string section for Taipei Rain deserves its own album.', applause: 26 },
  { name: 'Daichi F.', city: 'Hiroshima', mood: 'LIVE', status: 'pending', message: 'Premiere day at Roppongi — the stage greeting lasted nine minutes and he apologised for the rain, then stayed for eleven more. Note for the desk: the umbrella stand by gate C was empty.' },
  { name: 'Elena V.', city: 'Kanazawa', mood: 'MERCH', status: 'pending', message: 'Smallest room of the tour and he played it like a hall. Suggestion: a Kanazawa-only photo set with the gold-leaf sleeve — we would queue for it twice.' },
  { name: 'Toma I.', city: 'Fukuoka', mood: 'LIVE', status: 'rejected', message: 'This is a test of the moderation queue with a link that should not be published: http://example.invalid — deleted.' },
];

/* --------------------------------------------------- more journal, works, releases */

export const JOURNAL_EXTRA = [
  { category: 'TOUR', title: 'Setlist Anatomy — how a Checkpoint running order is built', excerpt: 'Fourteen songs, three traps and one that only exists on Fridays.', body: 'The order is not a list, it is a map of the room. Checkpoint Overture opens dark because the first thing an arena needs is its own hearing back. Nationwide lands third so the brass has somewhere to go after it. Flow Into You sits where the walk to the B-stage ends, and Never Enough is last before the encore because the room always sings it and the band waits for the end of that. The Friday shows carry one extra song that is never repeated — a trick from the 2022 run, when the Nagoya crowd kept asking for a song that was not written yet, so they wrote it the next week.', image: IMG.tour3, published_at: '2026.09.19', read_minutes: 7, visibility: 'public', sort: 11 },
  { category: 'TOUR', title: 'Sapporo to Sendai — six days on the road', excerpt: 'The tour diary: a cold open, a swapped set and 200 school seats.', body: 'Sapporo was twelve degrees and the doors opened early. The band played the second set standing at the front of the stage, which is not in the plan, it is what the balcony did to them. Sendai held 200 seats back for two schools from the coast; the ushers were told not to point at them, and of course the room noticed. Between the two, the van stopped at a service area at 3AM so a stagehand could post a photo of a vending coffee, which is the least interesting and most accurate record of a tour we have.', image: IMG.off4, published_at: '2026.10.27', read_minutes: 5, visibility: 'public', sort: 12 },
  { category: 'MUSIC', title: 'Cutting the Osaka live LP — nine horns, one room', excerpt: 'Why the double LP keeps the mistakes and the 40-minute delay.', body: 'The Osaka tapes had two problems: a delay and a room that would not leave. Both went onto the record. The delay is Side A, track one, announced as it happened; the delay is also why Late Show has a vocal the mix cannot quite control. The mastering chain was kept short — no re-build of the drums, no tuning of the crowd. Two discs, 22 minutes a side, and the soundcheck EP as a member download because the rehearsal is where the record actually starts.', image: IMG.tour4, published_at: '2026.11.06', read_minutes: 6, visibility: 'members', sort: 13 },
  { category: 'FILM', title: 'TOKYO TAXI — nine minutes of rain', excerpt: 'The premiere greeting that ran over, and the shot that survived the storm.', body: 'The red carpet was cut by weather, so the stage greeting inside ran nine minutes and then eleven more, standing. The night sequence on the Shuto Expressway — one practical lamp, three takes — is the shot the trailer used, and the reason the film has the colour it has: the lamp was borrowed, the crew had it for one night, and everything else was lit around that.', image: IMG.tour5, published_at: '2026.11.02', read_minutes: 4, visibility: 'public', sort: 14 },
  { category: 'STYLE', title: 'The gold-leaf sleeve — Kanazawa, for 400 orders', excerpt: 'What a city does to a record package when you let it.', body: 'The Kanazawa press run carries a genuine gold-leaf edge, laid by hand in the same workshops that finish the lacquer the town is known for. Four hundred sleeves, and the batch is never repeated because the leaf was bought for the job and not the tour. The photo of the wall of drying trays is in the vault; the short film about it is not, and it should be.', image: IMG.off1, published_at: '2026.11.12', read_minutes: 3, visibility: 'public', sort: 15 },
  { category: 'FAN CLUB', title: 'The tour passport, explained by the desk that prints it', excerpt: 'Twelve cities, one book, and what happens when you miss a stamp.', body: 'Bring the card to the desk or type the code on the board by the door — the stamp is yours either way, and it lands in the passport on the site the moment it is entered. Miss a city and nothing is lost: the vault keeps that night’s replay, and the stamp for it can be added at the next venue with the crew. The physical book is a Kanazawa-only extra for the 400 who bought the gold-leaf sleeve, because it seemed right that the paper and the leaf should come from the same street.', image: IMG.tour2, published_at: '2026.09.24', read_minutes: 4, visibility: 'public', sort: 16 },
];

export const WORKS_EXTRA = [
  { kind: 'movie', title: 'THE SWARM II', role: 'Lead', meta: '2027.02.12 • MOVIE', description: 'The deep-sea team goes back down — shot in the same tank, twice the water.', image: IMG.tour3, release_date: '2027.02.12', year: '2027', sort: 10 },
  { kind: 'drama', title: 'Kyojo Requiem — Season Two', role: 'Kazama Kimichika', meta: '2027.04.12 • DRAMA', description: 'The class graduates; the instructor is still standing in the doorway.', image: IMG.off2, release_date: '2027.04.12', year: '2027', sort: 11 },
  { kind: 'regular', title: '27 Hour TV — Charity Block', role: 'Host relay', meta: '2026.10.09 • NTV', description: 'Nine hours of live relay, including the 3AM segment nobody planned.', image: IMG.tour1, year: '2026', sort: 12 },
  { kind: 'magazine', title: 'BRUTUS — Checkpoint Special', role: 'Cover + interview', meta: '2026.11.21 • MAGAZINE', description: '64 pages on the tour: running orders, the van logs, and the gold-leaf sleeve.', image: IMG.off1, year: '2026', sort: 13 },
  { kind: 'cm', title: 'SUNTORY The Premium Malts', meta: 'CM', description: 'National campaign — “On the rocks, again”', year: '2026', sort: 7 },
  { kind: 'radio', title: 'Flow — 500th Broadcast', role: 'Host', meta: 'RADIO', description: 'The anniversary show: forty years of the Sunday studio in ninety minutes.', image: IMG.off4, year: '2027', sort: 3 },
];

export const RELEASES_EXTRA = [
  { kind: 'album', title: 'CHECKPOINT — Live at Osaka Grand Cube', release_date: '2026.12.18', cover: IMG.tour4, blurb: 'Double LP, nine horns, the 40-minute delay kept on tape.', price_yen: 7200, product_sku: 'CKPT-LP2', sort: 5, tracks: ['Checkpoint Overture (Live)', 'Nationwide (Live)', 'Lonely Highway (Live)', 'Seoul Nights (Live, with guest vocals)', 'Taipei Rain (Live, strings)', 'Gold Static (Live)', 'Arena Lights (Live)', 'Never Enough (Live)', 'Pearl Avenue (Live)', 'One More Lap (Live, floor)'] },
  { kind: 'single', title: 'Seoul Nights — Digital EP', release_date: '2026.11.06', cover: IMG.off3, blurb: 'The Seoul room, three ways: band, brass, and the soundcheck take.', price_yen: 1200, sort: 6, tracks: ['Seoul Nights (Band)', 'Seoul Nights (Brass Mix)', 'Seoul Nights (Soundcheck)'] },
  { kind: 'album', title: 'Checkpoint Remixes', release_date: '2027.01.22', cover: IMG.tour2, blurb: 'Twelve reworks plus the Osaka string sessions as a bonus disc.', price_yen: 5200, product_sku: 'CKPT-RMX', sort: 7, tracks: ['Checkpoint Overture (12″ Edit)', 'Nationwide (Night Bus Remix)', 'Flow Into You (Four Hands)', 'Arena Lights (Balcony Dub)', 'Gold Static (Brass Up)', 'Taipei Rain (Mandarin Verse)', 'See You There (Slow 12″)', 'Never Enough (Room Only)', 'One More Lap (Walk-Off)', 'Pearl Avenue (Leaf Mix)', 'Vault Edit (Reprise)', 'Long Vacation Interlude'] },
];

export const ARCHIVE_EXTRA = [
  { year: '1994', era: 'SMAP', title: 'First dome night', description: 'The tour that taught the stage how to move', image: IMG.tour1, sort: 11 },
  { year: '1996', era: 'DRAMA', title: 'Long Vacation — final episode', description: 'The ratings number the phrase “King of Ratings” came from', image: IMG.off4, sort: 12 },
  { year: '2000', era: 'DRAMA', title: 'Beautiful Life', description: 'Friday night, 30% average, a designer’s flat set in concrete', image: IMG.tour4, sort: 13 },
  { year: '2004', era: 'FILM', title: 'Howl — the second loop', description: 'Voice sessions recorded twice for the same scream', image: IMG.off3, sort: 14 },
  { year: '2016', era: 'STAGE', title: 'The last SMAP year', description: 'An encore the arena finished for them', image: IMG.tour2, sort: 15 },
  { year: '2019', era: 'FILM', title: 'Masquerade Hotel — front desk', description: 'The role that stayed in the box office top ten', image: IMG.off5, sort: 16 },
  { year: '2022', era: 'TOUR', title: 'Next Destination', description: 'Five cities, one brass section on the floor', image: IMG.tour3, sort: 17 },
  { year: '2026', era: 'TOUR', title: 'Checkpoint — twelve cities', description: 'The run this site is built around', image: IMG.tour5, sort: 18 },
];

/** demo members for the drawn Fukuoka lottery — the fan club test accounts */
const RAFFLE_DEMO_ENTRIES = ['aiko@example.com', 'marc@example.com', 'yuki@example.com'];

const has = (sql, params) => !!get(sql, params);

/**
 * Everything below is additive: each block asks "is this row here yet?" on the table's natural
 * key, so a site that already has content gains the new rows and a fresh database gets the whole
 * set in one pass. Returns the number of rows written, for the boot log.
 */
/* The Osaka live LP is announced by a release row, so the merch has to exist — an anchor
   that points at nothing is a broken link, not a coming-soon page. */
const PRODUCTS_EXTRA = [
  {
    sku: 'CKPT-LP2', title: 'CHECKPOINT — Live at Osaka Grand Cube (2LP)', category: 'Albums',
    price_yen: 7200, stock: 24, image: IMG.tour4, blurb: 'Double LP • nine horns • the 40-minute delay kept on tape',
    member_discount: 10, images: [IMG.tour4, IMG.tour2], sort: 12, status: 'active',
  },
];

/**
 * lat/lng and the sale windows are facts about a date, not decoration, so one pass fills them
 * for every row (the four original seed dates included). Only nulls are touched: a coordinate
 * or a date the desk typed in the console always wins, and re-running changes nothing.
 */
export function syncGeoAndWindows() {
  const DAY = 86400000;
  const stamp = (ms) => {
    const d = new Date(ms + 9 * 3600 * 1000);                                   // JST wall time
    return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };
  let touched = 0;
  for (const row of all(`SELECT id, date, city, venue, lat, lng, status, tier_required, presale_at, on_sale_at FROM tour_dates`)) {
    const geo = venueGeo(row);
    const show = parseJst(row.date, '18:00');
    const patch = {};
    if (geo && row.lat === null) { patch.lat = geo.lat; patch.lng = geo.lng; }
    // priority opens ten weeks before the night, general sale six — only for dates ahead of us
    if (!row.on_sale_at && show !== null && show > Date.now()) patch.on_sale_at = stamp(show - 60 * DAY);
    if (!row.presale_at && show !== null && show > Date.now()) patch.presale_at = stamp(show - 74 * DAY);
    if (!Object.keys(patch).length) continue;
    const sets = Object.keys(patch).map((k) => `${k}=@${k}`).join(', ');
    run(`UPDATE tour_dates SET ${sets} WHERE id=@id`, { ...patch, id: row.id });
    touched += 1;
  }
  // the announced 2027 pair is the "coming soon" story: both windows still ahead of us
  run(`UPDATE tour_dates SET presale_at='2026.11.20 12:00', on_sale_at='2026.12.18 12:00' WHERE status='pre_sale' AND date='2027.01.10'`);
  run(`UPDATE tour_dates SET presale_at='2026.12.04 12:00', on_sale_at='2027.01.08 12:00' WHERE status='pre_sale' AND date='2027.02.14'`);
  return touched;
}

/** Fans already waiting, so the tally on a coming-soon card is a real number on day one. */
const NOTIFY_SEED = [
  { email: 'hikaru.abe@example.com', date: '2027.01.10', tier: 'gold' },
  { email: 'n.okada@example.com', date: '2027.01.10', tier: 'silver' },
  { email: 'stanley.oyarzun@example.com', date: '2027.01.10', tier: 'platinum' },
  { email: 'yuki.tanaka@example.com', date: '2027.02.14', tier: 'silver' },
  { email: 'm_holderness@example.com', date: '2027.02.14', tier: 'gold' },
  { email: 'aiko.fanclub@example.com', date: '2026.12.05', tier: 'gold' },
  { email: 'marc.fanclub@example.com', date: '2026.10.19', tier: 'diamond' },
];

export function seedExtras() {
  const db = getDb();
  let added = 0;
  const put = (table, match, values) => {
    if (has(`SELECT 1 FROM ${table} WHERE ${match}`, values.where)) return false;
    insert(table, values.row);
    return true;
  };

  /* --- tour dates: capacity fills the way a real on-sale behaves --- */
  TOUR_EXTRA.forEach((d, i) => {
    if (put('tour_dates', `date=@d AND city=@c AND venue=@v`, {
      where: { d: d.date, c: d.city, v: d.venue },
      row: { tour: d.tour, date: d.date, time: d.time, city: d.city, venue: d.venue, note: d.note, capacity: d.capacity, remaining: d.remaining, tier_required: d.tier, status: d.status, sort: 40 + i, doors_at: d.doors, checkin_code: null, setlist_teaser: d.teaser },
    })) added += 1;
  });

  SCHEDULE_EXTRA.forEach((s, i) => { if (put('schedule', `starts_on=@d AND title=@t`, { where: { d: s.starts_on, t: s.title }, row: { ...s, status: 'published', sort: s.sort || (60 + i) } })) added += 1; });
  NEWS_EXTRA.forEach((n) => { if (put('news', `date=@d AND title=@t`, { where: { d: n.date, t: n.title }, row: { ...n, status: 'published' } })) added += 1; });
  JOURNAL_EXTRA.forEach((j) => { if (put('journal_posts', `title=@t`, { where: { t: j.title }, row: { ...j, status: 'published' } })) added += 1; });
  WORKS_EXTRA.forEach((w) => { if (put('works', `title=@t`, { where: { t: w.title }, row: { ...w, status: 'published' } })) added += 1; });
  RELEASES_EXTRA.forEach((r) => { if (put('releases', `title=@t`, { where: { t: r.title }, row: { ...r, tracks: JSON.stringify(r.tracks), status: 'published' } })) added += 1; });
  ARCHIVE_EXTRA.forEach((a) => { if (put('archive_items', `year=@y AND title=@t`, { where: { y: a.year, t: a.title }, row: a })) added += 1; });

  /* --- the shop: a release that advertises a product_sku must have that row ---- */
  PRODUCTS_EXTRA.forEach((g) => { if (put('products', `sku=@k`, { where: { k: g.sku }, row: { ...g, images: JSON.stringify(g.images || []) } })) added += 1; });

  /* --- the show archive --- */
  SHOWS.forEach((s, i) => {
    if (put('shows', `slug=@s`, {
      where: { s: s.slug },
      row: { slug: s.slug, tour: s.tour, date: s.date, city: s.city, venue: s.venue, capacity: s.capacity, attended: s.attended, duration_min: s.duration_min, setlist: JSON.stringify(s.setlist), encore: s.encore.join(' • '), gallery: JSON.stringify(s.gallery), report: s.report, note: s.note, status: s.status, sort: s.sort || (90 - i) },
    })) added += 1;
  });

  /* --- lotteries, with the drawn one actually drawn --- */
  RAFFLES.forEach((r) => {
    const date = r.date;
    const td = get(`SELECT id FROM tour_dates WHERE date=@date AND city=@city ORDER BY id LIMIT 1`, { date, city: r.cities });
    const show = get(`SELECT id FROM shows WHERE date=@date AND city=@city ORDER BY id LIMIT 1`, { date, city: r.cities });
    const row = { title: r.title, prize: r.prize, tour_date_id: td ? td.id : null, show_id: show ? show.id : null, tier_min: r.tier_min, winners: r.winners, alternates: r.alternates, opens_at: r.opens_at, closes_at: r.closes_at, status: r.status, seed: r.seed, note: r.note, sort: 1 };
    if (put('raffles', `title=@t`, { where: { t: r.title }, row })) added += 1;
  });

  const drawn = get(`SELECT * FROM raffles WHERE status='drawn' ORDER BY id LIMIT 1`);
  if (drawn) {
    RAFFLE_DEMO_ENTRIES.forEach((email) => {
      const u = get(`SELECT id FROM users WHERE email=@e`, { e: email });
      if (!u) return;
      if (has(`SELECT 1 FROM raffle_entries WHERE raffle_id=@r AND user_id=@u`, { r: drawn.id, u: u.id })) return;
      insert('raffle_entries', { raffle_id: drawn.id, user_id: u.id, code: entryCode(drawn.seed, drawn.id, u.id), ticket_ref: null, status: 'entered' });
      added += 1;
    });
    const entries = all(`SELECT * FROM raffle_entries WHERE raffle_id=@r`, { r: drawn.id });
    if (entries.length && !entries.some((e) => e.status !== 'entered')) runDraw(drawn, entries);
  }

  /* --- every date needs a door code and a doors time, including the ones already seeded --- */
  all(`SELECT id, date, city, venue, time, checkin_code, doors_at FROM tour_dates WHERE checkin_code IS NULL OR doors_at IS NULL`).forEach((d) => {
    const patch = {};
    if (!d.checkin_code) patch.checkin_code = venueCode(d);
    if (!d.doors_at) {
      const at = parseJst(d.date, d.time);
      patch.doors_at = at === null ? '17:00' : new Date(at - 3600 * 1000 + 9 * 3600 * 1000).toISOString().slice(11, 16);
    }
    run(`UPDATE tour_dates SET ${Object.keys(patch).map((k) => `${k}=@${k}`).join(', ')} WHERE id=@id`, { ...patch, id: d.id });
    added += 1;
  });

  /* --- fan wall, only on a fresh table so real member notes are never duplicated --- */
  if (tableEmpty('fan_wall')) {
    WALL.forEach((w) => {
      const created = w.status === 'approved' ? `datetime('now','-${2 + (w.message.length % 9)} days')` : 'datetime(\'now\',\'-3 hours\')';
      getDb().prepare(`INSERT INTO fan_wall (user_id, name, city, mood, message, status, applause, featured, reply, created_at, reviewed_at, reviewed_by)
        VALUES (NULL, @name, @city, @mood, @message, @status, @applause, @featured, @reply, ${created}, CASE WHEN @status='approved' THEN datetime('now') ELSE NULL END, 'desk')`)
        .run({ name: w.name, city: w.city || null, mood: w.mood || null, message: w.message, status: w.status, applause: w.applause || 0, featured: w.featured || 0, reply: w.reply || null });
      added += 1;
    });
  }

  /* --- the waitlist: never bulk-inserted over real sign-ups --- */
  if (tableEmpty('notify_list')) {
    for (const n of NOTIFY_SEED) {
      const date = get(`SELECT id FROM tour_dates WHERE date=@d ORDER BY sort, id LIMIT 1`, { d: n.date });
      if (!date) continue;
      insert('notify_list', {
        email: n.email, tour_date_id: Number(date.id), user_id: null, tier_hint: n.tier,
        source: 'site', status: 'subscribed', token: `nw_seed_${n.email.replace(/[^a-z0-9]/g, '')}_${date.id}`,
      });
      added += 1;
    }
  }

  /* --- demo passport stamps so the grid is not empty on day one --- */
  const fuk = get(`SELECT id, city FROM tour_dates WHERE date='2026.09.10' AND city='Fukuoka' ORDER BY id LIMIT 1`);
  const tok = get(`SELECT id, city FROM tour_dates WHERE date='2026.09.20' ORDER BY id LIMIT 1`);
  [fuk, tok].forEach((d) => {
    if (!d) return;
    RAFFLE_DEMO_ENTRIES.forEach((email) => {
      const u = get(`SELECT id FROM users WHERE email=@e`, { e: email });
      if (!u) return;
      if (has(`SELECT 1 FROM passport_stamps WHERE user_id=@u AND tour_date_id=@d`, { u: u.id, d: d.id })) return;
      insert('passport_stamps', { user_id: u.id, tour_date_id: d.id, city: d.city, source: 'import' });
      added += 1;
    });
  });

  /* --- the locator map and the two sale windows: last, so every date above has one --- */
  added += syncGeoAndWindows();

  /* --- headline numbers, refreshed in place --- */
  const statUp = (label, value, note, icon) => {
    const row = get(`SELECT id FROM stats WHERE label=@l`, { l: label });
    if (row) run(`UPDATE stats SET value=@v, note=@n, icon=@i WHERE id=@id`, { v: value, n: note, i: icon, id: row.id });
    else { insert('stats', { label, value, note, icon, sort: 20 }); added += 1; }
  };
  statUp('Tour Cities 2026', String(count('tour_dates', "date LIKE '2026%'")), 'Fukuoka → Singapore', '🎤');
  statUp('Shows in the archive', String(count('shows', `status='published'`)), 'Setlists, galleries, reports', '🎬');

  return added;
}

function count(table, where) {
  const row = get(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`);
  return row ? row.n : 0;
}

/** the draw uses the same helper the admin button uses, so a seeded result is a real result */
function runDraw(raffle, entries) {
  const result = drawRaffle(entries, { winners: raffle.winners || 5, alternates: raffle.alternates || 3, seed: raffle.seed || raffle.title });
  const win = new Set(result.winners.map(String));
  const alt = new Set(result.alternateIds.map(String));
  entries.forEach((e) => {
    const key = String(e.id);
    const status = win.has(key) ? 'winner' : alt.has(key) ? 'alternate' : 'missed';
    run(`UPDATE raffle_entries SET status=@s WHERE id=@id`, { s: status, id: e.id });
  });
  run(`UPDATE raffles SET status='drawn', drawn_at=datetime('now') WHERE id=@id`, { id: raffle.id });
}
