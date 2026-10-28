import { createEdsClient, EdsRateLimitError } from '@wattslot/eds-client';
import {
  addDays,
  classifyTariffShape,
  DK_TIME_ZONE,
  ELECTRICITY_TAX_CODE,
  ENERGINET_CONSUMER_TARIFF_CODES,
  ENERGINET_GLN,
  localMidnight,
  localTime,
  toMicro,
} from '@wattslot/pricing';
import type { Env } from '../env.js';
import { type Clock, clockAt, dayAheadTargetDays, dueTasks, type Task } from './schedule.js';
import {
  countSpotSlots,
  type Db,
  loadCharges,
  loadCo2,
  loadSupportedMappings,
  loadTaskStates,
  loadZones,
  openDb,
  recordTask,
  setDegraded,
  upsertCharges,
  upsertCo2,
  upsertSpotPrices,
} from './store.js';
import { changedCo2, toCo2Slots, toSpotRows } from './transform.js';

type Eds = ReturnType<typeof createEdsClient>;

interface Context {
  db: Db;
  eds: Eds;
  clock: Clock;
}

type Runner = (ctx: Context) => Promise<Record<string, unknown>>;

const DANISH_ZONES = ['DK1', 'DK2'];
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;

/** Fetches day-ahead prices only for days that are still incomplete. */
const dayAhead: Runner = async ({ db, eds, clock }) => {
  const zones = await loadZones(db);
  const days = dayAheadTargetDays(clock);
  const incomplete: string[] = [];
  for (const day of days) {
    const from = localMidnight(day, DK_TIME_ZONE);
    const to = localMidnight(addDays(day, 1), DK_TIME_ZONE);
    const counts = await countSpotSlots(db, from, to);
    const expected = (to - from) / 900_000;
    if (zones.some((z) => (counts.get(z.code) ?? 0) < expected)) incomplete.push(day);
  }
  const [first] = incomplete;
  const last = incomplete.at(-1);
  if (!first || !last) return { skipped: 'complete' };
  const prices = await eds.dayAheadPrices({ start: first, end: addDays(last, 1) });
  const rows = toSpotRows(prices, zones);
  await upsertSpotPrices(db, rows, clock.nowMs);
  return { days: incomplete, rows: rows.length };
};

function co2Runner(kind: 'forecast' | 'actual'): Runner {
  return async ({ db, eds, clock }) => {
    // Forecasts: the past hour to the end of tomorrow. Actuals: the last two hours, which can
    // start on the previous day just after midnight.
    const fromMs = clock.nowMs - (kind === 'forecast' ? 1 : 2) * 3_600_000;
    const start = localTime(fromMs, DK_TIME_ZONE).date;
    const end = kind === 'forecast' ? addDays(clock.today, 2) : addDays(clock.today, 1);
    const query = { start, end, priceAreas: DANISH_ZONES };
    const raw =
      kind === 'forecast' ? await eds.co2EmissionForecast(query) : await eds.co2Emission(query);
    const slots = toCo2Slots(raw.filter((r) => r.timeMs >= fromMs - (fromMs % 900_000)));
    if (slots.length === 0) return { rows: 0 };
    const minMs = Math.min(...slots.map((s) => s.slotStartMs));
    const maxMs = Math.max(...slots.map((s) => s.slotStartMs));
    const stored = await loadCo2(db, kind, minMs, maxMs + 1);
    const changed = changedCo2(slots, stored);
    await upsertCo2(db, kind, changed, clock.nowMs);
    return { slots: slots.length, written: changed.length };
  };
}

/**
 * Refreshes the mapped household tariffs, Energinet's tariffs and electricity tax, then checks
 * every supported grid company still has a recognisable tariff covering today and tomorrow.
 */
