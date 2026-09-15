import { Router } from 'express';
import pool from '../db.js';
import { requireRole } from '../middleware/auth.js';
const r = Router();

r.get('/', requireRole('admin','super_admin'), async (_req, res) => {
  const q = await pool.query(`SELECT * FROM campaigns ORDER BY created_at DESC`);
  res.json(q.rows);
});

r.post('/', requireRole('admin','super_admin'), async (req, res) => {
  const { slug, name, type='in_app', segment_query={} } = req.body;
  if (!slug || !name) return res.status(400).json({ error: 'slug/name required' });
  const q = await pool.query(`INSERT INTO campaigns (slug, name, type, segment_query, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [slug, name, type, JSON.stringify(segment_query), req.user.id]);
  await pool.query(`INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id) VALUES ($1,$2,'CAMPAIGN.CREATE','campaign',$3)`, [req.user.id, req.user.email, q.rows[0].id]);
  res.json(q.rows[0]);
});

r.post('/:id/send', requireRole('admin','super_admin'), async (req, res) => {
  const q = await pool.query(`SELECT * FROM campaigns WHERE id=$1`, [req.params.id]);
  if (!q.rows.length) return res.status(404).json({ error: 'Not found' });
  const c = q.rows[0];
  // Resolve segment — for demo, send to all active members
  const users = await pool.query(`SELECT id FROM users WHERE status='active' LIMIT 1000`);
  for (const u of users.rows) {
    await pool.query(`INSERT INTO notifications (user_id, type, title, body, channel, payload) VALUES ($1,'system',$2,$3,'in_app',$4)`, [u.id, c.name, `Campaign: ${c.name}`, JSON.stringify({ campaign_id: c.id })]);
    await pool.query(`INSERT INTO campaign_recipients (campaign_id, user_id, status, sent_at) VALUES ($1,$2,'sent', now()) ON CONFLICT DO NOTHING`, [c.id, u.id]);
  }
  await pool.query(`UPDATE campaigns SET status='sent', sent_at=now(), stats=jsonb_set(stats,'{sent}', to_jsonb($1::int)) WHERE id=$2`, [users.rowCount, c.id]);
  res.json({ ok: true, sent: users.rowCount });
});

export default r;
