import { Router } from 'express';
import pool from '../db.js';
import { authOptional, requireRole } from '../middleware/auth.js';
import { uploadOptimized } from '../r2.js';
import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12*1024*1024 } });

const r = Router();
r.use(authOptional);

// CMS — hero / news / works / music / tours / journal (zero-fabrication: DATA REQUIRED placeholders)
// GET list
r.get('/hero', async (_req, res) => {
  const q = await pool.query(`SELECT * FROM cms_hero_slides WHERE is_active=true ORDER BY sort_order`);
  res.json(q.rows);
});
r.get('/news', async (req, res) => {
  const { status='published' } = req.query;
  const q = await pool.query(`SELECT * FROM cms_news WHERE status=$1 ORDER BY date DESC LIMIT 100`, [status]);
  res.json(q.rows);
});
r.get('/works', async (req, res) => {
  const { kind } = req.query;
  const q = kind ? await pool.query(`SELECT works.*, assets.s3_key as cover_s3 FROM works LEFT JOIN assets ON works.cover_asset_id=assets.id WHERE kind=$1 AND status='published' ORDER BY release_date DESC`, [kind])
                 : await pool.query(`SELECT works.*, assets.s3_key as cover_s3 FROM works LEFT JOIN assets ON works.cover_asset_id=assets.id WHERE status='published' ORDER BY release_date DESC`);
  res.json(q.rows);
});
r.get('/music/releases', async (_req, res) => {
  const q = await pool.query(`SELECT music_releases.*, assets.s3_key FROM music_releases LEFT JOIN assets ON music_releases.cover_asset_id=assets.id WHERE status='published' ORDER BY release_date DESC`);
  res.json(q.rows);
});
r.get('/tours', async (_req, res) => {
  const q = await pool.query(`SELECT tours.*, json_agg(json_build_object('date', tour_dates.date, 'venue', venues.name, 'status', tour_dates.status)) as dates FROM tours LEFT JOIN tour_dates ON tour_dates.tour_id=tours.id LEFT JOIN venues ON venues.id=tour_dates.venue_id WHERE tours.status='published' GROUP BY tours.id ORDER BY tours.period_start`);
  res.json(q.rows);
});
r.get('/journal', async (req, res) => {
  const vis = req.user ? ['public','members','tier_gold','tier_platinum','tier_diamond'] : ['public'];
  const q = await pool.query(`SELECT * FROM journal_entries WHERE status='published' AND visibility = ANY($1) ORDER BY published_at DESC LIMIT 50`, [vis]);
  res.json(q.rows);
});

// Write — admin/editor
r.post('/hero', requireRole('admin','super_admin','editor'), upload.single('image'), async (req, res) => {
  const { title, kicker, sub, link_url, sort_order } = req.body;
  let assetId = null, image_url = req.body.image_url || null;
  if (req.file) {
    const up = await uploadOptimized({ buffer: req.file.buffer, entity: 'hero', id: crypto.randomUUID(), mime: req.file.mimetype, alt: title });
    const ins = await pool.query(`INSERT INTO assets (bucket, s3_key, mime, size_bytes, status, alt_text, created_by) VALUES ($1,$2,$3,$4,'ready',$5,$6) RETURNING id`, [process.env.R2_BUCKET, up.variants.find(v=>v.variant==='lg').s3_key, req.file.mimetype, req.file.size, title, req.user.id]);
    assetId = ins.rows[0].id;
    image_url = up.publicUrl;
  }
  const q = await pool.query(`INSERT INTO cms_hero_slides (title, kicker, sub, image_asset_id, image_url, link_url, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [title||'DATA REQUIRED', kicker, sub, assetId, image_url, link_url, Number(sort_order||0)]);
  await pool.query(`INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id) VALUES ($1,$2,'CMS.CREATE','hero',$3)`, [req.user.id, req.user.email, q.rows[0].id]);
  res.json(q.rows[0]);
});

r.put('/news/:id', requireRole('admin','super_admin','editor'), async (req, res) => {
  const { id } = req.params;
  const { title, category, date, body, status } = req.body;
  const q = await pool.query(`UPDATE cms_news SET title=$1, category=$2, date=$3, body=$4, status=$5, updated_at=now() WHERE id=$6 RETURNING *`, [title, category, date, body, status, id]);
  res.json(q.rows[0]);
});

// Announce marquee
r.get('/announce', async (_req, res) => {
  const q = await pool.query(`SELECT value_json FROM site_settings WHERE key='st_tk_announce_v2'`);
  res.json(q.rows[0]?.value_json || []);
});
r.put('/announce', requireRole('admin','super_admin','editor'), async (req, res) => {
  await pool.query(`INSERT INTO site_settings (key, value_json, updated_by) VALUES ('st_tk_announce_v2',$1,$2) ON CONFLICT (key) DO UPDATE SET value_json=EXCLUDED.value_json`, [JSON.stringify(req.body), req.user.id]);
  res.json({ ok: true });
});

export default r;
