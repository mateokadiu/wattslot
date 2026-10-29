// Runs before `next build`: saves today's and tomorrow's prices from the public API, so the
// pages ship them in their HTML (search engines and AI crawlers read that, not the live view).
// With WATTSLOT_PRICES_DIR set, the build uses those recorded responses instead (tests, offline).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FACT_ZONES } from '../src/lib/fact-zones.ts';

const OUT = join(import.meta.dirname, '..', '.prices');
const API = process.env.WATTSLOT_API ?? 'https://wattslot.mateokadiu.com';

if (process.env.WATTSLOT_PRICES_DIR) {
  console.log(`prices: using recorded responses in ${process.env.WATTSLOT_PRICES_DIR}`);
  process.exit(0);
}

const now = new Date();
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Copenhagen',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(now);

mkdirSync(OUT, { recursive: true });
for (const { zone, gln } of Object.values(FACT_ZONES)) {
  const url = `${API}/v1/prices?zone=${zone}&date=${today}&days=2${gln ? `&gln=${gln}` : ''}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`prices: ${url} answered ${response.status}`);
  const body = (await response.json()) as { slots?: { start?: unknown; total?: unknown }[] };
  const valid =
    Array.isArray(body.slots) &&
    body.slots.length > 0 &&
    body.slots.every((s) => typeof s.start === 'string' && typeof s.total === 'number');
  if (!valid) throw new Error(`prices: unexpected response from ${url}`);
  writeFileSync(join(OUT, `${zone}.json`), JSON.stringify(body));
  console.log(`prices: ${zone} ${body.slots?.length} quarter hours`);
}
writeFileSync(
  join(OUT, 'meta.json'),
  JSON.stringify({ date: today, generatedAt: now.toISOString() }),
);
