import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env.ts';

const STORED_AT = 'x-wattslot-stored-at';
const MAX_AGE = 'x-wattslot-max-age';

const maxAgeOf = (cacheControl: string | null) => {
  const match = /(?:^|,)\s*max-age=(\d+)/.exec(cacheControl ?? '');
  return match?.[1] ? Number(match[1]) : null;
};

/**
 * Serves repeat GETs from Cloudflare's edge cache for exactly as long as the response's own
 * `Cache-Control: public, max-age` says — so popular requests don't reach D1 at all.
 *
 * Freshness is checked here rather than trusted to the cache: Cloudflare applies the zone's
 * Browser Cache TTL (4 hours by default) to stored responses, which would otherwise keep
 * yesterday's prices alive and tell browsers to keep them too. Each stored copy records when
 * it was stored and its intended lifetime; a hit past that lifetime is treated as a miss, and a
 * hit is served with the remaining lifetime, not the zone's.
 * (The Cache API is a no-op on *.workers.dev; it takes effect on the custom domain.)
 */
export const edgeCache: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== 'GET') return next();
  const cache = caches.default;
  const key = new Request(c.req.url, { method: 'GET' });
  const now = Date.now();

  const hit = await cache.match(key);
  if (hit) {
    const storedAt = Number(hit.headers.get(STORED_AT));
    const maxAge = Number(hit.headers.get(MAX_AGE));
    const age = Math.floor((now - storedAt) / 1000);
    if (storedAt > 0 && maxAge > 0 && age >= 0 && age < maxAge) {
      const response = new Response(hit.body, hit);
      response.headers.set('Cache-Control', `public, max-age=${maxAge - age}`);
      response.headers.set('X-Cache', 'HIT');
      response.headers.delete(STORED_AT);
      response.headers.delete(MAX_AGE);
      return response;
    }
  }

  await next();
  const maxAge = maxAgeOf(c.res.headers.get('Cache-Control'));
  if (
    c.res.status === 200 &&
    (c.res.headers.get('Cache-Control') ?? '').includes('public') &&
    maxAge
  ) {
    const stored = c.res.clone();
    const copy = new Response(stored.body, stored);
    copy.headers.set(STORED_AT, String(now));
    copy.headers.set(MAX_AGE, String(maxAge));
    c.executionCtx.waitUntil(cache.put(key, copy));
  }
  c.res.headers.set('X-Cache', hit ? 'STALE' : 'MISS');
};
