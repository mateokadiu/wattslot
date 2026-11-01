import { createRoute, z } from '@hono/zod-openapi';
import { openDb } from '../ingest/store.ts';
import { planPreview, WindowTooShortError } from '../plans/preview.ts';
import { ErrorBody, router } from '../router.ts';

const HOUR_MS = 3_600_000;
/** How far ahead a plan may reach: published prices plus a day of estimates. */
export const MAX_AHEAD_MS = 48 * HOUR_MS;

const iso = (ms: number) => new Date(ms).toISOString();
const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorBody } },
});

const Run = z.object({
  start: z.string(),
  end: z.string(),
  energyWh: z.number().int(),
});

const SummaryBody = {
  runs: z.array(Run).openapi({ description: 'When to run: back-to-back slots merged' }),
  cost: z.number().openapi({ description: 'In the zone currency, all included as in /v1/prices' }),
  co2Kg: z.number().nullable(),
  estimated: z.boolean().openapi({ description: 'True if any price in it is an estimate' }),
};

const Option = z
  .object({ kind: z.enum(['cheapest', 'balanced', 'greenest']), ...SummaryBody })
  .openapi('PlanOption');

const PreviewBody = z
  .object({
    zone: z
      .string()
      .regex(/^[A-Z]{2}\d?$/)
      .openapi({ example: 'DK2' }),
    gln: z
      .string()
      .regex(/^\d{13}$/)
      .optional()
      .openapi({
        example: '5790000705689',
        description: 'Grid company GLN; needed for full prices',
      }),
    markup: z.number().min(0).max(10).default(0).openapi({
      description: "Your supplier's markup per kWh, excluding VAT",
    }),
    energyWh: z.number().int().min(1).max(100_000).openapi({ example: 1100 }),
    maxPowerW: z.number().int().min(1).max(22_000).openapi({ example: 550 }),
    contiguous: z.boolean().openapi({
      description: "true for loads that can't pause once started (a dishwasher programme)",
    }),
    earliest: z.iso
      .datetime({ offset: true })
      .optional()
      .openapi({ description: 'Defaults to now' }),
    deadline: z.iso
      .datetime({ offset: true })
      .openapi({ description: 'Done by; at most 48 hours ahead' }),
    co2Price: z.number().min(0).max(100).default(1).openapi({
      description: 'What 1 kg of CO₂ counts as in the balanced option, in the zone currency',
    }),
  })
  .openapi('PlanPreviewRequest');

const previewRoute = createRoute({
  method: 'post',
  path: '/plan-preview',
  summary: 'Three ways to run a load: cheapest, balanced and greenest',
  description:
    'Plans a load (energy, power, and whether it can pause) inside a window, and compares it with starting now and with a midnight timer. Slots without a published price use an estimate, and the result says so. Nothing is stored.',
  request: { body: { content: { 'application/json': { schema: PreviewBody } }, required: true } },
  responses: {
    200: {
      description: 'The options, best first; balanced and greenest need CO₂ data (Danish zones)',
      content: {
        'application/json': {
          schema: z.object({
            zone: z.string(),
            currency: z.string(),
            gridCompany: z.object({ gln: z.string(), name: z.string() }).nullable(),
            mode: z.enum(['full', 'spot-only']),
            note: z.string().nullable(),
            from: z.string(),
            to: z.string(),
            provisional: z.boolean().openapi({ description: 'Some prices are estimates' }),
            estimatedFrom: z.string().nullable().openapi({
              description: 'The first slot whose price is an estimate (tomorrow, before ~13:00)',
            }),
            options: z.array(Option),
            baselines: z.object({
              startNow: z.object(SummaryBody).nullable(),
              midnight: z.object({ ...SummaryBody, start: z.string() }).nullable(),
            }),
            message: z.string().nullable(),
          }),
        },
      },
    },
    400: error('Invalid request'),
    404: error('Unknown zone or grid company'),
    422: error("The window can't hold the load"),
  },
});

export const planRoutes = router().openapi(previewRoute, async (c) => {
  const body = c.req.valid('json');
  const nowMs = Date.now();
  const deadlineMs = Date.parse(body.deadline);
  const earliestMs = body.earliest ? Date.parse(body.earliest) : undefined;
  const invalid = (message: string) => c.json({ error: 'invalid_request', message }, 400);
  if (deadlineMs <= nowMs) return invalid('`deadline` must be in the future.');
  if (deadlineMs > nowMs + MAX_AHEAD_MS + HOUR_MS) {
    return invalid('`deadline` can be at most 48 hours ahead.');
  }
  if (earliestMs !== undefined && earliestMs >= deadlineMs) {
    return invalid('`earliest` must be before `deadline`.');
  }

  try {
    const p = await planPreview(
      openDb(c.env.DB),
      c.env.DB,
      { ...body, earliestMs, deadlineMs },
      nowMs,
    );
    c.header('Cache-Control', 'no-store');
    return c.json(
      {
        zone: p.priced.zone.code,
        currency: p.priced.zone.currency,
        gridCompany: p.priced.gridCompany,
        mode: p.priced.mode,
        note: p.priced.note,
        from: iso(p.fromMs),
        to: iso(p.toMs),
        provisional: p.estimatedFromMs !== null,
        estimatedFrom: p.estimatedFromMs === null ? null : iso(p.estimatedFromMs),
        options: p.options,
        baselines: p.baselines,
        message: p.options.length === 0 ? 'Not enough prices in this window yet to plan it.' : null,
      },
      200,
    );
  } catch (e) {
    if (e instanceof WindowTooShortError) {
      return c.json({ error: 'window_too_short', message: e.message }, 422);
    }
    throw e;
  }
});
