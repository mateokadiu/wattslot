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

// The tests expect pages built from the recorded prices (28 Oct 2026), not today's.
const page = readFileSync(fileURLToPath(new URL('../out/index.html', import.meta.url)), 'utf8');
if (!/datetime="2026-10-28"/i.test(page)) {
  console.error(
    'out/ was built with live prices. Run `pnpm --filter @wattslot/web build:fixtures` first.',
  );
  process.exit(1);
}

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
// The outage portal, faked relative to the real clock: the API shows outages by Date.now().
const wall = (offsetMs) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .format(Date.now() + offsetMs)
    .replace(' ', 'T');
const HOUR = 3_600_000;
const incident = (fields) => ({
  title: 'Afbrud i Østerbro',
  cause: 'Kabelfejl i lavspændingsnettet',
  incidentTypeId: 1,
  supplierId: 4,
  supplierName: 'Radius Elnet A/S',
  effectedCustomers: 120,
  startDate: wall(-HOUR / 2),
  endDate: null,
  expectedDowntime: wall(2 * HOUR),
  zipcodes: '2100',
  radius: 300,
  centerLat: 55.7,
  centerLng: 12.57,
  ...fields,
});
const outages = {
  2: [
    incident({ id: 1 }),
    incident({
      id: 2,
      title: 'Afbrud i Aarhus C',
      incidentTypeId: 2,
      supplierId: 18,
      supplierName: 'Elnetselskabet N1',
      zipcodes: '8000',
    }),
    incident({
      id: 4,
      title: 'Afbrud i Viby J',
      incidentTypeId: 2,
      supplierId: 14,
      supplierName: 'Dinel A/S',
      zipcodes: '8260',
      startDate: wall(48 * HOUR),
      expectedDowntime: wall(51 * HOUR),
    }),
    incident({
      id: 3,
      title: 'Afbrud i Roskilde',
      supplierId: 7,
      supplierName: 'Cerius A/S',
      zipcodes: '4000',
      endDate: wall(-HOUR / 4),
    }),
  ],
  3: [
    incident({
      id: 10,
      title: 'Planlagt arbejde i Østerbro',
      incidentTypeId: 3,
      startDate: wall(24 * HOUR),
      expectedDowntime: wall(28 * HOUR),
    }),
  ],
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
    const url = new URL(request.url);
    if (url.hostname.endsWith('greenpowerdenmark.dk')) {
      return new Response(JSON.stringify(outages[url.searchParams.get('showType')] ?? []), {
        headers: { 'content-type': 'application/json' },
      });
    }
    const name = fixtures[url.pathname.split('/').pop()];
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
// The cron ran "on 28 Oct"; mark the outage fetch as just now so the page isn't flagged stale.
const db = await mf.getD1Database('DB');
await db
  .prepare("update ingest_state set last_success_at_ms = ? where task like 'outages%'")
  .bind(Date.now())
  .run();
await mf.dispose();

const dev = spawn(
  'pnpm',
  ['exec', 'wrangler', 'dev', '--port', PORT, '--ip', '127.0.0.1', '--persist-to', STATE],
  { cwd: API, env, stdio: 'inherit' },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => dev.kill(signal));
dev.on('exit', (code) => process.exit(code ?? 0));