const tariffs: Runner = async ({ db, eds, clock }) => {
  const mappings = await loadSupportedMappings(db);
  const glns = [...new Set(mappings.map((m) => m.gln))];
  const codes = [
    ...new Set([
      ...mappings.map((m) => m.chargeCode),
      ...ENERGINET_CONSUMER_TARIFF_CODES,
      ELECTRICITY_TAX_CODE,
    ]),
  ];
  const fetched = await eds.datahubPricelist({
    start: addDays(clock.today, -730),
    ownerGlns: [...glns, ENERGINET_GLN],
    codes,
  });
  await upsertCharges(
    db,
    fetched.map((c) => ({
      ownerGln: c.ownerGln,
      chargeCode: c.code,
      chargeType: c.chargeType,
      validFrom: c.validFrom,
      validTo: c.validTo,
      hourlyMicro: c.hourlyDkkPerKwh.map(toMicro),
      isTax: c.isTax,
      note: c.note,
    })),
    clock.nowMs,
  );

  const stored = await loadCharges(db, [...glns, ENERGINET_GLN]);
  const checkpoints = [`${clock.today}T00:00:00`, `${clock.tomorrow}T23:00:00`];
  const covered = (gln: string, code: string, requireShape: boolean) =>
    checkpoints.every((at) => {
      const row = stored.find(
        (c) =>
          c.ownerGln === gln &&
          c.chargeCode === code &&
          c.validFrom <= at &&
          (c.validTo === null || at < c.validTo),
      );
      return (
        row !== undefined &&
        (!requireShape || classifyTariffShape(row.hourlyMicro).kind !== 'other')
      );
    });

  const missingEnerginet = [...ENERGINET_CONSUMER_TARIFF_CODES, ELECTRICITY_TAX_CODE].filter(
    (code) => !covered(ENERGINET_GLN, code, false),
  );
  if (missingEnerginet.length > 0) {
    throw new Error(
      `Energinet charges not covering today and tomorrow: ${missingEnerginet.join(', ')}`,
    );
  }

  const degraded: string[] = [];
  const healthy: string[] = [];
  for (const gln of glns) {
    const ok = mappings
      .filter((m) => m.gln === gln && m.role === 'tariff')
      .every((m) => covered(gln, m.chargeCode, true));
    (ok ? healthy : degraded).push(gln);
  }
  await setDegraded(db, degraded, healthy, clock.nowMs);
  return {
    charges: fetched.length,
    degraded: mappings.filter((m) => degraded.includes(m.gln)).map((m) => m.name),
  };
};

const RUNNERS: Record<Task, Runner> = {
  day_ahead: dayAhead,
  co2_forecast: co2Runner('forecast'),
  co2_actual: co2Runner('actual'),
  tariffs,
};

/** Entry point for the 5-minute Cron Trigger. Tasks run one after another, one request each. */
export async function runScheduled(
  env: Env,
  scheduledTimeMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const db = openDb(env.DB);
  const clock = clockAt(scheduledTimeMs);
  const eds = createEdsClient({
    fetch: fetchImpl,
    userAgent: 'wattslot (github.com/mateokadiu/wattslot)',
  });
  const due = dueTasks(clock, await loadTaskStates(db));
  const report: Record<string, unknown> = {};
  for (const task of due) {
    try {
      report[task] = await RUNNERS[task]({ db, eds, clock });
      await recordTask(db, task, clock.nowMs, { ok: true });
    } catch (error) {
      const nextAttemptAtMs =
        error instanceof EdsRateLimitError
          ? clock.nowMs + error.retryAfterSeconds * 1000
          : clock.nowMs + RETRY_AFTER_FAILURE_MS;
      const message = error instanceof Error ? error.message : String(error);
      await recordTask(db, task, clock.nowMs, { ok: false, error: message, nextAttemptAtMs });
      report[task] = { error: message, nextAttemptAt: new Date(nextAttemptAtMs).toISOString() };
    }
  }
  console.log(JSON.stringify({ event: 'ingest', at: clock.local.wallClock, report }));
  return report;
}
