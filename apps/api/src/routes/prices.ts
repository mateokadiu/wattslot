import { createRoute, z } from '@hono/zod-openapi';
import { schema } from '@wattslot/db';
import { cheapestSlots, cheapestWindow } from '@wattslot/planner';
import {
  addDays,
  fromMicro,
  localMidnight,
  localTime,
  type PriceBreakdown,
  SLOT_MS,
  toMicro,
} from '@wattslot/pricing';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { openDb } from '../ingest/store.js';
import { loadZone, type PricedRange, priceRange } from '../prices/service.js';
import { ErrorBody, router } from '../router.js';

const iso = (ms: number) => new Date(ms).toISOString();
const errors = {
  400: { description: 'Invalid request', content: { 'application/json': { schema: ErrorBody } } },
  404: {
    description: 'Unknown zone or grid company',
    content: { 'application/json': { schema: ErrorBody } },
  },
};

const zoneParam = z
  .string()
  .regex(/^[A-Z]{2}\d?$/)
  .openapi({ example: 'DK2' });
const glnParam = z
  .string()
  .regex(/^\d{13}$/)
  .optional()
  .openapi({ example: '5790000705689', description: 'Grid company GLN; needed for full prices' });
const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .openapi({ example: '2026-10-28', description: 'Local date; defaults to today' });
const markupParam = z.coerce
  .number()
  .min(0)
  .max(10)
  .default(0)
  .openapi({ description: "Your supplier's markup per kWh, excluding VAT" });

const Slot = z
  .object({
    start: z.string(),
    end: z.string(),
    spot: z.number(),
    gridTariff: z.number(),
    tsoTariffs: z.number(),
    electricityTax: z.number(),
    supplierMarkup: z.number(),
    vat: z.number(),
    total: z.number().openapi({ description: 'What a kWh in this slot costs, all included' }),
  })
  .openapi('PriceSlot');

const toSlot = (p: PriceBreakdown) => ({
  start: iso(p.slotStartMs),
  end: iso(p.slotStartMs + SLOT_MS),
  spot: fromMicro(p.spot),
  gridTariff: fromMicro(p.gridTariff),
  tsoTariffs: fromMicro(p.tsoTariffs),
  electricityTax: fromMicro(p.electricityTax),
  supplierMarkup: fromMicro(p.supplierMarkup),
  vat: fromMicro(p.vat),
  total: fromMicro(p.total),
});

const header = (r: PricedRange) => ({
  zone: r.zone.code,
  currency: r.zone.currency,
  unit: `${r.zone.currency}/kWh`,
  gridCompany: r.gridCompany,
  mode: r.mode,
  note: r.note,
});

const Header = {
  zone: z.string(),
  currency: z.string(),
  unit: z.string(),
  gridCompany: z.object({ gln: z.string(), name: z.string() }).nullable(),
  mode: z.enum(['full', 'spot-only']),
  note: z.string().nullable().openapi({ description: 'Why prices are spot-only, if they are' }),
};

const pricesRoute = createRoute({
  method: 'get',
  path: '/prices',
  summary: 'All-in price per 15-minute slot',
  request: {
    query: z.object({
      zone: zoneParam,
      gln: glnParam,
      date: dateParam,
      days: z.coerce.number().int().min(1).max(2).default(1),
      markup: markupParam,
    }),
  },
  responses: {
    200: {
      description: 'Prices with a per-component breakdown',
      content: {
        'application/json': {
          schema: z.object({
            ...Header,
            from: z.string(),
            to: z.string(),
            complete: z.boolean().openapi({ description: 'False until every slot is published' }),
            slots: z.array(Slot),
          }),
        },
      },
    },
    ...errors,
  },
});

const co2Route = createRoute({
  method: 'get',
  path: '/co2',
  summary: 'CO₂ intensity per 15-minute slot',
  request: {
    query: z.object({
      zone: zoneParam,
      date: dateParam,
      days: z.coerce.number().int().min(1).max(2).default(1),
    }),
  },
  responses: {
    200: {
      description: 'Forecast and measured grid CO₂ intensity (g/kWh), averaged per 15 minutes',
      content: {
        'application/json': {
          schema: z.object({
            zone: z.string(),
            unit: z.literal('g/kWh'),
            slots: z.array(
              z.object({
                start: z.string(),
                forecast: z.number().nullable(),
                actual: z.number().nullable(),
              }),
            ),
          }),
        },
      },
    },
    ...errors,
  },
});

