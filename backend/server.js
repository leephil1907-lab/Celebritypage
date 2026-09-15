import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import pool from './src/db.js';
import authRoutes from './src/routes/auth.js';
import kvRoutes from './src/routes/kv.js';
import cmsRoutes from './src/routes/cms.js';
import productRoutes from './src/routes/products.js';
import orderRoutes from './src/routes/orders.js';
import paymentRoutes from './src/routes/payments.js';
import supportRoutes from './src/routes/support.js';
import notificationRoutes from './src/routes/notifications.js';
import campaignRoutes from './src/routes/campaigns.js';
import uploadRoutes from './src/routes/upload.js';
import { authOptional } from './src/middleware/auth.js';
import { apiLimiter, rateLimit } from './src/middleware/rateLimit.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();

// Security headers — creamy site + R2 assets
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com", "https://quickchart.io"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:", process.env.R2_PUBLIC_BASE || "https://*.r2.cloudflarestorage.com"],
      connectSrc: ["'self'", "https://api.stripe.com", process.env.R2_PUBLIC_BASE || ""],
      frameSrc: ["https://js.stripe.com"],
    }
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: (origin, cb) => {
    const allow = (process.env.CORS_ORIGIN || '').split(',').map(s=>s.trim()).filter(Boolean);
    if (!origin || allow.length===0 || allow.includes(origin) || allow.includes('*')) return cb(null, true);
    // allow vercel preview
    if (origin.endsWith('.vercel.app')) return cb(null, true);
    cb(new Error('CORS blocked: '+origin));
  },
  credentials: true,
}));
app.use(pinoHttp({ logger }));
// Webhook needs raw body — mount before json
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit(apiLimiter, req=>req.ip));

// Health
app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'up', time: new Date().toISOString() }); }
  catch (e) { res.status(500).json({ ok: false, db: 'down', error: e.message }); }
});

// Auth
app.use('/api/auth', authRoutes);
// KV (legacy localStorage bridge)
app.use('/api/kv', kvRoutes);
// CMS
app.use('/api/cms', cmsRoutes);
app.use('/api', cmsRoutes); // also mount events etc at /api/events etc via cms
// Products / Commerce
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
// Support & Notifications
app.use('/api/support', supportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/upload', uploadRoutes);

// Audit logs — read only for admin/analyst
app.get('/api/audit', authOptional, async (req, res) => {
  if (!req.user || !req.user.roles?.some(r=>['super_admin','admin','analyst'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
  const q = await pool.query(`SELECT * FROM audit_logs ORDER BY occurred_at DESC LIMIT 100`);
  res.json(q.rows);
});

// Analytics rollup
app.get('/api/analytics/daily', authOptional, async (req, res) => {
  if (!req.user || !req.user.roles?.some(r=>['super_admin','admin','analyst'].includes(r))) return res.status(403).json({ error: 'Forbidden' });
  const q = await pool.query(`SELECT * FROM analytics_daily_rollup ORDER BY date DESC LIMIT 90`);
  res.json(q.rows);
});
app.post('/api/analytics/event', async (req, res) => {
  const { event_name, props={}, path } = req.body;
  if (!event_name) return res.status(400).json({ error: 'event_name required' });
  const userId = req.user?.id || null;
  await pool.query(`INSERT INTO analytics_events (user_id, event_name, props, path, ip_hash, user_agent) VALUES ($1,$2,$3,$4, md5($5), $6)`, [userId, event_name, JSON.stringify(props), path, req.ip, req.headers['user-agent']]);
  res.json({ ok: true });
});

// Catch-all
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));
app.use((err, _req, res, _next) => {
  logger.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => logger.info(`[api] listening on :${PORT} env=${process.env.NODE_ENV} db=${process.env.DATABASE_URL ? 'set' : 'missing'} R2=${process.env.R2_BUCKET||'missing'} Stripe=${process.env.STRIPE_SECRET_KEY? 'set':'missing'}`));
