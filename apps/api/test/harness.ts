/**
 * Runs the real Worker bundle in workerd (Miniflare) with a D1 database built from the real
 * migrations, and Energi Data Service replaced by recorded fixtures.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { D1Database } from '@cloudflare/workers-types';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { fixtureText } from './fixtures.ts';

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

/** A request the worker sent to the fake push service. */
export interface Push {
  endpoint: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface Harness {
  mf: Miniflare;
  db: D1Database;
  /** Dataset names requested from Energi Data Service, in order. */
  calls: string[];
  /** Full request URLs, to check query filters. */
  urls: URL[];
  rateLimited: Set<string>;
  /** Replaces a dataset's recorded response, e.g. to simulate a withdrawn tariff period. */
  overrides: Map<string, string>;
  /** Messages sent to the fake push service (fcm.googleapis.com), in order. */
  pushes: Push[];
  /** Status the fake push service answers per endpoint (default 201). */
  pushStatus: Map<string, number>;
  /** Fires the cron at a Danish local time on 28 Oct 2026 (CET). */
  tick(hhmm: string): Promise<void>;
  get(path: string): ReturnType<Miniflare['dispatchFetch']>;
  /** Starts the job workflow for a job already in the database. */
  startWorkflow(jobId: string): Promise<void>;
  workflowStatus(jobId: string): Promise<{ status: string; output?: unknown }>;
  dispose(): Promise<void>;
}

/** Danish local time on 28 Oct 2026 (CET, UTC+1). */
export const local = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(2026, 9, 28, h - 1, m));
};

export async function startWorker(bindings: Record<string, string> = {}): Promise<Harness> {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    conditions: ['workerd', 'worker', 'import'],
    target: 'es2022',
    // Workers runtime modules (the Workflows base class) are provided by workerd.
    external: ['cloudflare:*'],
    write: false,
    logLevel: 'silent',
  });
  const calls: string[] = [];
  const urls: URL[] = [];
  const rateLimited = new Set<string>();
  const overrides = new Map<string, string>();
  const pushes: Push[] = [];
  const pushStatus = new Map<string, number>();
  const outboundService = async (request: Request) => {
    const url = new URL(request.url);
    // A fake push service: records each message, answers 201 unless told otherwise.
    if (url.hostname === 'fcm.googleapis.com') {
      pushes.push({
        endpoint: request.url,
        headers: Object.fromEntries(request.headers),
        body: new Uint8Array(await request.arrayBuffer()),
      });
      return new Response(null, { status: pushStatus.get(request.url) ?? 201 });
    }
    // Outage portal lists share a path; tell them apart by showType ("incidents:2").
    const dataset = url.hostname.endsWith('greenpowerdenmark.dk')
      ? `incidents:${url.searchParams.get('showType')}`
      : (url.pathname.split('/').pop() ?? '');
    calls.push(dataset);
    urls.push(url);
    if (rateLimited.has(dataset)) {
      return new Response(fixtureText('error-429.json'), { status: 429 });
    }
    const override = overrides.get(dataset);
    if (override !== undefined) {
      return new Response(override, { headers: { 'content-type': 'application/json' } });
    }
    if (dataset.startsWith('incidents:')) {
      return new Response('[]', { headers: { 'content-type': 'application/json' } });
    }
    const name = FIXTURES[dataset];
    return name
      ? new Response(fixtureText(name), { headers: { 'content-type': 'application/json' } })
      : new Response('unknown dataset', { status: 404 });
  };
  const database = `wattslot-${Math.random().toString(36).slice(2)}`;
  const mf = new Miniflare({
    workers: [
      {
        name: 'api',
        modules: true,
        bindings,
        script: bundle.outputFiles[0]?.text ?? '',
        compatibilityDate: '2026-07-01',
        d1Databases: { DB: database },
        workflows: { JOB_WORKFLOW: { name: 'wattslot-jobs', className: 'JobWorkflow' } },
        outboundService,
      },
      // Lets tests start and inspect job workflows directly, without the API's planning.
      {
        name: 'driver',
        modules: true,
        compatibilityDate: '2026-07-01',
        workflows: {
          JOB_WORKFLOW: { name: 'wattslot-jobs', className: 'JobWorkflow', scriptName: 'api' },
        },
        script: `export default {
          async fetch(request, env) {
            const url = new URL(request.url);
            const id = url.searchParams.get('id');
            if (url.pathname === '/create') {
              await env.JOB_WORKFLOW.create({ id, params: { jobId: id } });
              return new Response('created');
            }
            return Response.json(await (await env.JOB_WORKFLOW.get(id)).status());
          },
        };`,
      },
    ],
  });
  const db = (await mf.getD1Database('DB', 'api')) as unknown as D1Database;
  await db.batch(migrationStatements().map((sql) => db.prepare(sql)));
  return {
    mf,
    db,
    calls,
    urls,
    rateLimited,
    overrides,
    pushes,
    pushStatus,
    async tick(hhmm) {
      const worker = await mf.getWorker('api');
      await worker.scheduled({ scheduledTime: local(hhmm), cron: '*/5 * * * *' });
    },
    get: (path) => mf.dispatchFetch(`http://api${path}`),
    async startWorkflow(jobId) {
      const driver = await mf.getWorker('driver');
      await (await driver.fetch(`http://driver/create?id=${jobId}`)).text();
    },
    async workflowStatus(jobId) {
      const driver = await mf.getWorker('driver');
      return (await (await driver.fetch(`http://driver/status?id=${jobId}`)).json()) as {
        status: string;
        output?: unknown;
      };
    },
    dispose: () => mf.dispose(),
  };
}
