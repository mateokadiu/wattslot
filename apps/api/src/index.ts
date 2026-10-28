import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { DATA_SOURCE } from './attribution.js';
import { edgeCache } from './cache.js';
import type { AppEnv, Env } from './env.js';
import { runScheduled } from './ingest/run.js';
import { RequestError } from './prices/service.js';
import { priceRoutes } from './routes/prices.js';
import { referenceRoutes } from './routes/reference.js';
import { statusRoutes } from './routes/status.js';

const app = new OpenAPIHono<AppEnv>();

app.get('/health', (c) => c.json({ ok: true }));

app.use('*', secureHeaders());
// Public, read-only data: any site may read it from a browser. No cookies, so no credentials.
app.use('/v1/*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'], maxAge: 86_400 }));
app.use('/openapi.json', cors({ origin: '*', allowMethods: ['GET'] }));
app.use('/v1/*', async (c, next) => {
  await next();
  c.header('X-Data-Source', DATA_SOURCE);
});
app.use('/v1/*', edgeCache);
app.route('/v1', referenceRoutes);
app.route('/v1', statusRoutes);
app.route('/v1', priceRoutes);

app.doc31('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'wattslot API',
    version: '0.1.0',
    description: `All-in electricity prices per 15-minute slot. Data source: ${DATA_SOURCE}; derived prices are calculated by wattslot.`,
    license: { name: 'AGPL-3.0-only', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
  },
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((error, c) => {
  if (error instanceof RequestError) {
    return c.json(
      { error: error.status === 404 ? 'not_found' : 'invalid_request', message: error.message },
      error.status,
    );
  }
  console.error(error);
  return c.json({ error: 'internal_error' }, 500);
});

export default {
  fetch: app.fetch,
  /** One Cron Trigger every 5 minutes; the schedule inside decides what to ingest. */
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
