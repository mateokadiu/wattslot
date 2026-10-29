// Runs before `next build`: saves today's and tomorrow's prices, the grid companies and their
// tariffs from the public API, so the pages ship them in their HTML (search engines and AI
// crawlers read that, not the live view). With WATTSLOT_PRICES_DIR set, the build uses those
// recorded responses instead (tests, offline).
//
// Recording fixtures: WATTSLOT_DATE=2026-10-28 WATTSLOT_PRICES_OUT=e2e/fixtures/prices node scripts/fetch-prices.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FACT_ZONES } from '../src/lib/fact-zones.ts';

const OUT = process.env.WATTSLOT_PRICES_OUT
  ? resolve(process.env.WATTSLOT_PRICES_OUT)
  : join(import.meta.dirname, '..', '.prices');
const API = process.env.WATTSLOT_API ?? 'https://wattslot.mateokadiu.com';
/** The edge allows 30 requests per 10 s per address; stay well under it. */
const SPACING_MS = 400;

if (process.env.WATTSLOT_PRICES_DIR) {
  console.log(`prices: using recorded responses in ${process.env.WATTSLOT_PRICES_DIR}`);
  process.exit(0);
}

const now = new Date();
const today =
  process.env.WATTSLOT_DATE ??
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get<T>(path: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await sleep(SPACING_MS);
    const response = await fetch(`${API}${path}`);
    if (response.status === 429 && attempt < 3) {
      await sleep((Number(response.headers.get('retry-after')) || 10) * 1000);
      continue;
    }
    if (!response.ok) throw new Error(`prices: ${path} answered ${response.status}`);
    return (await response.json()) as T;
  }
}

interface PricesBody {
  zone: string;
  currency: string;
  mode: string;
  note: string | null;
  gridCompany: { gln: string; name: string } | null;
  slots: { start: string; total: number }[];
}

/** Only what the pages use, so recorded fixtures stay small. */
async function prices(zone: string, gln?: string) {
  const body = await get<PricesBody>(
    `/v1/prices?zone=${zone}&date=${today}&days=2${gln ? `&gln=${gln}` : ''}`,
  );
  const valid =
    Array.isArray(body.slots) &&
    body.slots.length > 0 &&
    body.slots.every((s) => typeof s.start === 'string' && typeof s.total === 'number');
  if (!valid) throw new Error(`prices: unexpected response for ${zone} ${gln ?? ''}`);
  return {
    zone: body.zone,
    currency: body.currency,
    mode: body.mode,
    note: body.note,
    gridCompany: body.gridCompany,
    slots: body.slots.map((s) => ({ start: s.start, total: s.total })),
  };
}

const save = (file: string, data: unknown) => writeFileSync(join(OUT, file), JSON.stringify(data));

mkdirSync(OUT, { recursive: true });
for (const { zone, gln } of Object.values(FACT_ZONES)) {
  const body = await prices(zone, gln);
  save(`${zone}.json`, body);
  console.log(`prices: ${zone} ${body.slots.length} quarter hours`);
}

const { gridCompanies } = await get<{
  gridCompanies: { gln: string; zone: string; supported: boolean }[];
}>('/v1/grid-companies');
save('grid-companies.json', { gridCompanies });
const supported = gridCompanies.filter((g) => g.supported);
for (const g of supported) {
  save(`company-${g.gln}.json`, await prices(g.zone, g.gln));
  save(`tariffs-${g.gln}.json`, await get(`/v1/tariffs?gln=${g.gln}`));
}
console.log(`prices: ${supported.length} grid companies with prices and tariffs`);

save('meta.json', { date: today, generatedAt: now.toISOString() });
