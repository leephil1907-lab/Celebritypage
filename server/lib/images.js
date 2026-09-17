/**
 * server/lib/images.js — intrinsic size of an image, read from its file header.
 * No dependency, no decode: PNG IHDR, GIF LSD, WebP VP8/VP8L/VP8X and the JPEG marker chain.
 * Cached per path, because og:image:width/height is asked for on every request.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUB = path.join(ROOT, 'public');
const dimCache = new Map();

export function imageDims(relPath) {
  const key = String(relPath || '');
  if (dimCache.has(key)) return dimCache.get(key);
  let out = null;
  try {
    if (!/^\//.test(key) || key.includes('..')) return null;
    const fd = fs.openSync(path.join(PUB, key), 'r');
    const buf = Buffer.alloc(34);
    fs.readSync(fd, buf, 0, 34, 0);
    fs.closeSync(fd);
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      out = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };            // PNG IHDR
    } else if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      out = { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };               // GIF
    } else if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') {
      const tag = buf.subarray(12, 16).toString();
      if (tag === 'VP8X') out = { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      else if (tag === 'VP8L') { const b = buf.readUInt32LE(21); out = { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
      else if (tag === 'VP8 ') out = { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    } else if (buf[0] === 0xff && buf[1] === 0xd8) {
      // JPEG: walk the marker chain until a SOFn frame appears
      const fd = fs.openSync(path.join(PUB, key), 'r');
      const j = Buffer.alloc(128 * 1024);
      fs.readSync(fd, j, 0, j.length, 0);
      fs.closeSync(fd);
      let i = 2;
      while (i + 9 < j.length) {
        if (j[i] !== 0xff) { i++; continue; }
        const marker = j[i + 1];
        const len = j.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          out = { height: j.readUInt16BE(i + 5), width: j.readUInt16BE(i + 7) };
          break;
        }
        i += 2 + len;
      }
    }
  } catch { out = null; }
  if (out && !(out.width > 0 && out.height > 0)) out = null;
  dimCache.set(key, out);
  return out;
}