const cheapestRoute = createRoute({
  method: 'get',
  path: '/cheapest',
  summary: 'Cheapest time to use electricity',
  request: {
    query: z.object({
      zone: zoneParam,
      gln: glnParam,
      hours: z.coerce
        .number()
        .min(0.25)
        .max(24)
        .refine((h) => Number.isInteger(h * 4), 'must be a multiple of 0.25')
        .openapi({ example: 2 }),
      from: z.iso.datetime({ offset: true }).optional().openapi({ description: 'Defaults to now' }),
      to: z.iso
        .datetime({ offset: true })
        .optional()
        .openapi({ description: 'Defaults to 48 hours after `from`' }),
      contiguous: z
        .enum(['true', 'false'])
        .default('true')
        .openapi({ description: 'false lets the load pause, e.g. EV charging' }),
      markup: markupParam,
    }),
  },
  responses: {
    200: {
      description: 'The cheapest slots, compared with starting now',
      content: {
        'application/json': {
          schema: z.object({
            ...Header,
            hours: z.number(),
            contiguous: z.boolean(),
            cheapest: z
              .object({
                start: z.string(),
                end: z.string(),
                averagePrice: z.number(),
                slots: z.array(z.object({ start: z.string(), total: z.number() })),
              })
              .nullable(),
            startNow: z
              .object({ averagePrice: z.number() })
              .nullable()
              .openapi({ description: 'The same energy used from `from` onwards, for comparison' }),
            message: z.string().nullable(),
          }),
        },
      },
    },
    ...errors,
  },
});

export const priceRoutes = router()
  .openapi(pricesRoute, async (c) => {
    const q = c.req.valid('query');
    const db = openDb(c.env.DB);
    const zone = await loadZone(db, q.zone);
    const date = q.date ?? localTime(Date.now(), zone.timeZone).date;
    const fromMs = localMidnight(date, zone.timeZone);
    const toMs = localMidnight(addDays(date, q.days), zone.timeZone);
    const priced = await priceRange(db, {
      zone,
      gln: q.gln,
      fromMs,
      toMs,
      markup: toMicro(q.markup),
    });
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(
      {
        ...header(priced),
        from: iso(fromMs),
        to: iso(toMs),
        complete: priced.slots.length === (toMs - fromMs) / SLOT_MS,
        slots: priced.slots.map(toSlot),
      },
      200,
    );
  })
  .openapi(co2Route, async (c) => {
    const q = c.req.valid('query');
    const db = openDb(c.env.DB);
    const zone = await loadZone(db, q.zone);
    const date = q.date ?? localTime(Date.now(), zone.timeZone).date;
    const fromMs = localMidnight(date, zone.timeZone);
    const toMs = localMidnight(addDays(date, q.days), zone.timeZone);
    const t = schema.co2Intensity;
    const rows = await db
      .select()
      .from(t)
      .where(and(eq(t.zone, zone.code), gte(t.timeMs, fromMs), lt(t.timeMs, toMs)))
      .orderBy(asc(t.timeMs));
    const bySlot = new Map<number, { forecast: number | null; actual: number | null }>();
    for (const r of rows) {
      const entry = bySlot.get(r.timeMs) ?? { forecast: null, actual: null };
      entry[r.kind] = r.gPerKwh;
      bySlot.set(r.timeMs, entry);
    }
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(
      {
        zone: zone.code,
        unit: 'g/kWh' as const,
        slots: [...bySlot.entries()].map(([ms, v]) => ({ start: iso(ms), ...v })),
      },
      200,
    );
  })
  .openapi(cheapestRoute, async (c) => {
    const q = c.req.valid('query');
    const db = openDb(c.env.DB);
    const zone = await loadZone(db, q.zone);
    const requested = q.from ? Date.parse(q.from) : Date.now();
    const fromMs = Math.ceil(requested / SLOT_MS) * SLOT_MS;
    const toMs = q.to ? Date.parse(q.to) : fromMs + 48 * 3_600_000;
    if (toMs <= fromMs)
      return c.json({ error: 'invalid_request', message: '`to` must be after `from`.' }, 400);
    const priced = await priceRange(db, {
      zone,
      gln: q.gln,
      fromMs,
      toMs,
      markup: toMicro(q.markup),
    });

    const count = q.hours * 4;
    const contiguous = q.contiguous === 'true';
    const scored = priced.slots.map((p) => ({ startMs: p.slotStartMs, score: p.total }));
    const best = contiguous ? cheapestWindow(scored, count) : cheapestSlots(scored, count);
    const now = cheapestWindow(
      scored.filter((s) => s.startMs < fromMs + count * SLOT_MS),
      count,
    );
    const average = (total: number) => fromMicro(Math.round(total / count));
    c.header('Cache-Control', 'public, max-age=60');
    return c.json(
      {
        ...header(priced),
        hours: q.hours,
        contiguous,
        cheapest: best
          ? {
              start: iso(best.slots[0]?.startMs ?? fromMs),
              end: iso((best.slots.at(-1)?.startMs ?? fromMs) + SLOT_MS),
              averagePrice: average(best.totalScore),
              slots: best.slots.map((s) => ({ start: iso(s.startMs), total: fromMicro(s.score) })),
            }
          : null,
        startNow:
          now && now.slots[0]?.startMs === fromMs
            ? { averagePrice: average(now.totalScore) }
            : null,
        message: best ? null : 'Not enough published prices in this range yet.',
      },
      200,
    );
  });
