import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { schema } from '@wattslot/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { AppEnv } from '../env.js';
import { TASKS } from '../ingest/schedule.js';

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

const statusRoute = createRoute({
  method: 'get',
  path: '/status',
  summary: 'Data freshness',
  responses: {
    200: {
      description: 'When each dataset was last ingested, and the latest price slot per zone',
      content: {
        'application/json': {
          schema: z.object({
            tasks: z.array(
              z.object({
                task: z.string(),
                lastSuccessAt: z.string().nullable(),
                nextAttemptAt: z.string().nullable(),
                lastError: z.string().nullable(),
              }),
            ),
            latestPriceSlot: z.record(z.string(), z.string()),
          }),
        },
      },
    },
  },
});

export const statusRoutes = new OpenAPIHono<AppEnv>().openapi(statusRoute, async (c) => {
  const db = drizzle(c.env.DB);
  const states = await db.select().from(schema.ingestState);
  const latest = await db
    .select({
      zone: schema.spotPrices.zone,
      slot: sql<number>`max(${schema.spotPrices.slotStartMs})`,
    })
    .from(schema.spotPrices)
    .groupBy(schema.spotPrices.zone);
  c.header('Cache-Control', 'public, max-age=60');
  return c.json(
    {
      tasks: TASKS.map((task) => {
        const s = states.find((x) => x.task === task);
        return {
          task,
          lastSuccessAt: iso(s?.lastSuccessAtMs ?? null),
          nextAttemptAt: iso(s?.nextAttemptAtMs ?? null),
          lastError: s?.lastError ?? null,
        };
      }),
      latestPriceSlot: Object.fromEntries(
        latest.map((r) => [r.zone, new Date(r.slot).toISOString()]),
      ),
    },
    200,
  );
});
