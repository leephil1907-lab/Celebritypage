import { Router } from 'express';
import pool from '../db.js';
import { authOptional, requireRole } from '../middleware/auth.js';
const r = Router();

// Simple KV table for legacy st_tk_* keys → now backed by Postgres
// We store in site_settings (key TEXT PK, value_json JSONB)
// This replaces localStorage seeds in production
// Legacy keys are mapped via KimuraDB.keyMap, but we also expose generic /api/kv/:key

r.use(authOptional);

// GET /api/kv/:key → {value}
r.get('/:key', async (req, res) => {
  const { key } = req.params;
  const q = await pool.query(`SELECT value_json FROM site_settings WHERE key=$1`, [key]);
  if (!q.rows.length) return res.status(404).json({ error: 'Not found', key });
  res.json({ key, value: q.rows[0].value_json });
});

// PUT /api/kv/:key — admin/editor only for most, but member prefs allowed for own
r.put('/:key', authOptional, async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'value required' });
  // RBAC: st_* CMS keys require cms:write
  const cmsKeys = ['st_tk_news_v2','st_tk_hero_v2','st_tk_concert_v2','st_tk_movie_v2','st_tk_release_v2','st_tk_blog_v2','st_tk_announce_v2','st_shop_products','st_journal','st_archive','st_tk_payments_v2'];
  if (cmsKeys.includes(key) && (!req.user || !req.user.roles.some(r=>['super_admin','admin','editor','tour_manager','shop_manager'].includes(r)))) {
    return res.status(403).json({ error: 'Forbidden: cms:write required' });
  }
  await pool.query(`
    INSERT INTO site_settings (key, value_json, updated_by)
    VALUES ($1,$2::jsonb,$3)
    ON CONFLICT (key) DO UPDATE SET value_json=EXCLUDED.value_json, updated_by=EXCLUDED.updated_by, updated_at=now()
  `, [key, JSON.stringify(value), req.user?.id || null]);
  // audit
  await pool.query(`INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, diff) VALUES ($1,$2,'CMS.UPDATE','kv',$3,$4)`,
    [req.user?.id||null, req.user?.email||null, key, JSON.stringify({ value })]);
  res.json({ ok: true, key });
});

export default r;
