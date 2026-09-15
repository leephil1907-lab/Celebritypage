import { Router } from 'express';
import pool from '../db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { sendJoinApplicationMail, sendJoinCompletedMail } from '../email.js';
const r = Router();

const ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);

// POST /api/auth/signup — email + password (8+ chars), NO plaintext storage, bcrypt only
r.post('/signup', async (req, res) => {
  const { email, password, name, locale='ja' } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email/password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password 8+ chars' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
  // Reject plaintext via trigger, but also check here
  const hash = await bcrypt.hash(password, ROUNDS);
  if (!hash.startsWith('$2')) return res.status(500).json({ error: 'hash failed' });
  try {
    const ins = await pool.query(`INSERT INTO users (email, password_hash, locale, status) VALUES ($1,$2,$3,'pending_verification') RETURNING id,email`, [email, hash, locale]);
    const uid = ins.rows[0].id;
    await pool.query(`INSERT INTO profiles (user_id, display_name) VALUES ($1,$2)`, [uid, name || email.split('@')[0]]);
    await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, (SELECT id FROM roles WHERE key='member'))`, [uid]);
    // Email verification token (24h)
    const token = crypto.randomBytes(32).toString('hex');
    const thash = crypto.createHash('sha256').update(token).digest('hex');
    await pool.query(`INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now()+ interval '24 hours')`, [uid, thash]);
    // Send STEP 2 mail (real delivery)
    try { await sendJoinApplicationMail({ to: email, token, baseUrl: process.env.SITE_URL }); } catch (e) { console.warn('[email] join mail failed (dev fallback)', e.message); }
    const jwtToken = jwt.sign({ sub: uid, email }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.cookie('token', jwtToken, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV==='production', maxAge: 7*24*60*60*1000 });
    res.json({ ok: true, user: { id: uid, email }, token: jwtToken, verificationToken: process.env.NODE_ENV==='production' ? undefined : token });
  } catch (e) {
    if (e.code==='23505') return res.status(409).json({ error: 'Email already registered' });
    console.error(e);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// POST /api/auth/login
r.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'required' });
  const q = await pool.query(`SELECT users.*, array_agg(roles.key) as roles FROM users LEFT JOIN user_roles ON user_roles.user_id=users.id LEFT JOIN roles ON roles.id=user_roles.role_id WHERE users.email=$1 AND users.deleted_at IS NULL GROUP BY users.id`, [email]);
  if (!q.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
  const u = q.rows[0];
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  if (u.status==='suspended') return res.status(403).json({ error: 'Suspended' });
  await pool.query(`UPDATE users SET last_login_at=now() WHERE id=$1`, [u.id]);
  const token = jwt.sign({ sub: u.id, email: u.email }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV==='production', maxAge: 7*24*60*60*1000 });
  await pool.query(`INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id) VALUES ($1,$2,'LOGIN','user',$1)`, [u.id, u.email]);
  res.json({ ok: true, user: { id: u.id, email: u.email, roles: u.roles.filter(Boolean) }, token });
});

// POST /api/auth/join/request — STEP1: email input + terms agree → send STEP2 mail (no card)
r.post('/join/request', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });
  // If user exists, reuse; else create pending
  let q = await pool.query(`SELECT id FROM users WHERE email=$1`, [email]);
  let uid;
  if (q.rows.length) uid = q.rows[0].id;
  else {
    const hash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), ROUNDS); // random, user will set later via info form
    const ins = await pool.query(`INSERT INTO users (email, password_hash, status) VALUES ($1,$2,'pending_verification') RETURNING id`, [email, hash]);
    uid = ins.rows[0].id;
    await pool.query(`INSERT INTO profiles (user_id) VALUES ($1)`, [uid]);
  }
  const token = crypto.randomBytes(32).toString('hex');
  const thash = crypto.createHash('sha256').update(token).digest('hex');
  await pool.query(`INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now()+ interval '24 hours')`, [uid, thash]);
  try {
    await sendJoinApplicationMail({ to: email, token });
  } catch (e) { console.warn('[email] fail', e.message); if (process.env.NODE_ENV!=='production') return res.json({ ok: true, devToken: token }); return res.status(500).json({ error: 'Email failed, try other domain (iCloud/Gmail delay known)', detail: e.message }); }
  res.json({ ok: true, msg: 'Application mail sent — check inbox (allow fc-member.familyclub.jp)' });
});

// POST /api/auth/join/complete — STEP2 URL token → register info + pay 5140 (handled via payments/join/intent)
r.post('/join/complete', async (req, res) => {
  const { token, name, address, birthdate } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  const thash = crypto.createHash('sha256').update(token).digest('hex');
  const q = await pool.query(`SELECT user_id, expires_at, consumed_at FROM email_verification_tokens WHERE token_hash=$1`, [thash]);
  if (!q.rows.length) return res.status(400).json({ error: 'Invalid token' });
  if (q.rows[0].consumed_at) return res.status(400).json({ error: 'Already used' });
  if (new Date(q.rows[0].expires_at) < new Date()) return res.status(400).json({ error: 'Expired (24h)' });
  await pool.query(`UPDATE email_verification_tokens SET consumed_at=now() WHERE token_hash=$1`, [thash]);
  await pool.query(`UPDATE profiles SET display_name=$1, bio=$2 WHERE user_id=$3`, [name || 'DATA REQUIRED', JSON.stringify({ address, birthdate }), q.rows[0].user_id]);
  // Return userId for next step (payment)
  res.json({ ok: true, userId: q.rows[0].user_id, next: 'payment' });
});

// GET /api/auth/me
r.get('/me', async (req, res) => {
  const h = req.headers.authorization;
  let token = null;
  if (h?.startsWith('Bearer ')) token = h.slice(7);
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const q = await pool.query(`SELECT users.id, users.email, users.status, profiles.display_name, array_agg(roles.key) as roles FROM users LEFT JOIN profiles ON profiles.user_id=users.id LEFT JOIN user_roles ON user_roles.user_id=users.id LEFT JOIN roles ON roles.id=user_roles.role_id WHERE users.id=$1 GROUP BY users.id, profiles.display_name`, [payload.sub]);
    res.json(q.rows[0] || null);
  } catch (e) { res.status(401).json({ error: 'Invalid token' }); }
});

r.post('/logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

export default r;
