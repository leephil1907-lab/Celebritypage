/**
 * server/resources.js — declarative CMS resources.
 * Drives BOTH the admin UI (list + form) and the REST endpoints, so a new content type
 * is one object here instead of a page + a router.
 */
const yen = (n) => '¥' + Number(n || 0).toLocaleString('en-US');

const perksField = { key: 'perks', label: 'Perks (one per line)', type: 'lines' };
const tracksField = { key: 'tracks', label: 'Tracklist (one per line)', type: 'lines' };

export const RESOURCES = {
  hero: {
    table: 'hero_slides', label: 'Hero Slides', icon: '▣', group: 'Content', order: 'sort, id',
    blurb: 'Carousel slides on the homepage hero — image, kicker, title, subtitle, CTA.',
    list: ['sort', 'kicker', 'title', 'image', 'active'],
    fields: [
      { key: 'kicker', label: 'Kicker', type: 'text' },
      { key: 'title', label: 'Title (use | for second line)', type: 'text', required: true },
      { key: 'subtitle', label: 'Subtitle', type: 'text' },
      { key: 'image', label: 'Image', type: 'image', required: true },
      { key: 'alt', label: 'Alt text', type: 'text' },
      { key: 'video_url', label: 'Ambient video (optional)', type: 'media', hint: 'mp4/webm from /uploads — muted, looped, poster-first' },
      { key: 'cta_label', label: 'CTA label', type: 'text' },
      { key: 'cta_href', label: 'CTA href', type: 'text' },
      { key: 'tone', label: 'Overlay tone', type: 'select', options: ['light', 'dark'] },
      { key: 'sort', label: 'Sort order', type: 'number', default: 0 },
      { key: 'active', label: 'Active', type: 'check', default: 1 },
    ],
  },
  news: {
    table: 'news', label: 'News', icon: '❖', group: 'Content', order: 'date DESC, id DESC',
    blurb: 'Information list on the homepage and the Work page.',
    list: ['date', 'category', 'title', 'status', 'featured'],
    fields: [
      { key: 'date', label: 'Date (YYYY.MM.DD)', type: 'text', required: true },
      { key: 'category', label: 'Category', type: 'select', options: ['CONCERT', 'RELEASE', 'MOVIE', 'REGULAR', 'NEWS', 'FAN CLUB', 'SHOP'] },
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'body', label: 'Body', type: 'textarea' },
      { key: 'image', label: 'Image', type: 'image' },
      { key: 'status', label: 'Status', type: 'select', options: ['published', 'draft'] },
      { key: 'featured', label: 'Featured', type: 'check', default: 0 },
    ],
  },
  schedule: {
    table: 'schedule', label: 'Schedule', icon: '◷', group: 'Content', order: 'starts_on, sort',
    blurb: 'Upcoming appearances feeding the schedule strip and JSON feed.',
    list: ['starts_on', 'starts_at', 'title', 'kind', 'status'],
    fields: [
      { key: 'starts_on', label: 'Date (YYYY.MM.DD)', type: 'text', required: true },
      { key: 'starts_at', label: 'Time (HH:MM)', type: 'text' },
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'meta', label: 'Meta line', type: 'text' },
      { key: 'kind', label: 'Kind', type: 'select', options: ['TV', 'RADIO', 'VAULT', 'MAGAZINE', 'EVENT'] },
      { key: 'link', label: 'Link', type: 'text' },
      { key: 'sort', label: 'Sort order', type: 'number', default: 0 },
      { key: 'status', label: 'Status', type: 'select', options: ['published', 'draft'] },
    ],
  },
  works: {
    table: 'works', label: 'Film • TV • CM', icon: '◉', group: 'Content', order: 'kind, sort, release_date DESC',
    blurb: 'Filmography, regular shows and commercials — powers Work page + home carousels.',
    list: ['kind', 'title', 'year', 'release_date', 'status'],
    fields: [
      { key: 'kind', label: 'Kind', type: 'select', options: ['movie', 'drama', 'tv', 'radio', 'magazine', 'cm', 'regular'], required: true },
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'role', label: 'Role', type: 'text' },
      { key: 'meta', label: 'Meta line', type: 'text' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'image', label: 'Image', type: 'image' },
      { key: 'release_date', label: 'Release date', type: 'text' },
      { key: 'year', label: 'Year', type: 'text' },
      { key: 'sort', label: 'Sort order', type: 'number', default: 0 },
      { key: 'status', label: 'Status', type: 'select', options: ['published', 'draft'] },
    ],
  },
  releases: {
    table: 'releases', label: 'Discography', icon: '◍', group: 'Content', order: 'sort, release_date DESC',
    blurb: 'Albums and singles — music page + release carousel + player.',
    list: ['release_date', 'kind', 'title', 'price_yen', 'status'],
    fields: [
      { key: 'kind', label: 'Kind', type: 'select', options: ['album', 'single', 'vinyl', 'ep'] },
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'artist', label: 'Artist', type: 'text', default: 'Takuya Kimura' },
      { key: 'release_date', label: 'Release date', type: 'text' },
      { key: 'cover', label: 'Cover image', type: 'image' },
      { key: 'blurb', label: 'Blurb', type: 'textarea' },
      tracksField,
      { key: 'price_yen', label: 'Price (yen)', type: 'number' },
      { key: 'product_sku', label: 'Linked product SKU', type: 'text' },
      { key: 'sort', label: 'Sort order', type: 'number', default: 0 },
      { key: 'status', label: 'Status', type: 'select', options: ['published', 'draft'] },
    ],
  },
  tour: {
    table: 'tour_dates', label: 'Tour Dates', icon: '✈', group: 'Content', order: 'date, sort',
    blurb: 'Live Tour 2026 dates, capacity and tier rules (feeds lottery + passport).',
    list: ['date', 'city', 'venue', 'remaining', 'status'],
    fields: [
      { key: 'tour', label: 'Tour name', type: 'text', default: 'Live Tour 2026 Checkpoint' },
      { key: 'date', label: 'Date (YYYY-MM-DD)', type: 'text', required: true },
      { key: 'time', label: 'Time', type: 'text' },
      { key: 'city', label: 'City', type: 'text', required: true },
      { key: 'venue', label: 'Venue', type: 'text' },
      { key: 'note', label: 'Note', type: 'text' },
      { key: 'capacity', label: 'M&G capacity', type: 'number', default: 20 },
      { key: 'remaining', label: 'Remaining', type: 'number', default: 20 },
      { key: 'tier_required', label: 'Tier required', type: 'select', options: ['silver', 'gold', 'platinum', 'diamond'] },
      { key: 'status', label: 'Status', type: 'select', options: ['on_sale', 'lottery', 'sold_out', 'done'] },
      { key: 'sort', label: 'Sort order', type: 'number', default: 0 },
    ],
  },
  vault: {
    table: 'vault_items', label: 'Vault Items', icon: '◆', group: 'Content', order: 'sort, id',
    blurb: 'Members-only vault drops and their tier gates.',
    list: ['code', 'title', 'min_tier', 'streams', 'status'],
    fields: [
      { key: 'code', label: 'Code (VAULT 01)', type: 'text', required: true },
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'image', label: 'Image', type: 'image' },
      { key: 'min_tier', label: 'Minimum tier', type: 'select', options: ['silver', 'gold', 'platinum', 'diamond'] },
      { key: 'duration', label: 'Duration / size', type: 'text' },
      { key: 'video_url', label: 'Private stream file (optional)', type: 'media', hint: 'mp4/webm from /uploads — served only to entitled tiers' },
      { key: 'streams', label: 'Streams', type: 'number', default: 0 },
      { key: 'likes', label: 'Likes', type: 'number', default: 0 },
      { key: 'sort', label: 'Sort order', type: 'number', default: 0 },
      { key: 'status', label: 'Status', type: 'select', options: ['published', 'draft'] },
    ],
  },
  journal: {
    table: 'journal_posts', label: 'Journal', icon: '✎', group: 'Content', order: 'published_at DESC, id DESC',
    blurb: 'Editorial posts — public or members-only.',
    list: ['published_at', 'category', 'title', 'visibility', 'status'],
    fields: [
      { key: 'category', label: 'Category', type: 'select', options: ['TOUR', 'FILM', 'MUSIC', 'STYLE', 'CREATIVE', 'BEHIND THE SCENES'], required: true },
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'excerpt', label: 'Excerpt', type: 'textarea' },
      { key: 'body', label: 'Body', type: 'textarea' },
      { key: 'image', label: 'Image', type: 'image' },
      { key: 'published_at', label: 'Published (YYYY.MM.DD)', type: 'text', required: true },
      { key: 'read_minutes', label: 'Read minutes', type: 'number', default: 3 },
      { key: 'visibility', label: 'Visibility', type: 'select', options: ['public', 'members'] },
      { key: 'status', label: 'Status', type: 'select', options: ['published', 'draft'] },
    ],
  },
  archive: {
    table: 'archive_items', label: 'Archive Timeline', icon: '◔', group: 'Content', order: 'year, sort',
    blurb: '1987 → future timeline.',
    list: ['year', 'title', 'era', 'metric'],
    fields: [
      { key: 'year', label: 'Year', type: 'text', required: true },
      { key: 'era', label: 'Era tag', type: 'text' },
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'image', label: 'Image', type: 'image' },
      { key: 'metric', label: 'Metric', type: 'text' },
      { key: 'sort', label: 'Sort order', type: 'number', default: 0 },
    ],
  },
  tiers: {
    table: 'tiers', label: 'Fan Card Tiers', icon: '❈', group: 'Commerce', order: 'sort, price_yen',
    list: ['name', 'price_yen', 'rank', 'featured'],
    fields: [
      { key: 'id', label: 'Tier id (silver/gold/…)', type: 'text', required: true, immutable: true },
      { key: 'name', label: 'Display name', type: 'text', required: true },
      { key: 'tagline', label: 'Tagline', type: 'text' },
      { key: 'price_yen', label: 'Price (yen / year)', type: 'number', required: true },
      { key: 'icon', label: 'Icon glyph', type: 'text', default: '◆' },
      { key: 'accent', label: 'Accent colour', type: 'text', default: '#c9a86a' },
      { key: 'rank', label: 'Rank (1..4)', type: 'number', default: 1 },
      perksField,
      { key: 'sort', label: 'Sort order', type: 'number', default: 0 },
      { key: 'featured', label: 'Featured (most popular)', type: 'check', default: 0 },
    ],
    format: (row) => ({ ...row, price_label: yen(row.price_yen), perks: safeJson(row.perks, []) }),
  },
  products: {
    table: 'products', label: 'Shop Products', icon: '❐', group: 'Commerce', order: 'sort, id',
    list: ['sku', 'title', 'category', 'price_yen', 'stock', 'status'],
    fields: [
      { key: 'sku', label: 'SKU', type: 'text', required: true },
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'category', label: 'Category', type: 'select', options: ['Apparel', 'Tour Merch', 'Albums', 'Accessories', 'Photobook'] },
      { key: 'price_yen', label: 'Price (yen)', type: 'number', required: true },
      { key: 'stock', label: 'Stock', type: 'number', default: 0 },
      { key: 'image', label: 'Image', type: 'image' },
      { key: 'images', label: 'Gallery (one URL per line)', type: 'lines', storeAsJson: true },
      { key: 'blurb', label: 'Blurb', type: 'textarea' },
      { key: 'member_discount', label: 'Member discount %', type: 'number', default: 0 },
      { key: 'sort', label: 'Sort order', type: 'number', default: 0 },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'draft', 'retired'] },
    ],
    format: (row) => ({ ...row, price_label: yen(row.price_yen), images: safeJson(row.images, []) }),
  },
  stats: {
    table: 'stats', label: 'About Stats', icon: '◫', group: 'Site', order: 'sort, id',
    list: ['value', 'label', 'note'],
    fields: [
      { key: 'icon', label: 'Icon glyph', type: 'text' },
      { key: 'value', label: 'Value', type: 'text', required: true },
      { key: 'label', label: 'Label', type: 'text' },
      { key: 'note', label: 'Note', type: 'text' },
      { key: 'sort', label: 'Sort order', type: 'number', default: 0 },
    ],
  },
};

export function safeJson(v, fb) { try { return v == null ? fb : JSON.parse(v); } catch { return fb; } }

export function resourceList(key) {
  const r = RESOURCES[key];
  if (!r) return null;
  const rows = all(`SELECT * FROM ${r.table} ORDER BY ${r.order}`);
  return rows.map((row) => (r.format ? r.format(row) : row));
}

export { yen };
