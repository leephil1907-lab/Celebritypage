/**
 * server/seo.js — metadata, sitemap, robots and RSS from one source of truth.
 *
 * Why this exists: the static era shipped a hand-written sitemap.xml that pointed at a Vercel host,
 * invented /en/... URLs the app never served and listed /join/form/, which 404s. Crawlers noticed.
 * Everything here is derived from the live route table + the database, and every URL is absolute,
 * because social inspectors reject relative og:image values.
 *
 * Locale model: one URL per page; the language is a session preference that can also be seeded from
 * `?lang=ja|en` (see sessionMiddleware), which is what the hreflang alternates below point at.
 */
import { get, all } from './db.js';
import { imageDims } from './lib/images.js';
import * as C from './content.js';

/* ------------------------------------------------------------------ *
 * Page table — path is the canonical form; index=false keeps a page out of
 * the sitemap, sets robots:noindex and an X-Robots-Tag header.
 * ------------------------------------------------------------------ */
export const PAGE_DEFS = {
  home: {
    path: '/', priority: '1.0', changefreq: 'daily', index: true,
    en: { title: 'Takuya Kimura — Official Digital World', desc: 'Live Tour 2026 Checkpoint, Fan Club Vault, Tour Passport and private Meet & Greet — the official home of Takuya Kimura.' },
    ja: { title: '木村拓哉 — オフィシャル・デジタルワールド', desc: 'Live Tour 2026 Checkpoint、ファンクラブVault、ツアーパスポート、非公開ミート＆グリート。木村拓哉の公式サイト。' },
  },
  work: {
    path: '/work/', priority: '0.9', changefreq: 'weekly', index: true,
    en: { title: 'WORK — Film • TV • CM', desc: 'Verified filmography: film, television, commercials and regular appearances with dates and roles.' },
    ja: { title: 'WORK — 映画・ドラマ・CM', desc: '出演作品一覧。映画、ドラマ、CM、レギュラー番組を公開日・役柄とともに公式情報でお届けします。' },
  },
  music: {
    path: '/music/', priority: '0.9', changefreq: 'weekly', index: true,
    en: { title: 'MUSIC — CHECKPOINT & Discography', desc: 'Albums, singles and the CHECKPOINT campaign — with the members-only vault player.' },
    ja: { title: 'MUSIC — CHECKPOINT とディスコグラフィ', desc: 'アルバム、シングル、CHECKPOINTキャンペーン。会員限定のVaultプレイヤーもこちらから。' },
  },
  tour: {
    path: '/tour/', priority: '0.9', changefreq: 'daily', index: true,
    en: { title: 'TOUR — Live 2026 Checkpoint', desc: 'Fukuoka to Seoul to Taipei: dates, venues, fan-club lottery, goods and the QR Tour Passport.' },
    ja: { title: 'TOUR — Live 2026 Checkpoint', desc: '福岡・ソウル・台北の全公演日程、会場、ファンクラブ先行、グッズ、QRツアーパスポートのご案内。' },
  },
  journal: {
    path: '/journal/', priority: '0.8', changefreq: 'daily', index: true,
    en: { title: 'JOURNAL — Editorial', desc: 'Tour, film, music and style writing from the official desk.' },
    ja: { title: 'JOURNAL — エディトリアル', desc: 'ツアー、映画、音楽、スタイルについての公式コラム。' },
  },
  archive: {
    path: '/archive/', priority: '0.7', changefreq: 'monthly', index: true,
    en: { title: 'ARCHIVE — 1987 → Future', desc: 'A verified timeline from debut to the 2026 arena run.' },
    ja: { title: 'ARCHIVE — 1987 から未来へ', desc: 'デビューから2026年アリーナツアーまでの年表。' },
  },
  members: {
    path: '/members/', priority: '0.6', changefreq: 'weekly', index: false,
    en: { title: 'MEMBERS — Fan Card & Vault', desc: 'Your fan card, tour passport, tickets and vault access. Silver, Gold, Platinum and Diamond tiers.' },
    ja: { title: 'MEMBERS — ファンカードとVault', desc: 'マイページでファンカード・ツアーパスポート・チケット・Vaultをまとめて確認。シルバークォールドプラチナダイヤモンドの4段階で、先行抽選や会員限定配信が解放されます。' },
  },
  shop: {
    path: '/shop/', priority: '0.8', changefreq: 'daily', index: true,
    en: { title: 'SHOP — Official Goods', desc: 'Apparel, tour merchandise, albums and accessories with live inventory and QR pickup.' },
    ja: { title: 'SHOP — 公式グッズ', desc: 'アパレル、ツアーグッズ、アルバム、アクセサリー。在庫と受け取りQRをリアルタイムで反映。' },
  },
  join: {
    path: '/join/', priority: '0.7', changefreq: 'monthly', index: true,
    en: { title: 'JOIN — Fan Club Membership', desc: 'Become a member: choose a fan card tier, unlock the vault and enter tour lotteries.' },
    ja: { title: 'JOIN — ファンクラブ入会', desc: 'ファンカードのプランを選んで入会。Vault解除とツアー先行抽選に応募できます。' },
  },
  search: { path: '/search/', priority: '0.4', changefreq: 'monthly', index: false },
  support: {
    path: '/support/', priority: '0.5', changefreq: 'monthly', index: true,
    en: { title: 'SUPPORT — Ticket Desk', desc: 'Ticket-based support: bookings, fan-card and vault questions answered by Official Site / Management.' },
    ja: { title: 'SUPPORT — チケット窓口', desc: 'ご予約・ファンカード・Vaultのお問い合わせを、公式サイト／事務局がチケット方式で回答します。' },
  },
  /* transactional / personal surfaces — never indexed */
  'shop-complete': { path: '/shop/complete', index: false },
  verify: { path: '/shop/verify', index: false },
  'join-complete': { path: '/join/complete', index: false },
};

