import { readFileSync } from 'node:fs';
import { localTime } from '@wattslot/pricing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toOutageRows } from '../src/outages/feed.ts';
import { syncOutages } from '../src/outages/store.ts';
import { OUTAGE_COMPANIES } from '../src/outages/suppliers.ts';
import { type Harness, startWorker } from './harness.ts';

// Outages are shown relative to the real clock (the API compares with Date.now()), so the
// incidents here are built relative to now too, as Danish wall-clock times like the portal's.
const MIN = 60_000;
const HOUR = 60 * MIN;
const wall = (offsetMs: number) => localTime(Date.now() + offsetMs, 'Europe/Copenhagen').wallClock;

const RADIUS = '5790000705689';
const N1 = '5790001089030';

function incident(fields: Record<string, unknown>) {
  return {
    created: new Date().toISOString(),
    title: 'Afbrud i Østerbro',
    cause: 'Kabelfejl',
    comment: 'ID 7632.1',
    incidentTypeId: 1,
    incidentType: 'Uvarslet',
    incidentStatusId: 1,
    incidentStatus: 'Aktiv',
    supplierId: 4,
    supplierName: 'Radius Elnet A/S',
    supplierPhone: '(+45) 70 20 58 00',
    effectedCustomers: 120,
    startDate: wall(-30 * MIN),
    endDate: null,
    expectedDowntime: wall(2 * HOUR),
    zipcodes: '2100',
    radius: 312.6,
    centerLat: 55.7,
    centerLng: 12.57,
    ...fields,
  };
}

const ACTIVE = [
  incident({ id: 1 }),
  incident({
    id: 2,
    incidentTypeId: 2,
    supplierId: 18,
    supplierName: 'Elnetselskabet N1',
    zipcodes: '8000',
  }),
  incident({
    id: 3,
    supplierId: 7,
    supplierName: 'Cerius A/S',
    zipcodes: '4000',
    endDate: wall(-30 * MIN),
  }),
  incident({ id: 4, endDate: wall(-5 * HOUR) }), // restored long ago: hidden
  incident({ id: 5, startDate: wall(-3 * 24 * HOUR), expectedDowntime: wall(-2 * 24 * HOUR) }), // stale
  incident({
    id: 6,
    incidentTypeId: 4,
    supplierId: 75,
    supplierName: 'Dansk Energi - Net',
    zipcodes: '5000',
  }),
  { title: 'no id' }, // malformed: skipped
];
const PLANNED = [
  incident({
    id: 10,
    incidentTypeId: 3,
    startDate: wall(24 * HOUR),
    expectedDowntime: wall(28 * HOUR),
  }),
  incident({
    id: 11,
    incidentTypeId: 3,
    startDate: wall(60 * 24 * HOUR),
    expectedDowntime: wall(61 * 24 * HOUR),
  }),
  incident({
    id: 12,
    incidentTypeId: 3,
    startDate: wall(-5 * HOUR),
    expectedDowntime: wall(-1 * HOUR),
  }),
];

interface Body {
  enabled: boolean;
  updatedAt: string | null;
  stale: boolean;
  source: string;
  outages: {
    id: number;
    kind: string;
    start: string | null;
    restored: boolean;
    postcodes: string[];
    location: { lat: number; lng: number; radiusM: number | null } | null;
    gridCompany: { gln: string; name: string } | null;
    supplierName: string;
    cause: string | null;
  }[];
}

describe('outage feed', () => {
  it('reads the portal’s local times, kinds, postcodes and companies', () => {
    const { rows, skipped } = toOutageRows(ACTIVE, 'active');
    expect(skipped).toBe(1);
    const first = rows.find((r) => r.id === 1);
    expect(first?.kind).toBe('unplanned');
    expect(first?.gln).toBe(RADIUS);
    expect(first?.postcodes).toEqual(['2100']);
    expect(first?.radiusM).toBe(313);
    // Wall-clock "now − 30 min" comes back as that instant (to the second it was written).
    expect(Math.abs((first?.startMs ?? 0) - (Date.now() - 30 * MIN))).toBeLessThan(MIN);
    expect(rows.find((r) => r.id === 2)?.gln).toBe(N1);
    expect(rows.find((r) => r.id === 6)).toMatchObject({ kind: 'notice', gln: null });
  });

  it('changes a row’s hash only when its content changes', () => {
    const [a] = toOutageRows(
      [incident({ id: 1, startDate: '2026-11-05T07:00:00' })],
      'active',
    ).rows;
    const [b] = toOutageRows(
      [incident({ id: 1, startDate: '2026-11-05T07:00:00' })],
      'active',
    ).rows;
    const [c] = toOutageRows(
      [incident({ id: 1, startDate: '2026-11-05T07:00:00', effectedCustomers: 121 })],
      'active',
    ).rows;
    expect(a?.hash).toBe(b?.hash);
    expect(a?.hash).not.toBe(c?.hash);
  });

  it('rejects anything that isn’t a list', () => {
    expect(() => toOutageRows({ error: 'nope' }, 'active')).toThrow();
  });
});

