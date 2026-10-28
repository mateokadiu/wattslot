import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, local, startWorker } from './harness.js';

let h: Harness;

beforeAll(async () => {
  h = await startWorker();
  // The recorded day-ahead fixture only has Danish prices; other zones would never look complete.
  await h.db.prepare("delete from price_zones where code not in ('DK1', 'DK2')").run();
}, 60_000);

afterAll(async () => {
  await h?.dispose();
});

const count = async (sql: string) =>
  ((await h.db.prepare(sql).first<{ n: number }>())?.n ?? 0) as number;

describe('ingestion cron', () => {
  it('fills an empty database on the first run after midnight', async () => {
    await h.tick('00:00');
    expect(new Set(h.calls)).toEqual(
      new Set(['DayAheadPrices', 'CO2EmisProg', 'DatahubPricelist']),
    );
    expect(await count('select count(*) n from spot_prices')).toBe(192);
    expect(await count("select count(*) n from co2_intensity where kind = 'forecast'")).toBe(24);
    expect(await count('select count(*) n from charges')).toBe(13);
  });

  it('stores Danish spot prices in DKK micro-units per kWh', async () => {
    const row = await h.db
      .prepare('select price_micro from spot_prices where zone = ? and slot_start_ms = ?')
      .bind('DK2', Date.UTC(2026, 9, 27, 23))
      .first<{ price_micro: number }>();
    expect(Math.round((row?.price_micro ?? 0) / 10_000)).toBe(110); // 1.10 DKK/kWh
  });

  it('marks grid companies without current tariff data as degraded', async () => {
    const radius = await h.db
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
    h.calls.length = 0;
    const issued = "select max(issued_at_ms) n from co2_intensity where kind = 'forecast'";
    const before = await count(issued);
    await h.tick('00:30');
    expect(h.calls).toEqual(['CO2EmisProg']); // today's prices are complete; tariffs are fresh
    expect(await count(issued)).toBe(before);
  });

  it('backs off after HTTP 429 instead of retrying every tick', async () => {
    h.rateLimited.add('DayAheadPrices');
    h.calls.length = 0;
    await h.tick('13:00'); // tomorrow is missing, so it fetches — and gets rate limited
    expect(h.calls).toContain('DayAheadPrices');
    const state = await h.db
      .prepare("select next_attempt_at_ms, last_error from ingest_state where task = 'day_ahead'")
      .first<{ next_attempt_at_ms: number; last_error: string }>();
    expect(state?.next_attempt_at_ms).toBe(local('13:00').getTime() + 295_000);
    expect(state?.last_error).toContain('rate limited');

    h.calls.length = 0;
    await h.tick('13:04');
    expect(h.calls).not.toContain('DayAheadPrices');
    h.rateLimited.clear();
  });

  it('reports data freshness on /v1/status', async () => {
    const status = (await (await h.get('/v1/status')).json()) as {
      tasks: { task: string; lastSuccessAt: string | null; lastError: string | null }[];
      latestPriceSlot: Record<string, string>;
    };
    expect(status.latestPriceSlot.DK2).toBe('2026-10-28T22:45:00.000Z');
    const dayAhead = status.tasks.find((t) => t.task === 'day_ahead');
    expect(dayAhead?.lastSuccessAt).not.toBeNull();
    expect(dayAhead?.lastError).toContain('rate limited');
  });
});