/** Paths a crawler may request that must stay out of search results. */
export const NOINDEX_PATHS = ['/shop/complete', '/shop/verify', '/join/complete', '/members/', '/cart'];

/* ------------------------------------------------------------------ *
 * URLs
 * ------------------------------------------------------------------ */
export function siteUrlSetting() {
  const raw = String(C.settingsMap()['site.url'] || process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  return raw || '';
}

/** Absolute origin: the configured public URL wins, otherwise the live request. */
export function origin(req) {
  const cfg = siteUrlSetting();
  if (cfg) return cfg;
  const proto = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : (req.protocol || 'http');
  return `${proto}://${req.get('host')}`;
}

/** latin characters count as 1, CJK as 2 — the unit search results actually measure in. */
export function displayWidth(str) {
  return [...String(str || '')].reduce((n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1), 0);
}

export const abs = (originUrl, p) => (!p ? '' : /^https?:\/\//i.test(p) ? p : originUrl + (p.startsWith('/') ? p : `/${p}`));

/** Canonical path for a request: known pages get their registered slash form, everything else is kept. */
export function canonicalPath(rawPath) {
  let p = String(rawPath || '/').split('?')[0].split('#')[0];
  if (/\/index\.html?$/i.test(p)) p = p.replace(/\/index\.html?$/i, '/');
  const def = Object.values(PAGE_DEFS).find((d) => d.path === p);
  if (def) return def.path;
  if (!p.endsWith('/') && Object.values(PAGE_DEFS).some((d) => d.path === `${p}/`)) return `${p}/`;
  return p;
}

/** A path that is served as a page but is not in the table → 301 target for trailing-slash cleanup. */
export function slashRedirectFor(rawPath) {
  const p = String(rawPath || '/').split('?')[0];
  if (p === '/' || p.endsWith('/')) return null;
  if (/\.[a-z0-9]{1,5}$/i.test(p)) return null;                 // files (.json, .xml, .css) never take a slash
  const target = `${p}/`;
  const known = Object.values(PAGE_DEFS).some((d) => d.path === target);
  return known ? target : null;
}

export function localeUrl(originUrl, path, lang) {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return lang === 'ja' ? abs(originUrl, clean) : `${abs(originUrl, clean)}${clean.includes('?') ? '&' : '?'}lang=en`;
}

/* ------------------------------------------------------------------ *
 * Per-render metadata
 * ------------------------------------------------------------------ */
const brandSuffix = (title, brand) => (!title || title.includes(brand) ? title : `${title} | ${brand}`);

/**
 * Build everything head.ejs needs. Route-provided title/description always win; the localised
 * defaults in PAGE_DEFS are only used when a route is still carrying its English default.
 */
export function metaFor({ req, locals, status = 0 }) {
  const site = C.settingsMap();
  const o = origin(req);
  const lang = locals.lang === 'en' ? 'en' : 'ja';
  const def = PAGE_DEFS[locals.page] || {};
  const copy = def[lang] || {};

  const isDefaultTitle = !locals.title || (def.en && locals.title === def.en.title);
  const isDefaultDesc = !locals.description || (def.en && locals.description === def.en.desc);
  // detail pages carry their own identity: the post title, and the excerpt (or a body cut) as description
  if (locals.post) {
    if (isDefaultTitle) locals.title = `${locals.post.title} — ${def[lang]?.title?.split('—')[0].trim() || 'Journal'}`;
    if (isDefaultDesc) {
      const body = String(locals.post.body || '').replace(/\s+/g, ' ').trim();
      locals.description = (locals.post.excerpt || body).slice(0, 210);
    }
  }
  const title = brandSuffix(copy.title && isDefaultTitle ? copy.title : (locals.title || site['site.title']), site['site.brand'] || 'STARTO ENTERTAINMENT');
  let description = String((copy.desc && isDefaultDesc ? copy.desc : (locals.description || site['site.description'] || '')).replace(/\s+/g, ' ').trim());
  if (displayWidth(description) < 60 && locals.post?.body) {
    const tail = String(locals.post.body).replace(/\s+/g, ' ').trim();
    description = `${description} ${tail}`.slice(0, 200).trim();
  }

  const path = canonicalPath(req.path);
  const canonical = abs(o, path);

  /* social image: page-specific first, hero slide 1, then the brand default */
  let image = locals.shareImage || locals.ogImage || null;
  if (!image && Array.isArray(locals.hero) && locals.hero[0]?.image) image = locals.hero[0].image;
  if (!image && Array.isArray(locals.post?.images) && locals.post.images[0]) image = locals.post.images[0];
  if (!image && Array.isArray(locals.products) && locals.products[0]?.image) image = locals.products[0].image;
  if (!image) image = site['site.image'] || '/image-search/takuya-kimura-live-tour-checkpoint-2026--2.jpg';
  if (typeof image === 'string' && image.startsWith('/uploads/')) image = site['site.image'] || '/image-search/takuya-kimura-live-tour-checkpoint-2026--2.jpg';

  const dims = imageDims(image);
  const indexable = def.index !== false && !NOINDEX_PATHS.includes(path) && !req.query.q && !(status >= 400);
  const images = Array.isArray(locals.hero) ? locals.hero.map((h) => h.image).filter(Boolean)
    : Array.isArray(locals.post?.images) ? locals.post.images.filter(Boolean)
      : Array.isArray(locals.images) ? locals.images.filter(Boolean) : [];

  return {
    origin: o,
    title,
    description,
    canonical,
    path,
    robots: indexable ? 'index, follow, max-image-preview:large, max-snippet:-1' : 'noindex, follow',
    indexable,
    lang,
    alternates: [
      { lang: 'ja', href: localeUrl(o, path, 'ja') },
      { lang: 'en', href: localeUrl(o, path, 'en') },
      { lang: 'x-default', href: localeUrl(o, path, 'ja') },
    ],
    og: {
      type: locals.ogType || (locals.post ? 'article' : 'website'),
      title: title.replace(/\s*\|\s*STARTO.*$/, ''),
      description,
      image: abs(o, image),
      imageAlt: locals.post?.title || locals.shareAlt || site['site.title'] || 'Takuya Kimura',
      url: canonical,
      locale: lang === 'ja' ? 'ja_JP' : 'en_US',
      localeAlternate: lang === 'ja' ? 'en_US' : 'ja_JP',
      publishedTime: isoDate(locals.post?.published_at) || null,
      imageWidth: (dims && dims.width) || null,
      imageHeight: (dims && dims.height) || null,
      siteName: site['site.brand'] || 'STARTO ENTERTAINMENT',
    },
    images: images.slice(0, 6),
    jsonLd: jsonLd(structuredData({ locals, o, site, title, description, image, indexable, canonical })),
  };
}

/* ------------------------------------------------------------------ *
 * Structured data — a single @graph, always JSON-escaped for <script>
 * ------------------------------------------------------------------ */
function structuredData({ locals, o, site, title, description, image, indexable, canonical }) {
  const url = (p) => abs(o, p);
  const org = {
    '@type': 'Organization',
    '@id': `${o}/#organization`,
    name: site['site.brand'] || 'STARTO ENTERTAINMENT',
    url: o,
    logo: url('/images/logo-tk-gold.png'),
    sameAs: [site['social.x'], site['social.ig'], site['social.yt'], site['link.starto']].filter(Boolean).map(String),
  };
  const person = {
    '@type': 'Person',
    '@id': `${o}/#person`,
    name: 'Takuya Kimura',
    alternateName: '木村拓哉',
    jobTitle: ['Actor', 'Singer', 'Radio Host'],
    url: o,
    image: url(image),
    worksFor: { '@id': `${o}/#organization` },
    sameAs: org.sameAs,
  };
  const nodes = [org, person];

  if (indexable) {
    nodes.push({
      '@type': 'WebSite',
      '@id': `${o}/#website`,
      url: o,
      name: site['site.title'] || 'Takuya Kimura — Official',
      inLanguage: ['ja', 'en'],
      publisher: { '@id': `${o}/#organization` },
      potentialAction: {
        '@type': 'SearchAction',
        target: `${url('/search/')}?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    });
  }

  const crumbs = [{ name: 'Home', path: '/' }];
  const def = PAGE_DEFS[locals.page];
  if (def && locals.page !== 'home') crumbs.push({ name: title.split('—')[0].trim() || title, path: def.path });
  if (crumbs.length > 1) {
    nodes.push({
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumbs`,
      itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: url(c.path) })),
    });
  }

  if (locals.page === 'home') {
    nodes.push({
      '@type': 'WebPage', '@id': `${o}/#webpage`, url: o, name: title, description,
      isPartOf: { '@id': `${o}/#website` }, about: { '@id': `${o}/#person` },
      inLanguage: locals.lang === 'ja' ? 'ja' : 'en',
    });
  }

  if (locals.post) {
    nodes.push({
      '@type': 'Article',
      headline: locals.post.title,
      description: locals.post.excerpt || description,
      image: url(locals.post.image || image),
      datePublished: locals.post.published_at || undefined,
      dateModified: locals.post.updated_at || locals.post.published_at || undefined,
      inLanguage: locals.lang === 'ja' ? 'ja' : 'en',
      author: { '@id': `${o}/#organization` },
      publisher: { '@id': `${o}/#organization` },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url(`/journal/${locals.post.id}`) },
    });
  }

  if (Array.isArray(locals.tour) && locals.tour.length) {
    nodes.push({
      '@type': 'ItemList',
      name: 'TAKUYA KIMURA Live Tour 2026 Checkpoint',
      itemListElement: locals.tour.slice(0, 12).map((d, i) => ({
        '@type': 'ListItem', position: i + 1,
        item: {
          '@type': 'MusicEvent',
          name: d.title || 'TAKUYA KIMURA Live Tour 2026 Checkpoint',
          startDate: isoDate(d.date),
          eventStatus: 'https://schema.org/EventScheduled',
          eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
          location: { '@type': 'Place', name: d.venue || d.city || '', address: { '@type': 'PostalAddress', addressLocality: d.city || '', addressCountry: d.country || 'JP' } },
          performer: { '@id': `${o}/#person` },
          organizer: { '@id': `${o}/#organization` },
          ...(d.url ? { offers: { '@type': 'Offer', url: d.url, availability: d.sold_out ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock' } } : {}),
        },
      })),
    });
  }

  if (Array.isArray(locals.products) && locals.products.length && locals.page === 'shop') {
    nodes.push({
      '@type': 'ItemList',
      name: 'Official Goods',
      itemListElement: locals.products.slice(0, 20).map((p, i) => ({
        '@type': 'ListItem', position: i + 1, url: url(`/shop/#p-${p.sku || p.id}`),
        item: {
          '@type': 'Product', name: p.title, description: p.subtitle || p.title,
          image: url(p.image), sku: p.sku || String(p.id),
          offers: { '@type': 'Offer', price: Number(p.price_yen || 0), priceCurrency: 'JPY', availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url: url('/shop/') },
        },
      })),
    });
  }

  return nodes;
}

/** 'YYYY.MM.DD' / ISO-ish → ISO date, so Google never rejects a startDate. */
export function isoDate(v) {
  if (!v) return undefined;
  const s = String(v).trim();
  const m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

/** Escape for embedding inside <script type="application/ld+json"> — never a raw '<'. */
export const jsonLd = (nodes) => JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes })
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

export { imageDims } from './lib/images.js';

/* ------------------------------------------------------------------ *
 * Sitemap / robots / RSS
 * ------------------------------------------------------------------ */
function lastmod(table, column) {
  try {
    const row = get(`SELECT MAX(${column}) AS v FROM ${table}`);
    return isoDate(row?.v) || undefined;
  } catch { return undefined; }
}

export function sitemapXml(req) {
  const o = origin(req);
  const today = new Date().toISOString().slice(0, 10);
  const heroImages = (() => { try { return C.heroSlides(6).map((h) => h.image).filter(Boolean); } catch { return []; } })();
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const urls = [];
  /* a future date is never a useful lastmod — clamp to today so Search console doesn't flag it */
  const cap = (d) => (!d || d > today ? today : d);
  for (const [key, def] of Object.entries(PAGE_DEFS)) {
    if (def.index === false) continue;
    const loc = abs(o, def.path);
    const mod = cap(key === 'home' ? lastmod('news', 'date')
      : key === 'journal' ? lastmod('journal_posts', 'published_at')
        : key === 'shop' ? lastmod('products', 'updated_at')
          : key === 'tour' ? lastmod('tour_dates', 'date') : today) || today;
    urls.push(`  <url>
    <loc>${esc(loc)}</loc>
    <xhtml:link rel="alternate" hreflang="ja" href="${esc(localeUrl(o, def.path, 'ja'))}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${esc(localeUrl(o, def.path, 'en'))}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(localeUrl(o, def.path, 'ja'))}"/>
    <lastmod>${mod}</lastmod>
    <changefreq>${def.changefreq || 'monthly'}</changefreq>
    <priority>${def.priority || '0.5'}</priority>${key === 'home' && heroImages.length ? heroImages.map((im) => `
    <image:image><image:loc>${esc(abs(o, im))}</image:loc><image:title>Takuya Kimura — Official</image:title></image:image>`).join('') : ''}
  </url>`);
  }

  // journal posts + archive items get their own entries so the deep pages are discoverable
  let posts = [];
  try { posts = all(`SELECT id, title, published_at, image FROM journal_posts WHERE status='published' AND visibility='public' ORDER BY published_at DESC LIMIT 100`); } catch { /* empty db */ }
  for (const p of posts) {
    urls.push(`  <url>
    <loc>${esc(abs(o, `/journal/${p.id}`))}</loc>
    <lastmod>${cap(isoDate(p.published_at)) || today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>${p.image ? `
    <image:image><image:loc>${esc(abs(o, p.image))}</image:loc><image:title>${esc(p.title)}</image:title></image:image>` : ''}
  </url>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>
`;
}

export function robotsTxt(req) {
  const o = origin(req);
  return `# ${new Date().toISOString().slice(0, 10)} — generated by the app, so the host is always correct
User-agent: *
Allow: /$
Allow: /work/
Allow: /music/
Allow: /tour/
Allow: /journal/
Allow: /archive/
Allow: /shop/
Allow: /join/
Allow: /support/

# private, personal or transactional — do not crawl
Disallow: /admin
Disallow: /api/
Disallow: /members/
Disallow: /cart
Disallow: /checkout
Disallow: /shop/complete
Disallow: /shop/verify
Disallow: /join/complete
Disallow: /search/?q=
Disallow: /*?_pjax=
Disallow: /*?cart=
Disallow: /uploads/

Sitemap: ${abs(o, '/sitemap.xml')}
Host: ${o.replace(/^https?:\/\//, '')}
`;
}

export function rssXml(req) {
  const o = origin(req);
  const site = C.settingsMap();
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  /* content dates are written 2026.09.15 (and 2026-09-15 in the admin), both have to land as RFC-822 */
  const rfc = (d) => { const m = /^(\d{4})[.\/-](\d{2})[.\/-](\d{2})/.exec(String(d || '')); const t = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`) : new Date(d); return Number.isNaN(t.getTime()) ? new Date().toUTCString() : t.toUTCString(); };  
  const plain = (v, n) => String(v || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

  /* the feed has to describe what it links to: journal entries go to the post, news
     announcements to their anchored row, and a locked post never appears with its body */
  const entries = [];
  try {
    C.journalPosts({ limit: 12 }).forEach((post) => {
      if (post.locked) return;
      entries.push({
        title: post.title, link: abs(o, `/journal/${post.id}`), date: post.published_at || post.date,
        text: plain(post.excerpt || post.body, 480), tag: post.category,
      });
    });
  } catch { /* content layer not ready — the channel still renders */ }
  try {
    C.news(12).forEach((n) => entries.push({
      title: n.title, link: abs(o, `/work/#news-${n.id}`), date: n.date,
      text: plain(n.body || n.title, 480), tag: n.category,
    }));
  } catch { /* same */ }
  entries.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const body = entries.slice(0, 20).map((e) => `    <item>
      <title>${esc(e.title)}</title>
      <link>${esc(e.link)}</link>
      <guid isPermaLink="true">${esc(e.link)}</guid>
      <pubDate>${rfc(e.date)}</pubDate>
${e.tag ? `      <category>${esc(e.tag)}</category>\n` : ''}      <description>${esc(e.text)}</description>
    </item>`).join('\n');

  const stamp = entries.length ? rfc(entries[0].date) : new Date().toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(site['site.title'] || 'Takuya Kimura — Official')}</title>
    <link>${esc(abs(o, '/'))}</link>
    <description>${esc(site['site.description'] || '')}</description>
    <language>${esc(site['site.locale'] || 'ja')}</language>
    <lastBuildDate>${stamp}</lastBuildDate>
    <atom:link href="${esc(abs(o, '/rss.xml'))}" rel="self" type="application/rss+xml"/>
${body}
  </channel>
</rss>
`;
}
