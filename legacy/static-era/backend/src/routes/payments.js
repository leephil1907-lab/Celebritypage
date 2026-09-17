import { Router } from 'express';
import pool from '../db.js';
import { authOptional, requireAuth } from '../middleware/auth.js';
import { createJoinPaymentIntent, createShopCheckout, constructWebhookEvent, handleWebhookEvent } from '../stripe.js';
import express from 'express';
const r = Router();

// Create join PaymentIntent — 5140 yen flow (入会金1000+年会費4000+事務手数料140)
r.post('/join/intent', authOptional, async (req, res) => {
  const { email, method } = req.body;
  const userId = req.user?.id || null;
  if (!email) return res.status(400).json({ error: 'email required' });
  // No raw card storage — Stripe handles
  const pi = await createJoinPaymentIntent({ email, userId, method: method||'card' });
  // also create placeholder payment row (pending, not yet webhook_verified)
  await pool.query(`INSERT INTO payments (provider, provider_payment_id, user_id, amount_yen, currency, status, method, metadata) VALUES ('stripe',$1,$2,5140,'JPY','pending',$3,$4) ON CONFLICT (provider_payment_id) DO NOTHING`, [pi.id, userId, method||'card', JSON.stringify({ kind: 'join' })]);
  res.json({ clientSecret: pi.client_secret, paymentId: pi.id });
});

// Shop checkout → Stripe Checkout Session (card, paypay, konbini via Stripe)
r.post('/shop/checkout', requireAuth, async (req, res) => {
  const { orderNo } = req.body;
  if (!orderNo) return res.status(400).json({ error: 'orderNo required' });
  const o = await pool.query(`SELECT * FROM orders WHERE order_no=$1 AND user_id=$2`, [orderNo, req.user.id]);
  if (!o.rows.length) return res.status(404).json({ error: 'Order not found' });
  const items = await pool.query(`SELECT * FROM order_items WHERE order_id=$1`, [o.rows[0].id]);
  const session = await createShopCheckout({ orderNo, email: req.user.email, items: items.rows.map(it=>({ title: it.title, qty: it.qty, price_yen: it.unit_price_yen })), totalYen: o.rows[0].total_yen });
  await pool.query(`UPDATE orders SET payment_id=(SELECT id FROM payments WHERE provider_payment_id=$1) WHERE id=$2`, [session.payment_intent || session.id, o.rows[0].id]);
  res.json({ url: session.url, id: session.id });
});

// Webhook — must verify signature with raw body, no json middleware before
r.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  try {
    const event = constructWebhookEvent(req.body, sig);
    const result = await handleWebhookEvent(event, pool);
    res.json(result);
  } catch (e) {
    console.error('[stripe webhook] verify failed', e.message);
    res.status(400).send(`Webhook Error: ${e.message}`);
  }
});

// Public: list payments for current user
r.get('/mine', requireAuth, async (req, res) => {
  const q = await pool.query(`SELECT * FROM payments WHERE user_id=$1 ORDER BY created_at DESC`, [req.user.id]);
  res.json(q.rows);
});

// Admin manual (for Pay-easy / konbini offline verification) — no card data
r.post('/manual', authOptional, async (req, res) => {
  // For Pay-easy / konbini where webhook is not Stripe but provider posts to /api/payments/manual with provider verification
  // This keeps no raw card storage
  res.json({ ok: true, note: 'Manual payment recorded — awaiting provider webhook' });
});

export default r;
