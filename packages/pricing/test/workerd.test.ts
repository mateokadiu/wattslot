/**
 * Runs the pricing and EDS packages inside workerd via Miniflare, proving they need nothing
 * Node-specific (time zones, Intl, integer maths all behave the same on Cloudflare Workers).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../fixtures/eds/${name}`, import.meta.url), 'utf8'));

let mf: Miniflare;

beforeAll(async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./workerd/worker.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0]?.text ?? '',
    compatibilityDate: '2026-07-01',
  });
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
});

async function priceDay(date: string, dayAheadFixture: string) {
  const response = await mf.dispatchFetch('http://worker/', {
    method: 'POST',
    body: JSON.stringify({
      date,
      dayAhead: fixture(dayAheadFixture),
      pricelist: fixture('datahub-pricelist-radius-energinet.json'),
    }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { slots: number; totalsOre: number[] };
}

describe('pricing inside workerd', () => {
  it('reproduces the 28 Oct 2026 worked example: 1.66 at 00:00, 4.35 at 18:00', async () => {
    const day = await priceDay('2026-10-28', 'dayahead-2026-10-28.json');
    expect(day.slots).toBe(96);
    expect(day.totalsOre[0]).toBe(166);
    expect(day.totalsOre[18 * 4]).toBe(435);
  });

  it('gets the daylight-saving days right in Cloudflare time-zone data', async () => {
    expect((await priceDay('2026-10-25', 'dayahead-2026-10-25-dst-fall.json')).slots).toBe(100);
    expect((await priceDay('2026-03-29', 'dayahead-2026-03-29-dst-spring.json')).slots).toBe(92);
  });
});
