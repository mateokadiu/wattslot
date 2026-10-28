/** The whole chain: recorded EDS data → cron ingestion → D1 → pricing → public API. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startWorker } from './harness.js';

const RADIUS = '5790000705689'; // DK2, the worked example in PLAN.md §2.2
const N1 = '5790001089030'; // DK1; degraded because the fixture lacks its tariff
const KIMBRER = '5790001095239'; // unsupported: 0.00 household tariff

interface Slot {
  start: string;
  spot: number;
  gridTariff: number;
  tsoTariffs: number;
  electricityTax: number;
  supplierMarkup: number;
  vat: number;
  total: number;
}
interface Prices {
  mode: 'full' | 'spot-only';
  note: string | null;
  unit: string;
  complete: boolean;
  gridCompany: { name: string } | null;
  slots: Slot[];
}

let h: Harness;
const json = async <T>(path: string) => (await (await h.get(path)).json()) as T;
const ore = (dkk: number) => Math.round(dkk * 100);

beforeAll(async () => {
  h = await startWorker();
  await h.tick('00:00'); // ingest the recorded prices, CO₂ forecast and tariffs
}, 60_000);

afterAll(async () => {
  await h?.dispose();
});

describe('GET /v1/prices', () => {
  it('reproduces the worked example: 1.66 DKK/kWh at 00:00 and 4.35 at 18:00', async () => {
    const p = await json<Prices>(`/v1/prices?zone=DK2&gln=${RADIUS}&date=2026-10-28`);
    expect(p).toMatchObject({ mode: 'full', note: null, unit: 'DKK/kWh', complete: true });
    expect(p.gridCompany?.name).toBe('Radius Elnet A/S');
    expect(p.slots).toHaveLength(96);
    expect(ore(p.slots[0]?.total ?? 0)).toBe(166);
    const evening = p.slots.find((s) => s.start === '2026-10-28T17:00:00.000Z'); // 18:00 local
    expect(ore(evening?.total ?? 0)).toBe(435);
    expect(evening?.gridTariff).toBe(0.955573);
  });

  it('returns a breakdown that adds up to the total', async () => {
    const p = await json<Prices>(`/v1/prices?zone=DK2&gln=${RADIUS}&date=2026-10-28`);
    for (const s of p.slots) {
      const sum =
        s.spot + s.gridTariff + s.tsoTariffs + s.electricityTax + s.supplierMarkup + s.vat;
      expect(Math.abs(sum - s.total)).toBeLessThan(1e-9);
    }
  });

  it('adds a supplier markup with VAT on top', async () => {
    const base = await json<Prices>(`/v1/prices?zone=DK2&gln=${RADIUS}&date=2026-10-28`);
    const marked = await json<Prices>(
      `/v1/prices?zone=DK2&gln=${RADIUS}&date=2026-10-28&markup=0.1`,
    );
    expect((marked.slots[0]?.total ?? 0) - (base.slots[0]?.total ?? 0)).toBeCloseTo(0.125, 9);
  });

  it('falls back to spot prices and says why', async () => {
    const noCompany = await json<Prices>('/v1/prices?zone=DK2&date=2026-10-28');
    expect(noCompany.mode).toBe('spot-only');
    expect(noCompany.note).toContain('choose a grid company');
    expect(noCompany.slots[0]?.total).toBe(noCompany.slots[0]?.spot);

    const stale = await json<Prices>(`/v1/prices?zone=DK1&gln=${N1}&date=2026-10-28`);
    expect(stale.note).toContain('out of date');

    const unsupported = await json<Prices>(`/v1/prices?zone=DK1&gln=${KIMBRER}&date=2026-10-28`);
    expect(unsupported.note).toContain('0.00');

    const germany = await json<Prices>('/v1/prices?zone=DE&date=2026-10-28');
    expect(germany.note).toContain("aren't modelled for DE");
    expect(germany.complete).toBe(false);
  });

  it('explains why a degraded grid company is not supported', async () => {
    const { gridCompanies } = await json<{
      gridCompanies: { gln: string; supported: boolean; note: string | null }[];
    }>('/v1/grid-companies?zone=DK1');
    const n1 = gridCompanies.find((g) => g.gln === N1);
    expect(n1?.supported).toBe(false);
    expect(n1?.note).toContain('out of date since');
  });

  it('rejects bad requests with clear errors', async () => {
    const wrongZone = await h.get(`/v1/prices?zone=DK1&gln=${RADIUS}`);
    expect(wrongZone.status).toBe(400);
    expect(((await wrongZone.json()) as { message: string }).message).toContain('is in DK2');

    expect((await h.get('/v1/prices?zone=XX')).status).toBe(404);
    const badGln = await h.get('/v1/prices?zone=DK2&gln=123');
    expect(badGln.status).toBe(400);
    expect(((await badGln.json()) as { error: string }).error).toBe('invalid_request');
  });
});

describe('GET /v1/co2', () => {
  it('returns 15-minute CO₂ intensity', async () => {
    const co2 = await json<{ unit: string; slots: { forecast: number | null }[] }>(
      '/v1/co2?zone=DK2&date=2026-10-28',
    );
    expect(co2.unit).toBe('g/kWh');
    expect(co2.slots).toHaveLength(24); // the fixture covers 00:00–06:00
    expect(co2.slots.every((s) => typeof s.forecast === 'number')).toBe(true);
  });
});

describe('GET /v1/cheapest', () => {
  const day = 'from=2026-10-28T00:00:00%2B01:00&to=2026-10-29T00:00:00%2B01:00';
  interface Cheapest {
    mode: string;
    cheapest: { start: string; end: string; averagePrice: number; slots: unknown[] } | null;
    startNow: { averagePrice: number } | null;
    message: string | null;
  }

  it('finds the cheapest 2-hour window of the day, compared with starting now', async () => {
    const r = await json<Cheapest>(`/v1/cheapest?zone=DK2&gln=${RADIUS}&hours=2&${day}`);
    expect(r.mode).toBe('full');
    expect(r.cheapest?.slots).toHaveLength(8);

    // Brute force over the same day's prices: no 2-hour window is cheaper.
    const p = await json<Prices>(`/v1/prices?zone=DK2&gln=${RADIUS}&date=2026-10-28`);
    const totals = p.slots.map((s) => s.total);
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i + 8 <= totals.length; i++) {
      best = Math.min(best, totals.slice(i, i + 8).reduce((a, b) => a + b, 0) / 8);
    }
    expect(r.cheapest?.averagePrice).toBeCloseTo(best, 5);
    expect(r.startNow?.averagePrice).toBeGreaterThanOrEqual(r.cheapest?.averagePrice ?? 0);
  });

  it('can do better when the load may pause', async () => {
    const window = await json<Cheapest>(`/v1/cheapest?zone=DK2&gln=${RADIUS}&hours=2&${day}`);
    const anyOrder = await json<Cheapest>(
      `/v1/cheapest?zone=DK2&gln=${RADIUS}&hours=2&contiguous=false&${day}`,
    );
    expect(anyOrder.cheapest?.averagePrice).toBeLessThanOrEqual(window.cheapest?.averagePrice ?? 0);
  });

  it('says so when there are not enough prices yet', async () => {
    const r = await json<Cheapest>(
      `/v1/cheapest?zone=DK2&gln=${RADIUS}&hours=2&from=2026-11-05T00:00:00Z`,
    );
    expect(r.cheapest).toBeNull();
    expect(r.message).toContain('Not enough published prices');
  });

  it('only accepts quarter-hour durations', async () => {
    const r = await h.get(`/v1/cheapest?zone=DK2&gln=${RADIUS}&hours=0.3&${day}`);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toContain('multiple of 0.25');
  });
});
