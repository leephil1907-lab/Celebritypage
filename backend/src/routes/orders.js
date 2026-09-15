import { Router } from 'express';
import pool from '../db.js';
import { authOptional, requireAuth, requireRole } from '../middleware/auth.js';
import { tx } from '../db.js';
const r = Router();
r.use(authOptional);

function genOrderNo() { return 'ORD-' + Math.random().toString(36).slice(2,10).toUpperCase(); }

// Create order — Products→Inventory→Checkout→Payment→Orders (reserve inventory)
r.post('/', requireAuth, async (req, res) => {
  const { items, deliveryType, shipping_address, pickupVenue } = req.body; // items: [{variant_id, qty}]
  if (!items?.length) return res.status(400).json({ error: 'items required' });
  const email = req.user.email;
  const userId = req.user.id;
  try {
    const order = await tx(async (client) => {
      let subtotal=0;
      const variants = [];
      for (const it of items) {
        const q = await client.query(`SELECT product_variants.*, inventory.quantity, inventory.reserved, products.title FROM product_variants JOIN inventory ON inventory.variant_id=product_variants.id JOIN products ON product_variants.product_id=products.id WHERE product_variants.id=$1 FOR UPDATE`, [it.variant_id]);
        if (!q.rows.length) throw new Error(`Variant ${it.variant_id} not found`);
        const v=q.rows[0];
        if (v.quantity - v.reserved < it.qty) throw new Error(`Insufficient stock: ${v.title} (${v.sku})`);
        // reserve
        await client.query(`UPDATE inventory SET reserved = reserved + $1 WHERE variant_id=$2`, [it.qty, it.variant_id]);
        await client.query(`INSERT INTO inventory_movements (variant_id, delta, reason, order_id, created_by) VALUES ($1,$2,'reserve', NULL, $3)`, [it.variant_id, -it.qty, userId]);
        subtotal += v.price_yen * it.qty;
        variants.push({ ...v, qty: it.qty });
      }
      const orderNo = genOrderNo();
      const total = subtotal; // tax/shipping added at payment if needed
      const ins = await client.query(`
        INSERT INTO orders (order_no, user_id, email, status, subtotal_yen, total_yen, shipping_address, placed_at)
        VALUES ($1,$2,$3,'pending',$4,$5,$6, now()) RETURNING *
      `, [orderNo, userId, email, subtotal, total, JSON.stringify(deliveryType==='delivery'? shipping_address : { pickupVenue, deliveryType })]);
      const orderId = ins.rows[0].id;
      for (const v of variants) {
        await client.query(`INSERT INTO order_items (order_id, variant_id, product_id, title, sku, qty, unit_price_yen, total_yen) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [orderId, v.id, v.product_id, v.title, v.sku, v.qty, v.price_yen, v.price_yen*v.qty]);
        // update movement with order_id
        await client.query(`UPDATE inventory_movements SET order_id=$1 WHERE variant_id=$2 AND created_by=$3 AND order_id IS NULL AND reason='reserve'`, [orderId, v.id, userId]);
      }
      // QR token for MERCH QR SYSTEM ORDER→PAYMENT→QR→VENUE→SCAN→VERIFY→COLLECT
      const qr = 'QR-' + orderNo + '-' + Math.random().toString(36).slice(2,7).toUpperCase();
      // Store QR as metadata in orders.shipping_address? Better add column qr_token — use metadata in orders for now
      await client.query(`UPDATE orders SET shipping_address = jsonb_set(COALESCE(shipping_address,'{}'::jsonb), '{qr}', to_jsonb($1::text)), shipping_address = jsonb_set(shipping_address, '{deliveryType}', to_jsonb($2::text)) WHERE id=$3`, [qr, deliveryType, orderId]);
      return { ...ins.rows[0], qr, items: variants };
    });
    // audit + notification
    await pool.query(`INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id) VALUES ($1,$2,'ORDER.CREATE','order',$3)`, [userId, email, order.order_no]);
    await pool.query(`INSERT INTO notifications (user_id, type, title, body, channel) VALUES ($1,'order',$2,$3,'in_app')`, [userId, `Order ${order.order_no} pending payment`, `Total ¥${order.total_yen.toLocaleString()} • ${deliveryType}`]);
    res.json(order);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// List own orders
r.get('/mine', requireAuth, async (req, res) => {
  const q = await pool.query(`SELECT orders.*, json_agg(json_build_object('title', order_items.title,'qty',order_items.qty,'total',order_items.total_yen)) as items FROM orders LEFT JOIN order_items ON order_items.order_id=orders.id WHERE orders.user_id=$1 GROUP BY orders.id ORDER BY orders.created_at DESC`, [req.user.id]);
  res.json(q.rows);
});

// Admin: list all
r.get('/', requireRole('admin','super_admin','shop_manager'), async (_req, res) => {
  const q = await pool.query(`SELECT orders.*, users.email as user_email FROM orders LEFT JOIN users ON users.id=orders.user_id ORDER BY orders.created_at DESC LIMIT 100`);
  res.json(q.rows);
});

// QR verify — VENUE→SCAN→VERIFY→COLLECT (no sensitive data, only order_no + QR)
r.post('/verify', async (req, res) => {
  const { qr, order_no } = req.body;
  const key = qr || order_no;
  if (!key) return res.status(400).json({ error: 'qr or order_no required' });
  const q = await pool.query(`SELECT * FROM orders WHERE order_no=$1 OR shipping_address->>'qr'=$1`, [key]);
  if (!q.rows.length) return res.status(404).json({ ok: false, msg: 'QR not found' });
  const o = q.rows[0];
  if (o.status === 'fulfilled') return res.json({ ok: false, msg: 'Already collected' });
  if (o.status !== 'paid') return res.json({ ok: false, msg: 'Order not ready: '+o.status });
  await pool.query(`UPDATE orders SET status='fulfilled', fulfilled_at=now() WHERE id=$1`, [o.id]);
  // release reserved → quantity (sale)
  const items = await pool.query(`SELECT variant_id, qty FROM order_items WHERE order_id=$1`, [o.id]);
  for (const it of items.rows) {
    await pool.query(`UPDATE inventory SET quantity = quantity - $1, reserved = reserved - $1 WHERE variant_id=$2`, [it.qty, it.variant_id]);
    await pool.query(`INSERT INTO inventory_movements (variant_id, delta, reason, order_id) VALUES ($1,$2,'sale',$3)`, [it.variant_id, -it.qty, o.id]);
  }
  await pool.query(`INSERT INTO notifications (user_id, type, title, body, channel) VALUES ($1,'order',$2,$3,'in_app')`, [o.user_id, `Order ${o.order_no} collected`, `Verified at venue`]);
  res.json({ ok: true, order: { ...o, status: 'fulfilled' } });
});

export default r;
