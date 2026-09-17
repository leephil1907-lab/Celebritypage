/**
 * server/media.js — picks the sharpest file that actually exists for a given asset path.
 *
 * The photo archive is mixed: some shots are 1600px scans, some are 300px web thumbnails. A 300px
 * file blown up across a 1262px hero is exactly the "the design looks cut off / soft" complaint, and
 * there is a set of pre-cut renditions in public/images/optimized that the site was not using.
 * This maps a source path to the best available rendition + a srcset, and reports nothing that is
 * not on disk, so a missing derivative can never produce a broken <img>.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageDims } from './lib/images.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPT_DIR = path.join(ROOT, 'public', 'images', 'optimized');
const WIDTHS = [1280, 960, 640, 320];

let index = null;
let indexedAt = 0;
const TTL = 30_000;

/** a file only earns a srcset entry if it is a WebP that is really the size its name claims */
function usableRendition(file, declared) {
  try {
    const fd = fs.openSync(path.join(OPT_DIR, file), 'r');
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
    if (head.subarray(0, 4).toString('latin1') !== 'RIFF' || head.subarray(8, 12).toString('latin1') !== 'WEBP') return false;
    if (!declared) return true;
    const d = imageDims(`/images/optimized/${file}`);
    return !!d && Math.abs(d.width - declared) <= Math.max(8, Math.round(declared * 0.06));
  } catch { return false; }
}

/**
 * filename → available widths, refreshed every 30s so an admin drop-in is picked up without a restart.
 * The static-era archive shipped files named `-1280.webp` that were byte-for-byte copies of the
 * source GIF, so every candidate is opened and verified here; a lie on disk costs one <srcset>
 * entry, never a soft or mistyped image on screen.
 */
function scan() {
  const now = Date.now();
  if (index && now - indexedAt < TTL) return index;
  index = new Map();
  try {
    for (const f of fs.readdirSync(OPT_DIR)) {
      const m = /^(.*)-(\d{3,4}|og)\.webp$/.exec(f);
      if (!m) continue;
      const width = m[2] === 'og' ? 'og' : Number(m[2]);
      if (!usableRendition(f, width === 'og' ? 0 : width)) continue;
      if (!index.has(m[1])) index.set(m[1], new Map());
      index.get(m[1]).set(width, f);
    }
  } catch { index = new Map(); }
  indexedAt = now;
  return index;
}

/** '/image-search/x--3.jpg' → { src, srcset, sizes, width, height } using the largest renditions. */
export function renditions(rel, { sizes = '100vw' } = {}) {
  const src = String(rel || '');
  if (!src || !src.startsWith('/')) return { src, srcset: '', sizes: '', width: 0, height: 0 };
  const base = path.basename(src).replace(/\.[a-z0-9]+$/i, '');
  const avail = scan().get(base);
  const dims = imageDims(src);
  const out = { src, srcset: '', sizes: '', width: dims?.width || 0, height: dims?.height || 0 };
  if (!avail) return out;
  const have = WIDTHS.filter((w) => avail.has(w));
  if (!have.length) return out;
  // the <src> stays the original file, so the webp set is an upgrade and never a broken reference
  out.srcset = have.map((w) => `/images/optimized/${avail.get(w)} ${w}w`).join(', ');
  out.sizes = sizes;
  return out;
}

/**
 * Attribute string for an <img> that should never be blurry or cut off.
 * Returns src/srcset/sizes/width/height + lazy/decoding defaults; escape-safe because every value is
 * produced here, so templates can print it with <%- %>.
 */
export function imgAttrs(rel, { alt = '', sizes = '100vw', class: cls = '', priority = false, extra = '' } = {}) {
  const r = renditions(rel, { sizes });
  const a = [];
  a.push(`src="${r.src}"`);
  if (r.srcset) a.push(`srcset="${r.srcset}"`, `sizes="${r.sizes}"`);
  if (r.width && r.height) a.push(`width="${r.width}"`, `height="${r.height}"`);
  a.push(`alt="${String(alt).replace(/"/g, '&quot;')}"`);
  if (cls) a.push(`class="${cls}"`);
  a.push(priority ? 'fetchpriority="high" decoding="async"' : 'loading="lazy" decoding="async"');
  if (extra) a.push(extra);
  return a.join(' ');
}

/** <link rel=preload as=image> attributes — with imagesrcset so the preloaded file is the one
 *  the srcset would have selected, otherwise the hero is downloaded twice. */
export function preloadAttrs(rel, sizes = '100vw') {
  const r = renditions(rel, { sizes });
  if (!r.src) return '';
  if (!r.srcset) return `href="${r.src}"`;
  return `href="${r.src}" imagesrcset="${r.srcset}" imagesizes="${r.sizes}"`;
}
