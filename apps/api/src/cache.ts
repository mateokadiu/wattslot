import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env.js';

/**
 * Serves repeat GETs from Cloudflare's edge cache for as long as the response's own
 * `Cache-Control: public, max-age` allows, so popular requests don't reach D1 at all.
 * (The Cache API is a no-op on *.workers.dev; it takes effect on a custom domain.)
 */
export const edgeCache: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== 'GET') return next();
  const cache = caches.default;
  const key = new Request(c.req.url, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) {
    const response = new Response(hit.body, hit);
    response.headers.set('X-Cache', 'HIT');
    return response;
  }
  await next();
  const cacheControl = c.res.headers.get('Cache-Control') ?? '';
  if (c.res.status === 200 && cacheControl.includes('public')) {
    c.executionCtx.waitUntil(cache.put(key, c.res.clone()));
  }
  c.res.headers.set('X-Cache', 'MISS');
};
