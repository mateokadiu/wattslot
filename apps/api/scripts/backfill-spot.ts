/**
 * Fills in day-ahead prices the cron missed (an ingest outage), as SQL for D1. The rows are the
 * ones the cron would have written (same transform); rows already stored are left alone, and a
 * day with any zone incomplete is refused rather than half-filled.
 *
 *   pnpm exec tsx scripts/backfill-spot.ts 2026-11-06 [last day] > backfill.sql
 *   pnpm exec wrangler d1 execute wattslot --remote --file backfill.sql
 *
 * Data: Source: Energinet (www.energidataservice.dk), CC BY 4.0.
 */
import { createEdsClient } from '@wattslot/eds-client';
import { addDays, DK_TIME_ZONE, localMidnight } from '@wattslot/pricing';
import { type SpotRow, toSpotRows, type ZoneInfo } from '../src/ingest/transform.ts';

const API = process.env.WATTSLOT_API ?? 'https://wattslot.mateokadiu.com';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ROWS_PER_STATEMENT = 100;

const [first = '', last = first] = process.argv.slice(2);
if (!DATE.test(first) || !DATE.test(last) || last < first) {
  console.error('usage: tsx scripts/backfill-spot.ts <first day> [last day]   (YYYY-MM-DD)');
  process.exit(1);
}

// The cron reads the zones from D1; the public API lists the same table.
const response = await fetch(`${API}/v1/zones`);
if (!response.ok) throw new Error(`zones: ${API} answered ${response.status}`);
const { zones } = (await response.json()) as { zones: ZoneInfo[] };
// Zone codes end up in SQL literals below.
if (zones.length === 0 || !zones.every((z) => /^[A-Z0-9]+$/.test(z.code))) {
  throw new Error('zones: unexpected list');
}

const end = addDays(last, 1);
const eds = createEdsClient({
  userAgent: 'wattslot backfill (github.com/mateokadiu/wattslot)',
  rateLimitRetries: 3,
  retryWaitBudgetSeconds: 120,
});
const rows = toSpotRows(await eds.dayAheadPrices({ start: first, end }), zones);

// Days are Danish days, as the cron counts them.
for (let day = first; day < end; day = addDays(day, 1)) {
  const from = localMidnight(day, DK_TIME_ZONE);
  const to = localMidnight(addDays(day, 1), DK_TIME_ZONE);
  for (const zone of zones) {
    const n = rows.filter(
      (r) => r.zone === zone.code && r.slotStartMs >= from && r.slotStartMs < to,
    ).length;
    if (n !== (to - from) / 900_000) {
      throw new Error(`${day} ${zone.code}: ${n} quarter hours, refusing to write a partial day`);
    }
  }
}

const nowMs = Date.now();
const values = (r: SpotRow) =>
  `('${r.zone}', ${r.slotStartMs}, ${r.priceMicro}, ${r.priceEurMicro}, 'eds', ${nowMs})`;
for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
  const chunk = rows.slice(i, i + ROWS_PER_STATEMENT);
  console.log(
    `INSERT INTO spot_prices (zone, slot_start_ms, price_micro, price_eur_micro, source, ingested_at_ms) VALUES\n${chunk.map(values).join(',\n')}\nON CONFLICT (zone, slot_start_ms) DO NOTHING;`,
  );
}
console.error(`backfill: ${rows.length} rows for ${zones.length} zones, ${first} to ${last}`);
