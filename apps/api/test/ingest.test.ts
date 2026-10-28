import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtureText } from './fixtures.ts';
import { type Harness, local, startWorker } from './harness.ts';

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

  it('deletes a tariff period the grid company has withdrawn', async () => {
    const withdrawn = '2027-04-01T00:00:00'; // Radius DT_C_01 summer 2027 period
    const recorded = JSON.parse(fixtureText('datahub-pricelist-radius-energinet.json')) as {
      total: number;
      records: { ChargeTypeCode: string; ValidFrom: string }[];
    };
    const records = recorded.records.filter(
      (r) => !(r.ChargeTypeCode === 'DT_C_01' && r.ValidFrom === withdrawn),
    );
    h.overrides.set(
      'DatahubPricelist',
      JSON.stringify({ ...recorded, total: records.length, records }),
    );
    await h.tick('02:00'); // the nightly tariff sync
    h.overrides.clear();
    expect(await count('select count(*) n from charges')).toBe(12);
    const gone = await h.db
      .prepare('select count(*) n from charges where charge_code = ? and valid_from = ?')
      .bind('DT_C_01', withdrawn)
      .first<{ n: number }>();
    expect(gone?.n).toBe(0);
  });

  it('never lets a subscription that shares a tariff code into the tariffs', async () => {
    // N1 uses the code CD for both its tariff (D03) and its monthly subscription (D01). Inject
    // the same situation for Radius: a D01 row with DT_C_01's code and start date.
    const recorded = JSON.parse(fixtureText('datahub-pricelist-radius-energinet.json')) as {
      total: number;
      records: Record<string, unknown>[];
    };
    const tariff = recorded.records.find(
      (r) => r.ChargeTypeCode === 'DT_C_01' && r.ValidFrom === '2026-10-01T00:00:00',
    );
    const subscription = {
      ...tariff,
      ChargeType: 'D01',
      Note: 'Net abo C forbrug',
      ValidTo: '2027-01-01T00:00:00',
      Price1: 26.686367,
      ...Object.fromEntries(Array.from({ length: 23 }, (_, i) => [`Price${i + 2}`, null])),
    };
    const records = [...recorded.records, subscription];
    h.overrides.set(
      'DatahubPricelist',
      JSON.stringify({ ...recorded, total: records.length, records }),
    );
    h.urls.length = 0;
    await h.tick('02:00');
    h.overrides.clear();

    const request = h.urls.find((u) => u.pathname.endsWith('/DatahubPricelist'));
    expect(JSON.parse(request?.searchParams.get('filter') ?? '{}').ChargeType).toEqual(['D03']);
    expect(await count("select count(*) n from charges where charge_type <> 'D03'")).toBe(0);

    const prices = (await (
      await h.get(`/v1/prices?zone=DK2&gln=5790000705689&date=2026-10-28`)
    ).json()) as {
      mode: string;
      slots: { start: string; total: number }[];
    };
    expect(prices.mode).toBe('full');
    const evening = prices.slots.find((x) => x.start === '2026-10-28T17:00:00.000Z');
    expect(Math.round((evening?.total ?? 0) * 100)).toBe(435);
  });

  it('re-fetches a missing price and writes only that row', async () => {
    const slot = Date.UTC(2026, 9, 28, 10); // 11:00 local, DK2
    await h.db
      .prepare('delete from spot_prices where zone = ? and slot_start_ms = ?')
      .bind('DK2', slot)
      .run();
    await h.tick('03:00'); // half-hourly catch-up: today is incomplete again
    expect(await count('select count(*) n from spot_prices')).toBe(192);
    const rewritten = await h.db
      .prepare('select zone, slot_start_ms from spot_prices where ingested_at_ms = ?')
      .bind(local('03:00').getTime())
      .all<{ zone: string; slot_start_ms: number }>();
    expect(rewritten.results).toEqual([{ zone: 'DK2', slot_start_ms: slot }]);
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
      degradedGridCompanies: { name: string }[];
    };
    expect(status.degradedGridCompanies).toHaveLength(30);
    expect(status.latestPriceSlot.DK2).toBe('2026-10-28T22:45:00.000Z');
    const dayAhead = status.tasks.find((t) => t.task === 'day_ahead');
    expect(dayAhead?.lastSuccessAt).not.toBeNull();
    expect(dayAhead?.lastError).toContain('rate limited');
  });
});
