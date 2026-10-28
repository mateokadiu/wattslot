/**
 * Runs the real Worker's cron handler in workerd with Energi Data Service replaced by the
 * recorded fixtures, then inspects D1 and the public API.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { D1Database } from '@cloudflare/workers-types';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureText } from './fixtures.js';

const MIGRATIONS = new URL('../../../packages/db/migrations/', import.meta.url);
const statements = () =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .flatMap((f) => readFileSync(new URL(f, MIGRATIONS), 'utf8').split('--> statement-breakpoint'))
    .map((s) =>
      s
        .split('\n')
        .filter((l) => !l.startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);

const FIXTURES: Record<string, string> = {
  DayAheadPrices: 'dayahead-2026-10-28.json',
  CO2EmisProg: 'co2-forecast-2026-10-28-dk2-night.json',
  CO2Emis: 'co2-forecast-2026-10-28-dk2-night.json',
  DatahubPricelist: 'datahub-pricelist-radius-energinet.json',
};

const calls: string[] = [];
let rateLimited = new Set<string>();
let mf: Miniflare;
let db: D1Database;

beforeAll(async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'import'],
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0]?.text ?? '',
    compatibilityDate: '2026-07-01',
    d1Databases: { DB: 'wattslot-ingest-test' },
    outboundService: (request: Request) => {
      const dataset = new URL(request.url).pathname.split('/').pop() ?? '';
      calls.push(dataset);
      if (rateLimited.has(dataset)) {
        return new Response(fixtureText('error-429.json'), { status: 429 });
      }
      const name = FIXTURES[dataset];
      return name
        ? new Response(fixtureText(name), { headers: { 'content-type': 'application/json' } })
        : new Response('unknown dataset', { status: 404 });
    },
  });
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  await db.batch(statements().map((s) => db.prepare(s)));
  // The recorded day-ahead fixture only has Danish prices; other zones would never look complete.
  await db.prepare("delete from price_zones where code not in ('DK1', 'DK2')").run();
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
});

/** Danish local time on 28 Oct 2026 (CET) as a Date. */
const local = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(2026, 9, 28, h - 1, m));
};
const tick = async (hhmm: string) => {
  const worker = await mf.getWorker();
  await worker.scheduled({ scheduledTime: local(hhmm), cron: '*/5 * * * *' });
};
const count = async (sql: string) =>
  ((await db.prepare(sql).first<{ n: number }>())?.n ?? 0) as number;

describe('ingestion cron', () => {
  it('fills an empty database on the first run after midnight', async () => {
    await tick('00:00');
    expect(new Set(calls)).toEqual(new Set(['DayAheadPrices', 'CO2EmisProg', 'DatahubPricelist']));
    expect(await count('select count(*) n from spot_prices')).toBe(192);
    expect(await count("select count(*) n from co2_intensity where kind = 'forecast'")).toBe(24);
    expect(await count('select count(*) n from charges')).toBe(13);
  });

  it('stores Danish spot prices in DKK micro-units per kWh', async () => {
    const row = await db
      .prepare('select price_micro from spot_prices where zone = ? and slot_start_ms = ?')
      .bind('DK2', Date.UTC(2026, 9, 27, 23))
      .first<{ price_micro: number }>();
    expect(Math.round((row?.price_micro ?? 0) / 10_000)).toBe(110); // 1.10 DKK/kWh
  });

  it('marks grid companies without current tariff data as degraded', async () => {
    const radius = await db
      .prepare('select degraded_at_ms from grid_companies where gln = ?')
      .bind('5790000705689')
      .first<{ degraded_at_ms: number | null }>();
    expect(radius?.degraded_at_ms).toBeNull();
    // The fixture only has Radius' and Energinet's tariffs, so every other company is stale.
    expect(
      await count(
        "select count(*) n from grid_companies where support = 'supported' and degraded_at_ms is not null",
      ),
    ).toBe(30);
  });

  it('skips work that is already done and writes nothing unchanged', async () => {
    calls.length = 0;
    const before = await count(
      "select max(issued_at_ms) n from co2_intensity where kind = 'forecast'",
    );
    await tick('00:30');
    expect(calls).toEqual(['CO2EmisProg']); // today's prices are complete; tariffs are fresh
    expect(
      await count("select max(issued_at_ms) n from co2_intensity where kind = 'forecast'"),
    ).toBe(before);
  });

  it('backs off after HTTP 429 instead of retrying every tick', async () => {
    rateLimited = new Set(['DayAheadPrices']);
    calls.length = 0;
    await tick('13:00'); // tomorrow is missing, so it fetches — and gets rate limited
    expect(calls).toContain('DayAheadPrices');
    const state = await db
      .prepare("select next_attempt_at_ms, last_error from ingest_state where task = 'day_ahead'")
      .first<{ next_attempt_at_ms: number; last_error: string }>();
    expect(state?.next_attempt_at_ms).toBe(local('13:00').getTime() + 295_000);
    expect(state?.last_error).toContain('rate limited');

    calls.length = 0;
    await tick('13:04');
    expect(calls).not.toContain('DayAheadPrices');
    rateLimited = new Set();
  });

  it('reports data freshness on /v1/status', async () => {
    const response = await mf.dispatchFetch('http://api/v1/status');
    const status = (await response.json()) as {
      tasks: { task: string; lastSuccessAt: string | null; lastError: string | null }[];
      latestPriceSlot: Record<string, string>;
    };
    expect(status.latestPriceSlot.DK2).toBe('2026-10-28T22:45:00.000Z');
    const dayAhead = status.tasks.find((t) => t.task === 'day_ahead');
    expect(dayAhead?.lastSuccessAt).not.toBeNull();
    expect(dayAhead?.lastError).toContain('rate limited');
  });
});
