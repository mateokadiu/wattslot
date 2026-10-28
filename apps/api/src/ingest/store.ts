import { schema } from '@wattslot/db';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1';
import type { Task, TaskState } from './schedule.ts';
import type { Co2Row, SpotRow, ZoneInfo } from './transform.ts';

export type Db = DrizzleD1Database<typeof schema>;

export const openDb = (d1: D1Database): Db => drizzle(d1, { schema });

/**
 * Bulk writes pass every row as ONE JSON parameter that SQLite unpacks with json_each: one
 * statement per table instead of one per handful of rows. That stays within D1's 100-parameter
 * limit and, more importantly, the free plan's 10 ms CPU budget — building dozens of statements
 * through the query builder alone cost ~7 ms for a day-ahead run.
 */
const json = (rows: unknown) => JSON.stringify(rows);

async function runBatch(db: Db, statements: BatchItem<'sqlite'>[]): Promise<void> {
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
}

export async function loadZones(db: Db): Promise<ZoneInfo[]> {
  return db
    .select({
      code: schema.priceZones.code,
      currency: schema.priceZones.currency,
      timeZone: schema.priceZones.timeZone,
    })
    .from(schema.priceZones);
}

export async function loadTaskStates(db: Db): Promise<Map<Task, TaskState>> {
  const rows = await db.select().from(schema.ingestState);
  return new Map(rows.map((r) => [r.task as Task, r]));
}

export async function recordTask(
  db: Db,
  task: Task,
  nowMs: number,
  outcome: { ok: true } | { ok: false; error: string; nextAttemptAtMs: number },
): Promise<void> {
  const t = schema.ingestState;
  const values = outcome.ok
    ? { task, lastSuccessAtMs: nowMs, nextAttemptAtMs: null, lastError: null, updatedAtMs: nowMs }
    : {
        task,
        nextAttemptAtMs: outcome.nextAttemptAtMs,
        lastError: outcome.error.slice(0, 500),
        updatedAtMs: nowMs,
      };
  await db
    .insert(t)
    .values(values)
    .onConflictDoUpdate({ target: t.task, set: { ...values, task: undefined } });
}

/** Number of stored slots per zone in [fromMs, toMs). */
export async function countSpotSlots(
  db: Db,
  fromMs: number,
  toMs: number,
): Promise<Map<string, number>> {
  const t = schema.spotPrices;
  const rows = await db
    .select({ zone: t.zone, n: sql<number>`count(*)` })
    .from(t)
    .where(and(gte(t.slotStartMs, fromMs), lt(t.slotStartMs, toMs)))
    .groupBy(t.zone);
  return new Map(rows.map((r) => [r.zone, r.n]));
}

/** Stored prices in [fromMs, toMs), keyed `zone|slotStartMs`, for writing only what changed. */
export async function loadSpotPrices(
  db: Db,
  fromMs: number,
  toMs: number,
): Promise<Map<string, string>> {
  const t = schema.spotPrices;
  const rows = await db
    .select({ zone: t.zone, slot: t.slotStartMs, price: t.priceMicro, eur: t.priceEurMicro })
    .from(t)
    .where(and(gte(t.slotStartMs, fromMs), lt(t.slotStartMs, toMs)));
  return new Map(rows.map((r) => [`${r.zone}|${r.slot}`, `${r.price}|${r.eur}`]));
}

export const changedSpotRows = (rows: readonly SpotRow[], stored: ReadonlyMap<string, string>) =>
  rows.filter(
    (r) => stored.get(`${r.zone}|${r.slotStartMs}`) !== `${r.priceMicro}|${r.priceEurMicro}`,
  );

export async function upsertSpotPrices(d1: D1Database, rows: readonly SpotRow[], nowMs: number) {
  if (rows.length === 0) return;
  await d1
    .prepare(
      `INSERT INTO spot_prices (zone, slot_start_ms, price_micro, price_eur_micro, source, ingested_at_ms)
       SELECT value ->> '$[0]', value ->> '$[1]', value ->> '$[2]', value ->> '$[3]', 'eds', ?2
       FROM json_each(?1) WHERE true
       ON CONFLICT (zone, slot_start_ms) DO UPDATE SET
         price_micro = excluded.price_micro,
         price_eur_micro = excluded.price_eur_micro,
         ingested_at_ms = excluded.ingested_at_ms`,
    )
    .bind(json(rows.map((r) => [r.zone, r.slotStartMs, r.priceMicro, r.priceEurMicro])), nowMs)
    .run();
}

export async function loadCo2(
  db: Db,
  kind: 'forecast' | 'actual',
  fromMs: number,
  toMs: number,
): Promise<Map<string, number>> {
  const t = schema.co2Intensity;
  const rows = await db
    .select({ zone: t.zone, timeMs: t.timeMs, gPerKwh: t.gPerKwh })
    .from(t)
    .where(and(eq(t.kind, kind), gte(t.timeMs, fromMs), lt(t.timeMs, toMs)));
  return new Map(rows.map((r) => [`${r.zone}|${r.timeMs}`, r.gPerKwh]));
}

