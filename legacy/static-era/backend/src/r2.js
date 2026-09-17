import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import crypto from 'crypto';

const isR2 = !!process.env.R2_ACCOUNT_ID;
const endpoint = isR2 ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined;

export const s3 = new S3Client({
  region: process.env.AWS_REGION || 'auto',
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export const BUCKET = process.env.R2_BUCKET || process.env.S3_BUCKET;
export const PUBLIC_BASE = process.env.R2_PUBLIC_BASE; // https://assets.takuya-kimura.jp

// Generate R2 key: assets/{entity}/{uuid}-{variant}.webp
export function keyFor(entity, id, variant = 'orig') {
  return `assets/${entity}/${id}-${variant}.webp`;
}

// Optimize & upload — hero/news/film/release + 6 carousel => WebP
export async function uploadOptimized({ buffer, entity, id, mime, alt }) {
  const variants = [
    { name: 'thumb', w: 320, q: 78 },
    { name: 'sm', w: 640, q: 80 },
    { name: 'md', w: 960, q: 82 },
    { name: 'lg', w: 1280, q: 84 },
    { name: 'og', w: 1200, h: 630, q: 84 }, // OG 1.91:1
    { name: 'blur', w: 20, q: 30 },
  ];
  const results = [];
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  // blurhash could be generated here; using sharp metadata + placeholder
  for (const v of variants) {
    const pipeline = sharp(buffer).webp({ quality: v.q });
    if (v.w) pipeline.resize({ width: v.w, withoutEnlargement: true });
    if (v.h) pipeline.resize({ width: v.w, height: v.h, fit: 'cover' });
    const out = await pipeline.toBuffer();
    const s3Key = keyFor(entity, id, v.name);
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      Body: out,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
      Metadata: { alt: alt || '', checksum },
    }));
    results.push({ variant: v.name, s3_key: s3Key, width: v.w, height: v.h, size_bytes: out.length, checksum });
  }
  // also upload original as fallback
  const origKey = keyFor(entity, id, 'orig');
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: origKey,
    Body: buffer,
    ContentType: mime,
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  results.push({ variant: 'orig', s3_key: origKey, size_bytes: buffer.length, checksum });
  return { variants: results, checksum, publicUrl: `${PUBLIC_BASE}/${keyFor(entity, id, 'lg')}` };
}

export async function deleteAssets(keys) {
  for (const k of keys) {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: k }));
  }
}

// Pre-signed POST for direct browser upload (optional, not used for hero due to rights check)
export function presignedPost(entity, id) {
  // For future: use @aws-sdk/s3-presigned-post
  return null;
}
