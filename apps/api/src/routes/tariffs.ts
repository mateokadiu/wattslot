import { createRoute, z } from '@hono/zod-openapi';
import { schema } from '@wattslot/db';
import { DK_TIME_ZONE, localTime } from '@wattslot/pricing';
import { and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { ErrorBody, router } from '../router.ts';

const TariffPeriod = z
  .object({
    validFrom: z.string().openapi({
      example: '2026-10-01T00:00:00',
      description: 'Danish local wall-clock time, as published in DataHub',
    }),
    validTo: z.string().nullable().openapi({ description: 'Exclusive; null until further notice' }),
    hourly: z.array(z.number()).length(24).openapi({
      description: 'DKK per kWh excluding VAT, by local hour 0–23',
    }),
  })
  .openapi('TariffPeriod');

const Tariff = z
  .object({
    chargeCode: z.string().openapi({ example: 'DT_C_01' }),
    role: z.enum(['tariff', 'discount']).openapi({
      description: '`discount` lowers the price while it is valid',
    }),
    periods: z.array(TariffPeriod),
  })
  .openapi('Tariff');

const tariffsRoute = createRoute({
  method: 'get',
  path: '/tariffs',
  summary: 'A grid company’s household tariff',
  description:
    'The DataHub charges that make up a grid company’s household tariff, for every period that is valid today or later.',
  request: {
    query: z.object({
      gln: z
        .string()
        .regex(/^\d{13}$/)
        .openapi({ example: '5790000705689', description: 'Grid company GLN' }),
    }),
  },
  responses: {
    200: {
      description: 'Current and upcoming tariff periods',
      content: {
        'application/json': {
          schema: z.object({
            gridCompany: z.object({ gln: z.string(), name: z.string(), zone: z.string() }),
            tariffs: z.array(Tariff),
          }),
        },
      },
    },
    400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorBody } } },
    404: {
      description: 'Unknown grid company',
      content: { 'application/json': { schema: ErrorBody } },
    },
  },
});

const dkk = (micro: number) => Number((micro / 1_000_000).toFixed(6));

export const tariffRoutes = router().openapi(tariffsRoute, async (c) => {
  const { gln } = c.req.valid('query');
  const db = drizzle(c.env.DB);
  const [company] = await db
    .select()
    .from(schema.gridCompanies)
    .where(eq(schema.gridCompanies.gln, gln));
  if (!company) return c.json({ error: 'not_found', message: `Unknown grid company ${gln}.` }, 404);

  const mappings = await db
    .select()
    .from(schema.tariffMappings)
    .where(and(eq(schema.tariffMappings.gln, gln), eq(schema.tariffMappings.customerType, 'C')));
  // Periods still in force at the start of today, Danish time, or starting later.
  const today = `${localTime(Date.now(), DK_TIME_ZONE).date}T00:00:00`;
  const t = schema.charges;
  const rows =
    mappings.length === 0
      ? []
      : await db
          .select()
          .from(t)
          .where(
            and(
              eq(t.ownerGln, gln),
              eq(t.chargeType, 'D03'),
              inArray(
                t.chargeCode,
                mappings.map((m) => m.chargeCode),
              ),
              or(isNull(t.validTo), gt(t.validTo, today)),
            ),
          )
          .orderBy(asc(t.chargeCode), asc(t.validFrom));

  c.header('Cache-Control', 'public, max-age=3600');
  return c.json(
    {
      gridCompany: { gln: company.gln, name: company.name, zone: company.zone },
      tariffs: mappings.map((m) => ({
        chargeCode: m.chargeCode,
        role: m.role,
        periods: rows
          .filter((r) => r.chargeCode === m.chargeCode)
          .map((r) => ({
            validFrom: r.validFrom,
            validTo: r.validTo,
            hourly: r.hourlyMicro.map(dkk),
          })),
      })),
    },
    200,
  );
});
