// Starts the real stack for end-to-end tests: a fresh local D1 with the real migrations,
// filled by running the real ingestion cron against recorded Energi Data Service fixtures,
// then `wrangler dev` serving the built website and the API.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const API = fileURLToPath(new URL('../../api/', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../../../fixtures/eds/', import.meta.url));
const STATE = fileURLToPath(new URL('../.e2e-state/', import.meta.url));
const PORT = process.env.E2E_PORT ?? '8788';
const config = readFileSync(`${API}wrangler.jsonc`, 'utf8');
const databaseId = /"database_id":\s*"([^"]+)"/.exec(config)?.[1];
if (!databaseId) throw new Error('database_id not found in wrangler.jsonc');

rmSync(STATE, { recursive: true, force: true });
const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' };
const migrate = spawnSync(
  'pnpm',
  ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'wattslot', '--local', '--persist-to', STATE],
  { cwd: API, env, stdio: 'inherit' },
);
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const fixtures = {
  DayAheadPrices: 'dayahead-2026-10-28.json',
  CO2EmisProg: 'co2-forecast-2026-10-28-dk2-night.json',
  CO2Emis: 'co2-forecast-2026-10-28-dk2-night.json',
  DatahubPricelist: 'datahub-pricelist-radius-energinet.json',
};
const bundle = await build({
  entryPoints: [`${API}src/index.ts`],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['workerd', 'worker', 'import'],
  target: 'es2022',
  write: false,
  logLevel: 'silent',
});
const mf = new Miniflare({
  modules: true,
  script: bundle.outputFiles[0].text,
  compatibilityDate: '2026-07-01',
  d1Databases: { DB: databaseId },
  d1Persist: `${STATE}v3/d1`,
  outboundService: (request) => {
    const name = fixtures[new URL(request.url).pathname.split('/').pop()];
    return name
      ? new Response(readFileSync(`${FIXTURES}${name}`, 'utf8'), {
          headers: { 'content-type': 'application/json' },
        })
      : new Response('not found', { status: 404 });
  },
});
const worker = await mf.getWorker();
// 00:00 Copenhagen on 28 Oct 2026: ingests the day's prices, the CO₂ forecast and tariffs.
await worker.scheduled({ scheduledTime: new Date('2026-10-27T23:00:00Z'), cron: '*/5 * * * *' });
await mf.dispose();

const dev = spawn(
  'pnpm',
  ['exec', 'wrangler', 'dev', '--port', PORT, '--ip', '127.0.0.1', '--persist-to', STATE],
  { cwd: API, env, stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => dev.kill(signal));
dev.on('exit', (code) => process.exit(code ?? 0));
