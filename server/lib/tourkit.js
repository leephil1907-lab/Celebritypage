/**
 * server/lib/tourkit.js — the pure logic behind the live-show features.
 *   • iCalendar (RFC 5545) writing for the tour, so a fan can put the dates in their own calendar
 *   • the countdown maths, shared by the server render and the browser tick
 *   • the meet & greet draw: deterministic, replayable, auditable
 *   • fan-wall note validation
 * Nothing in here touches the database or Express, so all of it is unit-testable.
 */

/* ---------------------------------------------------------------- dates */

/** the site stores dates as YYYY.MM.DD with an optional HH:MM, always Japan time */
export function parseJst(dateStr, timeStr) {
  const m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(String(dateStr || '').trim());
  if (!m) return null;
  let h = 0; let min = 0;
  const t = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || '').trim());
  if (t) { h = Number(t[1]); min = Number(t[2]); }
  if (h > 23 || min > 59) return null;
  // Asia/Tokyo is UTC+9 with no DST, so a fixed offset is exact, not an approximation
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, min) - 9 * 3600 * 1000;
}

export function isoBasic(ms) {
  const d = new Date(ms + 9 * 3600 * 1000);            // render in JST wall time
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`;
}

export function stamp(ms = Date.now()) {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export function countdownParts(msLeft) {
  const clamped = Math.max(0, Math.floor(Number(msLeft) || 0));
  const s = Math.floor(clamped / 1000);
  return {
    past: clamped <= 0,
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
    pad: { hours: String(Math.floor((s % 86400) / 3600)).padStart(2, '0'), minutes: String(Math.floor((s % 3600) / 60)).padStart(2, '0'), seconds: String(s % 60).padStart(2, '0') },
  };
}

/** the next show that has not finished yet, from a list of {date,time} rows */
export function nextUpcoming(rows, now = Date.now()) {
  return (rows || [])
    .map((r) => ({ row: r, at: parseJst(r.date, r.time || r.starts_at) }))
    .filter((x) => x.at !== null && x.at + 4 * 3600 * 1000 > now)   // a show stays "next" for its own length
    .sort((a, b) => a.at - b.at)[0] || null;
}

/* ---------------------------------------------------------------- icalendar */

export function icsEscape(v) {
  return String(v == null ? '' : v)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
    // control characters would break the file for every parser downstream
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

/** RFC 5545 §3.1: lines are folded at 75 OCTETS, continuation starts with a space */
export function icsFold(line) {
  const out = [];
  let rest = String(line);
  let limit = 75;
  while (Buffer.byteLength(rest, 'utf8') > limit) {
    let cut = limit;
    // never split a multi-byte character: step back until the slice is valid
    while (cut > 0 && (rest.charCodeAt(cut) & 0xc0) === 0x80) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
    limit = 74;   // the leading space of a continuation line counts toward the 75
  }
  out.push(rest);
  return out.join('\r\n ');
}

export function icsLine(name, value) {
  return icsFold(`${name}:${icsEscape(value)}`);
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Asia-Tokyo',
  'X-LIC-LOCATION:Japan Standard Time',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0900',
  'TZOFFSETTO:+0900',
  'TZNAME:JST',
  'DTSTART:19700101T000000',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/**
 * events: [{ id, title, date, time, durationMin, city, venue, note, url, status }]
 * A fan imports this once and their calendar keeps the whole tour.
 */
export function buildVCalendar(events, meta = {}) {
  const now = stamp(meta.now);
  const lines = [
    'BEGIN:VCALENDAR',
    icsLine('VERSION', '2.0'),
    icsLine('PRODID', meta.prodId || '-//STARTO ENTERTAINMENT//Takuya Kimura Official//EN'),
    icsLine('CALSCALE', 'GREGORIAN'),
    icsLine('METHOD', 'PUBLISH'),
    icsLine('X-WR-CALNAME', meta.name || 'Live Tour 2026 Checkpoint'),
    icsLine('X-WR-TIMEZONE', 'Asia-Tokyo'),
    ...VTIMEZONE,
  ];
  (events || []).forEach((e) => {
    const start = parseJst(e.date, e.time);
    if (start === null) return;
    const end = start + Math.max(30, Number(e.durationMin) || 150) * 60 * 1000;
    lines.push('BEGIN:VEVENT');
    lines.push(icsLine('UID', `${e.uid || `ckpt-${e.id || e.date}-${e.city}`}@tour.starto.invalid`));
    lines.push(icsLine('DTSTAMP', now));
    lines.push(`DTSTART;TZID=Asia-Tokyo:${isoBasic(start)}`);
    lines.push(`DTEND;TZID=Asia-Tokyo:${isoBasic(end)}`);
    lines.push(icsLine('SUMMARY', e.title || 'Live show'));
    if (e.city || e.venue) lines.push(icsLine('LOCATION', [e.venue, e.city].filter(Boolean).join(', ')));
    if (e.note) lines.push(icsLine('DESCRIPTION', e.note));
    if (e.url) lines.push(icsLine('URL', e.url));
    lines.push(icsLine('STATUS', e.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'));
    lines.push(icsLine('TRANSP', 'OPAQUE'));
    lines.push(icsLine('CATEGORIES', e.category || 'CONCERT'));
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/* ---------------------------------------------------------------- raffle draw */

/** FNV-1a: small, stable across runs and platforms, which is the whole point of a public draw */
export function hash32(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function rng(seedNum) {
  let x = seedNum || 0x9e3779b9;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0x100000000;
  };
}

export function entryCode(seed, raffleId, userId) {
  const h = hash32(`${seed}|${raffleId}|${userId}`).toString(36).toUpperCase().padStart(7, '0');
  return `MG-${h.slice(0, 4)}-${h.slice(4, 7)}`;
}

/**
 * The draw: everyone who entered is ordered by a seeded shuffle of their ticket codes, the first
 * `winners` win and the next `alternates` are alternates. Same seed + same entries always gives the
 * same result, so a fan can check the draw themselves and Management can replay it in the audit log.
 */
export function drawRaffle(entries, { winners = 5, alternates = 3, seed = 'draw' } = {}) {
  const list = [...(entries || [])].sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const rand = rng(hash32(String(seed)));
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const w = Math.max(0, Number(winners) || 0);
  const a = Math.max(0, Number(alternates) || 0);
  return {
    order: list.map((e) => e.code),
    winners: list.slice(0, w).map((e) => e.id ?? e.code),
    alternateIds: list.slice(w, w + a).map((e) => e.id ?? e.code),
    winnerCodes: list.slice(0, w).map((e) => e.code),
    alternateCodes: list.slice(w, w + a).map((e) => e.code),
    seed: String(seed),
    at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
}

/* ---------------------------------------------------------------- fan wall */

export const WALL_MIN = 6;
export const WALL_MAX = 280;

export function validateWallNote(raw, { name = '', city = '' } = {}) {
  const errors = [];
  const message = String(raw == null ? '' : raw).replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ').trim();
  const len = [...message].length;               // counting code points, so Japanese is not punished
  if (len < WALL_MIN) errors.push(`Write at least ${WALL_MIN} characters (${len} now).`);
  if (len > WALL_MAX) errors.push(`Keep it to ${WALL_MAX} characters (you are ${len - WALL_MAX} over).`);
  if (/[\x00-\x08]/.test(String(raw))) errors.push('The note contains control characters.');
  const cleanName = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const cleanCity = String(city || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!cleanName) errors.push('A name is needed so the note can be signed.');
  return { errors, ok: errors.length === 0, message, len, remaining: Math.max(0, WALL_MAX - len), name: cleanName, city: cleanCity };
}

/** check-in is open from three days before the date to a fortnight after it */
export function checkinWindow(dateStr, now = Date.now()) {
  const at = parseJst(dateStr, '20:00');
  if (at === null) return { open: false, reason: 'unknown_date' };
  const from = at - 3 * 86400 * 1000;
  const to = at + 14 * 86400 * 1000;
  if (now < from) return { open: false, reason: 'too_early', from };
  if (now > to) return { open: false, reason: 'closed', to };
  return { open: true, from, to };
}

/**
 * The code printed on the passport board by the gate. A date can carry its own (set by the desk);
 * otherwise it is derived from the city and the day, so every date is checkable without anyone
 * having to remember to fill a field in.
 */
export function venueCode(row) {
  const explicit = String(row?.checkin_code || '').trim();
  if (explicit) return explicit.toUpperCase();
  const d = String(row?.date || '').replace(/[^0-9]/g, '');
  const city = String(row?.city || 'show').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  if (d.length < 8 || !city) return null;
  return `${city}-${d.slice(4, 8)}`;
}

export function slugify(v, fallback = 'show') {
  const s = String(v || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60);
  return s || fallback;
}

/* ---------------------------------------------------------------- venues */

/**
 * Where each room actually is. These are the arena districts of the host cities — the
 * locator map draws from them and the directions link goes to them, so a wrong number here
 * would be a wrong pin on a map. The desk can override any row in the console.
 */
export const VENUE_GEO = {
  'Fukuoka|TOTTEI PARK': [33.6070, 130.3800, 'PayPay Dome district, Momochi'],
  'Fukuoka|Bay Arena': [33.5905, 130.3438, 'Maizuru, by the waterfront'],
  'Tokyo|Arena Tokyo': [35.6355, 139.7930, 'Ariake'],
  'Tokyo|Dome City Hall': [35.7075, 139.7515, 'Tokyo Dome City'],
  'Osaka|Grand Cube': [34.6657, 135.4330, 'Maishima, east of the river'],
  'Nagoya|Sky Hall': [35.0940, 136.9270, 'Mizuho, near the port line'],
  'Sapporo|Park Arena': [43.1136, 141.5876, 'Ōdō Park, Atsubetsu'],
  'Seoul|Gocheok Hall': [37.4980, 126.8645, 'Gocheok, south-west of the Han'],
  'Seoul|Nexus Hall': [37.5143, 127.1026, 'Jamsil, on the Songi side'],
  'Sendai|Wave Hall': [38.2530, 140.8650, 'Arisawa, Sendai Park'],
  'Hiroshima|River Hall': [34.4300, 132.5050, 'Naka-ku, upstream of the delta'],
  'Kanazawa|Ishikawa Hall': [36.5960, 136.6270, 'Teramachi'],
  'Taipei|Arena Taipei': [25.0514, 121.5520, 'Dong District, Nanjing East'],
  'Taipei|Summit Arena': [25.0474, 121.5197, 'Taipei Dome, Datun'],
  'Bangkok|Golden Hall': [13.9166, 100.5420, 'Pak Kret, north of the city'],
  'Singapore|Marina Arena': [1.2836, 103.8607, 'Marina Bay, south shore'],
};

const TOKYO_GATE = [35.6355, 139.7930];

/** [lat, lng, district] for a row, from the desk value first, then the table above */
export function venueGeo(row) {
  if (!row) return null;
  const known = VENUE_GEO[`${row.city}|${row.venue}`];
  const lat = row.lat !== null && row.lat !== undefined ? Number(row.lat) : (known ? known[0] : null);
  const lng = row.lng !== null && row.lng !== undefined ? Number(row.lng) : (known ? known[1] : null);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng, district: (known && known[2]) || null };
}

/** great-circle distance in km — the row says how far the room is from the first night */
export function haversineKm(a, b) {
  if (!a || !b) return null;
  const R = 6371;
  const rad = (v) => (v * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

const boundsOf = (g) => (g ? { lngMin: g.lng - 0.06, lngMax: g.lng + 0.06, latMin: g.lat - 0.045, latMax: g.lat + 0.045 } : null);

/**
 * The map furniture, as numbers only: a 1.5 km graticule around the pin, so the marker is
 * placed by projection and not by eye. The template draws it — no tiles, no third-party request.
 */
export function venueMapData(row) {
  const geo = venueGeo(row);
  if (!geo) return null;
  const box = boundsOf(geo);
  const kmLng = 111.32 * Math.cos((geo.lat * Math.PI) / 180);
  return {
    lat: geo.lat, lng: geo.lng, district: geo.district,
    box,
    // where the meridian/parallel lines fall inside the box, in the same units as the projection
    grid: [
      Math.round(geo.lng * 1000) / 1000,
      Math.round((geo.lng - 0.02) * 1000) / 1000,
      Math.round((geo.lng + 0.02) * 1000) / 1000,
    ],
    gridLat: [Math.round(geo.lat * 1000) / 1000, Math.round((geo.lat - 0.015) * 1000) / 1000, Math.round((geo.lat + 0.015) * 1000) / 1000],
    scale_km: Math.round((box.lngMax - box.lngMin) * kmLng),
    from_gate: haversineKm({ lat: TOKYO_GATE[0], lng: TOKYO_GATE[1] }, geo),
    osm: `https://www.openstreetmap.org/?mlat=${geo.lat.toFixed(5)}&mlon=${geo.lng.toFixed(5)}#map=15/${geo.lat.toFixed(5)}/${geo.lng.toFixed(5)}`,
    gmaps: `https://www.google.com/maps/search/?api=1&query=${geo.lat.toFixed(5)},${geo.lng.toFixed(5)}`,
  };
}

/** the waitlist address has to be a real address, and only that */
export function normalizeNotifyEmail(v) {
  const email = String(v || '').trim().toLowerCase().slice(0, 180);
  if (!/^[^\s@]+@[^\s@.]+\.[a-z]{2,}$/i.test(email)) return { ok: false, error: 'That is not an email address we can reach.' };
  return { ok: true, email };
}
