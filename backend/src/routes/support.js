import { Router } from 'express';
import pool from '../db.js';
import { authOptional, requireAuth, requireRole } from '../middleware/auth.js';
import { sendTicketUpdate } from '../email.js';
const r = Router();
r.use(authOptional);

function genTicketNo(){ return 'TK-' + Math.random().toString(36).slice(2,10).toUpperCase(); }

// Create ticket — Open→Closed via same table (mirrors chat threads)
r.post('/', authOptional, async (req, res) => {
  const { subject, category='general', message, email, priority='normal' } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'subject & message required' });
  const userId = req.user?.id || null;
  const mail = email || req.user?.email;
  if (!mail) return res.status(400).json({ error: 'email required' });
  const ticketNo = genTicketNo();
  const ins = await pool.query(`
    INSERT INTO support_tickets (ticket_no, user_id, email, subject, category, priority, status)
    VALUES ($1,$2,$3,$4,$5,$6,'open') RETURNING *
  `, [ticketNo, userId, mail, subject, category, priority]);
  const ticket = ins.rows[0];
  await pool.query(`INSERT INTO support_messages (ticket_id, sender_user_id, sender_role, body) VALUES ($1,$2,$3,$4)`, [ticket.id, userId, userId ? 'member' : 'visitor', message]);
  // also keep legacy threads for chat widget
  await pool.query(`
    INSERT INTO support_threads (email, messages) VALUES ($1, $2::jsonb)
    ON CONFLICT (email) DO UPDATE SET messages = support_threads.messages || $2::jsonb, updated_at=now()
  `, [mail, JSON.stringify([{ from:'user', text: message, ts: Date.now() }])]);
  await pool.query(`INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id) VALUES ($1,$2,'TICKET.CREATE','ticket',$3)`, [userId, mail, ticketNo]);
  await pool.query(`INSERT INTO notifications (user_id, type, title, body, channel) VALUES ($1,'support',$2,$3,'in_app')`, [userId || null, `Ticket ${ticketNo} opened`, subject]);
  res.json(ticket);
});

// List — mine or all (staff)
r.get('/', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const isStaff = req.user.roles?.some(r=>['super_admin','admin','support'].includes(r));
  if (isStaff) {
    const q = await pool.query(`SELECT support_tickets.*, users.email as user_email FROM support_tickets LEFT JOIN users ON users.id=support_tickets.user_id ORDER BY updated_at DESC LIMIT 100`);
    return res.json(q.rows);
  }
  const q = await pool.query(`SELECT * FROM support_tickets WHERE user_id=$1 OR email=$2 ORDER BY updated_at DESC`, [req.user.id, req.user.email]);
  res.json(q.rows);
});

r.get('/:id', requireAuth, async (req, res) => {
  const q = await pool.query(`SELECT * FROM support_tickets WHERE id=$1`, [req.params.id]);
  if (!q.rows.length) return res.status(404).json({ error: 'Not found' });
  const t = q.rows[0];
  const isStaff = req.user.roles?.some(r=>['super_admin','admin','support'].includes(r));
  if (t.user_id !== req.user.id && t.email !== req.user.email && !isStaff) return res.status(403).json({ error: 'Forbidden' });
  const msgs = await pool.query(`SELECT * FROM support_messages WHERE ticket_id=$1 ORDER BY created_at`, [t.id]);
  res.json({ ...t, messages: msgs.rows });
});

// Staff reply + status transition Open→In Progress→Waiting→Resolved→Closed
r.post('/:id/messages', requireAuth, async (req, res) => {
  const { body, status } = req.body;
  if (!body) return res.status(400).json({ error: 'body required' });
  const q = await pool.query(`SELECT * FROM support_tickets WHERE id=$1`, [req.params.id]);
  if (!q.rows.length) return res.status(404).json({ error: 'Not found' });
  const t = q.rows[0];
  const isStaff = req.user.roles?.some(r=>['super_admin','admin','support'].includes(r));
  const isOwner = t.user_id===req.user.id || t.email===req.user.email;
  if (!isOwner && !isStaff) return res.status(403).json({ error: 'Forbidden' });
  const role = isStaff ? 'staff' : 'member';
  await pool.query(`INSERT INTO support_messages (ticket_id, sender_user_id, sender_role, body) VALUES ($1,$2,$3,$4)`, [t.id, req.user.id, role, body]);
  if (status && ['open','pending','resolved','closed'].includes(status)) {
    await pool.query(`UPDATE support_tickets SET status=$1, updated_at=now(), closed_at= CASE WHEN $1='closed' THEN now() ELSE closed_at END WHERE id=$2`, [status, t.id]);
    if (isStaff) await sendTicketUpdate({ to: t.email, ticketNo: t.ticket_no, status, subject: t.subject }).catch(e=>console.warn('[email] ticket update failed', e.message));
    await pool.query(`INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, diff) VALUES ($1,$2,'TICKET.UPDATE','ticket',$3,$4)`, [req.user.id, req.user.email, t.ticket_no, JSON.stringify({ status })]);
  } else {
    await pool.query(`UPDATE support_tickets SET updated_at=now() WHERE id=$1`, [t.id]);
  }
  // also update thread for widget
  const threadMsg = { from: role==='staff'?'staff':'user', text: body, ts: Date.now() };
  await pool.query(`INSERT INTO support_threads (email, messages) VALUES ($1,$2) ON CONFLICT (email) DO UPDATE SET messages = support_threads.messages || $2, updated_at=now()`, [t.email, JSON.stringify([threadMsg])]);
  res.json({ ok: true });
});

export default r;
