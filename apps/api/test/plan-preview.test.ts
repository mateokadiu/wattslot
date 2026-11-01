import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../src/ingest/store.ts';
import { type PreviewRequest, planPreview, WindowTooShortError } from '../src/plans/preview.ts';
import { type Harness, local, startWorker } from './harness.ts';

// The preview against the real worker and real migrations: 28 Oct 2026 as recorded (prices,
// tariffs and a night's CO₂ forecast), plus four weeks of made-up history for DK2 so that
// 29 Oct — not published at 10:00 — has estimates.

let h: Harness;
const RADIUS = '5790000705689';
const NOW = local('10:00').getTime();
const DAY = 86_400_000;
/** 29 Oct 2026, 00:00 and 07:00 in Copenhagen (UTC+1). */
const MIDNIGHT = Date.UTC(2026, 9, 28, 23);
const SEVEN = MIDNIGHT + 7 * 3_600_000;

/** History: 0.20 DKK/kWh from midnight to 05:00 local, 1.50 otherwise. */
const historyPrice = (ms: number) => ((ms + 3_600_000) % DAY < 5 * 3_600_000 ? 200_000 : 1_500_000);

beforeAll(async () => {
  h = await startWorker();
  await h.db.prepare("delete from price_zones where code not in ('DK1', 'DK2')").run();
  await h.tick('00:00'); // 28 Oct prices, tariffs and the CO₂ forecast
  const rows: [number, number][] = [];
  for (let t = MIDNIGHT - 29 * DAY; t < MIDNIGHT - DAY; t += 900_000) {
    rows.push([t, historyPrice(t)]);
  }
  await h.db
    .prepare(
      `INSERT INTO spot_prices (zone, slot_start_ms, price_micro, price_eur_micro, source)
       SELECT 'DK2', value ->> '$[0]', value ->> '$[1]', 0, 'test' FROM json_each(?)`,
    )
    .bind(JSON.stringify(rows))
    .run();
}, 60_000);

afterAll(async () => {
  await h?.dispose();
});

const ev: PreviewRequest = {
  zone: 'DK2',
  gln: RADIUS,
  markup: 0,
  energyWh: 20_000,
  maxPowerW: 7_400,
  contiguous: false,
  deadlineMs: SEVEN,
  co2Price: 1,
};
const preview = (req: Partial<PreviewRequest>) =>
  planPreview(openDb(h.db), h.db, { ...ev, ...req }, NOW);
const energy = (runs: { energyWh: number }[]) => runs.reduce((sum, r) => sum + r.energyWh, 0);

