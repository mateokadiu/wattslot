import { schema } from '@wattslot/db';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1';
import type { Task, TaskState } from './schedule.js';
import type { Co2Row, SpotRow, ZoneInfo } from './transform.js';

export type Db = DrizzleD1Database<typeof schema>;

export const openDb = (d1: D1Database): Db => drizzle(d1, { schema });

/** D1 allows at most 100 bound parameters per statement. */
const MAX_PARAMS = 100;
const chunk = <T>(rows: readonly T[], columns: number): T[][] => {
  const size = Math.max(1, Math.floor(MAX_PARAMS / columns));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
};

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

export async function upsertSpotPrices(db: Db, rows: readonly SpotRow[], nowMs: number) {
  const t = schema.spotPrices;
  await runBatch(
    db,
    chunk(rows, 6).map((part) =>
      db
        .insert(t)
        .values(part.map((r) => ({ ...r, source: 'eds', ingestedAtMs: nowMs })))
        .onConflictDoUpdate({
          target: [t.zone, t.slotStartMs],
          set: {
            priceMicro: sql`excluded.price_micro`,
            priceEurMicro: sql`excluded.price_eur_micro`,
            ingestedAtMs: sql`excluded.ingested_at_ms`,
          },
        }),
    ),
  );
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
  db: Db,
  kind: 'forecast' | 'actual',
  rows: readonly Co2Row[],
  nowMs: number,
) {
  const t = schema.co2Intensity;
  await runBatch(
    db,
    chunk(rows, 5).map((part) =>
      db
        .insert(t)
        .values(
          part.map((r) => ({
            zone: r.zone,
            timeMs: r.slotStartMs,
            kind,
            gPerKwh: r.gPerKwh,
            issuedAtMs: nowMs,
          })),
        )
        .onConflictDoUpdate({
          target: [t.zone, t.timeMs, t.kind],
          set: { gPerKwh: sql`excluded.g_per_kwh`, issuedAtMs: sql`excluded.issued_at_ms` },
        }),
    ),
  );
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

export async function upsertCharges(db: Db, rows: readonly ChargeRow[], nowMs: number) {
  const t = schema.charges;
  await runBatch(
    db,
    chunk(rows, 9).map((part) =>
      db
        .insert(t)
        .values(part.map((r) => ({ ...r, ingestedAtMs: nowMs })))
        .onConflictDoUpdate({
          target: [t.ownerGln, t.chargeCode, t.validFrom],
          set: {
            validTo: sql`excluded.valid_to`,
            hourlyMicro: sql`excluded.hourly_micro`,
            isTax: sql`excluded.is_tax`,
            note: sql`excluded.note`,
            ingestedAtMs: sql`excluded.ingested_at_ms`,
          },
        }),
    ),
  );
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
