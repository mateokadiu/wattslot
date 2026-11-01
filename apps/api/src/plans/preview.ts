// An explicit import (not the ambient Workers global) so tests type-check under Node too.
import type { D1Database } from '@cloudflare/workers-types';
import {
  type Plan,
  planEnergy,
  type Run,
  runFrom,
  type ScoredSlot,
  slotCount,
} from '@wattslot/planner';
import {
  addDays,
  estimateCo2,
  estimateSpot,
  fromMicro,
  type HistoryClock,
  historyClock,
  historyTimes,
  localMidnight,
  localTime,
  type Micro,
  SLOT_MS,
  toMicro,
} from '@wattslot/pricing';
import type { Db } from '../ingest/store.ts';
import { loadZone, type PricedRange, priceRange, spotSlots, type Zone } from '../prices/service.ts';

// Planning a load (PLAN.md §17.7): three ways to run it in a window — cheapest, balanced and
// greenest — with what each costs and emits, against starting now and a midnight timer. The
// preview shows them; a saved job stores one. Slots without a published price use an estimate
// (§8.4).

export interface PreviewRequest {
  zone: string;
  gln?: string | undefined;
  /** Supplier markup per kWh, excluding VAT, in the zone currency. */
  markup: number;
  energyWh: number;
  maxPowerW: number;
  contiguous: boolean;
  /** Defaults to now; never earlier than now. */
  earliestMs?: number | undefined;
  deadlineMs: number;
  /** What the visitor counts 1 kg of CO₂ as, in the zone currency (the balanced option). */
  co2Price: number;
}

export class WindowTooShortError extends Error {}

export type OptionKind = 'cheapest' | 'balanced' | 'greenest';

interface Slot extends ScoredSlot {
  total: Micro;
  /** g/kWh, or null where neither a forecast nor an estimate exists. */
  co2: number | null;
  /** True when the price rests on an estimated spot price. */
  estimated: boolean;
}

export interface Summary {
  runs: { start: string; end: string; energyWh: number }[];
  cost: number;
  co2Kg: number | null;
  estimated: boolean;
}

/** What storing a plan needs beyond its summary (never sent to the browser). */
export interface PlanDetail {
  costMicro: number;
  co2Grams: number | null;
  runs: Run[];
  slots: {
    startMs: number;
    energyWh: number;
    priceMicro: number;
    co2: number | null;
    estimated: boolean;
  }[];
}

export interface Planned extends Summary {
  detail: PlanDetail;
}

export interface Preview {
  priced: PricedRange;
  fromMs: number;
  toMs: number;
  /** Start of the first estimated slot in the window, or null when every price is published. */
  estimatedFromMs: number | null;
  options: ({ kind: OptionKind } & Planned)[];
  baselines: { startNow: Planned | null; midnight: (Planned & { start: string }) | null };
}

/** Counted as CO₂ only, with cost a distant tie-break. */
const GREENEST_CO2_PRICE = 1_000_000;
/** A run starting before this local hour already is the night: a timer would start it now. */
const NIGHT_UNTIL_HOUR = 6;

const iso = (ms: number) => new Date(ms).toISOString();

/** Rows at the given slot starts, in one query with one JSON parameter (D1 caps bound values). */
async function rowsAt<T>(d1: D1Database, sql: string, zone: string, times: Iterable<number>) {
  const { results } = await d1
    .prepare(sql)
    .bind(zone, JSON.stringify([...new Set(times)]))
    .all<T>();
  return results;
}

/** Published spot prices in the window, with estimates for the slots not published yet. */
async function windowSpots(
  db: Db,
  d1: D1Database,
  zone: Zone,
  clock: HistoryClock,
  fromMs: number,
  toMs: number,
) {
  const published = await spotSlots(db, zone.code, fromMs, toMs);
  const have = new Set(published.map((s) => s.startMs));
  const missing: number[] = [];
  for (let t = fromMs; t < toMs; t += SLOT_MS) if (!have.has(t)) missing.push(t);
  if (missing.length === 0) return { spots: published, estimated: new Set<number>() };

  const history = new Map(
    (
      await rowsAt<{ t: number; v: number }>(
        d1,
        `SELECT slot_start_ms AS t, price_micro AS v FROM spot_prices
         WHERE zone = ?1 AND slot_start_ms IN (SELECT value FROM json_each(?2))`,
        zone.code,
        missing.flatMap((t) => historyTimes(t, clock)),
      )
    ).map((r) => [r.t, r.v]),
  );
  const estimated = new Set<number>();
  const spots = [...published];
  for (const t of missing) {
    const price = estimateSpot(t, clock, history);
    if (price === null) continue;
    spots.push({ startMs: t, price });
    estimated.add(t);
  }
  spots.sort((a, b) => a.startMs - b.startMs);
  return { spots, estimated };
}

/** CO₂ per slot: measured, else forecast, else the last week's average for that time. */
async function windowCo2(
  d1: D1Database,
  zone: Zone,
  clock: HistoryClock,
  starts: readonly number[],
) {
  const byKind = <T extends { t: number; kind: string; v: number }>(rows: T[]) => {
    const map = new Map<number, number>();
    for (const r of rows) if (r.kind === 'forecast') map.set(r.t, r.v);
    for (const r of rows) if (r.kind === 'actual') map.set(r.t, r.v);
    return map;
  };
  const sql = `SELECT time_ms AS t, kind, g_per_kwh AS v FROM co2_intensity
               WHERE zone = ?1 AND time_ms IN (SELECT value FROM json_each(?2))`;
  type Row = { t: number; kind: string; v: number };
  const known = byKind(await rowsAt<Row>(d1, sql, zone.code, starts));
  const missing = starts.filter((t) => !known.has(t));
  if (missing.length > 0) {
    const history = byKind(
      await rowsAt<Row>(
        d1,
        sql,
        zone.code,
        // The last seven days only: the first seven history days are exactly those.
        missing.flatMap((t) => historyTimes(t, clock).slice(0, 7)),
      ),
    );
    for (const t of missing) {
      const value = estimateCo2(t, clock, history);
      if (value !== null) known.set(t, value);
    }
  }
  return known;
}