describe('plan preview', () => {
  it('plans an overnight EV charge three ways, with tomorrow estimated', async () => {
    const p = await preview({});
    expect(p.priced.mode).toBe('full');
    expect(p.fromMs).toBe(NOW);
    expect(p.toMs).toBe(SEVEN);
    expect(p.estimatedFromMs).toBe(MIDNIGHT);
    expect(p.options.map((o) => o.kind)).toEqual(['cheapest', 'balanced', 'greenest']);
    for (const o of p.options) {
      expect(energy(o.runs)).toBeCloseTo(20_000, -1);
      for (const r of o.runs) {
        expect(Date.parse(r.start)).toBeGreaterThanOrEqual(NOW);
        expect(Date.parse(r.end)).toBeLessThanOrEqual(SEVEN);
      }
    }
    const [cheapest, balanced, greenest] = p.options as [
      (typeof p.options)[0],
      (typeof p.options)[0],
      (typeof p.options)[0],
    ];
    // Each option is best at what it optimises; balanced sits between the other two.
    const tolerance = 0.01;
    expect(cheapest.cost).toBeLessThanOrEqual(balanced.cost + tolerance);
    expect(balanced.cost).toBeLessThanOrEqual(greenest.cost + tolerance);
    expect(greenest.co2Kg as number).toBeLessThanOrEqual((balanced.co2Kg as number) + 0.001);
    expect(balanced.co2Kg as number).toBeLessThanOrEqual((cheapest.co2Kg as number) + 0.001);
    // The made-up history makes 00:00–05:00 cheap, so the cheapest charge is estimated.
    expect(cheapest.estimated).toBe(true);
    expect(Date.parse(cheapest.runs[0]?.start ?? '')).toBeGreaterThanOrEqual(MIDNIGHT);
  });

  it('compares with starting now and with a midnight timer', async () => {
    const p = await preview({});
    const cheapest = p.options[0];
    expect(p.baselines.startNow?.runs[0]?.start).toBe(new Date(NOW).toISOString());
    expect(p.baselines.midnight?.start).toBe(new Date(MIDNIGHT).toISOString());
    expect(p.baselines.startNow?.cost).toBeGreaterThanOrEqual(cheapest?.cost ?? Infinity);
    expect(p.baselines.midnight?.cost).toBeGreaterThanOrEqual(cheapest?.cost ?? Infinity);
  });

  it('keeps a programme that can’t pause in one run', async () => {
    const p = await preview({ energyWh: 1_100, maxPowerW: 550, contiguous: true });
    for (const o of p.options) {
      expect(o.runs).toHaveLength(1);
      const run = o.runs[0] as (typeof o.runs)[0];
      expect(Date.parse(run.end) - Date.parse(run.start)).toBe(2 * 3_600_000);
    }
  });

  it('starts at the next quarter hour and never in the past', async () => {
    const p = await preview({ earliestMs: NOW - DAY });
    expect(p.fromMs).toBe(NOW);
    const later = await planPreview(openDb(h.db), h.db, ev, NOW + 60_000);
    expect(later.fromMs).toBe(NOW + 900_000);
  });

  it('offers only the cheapest option without CO₂ data', async () => {
    const p = await preview({ zone: 'DK1', gln: undefined });
    expect(p.priced.mode).toBe('spot-only');
    expect(p.options.map((o) => o.kind)).toEqual(['cheapest']);
    expect(p.options[0]?.co2Kg).toBeNull();
    // DK1 has one day of history (today), so tomorrow is estimated from that day alone.
    expect(p.estimatedFromMs).toBe(MIDNIGHT);
  });

  it('plans only the published part of a window it can’t estimate', async () => {
    await h.db.prepare("delete from spot_prices where zone = 'DK1'").run();
    const p = await preview({ zone: 'DK1', gln: undefined });
    expect(p.options).toEqual([]);
    expect(p.estimatedFromMs).toBeNull();
  });

  it('refuses a window that can’t hold the load', async () => {
    await expect(preview({ deadlineMs: NOW + 3_600_000 })).rejects.toThrow(WindowTooShortError);
  });
});

describe('POST /v1/plan-preview', () => {
  const post = (body: unknown) =>
    h.mf.dispatchFetch('http://api/v1/plan-preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
  const body = { zone: 'DK2', energyWh: 20_000, maxPowerW: 7_400, contiguous: false };

  it('rejects deadlines in the past or more than 48 hours ahead', async () => {
    for (const deadline of [inHours(-1), inHours(50)]) {
      const response = await post({ ...body, deadline });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe('invalid_request');
    }
  });

  it('rejects malformed bodies', async () => {
    const response = await post({ ...body, energyWh: 0, deadline: inHours(5) });
    expect(response.status).toBe(400);
  });

  it('answers 422 when the window is too short', async () => {
    const response = await post({ ...body, deadline: inHours(1) });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toBe('window_too_short');
  });

  it('plans from estimates when nothing ahead is published', async () => {
    // The made-up history ends weeks before the real clock's today, so every slot is estimated.
    const response = await post({ ...body, deadline: inHours(24) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const json = (await response.json()) as {
      provisional: boolean;
      options: { kind: string }[];
      message: string | null;
    };
    expect(json.provisional).toBe(true);
    expect(json.options.map((o) => o.kind)).toEqual(['cheapest', 'balanced', 'greenest']);
    expect(json.message).toBeNull();
  });

  it('says so when it can’t plan at all', async () => {
    const response = await post({ ...body, zone: 'DK1', deadline: inHours(24) });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { options: unknown[]; message: string | null };
    expect(json.options).toEqual([]);
    expect(json.message).not.toBeNull();
  });

  it('allows the POST from other sites', async () => {
    const response = await h.mf.dispatchFetch('http://api/v1/plan-preview', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://example.com',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });
});