export async function upsertCo2(
  d1: D1Database,
  kind: 'forecast' | 'actual',
  rows: readonly Co2Row[],
  nowMs: number,
) {
  if (rows.length === 0) return;
  await d1
    .prepare(
      `INSERT INTO co2_intensity (zone, time_ms, kind, g_per_kwh, issued_at_ms)
       SELECT value ->> '$[0]', value ->> '$[1]', ?2, value ->> '$[2]', ?3
       FROM json_each(?1) WHERE true
       ON CONFLICT (zone, time_ms, kind) DO UPDATE SET
         g_per_kwh = excluded.g_per_kwh,
         issued_at_ms = excluded.issued_at_ms`,
    )
    .bind(json(rows.map((r) => [r.zone, r.slotStartMs, r.gPerKwh])), kind, nowMs)
    .run();
}

export interface ChargeRow {
  ownerGln: string;
  chargeCode: string;
  chargeType: string;
  validFrom: string;
  validTo: string | null;
  hourlyMicro: number[];
  isTax: boolean;
  note: string | null;
}

/**
 * Stores every fetched tariff period and deletes stored periods the response no longer has.
 * The fetch returns all periods with ValidFrom ≥ `sinceWallClock` for these owners and codes,
 * so anything else stored in that range was withdrawn by the grid company — and a withdrawn
 * period must never win as "the latest-starting one". One batch, so it's atomic.
 */
export async function syncCharges(
  d1: D1Database,
  scope: { sinceWallClock: string; owners: readonly string[]; codes: readonly string[] },
  rows: readonly ChargeRow[],
  nowMs: number,
) {
  const upsert = d1
    .prepare(
      `INSERT INTO charges
         (owner_gln, charge_code, charge_type, valid_from, valid_to, hourly_micro, is_tax, note, ingested_at_ms)
       SELECT value ->> '$[0]', value ->> '$[1]', value ->> '$[2]', value ->> '$[3]', value ->> '$[4]',
              value -> '$[5]', value ->> '$[6]', value ->> '$[7]', ?2
       FROM json_each(?1) WHERE true
       ON CONFLICT (owner_gln, charge_type, charge_code, valid_from) DO UPDATE SET
         valid_to = excluded.valid_to,
         hourly_micro = excluded.hourly_micro,
         is_tax = excluded.is_tax,
         note = excluded.note,
         ingested_at_ms = excluded.ingested_at_ms`,
    )
    .bind(
      json(
        rows.map((r) => [
          r.ownerGln,
          r.chargeCode,
          r.chargeType,
          r.validFrom,
          r.validTo,
          r.hourlyMicro,
          r.isTax ? 1 : 0,
          r.note,
        ]),
      ),
      nowMs,
    );
  const removeWithdrawn = d1
    .prepare(
      `DELETE FROM charges
       WHERE charge_type = 'D03'
         AND valid_from >= ?1
         AND owner_gln IN (SELECT value FROM json_each(?2))
         AND charge_code IN (SELECT value FROM json_each(?3))
         AND owner_gln || '|' || charge_code || '|' || valid_from
             NOT IN (SELECT value FROM json_each(?4))`,
    )
    .bind(
      scope.sinceWallClock,
      json(scope.owners),
      json(scope.codes),
      json(rows.map((r) => `${r.ownerGln}|${r.chargeCode}|${r.validFrom}`)),
    );
  await d1.batch([upsert, removeWithdrawn]);
}

export interface TariffMapping {
  gln: string;
  name: string;
  chargeCode: string;
  role: 'tariff' | 'discount';
}

export async function loadSupportedMappings(db: Db): Promise<TariffMapping[]> {
  const g = schema.gridCompanies;
  const m = schema.tariffMappings;
  return db
    .select({ gln: g.gln, name: g.name, chargeCode: m.chargeCode, role: m.role })
    .from(m)
    .innerJoin(g, eq(g.gln, m.gln))
    .where(and(eq(g.support, 'supported'), eq(m.customerType, 'C')));
}

export async function loadCharges(
  db: Db,
  owners: readonly string[],
): Promise<(typeof schema.charges.$inferSelect)[]> {
  if (owners.length === 0) return [];
  return db
    .select()
    .from(schema.charges)
    .where(inArray(schema.charges.ownerGln, [...owners]));
}

export async function setDegraded(
  db: Db,
  glns: readonly string[],
  healthy: readonly string[],
  nowMs: number,
) {
  const g = schema.gridCompanies;
  const statements: BatchItem<'sqlite'>[] = [];
  if (glns.length > 0) {
    statements.push(
      db
        .update(g)
        .set({ degradedAtMs: nowMs })
        .where(and(inArray(g.gln, [...glns]), sql`${g.degradedAtMs} is null`)),
    );
  }
  if (healthy.length > 0) {
    statements.push(
      db
        .update(g)
        .set({ degradedAtMs: null })
        .where(inArray(g.gln, [...healthy])),
    );
  }
  await runBatch(db, statements);
}
