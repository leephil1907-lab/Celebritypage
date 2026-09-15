import { Router } from 'express';
import pool from '../db.js';
import { authOptional, requireRole } from '../middleware/auth.js';
import { uploadOptimized } from '../r2.js';
import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12*1024*1024 } });
const r = Router();
r.use(authOptional);

// List products — public, but inventory is real (no fake)
r.get('/', async (req, res) => {
  const { status='published' } = req.query;
  const q = await pool.query(`
    SELECT products.*, assets.s3_key as cover_s3, assets.blurhash,
           json_agg(json_build_object('id', product_variants.id,'sku',product_variants.sku,'price_yen',product_variants.price_yen,'inventory', inventory.quantity, 'reserved', inventory.reserved)) FILTER (WHERE product_variants.id IS NOT NULL) as variants
    FROM products
    LEFT JOIN assets ON products.cover_asset_id=assets.id
    LEFT JOIN product_variants ON product_variants.product_id=products.id
    LEFT JOIN inventory ON inventory.variant_id=product_variants.id
    WHERE products.status=$1
    GROUP BY products.id, assets.s3_key, assets.blurhash
    ORDER BY products.created_at DESC
  `, [status]);
  res.json(q.rows);
});

r.get('/:id', async (req, res) => {
  const q = await pool.query(`SELECT products.*, assets.s3_key FROM products LEFT JOIN assets ON products.cover_asset_id=assets.id WHERE products.id=$1`, [req.params.id]);
  if (!q.rows.length) return res.status(404).json({ error: 'Not found' });
  const v = await pool.query(`SELECT product_variants.*, inventory.quantity, inventory.reserved FROM product_variants LEFT JOIN inventory ON inventory.variant_id=product_variants.id WHERE product_variants.product_id=$1`, [req.params.id]);
  res.json({ ...q.rows[0], variants: v.rows });
});

// Admin — create product (R2)
r.post('/', requireRole('admin','super_admin','shop_manager'), upload.single('image'), async (req, res) => {
  const { slug, title, title_ja, description, base_price_yen, kind } = req.body;
  let coverId=null;
  if (req.file) {
    const up = await uploadOptimized({ buffer: req.file.buffer, entity: 'product', id: slug, mime: req.file.mimetype, alt: title });
    const ins = await pool.query(`INSERT INTO assets (bucket, s3_key, mime, size_bytes, status, alt_text, created_by) VALUES ($1,$2,$3,$4,'ready',$5,$6) RETURNING id`, [process.env.R2_BUCKET, up.variants.find(v=>v.variant==='lg').s3_key, req.file.mimetype, req.file.size, title, req.user.id]);
    coverId=ins.rows[0].id;
  }
  const q = await pool.query(`INSERT INTO products (slug, title, title_ja, description, base_price_yen, kind, cover_asset_id, created_by, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published') RETURNING *`, [slug, title, title_ja, description, Number(base_price_yen)||0, kind||'goods', coverId, req.user.id]);
  await pool.query(`INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id) VALUES ($1,$2,'PRODUCT.CREATE','product',$3)`, [req.user.id, req.user.email, q.rows[0].id]);
  res.json(q.rows[0]);
});

// Variant + inventory
r.post('/:id/variants', requireRole('admin','super_admin','shop_manager'), async (req, res) => {
  const { sku, title, price_yen, quantity } = req.body;
  const v = await pool.query(`INSERT INTO product_variants (product_id, sku, title, price_yen) VALUES ($1,$2,$3,$4) RETURNING *`, [req.params.id, sku, title, Number(price_yen)]);
  await pool.query(`INSERT INTO inventory (variant_id, quantity) VALUES ($1,$2) ON CONFLICT (variant_id) DO UPDATE SET quantity=$2`, [v.rows[0].id, Number(quantity||0)]);
  await pool.query(`INSERT INTO inventory_movements (variant_id, delta, reason, created_by) VALUES ($1,$2,'adjustment',$3)`, [v.rows[0].id, Number(quantity||0), req.user.id]);
  res.json(v.rows[0]);
});

// Inventory adjust (Shop→Inventory flow)
r.put('/inventory/:variantId', requireRole('admin','super_admin','shop_manager'), async (req, res) => {
  const { delta, reason='adjustment' } = req.body;
  const cur = await pool.query(`SELECT quantity FROM inventory WHERE variant_id=$1`, [req.params.variantId]);
  if (!cur.rows.length) return res.status(404).json({ error: 'variant not found' });
  const next = cur.rows[0].quantity + Number(delta);
  if (next < 0) return res.status(400).json({ error: 'Insufficient inventory' });
  await pool.query(`UPDATE inventory SET quantity=$1, updated_at=now() WHERE variant_id=$2`, [next, req.params.variantId]);
  await pool.query(`INSERT INTO inventory_movements (variant_id, delta, reason, created_by) VALUES ($1,$2,$3,$4)`, [req.params.variantId, Number(delta), reason, req.user.id]);
  res.json({ quantity: next });
});

export default r;
