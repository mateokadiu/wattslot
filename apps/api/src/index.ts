import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { DATA_SOURCE } from './attribution.ts';
import { edgeCache } from './cache.ts';
import type { AppEnv, Env } from './env.ts';
import { runScheduled } from './ingest/run.ts';
import { RequestError } from './prices/service.ts';
import { jobRoutes } from './routes/jobs.ts';
import { outageRoutes } from './routes/outages.ts';
import { planRoutes } from './routes/plans.ts';
import { priceRoutes } from './routes/prices.ts';
import { pushRoutes } from './routes/push.ts';
import { referenceRoutes } from './routes/reference.ts';
import { statusRoutes } from './routes/status.ts';
import { tariffRoutes } from './routes/tariffs.ts';

const app = new OpenAPIHono<AppEnv>();

// Everything the Worker answers is data, not a page: keep it out of search results. (Pages are
// static assets and never reach this code.) Registered first so it also covers cache hits.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Robots-Tag', 'noindex');
});

app.get('/health', (c) => c.json({ ok: true }));

app.use('*', secureHeaders());
// Any site may call the API from a browser. There are no cookies: saved plans are reached with a
// bearer token the caller holds, so a cross-site request can't act on someone else's behalf.
app.use('/v1/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'], maxAge: 86_400 }));
app.use('/openapi.json', cors({ origin: '*', allowMethods: ['GET'] }));
app.use('/v1/*', async (c, next) => {
  await next();
  c.header('X-Data-Source', DATA_SOURCE);
});
app.use('/v1/*', edgeCache);
app.route('/v1', referenceRoutes);
app.route('/v1', statusRoutes);
app.route('/v1', priceRoutes);
app.route('/v1', tariffRoutes);
app.route('/v1', outageRoutes);
app.route('/v1', planRoutes);
app.route('/v1', jobRoutes);
app.route('/v1', pushRoutes);

app.openAPIRegistry.registerComponent('securitySchemes', 'ownerToken', {
  type: 'http',
  scheme: 'bearer',
  description: 'The owner token from POST /v1/owners',
});

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

export { JobWorkflow } from './jobs/workflow.ts';