describe('outage supplier mapping', () => {
  const seed = JSON.parse(
    readFileSync(new URL('../../../packages/db/seed/grid-companies.json', import.meta.url), 'utf8'),
  ) as { gridCompanies: { gln: string }[] };
  const known = new Set(seed.gridCompanies.map((g) => g.gln));

  it('points every portal supplier at a grid company we know, once', () => {
    for (const c of OUTAGE_COMPANIES) expect(known.has(c.gln), c.gln).toBe(true);
    const ids = OUTAGE_COMPANIES.flatMap((c) => c.supplierIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(OUTAGE_COMPANIES.map((c) => c.gln)).size).toBe(OUTAGE_COMPANIES.length);
  });

  it('has a phone number for every company and only https outage pages', () => {
    for (const c of OUTAGE_COMPANIES) {
      expect(c.phone).toMatch(/^\+45( \d\d){4}$/);
      if (c.page) expect(c.page).toMatch(/^https:\/\//);
    }
  });
});

describe('outages end to end', () => {
  let h: Harness;
  const get = async (path: string) => (await (await h.get(path)).json()) as Body;
  const ids = (b: Body) => b.outages.map((o) => o.id);

  beforeAll(async () => {
    h = await startWorker();
    h.overrides.set('incidents:2', JSON.stringify(ACTIVE));
    h.overrides.set('incidents:3', JSON.stringify(PLANNED));
    await h.tick('01:05');
  }, 60_000);

  afterAll(async () => {
    await h?.dispose();
  });

  it('lists current outages, most serious first, restored ones last', async () => {
    const body = await get('/v1/outages');
    expect(body.enabled).toBe(true);
    expect(body.source).toContain('Green Power Denmark');
    expect(ids(body)).toEqual([1, 2, 6, 3]);
    const first = body.outages[0];
    expect(first?.gridCompany).toEqual({ gln: RADIUS, name: 'Radius Elnet A/S' });
    expect(first?.location).toEqual({ lat: 55.7, lng: 12.57, radiusM: 313 });
    expect(first?.cause).toBe('Kabelfejl');
    expect(body.outages.find((o) => o.id === 3)?.restored).toBe(true);
    expect(body.outages.find((o) => o.id === 6)?.gridCompany).toBeNull();
  });

  it('says when it last fetched, and that it is stale if long ago', async () => {
    const body = await get('/v1/outages');
    // The harness cron runs on 28 Oct 2026, so the last fetch is older than 20 minutes.
    expect(body.updatedAt).toBe('2026-10-28T00:05:00.000Z');
    expect(body.stale).toBe(true);
  });

  it('shows planned work for the next 30 days only', async () => {
    expect(ids(await get('/v1/outages?list=planned'))).toEqual([10]);
    expect(ids(await get('/v1/outages?list=all'))).toEqual([1, 2, 6, 3, 10]);
  });

  it('filters by postcode and grid company', async () => {
    expect(ids(await get('/v1/outages?postcode=2100'))).toEqual([1]);
    expect(ids(await get(`/v1/outages?gln=${N1}`))).toEqual([2]);
    expect(ids(await get(`/v1/outages?gln=${N1},${RADIUS}`))).toEqual([1, 2]);
    expect((await h.get('/v1/outages?postcode=21')).status).toBe(400);
  });

  it('drops an outage once it leaves the portal, and brings it back if it returns', async () => {
    h.overrides.set(
      'incidents:2',
      JSON.stringify(ACTIVE.filter((i) => !('id' in i) || i.id !== 2)),
    );
    await h.tick('01:10');
    expect(ids(await get('/v1/outages?list=all&postcode=8000'))).toEqual([]);
    h.overrides.set('incidents:2', JSON.stringify(ACTIVE));
    await h.tick('01:15');
    expect(ids(await get('/v1/outages?postcode=8000'))).toEqual([2]);
  });

  it('writes nothing when nothing changed', async () => {
    const { rows } = toOutageRows(ACTIVE, 'active');
    expect(await syncOutages(h.db, 'active', rows, Date.now())).toEqual({ written: 0, gone: 0 });
  });
});

describe('outage off switch', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startWorker({ OUTAGES: 'off' });
    await h.tick('00:05');
  }, 60_000);

  afterAll(async () => {
    await h?.dispose();
  });

  it('stops fetching and says the overview is paused', async () => {
    expect(h.calls.some((c) => c.startsWith('incidents'))).toBe(false);
    const body = (await (await h.get('/v1/outages')).json()) as Body;
    expect(body).toMatchObject({ enabled: false, outages: [] });
  });
});
