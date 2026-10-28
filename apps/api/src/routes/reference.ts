import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { schema } from '@wattslot/db';
import { asc, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { AppEnv } from '../env.js';

const Zone = z
  .object({
    code: z.string().openapi({ example: 'DK2' }),
    currency: z.string().openapi({ example: 'DKK' }),
    timeZone: z.string().openapi({ example: 'Europe/Copenhagen' }),
    fullPrice: z.boolean().openapi({
      description: 'True when grid tariffs and taxes are included; false means spot price only.',
    }),
  })
  .openapi('Zone');

const GridCompany = z
  .object({
    gln: z.string().openapi({ example: '5790000705689' }),
    name: z.string().openapi({ example: 'Radius Elnet A/S' }),
    zone: z.string().openapi({ example: 'DK2' }),
    meteringPoints: z.number().int().nullable().openapi({
      description: 'Connected consumption metering points — roughly, the number of customers.',
    }),
    supported: z.boolean().openapi({
      description:
        'False when the household tariff is not yet understood; prices fall back to spot.',
    }),
    note: z.string().nullable(),
  })
  .openapi('GridCompany');

const zonesRoute = createRoute({
  method: 'get',
  path: '/zones',
  summary: 'Bidding zones',
  responses: {
    200: {
      description: 'Every bidding zone with day-ahead prices',
      content: { 'application/json': { schema: z.object({ zones: z.array(Zone) }) } },
    },
  },
});

const gridCompaniesRoute = createRoute({
  method: 'get',
  path: '/grid-companies',
  summary: 'Grid companies',
  request: {
    query: z.object({
      zone: z.string().optional().openapi({ example: 'DK2', description: 'Only this zone' }),
    }),
  },
  responses: {
    200: {
      description: 'Danish grid companies, largest first',
      content: {
        'application/json': { schema: z.object({ gridCompanies: z.array(GridCompany) }) },
      },
    },
  },
});

export const referenceRoutes = new OpenAPIHono<AppEnv>()
  .openapi(zonesRoute, async (c) => {
    const rows = await drizzle(c.env.DB)
      .select()
      .from(schema.priceZones)
      .orderBy(asc(schema.priceZones.code));
    c.header('Cache-Control', 'public, max-age=3600');
    return c.json(
      {
        zones: rows.map((z) => ({
          code: z.code,
          currency: z.currency,
          timeZone: z.timeZone,
          fullPrice: z.fullPrice,
        })),
      },
      200,
    );
  })
  .openapi(gridCompaniesRoute, async (c) => {
    const { zone } = c.req.valid('query');
    const t = schema.gridCompanies;
    const rows = await drizzle(c.env.DB)
      .select()
      .from(t)
      .where(zone ? eq(t.zone, zone) : undefined)
      .orderBy(desc(t.meteringPoints), asc(t.name));
    c.header('Cache-Control', 'public, max-age=3600');
    return c.json(
      {
        gridCompanies: rows.map((g) => ({
          gln: g.gln,
          name: g.name,
          zone: g.zone,
          meteringPoints: g.meteringPoints,
          supported: g.support === 'supported' && g.degradedAtMs === null,
          note: g.supportNote,
        })),
      },
      200,
    );
  });
