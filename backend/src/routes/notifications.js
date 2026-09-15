import { Router } from 'express';
import pool from '../db.js';
import { authOptional, requireAuth } from '../middleware/auth.js';
const r = Router();

// Preferences — user can set In-App/Email/Push per type (tour/music/journal/membership/ticket/merchandise/support)
r.get('/preferences', requireAuth, async (req, res) => {
  const q = await pool.query(`SELECT channel, type, enabled FROM notification_preferences WHERE user_id=$1`, [req.user.id]);
  const prefs = {};
  for (const row of q.rows) {
    if (!prefs[row.type]) prefs[row.type] = {};
    prefs[row.type][row.channel] = row.enabled;
  }
  res.json(prefs);
});

r.put('/preferences', requireAuth, async (req, res) => {
  const prefs = req.body; // {tour:{in_app:true,email:true,push:false}, ...}
  for (const [type, channels] of Object.entries(prefs)) {
    for (const [channel, enabled] of Object.entries(channels)) {
      // channel mapping: in_app vs inapp
      const ch = channel === 'inapp' ? 'in_app' : channel;
      await pool.query(`
        INSERT INTO notification_preferences (user_id, channel, type, enabled)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (user_id, channel, type) DO UPDATE SET enabled=EXCLUDED.enabled
      `, [req.user.id, ch, type, !!enabled]);
    }
  }
  res.json({ ok: true });
});

// Inbox
r.get('/', requireAuth, async (req, res) => {
  const q = await pool.query(`SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.user.id]);
  res.json(q.rows);
});

r.put('/:id/read', requireAuth, async (req, res) => {
  await pool.query(`UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
  res.json({ ok: true });
});

r.put('/read-all', requireAuth, async (req, res) => {
  await pool.query(`UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL`, [req.user.id]);
  res.json({ ok: true });
});

// Admin: send campaign / broadcast
r.post('/broadcast', authOptional, async (req, res) => {
  // require admin — check via authOptional then verify
  if (!req.user || !req.user.roles?.some(r=>['super_admin','admin'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
  const { type='system', title, body, channel='in_app', segment } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title/body required' });
  // For demo, broadcast to all members with tier? For prod, respect preferences
  const users = await pool.query(`SELECT id FROM users WHERE status='active'`);
  for (const u of users.rows) {
    // Check preference
    const pref = await pool.query(`SELECT enabled FROM notification_preferences WHERE user_id=$1 AND type=$2 AND channel=$3`, [u.id, type, channel]);
    if (pref.rows.length && !pref.rows[0].enabled) continue;
    await pool.query(`INSERT INTO notifications (user_id, type, title, body, channel) VALUES ($1,$2,$3,$4,$5)`, [u.id, type, title, body, channel]);
  }
  await pool.query(`INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id) VALUES ($1,$2,'NOTIFICATION.BROADCAST','notification',$3)`, [req.user.id, req.user.email, title]);
  res.json({ ok: true, sent: users.rowCount });
});

export default r;
