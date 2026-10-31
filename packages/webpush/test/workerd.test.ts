import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RFC8291 } from './rfc8291.ts';

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

describe('webpush inside workerd', () => {
  it('reproduces the RFC 8291 example and round-trips a real push request', async () => {
    const body = (await (await mf.dispatchFetch('http://worker/')).json()) as {
      vector: string;
      roundTrip: string;
    };
    expect(body.vector).toBe(RFC8291.body);
    expect(body.roundTrip).toBe('Start nu');
  });
});