/** When a midnight timer would start the load: the next local midnight, or now during the night. */
export function midnightStart(fromMs: number, timeZone: string): number {
  const local = localTime(fromMs, timeZone);
  if (local.hour < NIGHT_UNTIL_HOUR) return fromMs;
  return localMidnight(addDays(local.date, 1), timeZone);
}

function summarize(plan: Plan, bySlot: ReadonlyMap<number, Slot>): Planned {
  let costMicro = 0;
  let co2G: number | null = 0;
  let estimated = false;
  const slots: PlanDetail['slots'] = [];
  for (const p of plan.slots) {
    const slot = bySlot.get(p.startMs) as Slot;
    costMicro += (slot.total * p.energyWh) / 1000;
    co2G = co2G === null || slot.co2 === null ? null : co2G + (slot.co2 * p.energyWh) / 1000;
    estimated ||= slot.estimated;
    slots.push({
      startMs: p.startMs,
      energyWh: p.energyWh,
      priceMicro: slot.total,
      co2: slot.co2,
      estimated: slot.estimated,
    });
  }
  return {
    detail: {
      costMicro: Math.round(costMicro),
      co2Grams: co2G,
      runs: plan.runs,
      slots,
    },
    runs: plan.runs.map((r) => ({
      start: iso(r.startMs),
      end: iso(r.endMs),
      energyWh: Math.round(r.energyWh),
    })),
    cost: fromMicro(Math.round(costMicro)),
    co2Kg: co2G === null ? null : Math.round(co2G) / 1000,
    estimated,
  };
}

export async function planPreview(
  db: Db,
  d1: D1Database,
  req: PreviewRequest,
  nowMs: number,
): Promise<Preview> {
  const zone = await loadZone(db, req.zone);
  const fromMs = Math.ceil(Math.max(req.earliestMs ?? nowMs, nowMs) / SLOT_MS) * SLOT_MS;
  const toMs = Math.floor(req.deadlineMs / SLOT_MS) * SLOT_MS;
  const needed = slotCount(req.energyWh, req.maxPowerW);
  if ((toMs - fromMs) / SLOT_MS < needed) {
    throw new WindowTooShortError(
      `This needs ${needed * 15} minutes at ${req.maxPowerW} W, but the window has ${Math.max(0, (toMs - fromMs) / 60_000)}.`,
    );
  }

  const clock = historyClock(zone.timeZone, fromMs, toMs);
  const { spots, estimated } = await windowSpots(db, d1, zone, clock, fromMs, toMs);
  const priced = await priceRange(db, {
    zone,
    gln: req.gln,
    fromMs,
    toMs,
    markup: toMicro(req.markup),
    spots,
  });
  const co2 = await windowCo2(
    d1,
    zone,
    clock,
    priced.slots.map((p) => p.slotStartMs),
  );
  // A slot with no CO₂ figure at all (a gap in the history) counts as the window's average.
  const known = [...co2.values()];
  const fallbackCo2 = known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
  const slots: Slot[] = priced.slots.map((p) => ({
    startMs: p.slotStartMs,
    score: p.total,
    total: p.total,
    co2: co2.get(p.slotStartMs) ?? fallbackCo2,
    estimated: estimated.has(p.slotStartMs),
  }));
  const bySlot = new Map(slots.map((s) => [s.startMs, s]));
  const hasCo2 = fallbackCo2 !== null;

  const load = { energyWh: req.energyWh, maxPowerW: req.maxPowerW, contiguous: req.contiguous };
  // Scores are per kWh in micro-units: price plus λ (currency per kg) × g/kWh × 1000.
  const scored = (co2Price: number) =>
    slots.map((s) => ({ startMs: s.startMs, score: s.total + co2Price * (s.co2 ?? 0) * 1000 }));
  const kinds: [OptionKind, number][] = hasCo2
    ? [
        ['cheapest', 0],
        ['balanced', req.co2Price],
        ['greenest', GREENEST_CO2_PRICE],
      ]
    : [['cheapest', 0]];
  const options = kinds.flatMap(([kind, co2Price]) => {
    const plan = planEnergy({ slots: scored(co2Price), ...load });
    return plan ? [{ kind, ...summarize(plan, bySlot) }] : [];
  });

  const baseline = (startMs: number) => {
    const plan = runFrom(
      slots,
      slots.findIndex((s) => s.startMs === startMs),
      req.energyWh,
      req.maxPowerW,
    );
    return plan ? summarize(plan, bySlot) : null;
  };
  const midnightMs = midnightStart(fromMs, zone.timeZone);
  const midnight = baseline(midnightMs);

  return {
    priced,
    fromMs,
    toMs,
    estimatedFromMs: slots.find((s) => s.estimated)?.startMs ?? null,
    options,
    baselines: {
      startNow: baseline(fromMs),
      midnight: midnight ? { ...midnight, start: iso(midnightMs) } : null,
    },
  };
}
