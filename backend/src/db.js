import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (e) => console.error('[db] pool error', e.message));

// Helper to set RLS context (current user) per request
export async function withRls(client, userId, fn) {
  try {
    if (userId) await client.query(`SET LOCAL app.current_user_id = $1`, [userId]);
    // For Supabase-style auth.uid() compatibility
    if (userId) await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    return await fn(client);
  } finally {
    // reset is automatic on transaction end (SET LOCAL)
  }
}

// Transaction helper
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export default pool;
