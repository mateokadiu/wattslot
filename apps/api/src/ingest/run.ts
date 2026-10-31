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
  periodAt,
  toMicro,
} from '@wattslot/pricing';
import type { Env } from '../env.ts';
import { OUTAGE_API, type OutageList, SHOW_TYPE, toOutageRows } from '../outages/feed.ts';
import { syncOutages } from '../outages/store.ts';
import { type Clock, clockAt, dayAheadTargetDays, dueTasks, type Task } from './schedule.ts';
import {
  changedSpotRows,
  countSpotSlots,
  type Db,
  loadCharges,
  loadCo2,
  loadSpotPrices,
  loadSupportedMappings,
  loadTaskStates,
  loadZones,
  openDb,
  recordTask,
  setDegraded,
  syncCharges,
  upsertCo2,
  upsertSpotPrices,
} from './store.ts';
import { changedCo2, toCo2Slots, toSpotRows } from './transform.ts';

type Eds = ReturnType<typeof createEdsClient>;

interface Context {
  db: Db;
  /** Raw D1 for bulk writes; see store.ts. */
  d1: D1Database;
  eds: Eds;
  fetch: typeof fetch;
  clock: Clock;
}

const USER_AGENT = 'wattslot (github.com/mateokadiu/wattslot)';
const OUTAGE_TASKS: readonly Task[] = ['outages', 'outages_planned'];

type Runner = (ctx: Context) => Promise<Record<string, unknown>>;

const DANISH_ZONES = ['DK1', 'DK2'];
/** DataHub charge type for per-kWh tariffs (D01 = subscription, D02 = fee). */
const TARIFF = 'D03';
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;

/** Fetches day-ahead prices only for days that are still incomplete; writes only what changed. */
const dayAhead: Runner = async ({ db, d1, eds, clock }) => {
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
  const end = addDays(last, 1);
  const prices = await eds.dayAheadPrices({ start: first, end });
  const rows = toSpotRows(prices, zones);
  const stored = await loadSpotPrices(
    db,
    localMidnight(first, DK_TIME_ZONE),
    localMidnight(end, DK_TIME_ZONE),
  );
  const changed = changedSpotRows(rows, stored);
  await upsertSpotPrices(d1, changed, clock.nowMs);
  return { days: incomplete, rows: rows.length, written: changed.length };
};

function co2Runner(kind: 'forecast' | 'actual'): Runner {
  return async ({ db, d1, eds, clock }) => {
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
    await upsertCo2(d1, kind, changed, clock.nowMs);
    return { slots: slots.length, written: changed.length };
  };
}

/**
 * Refreshes the mapped household tariffs, Energinet's tariffs and electricity tax, then checks
 * every supported grid company still has a recognisable tariff covering today and tomorrow.
 */
const tariffs: Runner = async ({ db, d1, eds, clock }) => {
  const mappings = await loadSupportedMappings(db);
  const glns = [...new Set(mappings.map((m) => m.gln))];
  const codes = [
    ...new Set([
      ...mappings.map((m) => m.chargeCode),
      ...ENERGINET_CONSUMER_TARIFF_CODES,
      ELECTRICITY_TAX_CODE,
    ]),
  ];
  const since = addDays(clock.today, -730);
  const owners = [...glns, ENERGINET_GLN];
  // Tariffs only: a grid company can reuse a tariff's code for its subscription (N1's CD).
  const fetched = (
    await eds.datahubPricelist({ start: since, ownerGlns: owners, codes, chargeTypes: [TARIFF] })
  ).filter((c) => c.chargeType === TARIFF);
  await syncCharges(
    d1,
    { sinceWallClock: `${since}T00:00:00`, owners, codes },
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
  const covered = (gln: string, code: string, requireShape: boolean) => {
    const periods = stored.filter((c) => c.ownerGln === gln && c.chargeCode === code);
    return checkpoints.every((at) => {
      let row: (typeof periods)[number] | null;
      try {
        row = periodAt(periods, at);
      } catch {
        return false; // overlapping periods: corrupt data, degrade rather than guess
      }
      return (
        row !== null && (!requireShape || classifyTariffShape(row.hourlyMicro).kind !== 'other')
      );
    });
  };

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

/**
 * Days of quarter-hour prices and CO₂ data to keep; older rows are deleted every night. Tariffs
 * aren't touched: they're small, and the nightly sync would only fetch old periods back.
 */
export const RETENTION_DAYS = 400;
const OUTAGE_RETENTION_DAYS = 30;

const cleanup: Runner = async ({ d1, clock }) => {
  const beforeMs = clock.nowMs - RETENTION_DAYS * 86_400_000;
  const [spot, co2, outages] = await d1.batch([
    d1.prepare('delete from spot_prices where slot_start_ms < ?').bind(beforeMs),
    d1.prepare('delete from co2_intensity where time_ms < ?').bind(beforeMs),
    // Outages are only shown while current; keep ended ones a month, then let them go.
    d1
      .prepare('delete from outages where gone_ms < ?')
      .bind(clock.nowMs - OUTAGE_RETENTION_DAYS * 86_400_000),
  ]);
  return {
    before: new Date(beforeMs).toISOString(),
    spotPrices: spot?.meta.changes ?? 0,
    co2: co2?.meta.changes ?? 0,
    outages: outages?.meta.changes ?? 0,
  };
};

/** One of the outage portal's lists: fetch it and bring the stored incidents in line. */
const outageRunner =
  (list: OutageList): Runner =>
  async ({ d1, fetch: fetchImpl, clock }) => {
    const response = await fetchImpl(`${OUTAGE_API}?showType=${SHOW_TYPE[list]}&supplierId=0`, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    });
    if (!response.ok) throw new Error(`Outage portal answered ${response.status}`);
    const { rows, skipped } = toOutageRows(await response.json(), list);
    const result = await syncOutages(d1, list, rows, clock.nowMs);
    return { incidents: rows.length, skipped, ...result };
  };

const RUNNERS: Record<Task, Runner> = {
  day_ahead: dayAhead,
  co2_forecast: co2Runner('forecast'),
  co2_actual: co2Runner('actual'),
  tariffs,
  cleanup,
  outages: outageRunner('active'),
  outages_planned: outageRunner('planned'),
};

/** Entry point for the 5-minute Cron Trigger. Tasks run one after another, one request each. */
export async function runScheduled(
  env: Env,
  scheduledTimeMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const db = openDb(env.DB);
  const d1 = env.DB;
  const clock = clockAt(scheduledTimeMs);
  const eds = createEdsClient({
    fetch: fetchImpl,
    userAgent: USER_AGENT,
  });
  const due = dueTasks(clock, await loadTaskStates(db)).filter(
    (task) => env.OUTAGES !== 'off' || !OUTAGE_TASKS.includes(task),
  );
  const report: Record<string, unknown> = {};
  for (const task of due) {
    try {
      report[task] = await RUNNERS[task]({ db, d1, eds, fetch: fetchImpl, clock });
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
