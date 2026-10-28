import type { Co2Emission, DayAheadPrice } from '@wattslot/eds-client';
import { perMwhToMicroPerKwh, SLOT_MS } from '@wattslot/pricing';

export interface ZoneInfo {
  code: string;
  currency: string;
  timeZone: string;
}

export interface SpotRow {
  zone: string;
  slotStartMs: number;
  priceMicro: number;
  priceEurMicro: number;
}

/**
 * Day-ahead rows for known zones, priced in the zone's currency. A DKK price can be missing
 * briefly after publication (EDS converts EUR with the day's exchange rate); those rows are
 * skipped and picked up on the next run.
 */
export function toSpotRows(
  prices: readonly DayAheadPrice[],
  zones: readonly ZoneInfo[],
): SpotRow[] {
  const byCode = new Map(zones.map((z) => [z.code, z]));
  const rows: SpotRow[] = [];
  for (const p of prices) {
    const zone = byCode.get(p.priceArea);
    if (!zone || p.slotStartMs % SLOT_MS !== 0) continue;
    const local = zone.currency === 'DKK' ? p.dkkPerMwh : p.eurPerMwh;
    if (local === null) continue;
    rows.push({
      zone: zone.code,
      slotStartMs: p.slotStartMs,
      priceMicro: perMwhToMicroPerKwh(local),
      priceEurMicro: perMwhToMicroPerKwh(p.eurPerMwh),
    });
  }
  return rows;
}

export interface Co2Row {
  zone: string;
  slotStartMs: number;
  gPerKwh: number;
}

/**
 * Averages 5-minute CO₂ values into the 15-minute slots that pricing and planning use.
 * Only slots with all three 5-minute values are returned, so a half-filled slot never
 * overwrites a complete one.
 */
export function toCo2Slots(rows: readonly Co2Emission[]): Co2Row[] {
  const buckets = new Map<string, { zone: string; slotStartMs: number; values: number[] }>();
  for (const r of rows) {
    const slotStartMs = r.timeMs - (r.timeMs % SLOT_MS);
    const key = `${r.priceArea}|${slotStartMs}`;
    const bucket = buckets.get(key) ?? { zone: r.priceArea, slotStartMs, values: [] };
    bucket.values.push(r.gPerKwh);
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .filter((b) => b.values.length === 3)
    .map((b) => ({
      zone: b.zone,
      slotStartMs: b.slotStartMs,
      gPerKwh: Math.round((b.values.reduce((a, v) => a + v, 0) / 3) * 100) / 100,
    }))
    .sort((a, b) => a.zone.localeCompare(b.zone) || a.slotStartMs - b.slotStartMs);
}

/** Rows whose value differs from what's stored — D1 row writes are the scarce resource. */
export function changedCo2(rows: readonly Co2Row[], stored: ReadonlyMap<string, number>): Co2Row[] {
  return rows.filter((r) => stored.get(`${r.zone}|${r.slotStartMs}`) !== r.gPerKwh);
}
