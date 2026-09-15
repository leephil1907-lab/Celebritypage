import jwt from 'jsonwebtoken';
import pool from '../db.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, roles: user.roles || [] }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

// Extract user from Authorization: Bearer or cookie
export async function authOptional(req, _res, next) {
  const h = req.headers.authorization;
  let token = null;
  if (h?.startsWith('Bearer ')) token = h.slice(7);
  else if (req.cookies?.token) token = req.cookies.token;
  else if (req.headers.cookie) {
    const m = req.headers.cookie.match(/token=([^;]+)/);
    if (m) token = decodeURIComponent(m[1]);
  }
  if (token) {
    try {
      const payload = verifyToken(token);
      // Load fresh roles
      const r = await pool.query(`SELECT key FROM roles JOIN user_roles ON user_roles.role_id=roles.id WHERE user_roles.user_id=$1`, [payload.sub]);
      req.user = { id: payload.sub, email: payload.email, roles: r.rows.map(x=>x.key) };
    } catch {}
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const ok = roles.some(r => req.user.roles.includes(r) || req.user.roles.includes('super_admin'));
    if (!ok) return res.status(403).json({ error: 'Forbidden', need: roles });
    next();
  };
}

// For RLS: attach user to pg SET LOCAL via middleware that wraps handlers with withRls
export function withUser(fn) {
  return async (req, res, next) => {
    try { await fn(req, res); } catch (e) { next(e); }
  };
}
