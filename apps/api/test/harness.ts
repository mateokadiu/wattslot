/**
 * Runs the real Worker bundle in workerd (Miniflare) with a D1 database built from the real
 * migrations, and Energi Data Service replaced by recorded fixtures.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { D1Database } from '@cloudflare/workers-types';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { fixtureText } from './fixtures.js';

const MIGRATIONS = new URL('../../../packages/db/migrations/', import.meta.url);

export function migrationStatements(): string[] {
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

const FIXTURES: Record<string, string> = {
  DayAheadPrices: 'dayahead-2026-10-28.json',
  CO2EmisProg: 'co2-forecast-2026-10-28-dk2-night.json',
  CO2Emis: 'co2-forecast-2026-10-28-dk2-night.json',
  DatahubPricelist: 'datahub-pricelist-radius-energinet.json',
};

export interface Harness {
  mf: Miniflare;
  db: D1Database;
  /** Dataset names requested from Energi Data Service, in order. */
  calls: string[];
  rateLimited: Set<string>;
  /** Fires the cron at a Danish local time on 28 Oct 2026 (CET). */
  tick(hhmm: string): Promise<void>;
  get(path: string): Promise<Response>;
  dispose(): Promise<void>;
}

/** Danish local time on 28 Oct 2026 (CET, UTC+1). */
export const local = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(2026, 9, 28, h - 1, m));
};

export async function startWorker(): Promise<Harness> {
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
  const calls: string[] = [];
  const rateLimited = new Set<string>();
  const mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0]?.text ?? '',
    compatibilityDate: '2026-07-01',
    d1Databases: { DB: `wattslot-${Math.random().toString(36).slice(2)}` },
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
  const db = (await mf.getD1Database('DB')) as unknown as D1Database;
  await db.batch(migrationStatements().map((sql) => db.prepare(sql)));
  return {
    mf,
    db,
    calls,
    rateLimited,
    async tick(hhmm) {
      const worker = await mf.getWorker();
      await worker.scheduled({ scheduledTime: local(hhmm), cron: '*/5 * * * *' });
    },
    get: (path) => mf.dispatchFetch(`http://api${path}`),
    dispose: () => mf.dispose(),
  };
}
