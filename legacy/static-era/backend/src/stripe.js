import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

// 5140 yen = 1000 + 4000 + 140
export const JOIN_AMOUNT = 5140;
export const JOIN_CURRENCY = 'jpy';

// Create Stripe Checkout or PaymentIntent for JOIN (credit / card) + shop checkout
// No raw card storage: use Stripe PaymentMethods (pm_xxx) + webhook verification

export async function createJoinPaymentIntent({ email, userId, method = 'card' }) {
  // For card: create PaymentIntent with automatic payment methods
  // For konbini/paypay: create with payment_method_types
  const types = method === 'konbini' ? ['konbini'] : method === 'paypay' ? ['paypay'] : ['card'];
  const pi = await stripe.paymentIntents.create({
    amount: JOIN_AMOUNT,
    currency: JOIN_CURRENCY,
    receipt_email: email,
    metadata: { kind: 'join', userId: String(userId), amount: String(JOIN_AMOUNT) },
    payment_method_types: types,
    description: 'Takuya Kimura Fan Club —入会金・年会費・事務手数料 5,140円',
  });
  return pi;
}

export async function createShopCheckout({ orderNo, email, items, totalYen }) {
  // items: [{title, qty, price_yen, variant_sku}]
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: email,
    line_items: items.map(it => ({
      price_data: {
        currency: 'jpy',
        product_data: { name: it.title },
        unit_amount: it.price_yen,
      },
      quantity: it.qty,
    })),
    metadata: { orderNo, kind: 'shop', total: String(totalYen) },
    success_url: `${process.env.SITE_URL}/shop/?success=${orderNo}`,
    cancel_url: `${process.env.SITE_URL}/shop/?cancel=${orderNo}`,
  });
  return session;
}

// Webhook verification — must be called with raw body
export function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

export async function handleWebhookEvent(event, db) {
  // event.type: payment_intent.succeeded, checkout.session.completed, etc
  // We use provider_payment_id as idempotency guard
  const existing = await db.query(`SELECT id FROM payment_webhooks WHERE event_id=$1`, [event.id]);
  if (existing.rows.length) return { duplicate: true };
  await db.query(`INSERT INTO payment_webhooks (provider, event_id, payload, signature_verified) VALUES ('stripe',$1,$2,true)`, [event.id, JSON.stringify(event)]);

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const userId = pi.metadata?.userId;
    const kind = pi.metadata?.kind;
    // Insert into payments
    await db.query(`
      INSERT INTO payments (provider, provider_payment_id, user_id, amount_yen, currency, status, method, metadata, webhook_verified)
      VALUES ('stripe',$1,$2,$3,'JPY','succeeded',$4,$5,true)
      ON CONFLICT (provider_payment_id) DO UPDATE SET status='succeeded', webhook_verified=true
    `, [pi.id, userId || null, pi.amount, pi.payment_method_types?.[0] || 'card', JSON.stringify(pi.metadata || {})]);
    if (kind === 'join' && userId) {
      // Activate membership — 1 year from next month 1st (FC rule)
      const tier = await db.query(`SELECT id FROM membership_tiers WHERE key='silver' LIMIT 1`);
      const tierId = tier.rows[0]?.id;
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const end = new Date(start); end.setFullYear(end.getFullYear() + 1); end.setDate(end.getDate() - 1);
      await db.query(`
        INSERT INTO memberships (user_id, tier_id, status, started_at, expires_at, provider, provider_subscription_id)
        VALUES ($1,$2,'active',$3,$4,'stripe',$5)
        ON CONFLICT DO NOTHING
      `, [userId, tierId, start.toISOString(), end.toISOString(), pi.id]);
      // Fan card + passport handled via separate job (issueFanCard)
    }
    if (kind === 'shop') {
      const orderNo = pi.metadata?.orderNo;
      if (orderNo) {
        await db.query(`UPDATE orders SET status='paid', placed_at=now() WHERE order_no=$1`, [orderNo]);
        // Inventory deducted already at order creation (reserve), now confirm
      }
    }
  }
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const orderNo = s.metadata?.orderNo;
    if (orderNo) await db.query(`UPDATE orders SET status='paid', placed_at=now() WHERE order_no=$1`, [orderNo]);
  }
  return { handled: event.type };
}

export default stripe;
