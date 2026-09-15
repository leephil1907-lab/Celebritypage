import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { createClient } from 'redis';

let redis;
if (process.env.REDIS_URL) {
  try {
    // lazy, not blocking startup
    const client = createClient({ url: process.env.REDIS_URL });
    client.on('error', e=>console.warn('[redis] ', e.message));
    client.connect().catch(()=>{});
    redis = client;
  } catch {}
}

// Fallback memory limiter if redis unavailable
function limiter({ points, duration, keyPrefix }) {
  if (redis) {
    return new RateLimiterRedis({ storeClient: redis, points, duration, keyPrefix });
  }
  return new RateLimiterMemory({ points, duration, keyPrefix });
}

export const loginLimiter = limiter({ points: 5, duration: 15*60, keyPrefix: 'login' });
export const chatLimiter = limiter({ points: 20, duration: 60, keyPrefix: 'chat' });
export const apiLimiter = limiter({ points: 120, duration: 60, keyPrefix: 'api' });

export function rateLimit(limiter, keyFn) {
  return async (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.ip;
    try {
      await limiter.consume(key);
      next();
    } catch (e) {
      res.status(429).json({ error: 'Too Many Requests', retryAfter: Math.round(e.msBeforeNext/1000) || 60 });
    }
  };
}
