import { Router } from 'express';
import multer from 'multer';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { uploadOptimized } from '../r2.js';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15*1024*1024 } });
const r = Router();

// Admin: upload hero/news/film/release etc → R2 with WebP variants + blur
// Body: entity=hero|news|product etc, alt, rights
r.post('/', requireRole('admin','super_admin','editor','shop_manager'), upload.single('file'), async (req, res) => {
  const { entity='general', alt='', rights_id } = req.body;
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
  if (!allowed.includes(req.file.mimetype)) return res.status(400).json({ error: 'image only' });
  const id = crypto.randomUUID();
  const up = await uploadOptimized({ buffer: req.file.buffer, entity, id, mime: req.file.mimetype, alt });
  const lg = up.variants.find(v=>v.variant==='lg');
  const q = await pool.query(`
    INSERT INTO assets (bucket, s3_key, mime, size_bytes, width, height, checksum_sha256, status, rights_id, alt_text, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'ready',$8,$9,$10) RETURNING *
  `, [process.env.R2_BUCKET, lg.s3_key, req.file.mimetype, req.file.size, lg.width, lg.height, up.checksum, rights_id||null, alt, req.user.id]);
  // variants
  for (const v of up.variants) {
    if (v.variant==='lg') continue;
    await pool.query(`INSERT INTO asset_variants (asset_id, variant, s3_key, width, height, size_bytes) VALUES ($1,$2,$3,$4,$5,$6)`, [q.rows[0].id, v.variant, v.s3_key, v.width, v.height, v.size_bytes]);
  }
  await pool.query(`INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id) VALUES ($1,$2,'ASSET.UPLOAD','asset',$3)`, [req.user.id, req.user.email, q.rows[0].id]);
  res.json({ asset: q.rows[0], variants: up.variants, publicUrl: up.publicUrl });
});

// List assets
r.get('/', requireRole('admin','super_admin','editor'), async (req, res) => {
  const q = await pool.query(`SELECT assets.*, array_agg(asset_variants.variant) as variants FROM assets LEFT JOIN asset_variants ON asset_variants.asset_id=assets.id GROUP BY assets.id ORDER BY assets.created_at DESC LIMIT 100`);
  res.json(q.rows);
});

export default r;
