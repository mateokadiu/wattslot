/**
 * Runs the real Worker bundle in workerd (Miniflare) against a D1 database built from the
 * real migrations, so schema, reference data and routes are tested together.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { D1Database } from '@cloudflare/workers-types';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATIONS = new URL('../../../packages/db/migrations/', import.meta.url);

function migrationStatements(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .flatMap((f) => readFileSync(new URL(f, MIGRATIONS), 'utf8').split('--> statement-breakpoint'))
    .map((sql) =>
      sql
        .split('\n')
        .filter((line) => !line.startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((sql) => sql.length > 0);
}

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
    d1Databases: { DB: 'wattslot-test' },
  });
  db = await mf.getD1Database('DB');
  await db.batch(migrationStatements().map((sql) => db.prepare(sql)));
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
});

const get = (path: string) => mf.dispatchFetch(`http://api${path}`);

interface GridCompany {
  gln: string;
  name: string;
  zone: string;
  meteringPoints: number | null;
  supported: boolean;
  note: string | null;
}

describe('api', () => {
  it('answers health checks', async () => {
    const response = await get('/health');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('lists every bidding zone, with full prices only for Denmark', async () => {
    const response = await get('/v1/zones');
    expect(response.headers.get('x-data-source')).toContain('Energinet');
    const { zones } = (await response.json()) as { zones: { code: string; fullPrice: boolean }[] };
    expect(zones.map((z) => z.code)).toEqual(['DE', 'DK1', 'DK2', 'NO2', 'SE3', 'SE4']);
    expect(zones.filter((z) => z.fullPrice).map((z) => z.code)).toEqual(['DK1', 'DK2']);
  });

  it('lists grid companies per zone, largest first', async () => {
    const response = await get('/v1/grid-companies?zone=DK2');
    const { gridCompanies } = (await response.json()) as { gridCompanies: GridCompany[] };
    expect(gridCompanies[0]).toMatchObject({
      name: 'Radius Elnet A/S',
      zone: 'DK2',
      supported: true,
    });
    expect(gridCompanies.every((g) => g.zone === 'DK2')).toBe(true);
    const sizes = gridCompanies.map((g) => g.meteringPoints ?? 0);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  });

  it('explains why a grid company is not supported yet', async () => {
    const { gridCompanies } = (await (await get('/v1/grid-companies')).json()) as {
      gridCompanies: GridCompany[];
    };
    const unsupported = gridCompanies.filter((g) => !g.supported);
    expect(unsupported.length).toBeGreaterThan(0);
    expect(unsupported.every((g) => (g.note ?? '').length > 10)).toBe(true);
  });

  it('lets any site read the public API from a browser, with security headers', async () => {
    const response = await get('/v1/zones');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const preflight = await mf.dispatchFetch('http://api/v1/zones', {
      method: 'OPTIONS',
      headers: { origin: 'https://example.com', 'access-control-request-method': 'GET' },
    });
    expect(preflight.status).toBe(204);
  });

  it('serves repeat requests from the edge cache', async () => {
    const first = await get('/v1/grid-companies?zone=DK1');
    expect(first.headers.get('x-cache')).toBe('MISS');
    await first.arrayBuffer();
    const second = await get('/v1/grid-companies?zone=DK1');
    expect(second.headers.get('x-cache')).toBe('HIT');
    expect(second.headers.get('x-data-source')).toContain('Energinet');
    // A hit carries the remaining lifetime the API asked for, never a longer one, and no
    // internal bookkeeping headers.
    const maxAge = Number(/max-age=(\d+)/.exec(second.headers.get('cache-control') ?? '')?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(3600);
    expect(second.headers.get('x-wattslot-stored-at')).toBeNull();
  });

  it('keeps API responses out of search results, cache hits included', async () => {
    for (const path of ['/health', '/v1/zones', '/v1/zones', '/openapi.json', '/nope']) {
      const response = await get(path);
      expect(response.headers.get('x-robots-tag'), path).toBe('noindex');
      await response.arrayBuffer();
    }
  });

  it('returns JSON for unknown routes', async () => {
    const response = await get('/nope');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('lists a grid company’s current tariff periods by hour', async () => {
    // Tarifmodel 3.0 shape in micro-DKK: low 00–06, high 06–17 and 21–24, peak 17–21.
    const hourly = (low: number, high: number, peak: number) =>
      JSON.stringify(
        Array.from({ length: 24 }, (_, h) => (h < 6 ? low : h >= 17 && h < 21 ? peak : high)),
      );
    const insert = db.prepare(
      `insert into charges (owner_gln, charge_code, charge_type, valid_from, valid_to, hourly_micro)
       values ('5790000705689', 'DT_C_01', 'D03', ?, ?, ?)`,
    );
    await db.batch([
      insert.bind('2020-01-01T00:00:00', '2021-01-01T00:00:00', hourly(1, 2, 3)), // ended
      insert.bind('2021-01-01T00:00:00', '2099-01-01T00:00:00', hourly(106_180, 318_520, 955_570)),
      insert.bind('2099-01-01T00:00:00', null, hourly(90_000, 270_000, 810_000)), // upcoming
    ]);
    const response = await get('/v1/tariffs?gln=5790000705689');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      gridCompany: { name: string; zone: string };
      tariffs: {
        role: string;
        periods: { validFrom: string; validTo: string | null; hourly: number[] }[];
      }[];
    };
    expect(body.gridCompany).toMatchObject({ name: 'Radius Elnet A/S', zone: 'DK2' });
    const periods = body.tariffs.filter((t) => t.role === 'tariff').flatMap((t) => t.periods);
    expect(periods.map((p) => p.validFrom)).toEqual(['2021-01-01T00:00:00', '2099-01-01T00:00:00']);
    expect(periods[0]?.hourly.slice(16, 18)).toEqual([0.31852, 0.95557]);
    for (const period of periods) {
      expect(period.hourly).toHaveLength(24);
      // Tarifmodel 3.0: the evening peak costs more than the night.
      expect(period.hourly[18]).toBeGreaterThan(period.hourly[3] ?? Number.POSITIVE_INFINITY);
      expect(period.validTo === null || period.validTo > period.validFrom).toBe(true);
    }
  });

  it('rejects unknown and malformed grid companies', async () => {
    expect((await get('/v1/tariffs?gln=5790000000000')).status).toBe(404);
    const bad = await get('/v1/tariffs?gln=radius');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('publishes an OpenAPI 3.1 document', async () => {
    const doc = (await (await get('/openapi.json')).json()) as { openapi: string; paths: object };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual([
      '/v1/zones',
      '/v1/grid-companies',
      '/v1/status',
      '/v1/prices',
      '/v1/co2',
      '/v1/cheapest',
      '/v1/tariffs',
      '/v1/outages',
    ]);
  });
});

describe('reference data', () => {
  it('maps at least one tariff to every supported grid company', async () => {
    const { results } = await db
      .prepare(
        `select g.name from grid_companies g
         where g.support = 'supported'
           and not exists (select 1 from tariff_mappings m where m.gln = g.gln and m.role = 'tariff')`,
      )
      .all();
    expect(results).toEqual([]);
  });

  it('covers nearly every Danish metering point with a supported tariff', async () => {
    const row = await db
      .prepare(
        `select sum(case when support = 'supported' then metering_points else 0 end) * 1.0
                / sum(metering_points) as share from grid_companies`,
      )
      .first<{ share: number }>();
    expect(row?.share).toBeGreaterThan(0.99);
  });

  it('passes the foreign key check', async () => {
    const { results } = await db.prepare('PRAGMA foreign_key_check').all();
    expect(results).toEqual([]);
  });
});
