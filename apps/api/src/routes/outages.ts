import { createRoute, z } from '@hono/zod-openapi';
import { schema } from '@wattslot/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { OUTAGE_SOURCE } from '../outages/feed.ts';
import { mainGln } from '../outages/suppliers.ts';
import { ErrorBody, router } from '../router.ts';

const HOUR = 3_600_000;
/** Restored outages stay visible this long, so people see the power is back. */
const SHOW_RESTORED_MS = 2 * HOUR;
/** An open outage whose expected end passed this long ago is probably just not updated. */
const STALE_AFTER_EXPECTED_MS = 12 * HOUR;
const PLANNED_AHEAD_MS = 30 * 24 * HOUR;
/** The portal is polled every 5 minutes; older than this, the page says the data may lag. */
const STALE_FEED_MS = 20 * 60_000;
const KIND_ORDER = { unplanned: 0, announced: 1, notice: 2, planned: 3 } as const;

const Outage = z
  .object({
    id: z.number().int(),
    list: z.enum(['active', 'planned']),
    kind: z.enum(['unplanned', 'announced', 'planned', 'notice']).openapi({
      description:
        'Uvarslet, varslet, planlagt arbejde or særlig driftsinfo, as the portal sets it',
    }),
    title: z.string(),
    cause: z.string().nullable(),
    customers: z.number().int().nullable().openapi({ description: 'Affected customers' }),
    start: z.string().nullable(),
    end: z.string().nullable().openapi({ description: 'Set once power is back' }),
    expectedEnd: z.string().nullable(),
    restored: z.boolean(),
    postcodes: z.array(z.string()),
    location: z
      .object({ lat: z.number(), lng: z.number(), radiusM: z.number().int().nullable() })
      .nullable()
      .openapi({ description: 'Approximate centre of the affected area' }),
    gridCompany: z.object({ gln: z.string(), name: z.string() }).nullable(),
    supplierName: z.string().openapi({ description: 'The name the portal reports it under' }),
  })
  .openapi('Outage');

const outagesRoute = createRoute({
  method: 'get',
  path: '/outages',
  summary: 'Power outages',
  description: `Current outages and planned work reported by Danish grid companies. Source: ${OUTAGE_SOURCE}. Indicative: grid companies update the portal themselves.`,
  request: {
    query: z.object({
      list: z.enum(['active', 'planned', 'all']).default('active').openapi({
        description: '`active`: current outages and notices; `planned`: planned work',
      }),
      gln: z
        .string()
        .regex(/^\d{13}(,\d{13})*$/)
        .optional()
        .openapi({ example: '5790000705689', description: 'Grid company GLNs, comma-separated' }),
      postcode: z
        .string()
        .regex(/^\d{4}$/)
        .optional()
        .openapi({ example: '2100' }),
    }),
  },
  responses: {
    200: {
      description: 'Outages, most serious first; planned work soonest first',
      content: {
        'application/json': {
          schema: z.object({
            enabled: z.boolean().openapi({ description: 'False while the overview is paused' }),
            updatedAt: z.string().nullable().openapi({ description: 'Last successful fetch' }),
            stale: z.boolean(),
            source: z.string(),
            outages: z.array(Outage),
          }),
        },
      },
    },
    400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export const outageRoutes = router().openapi(outagesRoute, async (c) => {
  const { list, gln, postcode } = c.req.valid('query');
  const now = Date.now();
  c.header('Cache-Control', 'public, max-age=60');
  if (c.env.OUTAGES === 'off') {
    return c.json(
      { enabled: false, updatedAt: null, stale: false, source: OUTAGE_SOURCE, outages: [] },
      200,
    );
  }

  const db = drizzle(c.env.DB);
  const o = schema.outages;
  const rows = await db
    .select({ outage: o, companyName: schema.gridCompanies.name })
    .from(o)
    .leftJoin(schema.gridCompanies, eq(schema.gridCompanies.gln, o.gln))
    .where(
      and(
        isNull(o.goneMs),
        list === 'all' ? undefined : eq(o.list, list),
        gln ? inArray(o.gln, [...new Set(gln.split(',').map(mainGln))]) : undefined,
        postcode
          ? sql`exists (select 1 from json_each(${o.postcodes}) where value = ${postcode})`
          : undefined,
      ),
    );
  const [state] = await db
    .select()
    .from(schema.ingestState)
    .where(eq(schema.ingestState.task, 'outages'));
  const updatedAtMs = state?.lastSuccessAtMs ?? null;

  const visible = rows
    .map(({ outage: r, companyName }) => ({ r, companyName }))
    .filter(({ r }) => {
      if (r.list === 'planned') {
        return (
          (r.expectedEndMs ?? r.startMs ?? 0) >= now && (r.startMs ?? 0) <= now + PLANNED_AHEAD_MS
        );
      }
      if (r.endMs !== null) return r.endMs > now - SHOW_RESTORED_MS;
      return r.expectedEndMs === null || r.expectedEndMs > now - STALE_AFTER_EXPECTED_MS;
    })
    .sort((a, b) => {
      if (a.r.list !== b.r.list) return a.r.list === 'active' ? -1 : 1;
      if (a.r.list === 'planned') return (a.r.startMs ?? 0) - (b.r.startMs ?? 0);
      // Happening now (most serious first, newest first), then announced for later (soonest
      // first), then restored (most recently first).
      const group = (r: typeof a.r) =>
        r.endMs !== null && r.endMs <= now ? 2 : (r.startMs ?? 0) > now ? 1 : 0;
      const ga = group(a.r);
      const gb = group(b.r);
      if (ga !== gb) return ga - gb;
      if (ga === 1) return (a.r.startMs ?? 0) - (b.r.startMs ?? 0);
      if (ga === 2) return (b.r.endMs ?? 0) - (a.r.endMs ?? 0);
      return KIND_ORDER[a.r.kind] - KIND_ORDER[b.r.kind] || (b.r.startMs ?? 0) - (a.r.startMs ?? 0);
    });

  return c.json(
    {
      enabled: true,
      updatedAt: iso(updatedAtMs),
      stale: updatedAtMs === null || now - updatedAtMs > STALE_FEED_MS,
      source: OUTAGE_SOURCE,
      outages: visible.map(({ r, companyName }) => ({
        id: r.id,
        list: r.list,
        kind: r.kind,
        title: r.title,
        cause: r.cause,
        customers: r.customers,
        start: iso(r.startMs),
        end: iso(r.endMs),
        expectedEnd: iso(r.expectedEndMs),
        restored: r.endMs !== null && r.endMs <= now,
        postcodes: r.postcodes,
        location:
          r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng, radiusM: r.radiusM } : null,
        gridCompany: r.gln && companyName ? { gln: r.gln, name: companyName } : null,
        supplierName: r.supplierName,
      })),
    },
    200,
  );
});
