import { parseCo2Emissions } from '@wattslot/eds-client';
import { describe, expect, it } from 'vitest';
import { changedCo2, toCo2Slots, toSpotRows } from '../src/ingest/transform.js';
import { fixture } from './fixtures.js';

const zones = [
  { code: 'DK2', currency: 'DKK', timeZone: 'Europe/Copenhagen' },
  { code: 'DE', currency: 'EUR', timeZone: 'Europe/Berlin' },
];

describe('toSpotRows', () => {
  const slot = Date.UTC(2026, 9, 28, 12);
  it('prices Danish zones in DKK and others in EUR, both per kWh in micro-units', () => {
    const rows = toSpotRows(
      [
        { slotStartMs: slot, priceArea: 'DK2', dkkPerMwh: 1097.12, eurPerMwh: 147.03 },
        { slotStartMs: slot, priceArea: 'DE', dkkPerMwh: 1816.83, eurPerMwh: 243.08 },
      ],
      zones,
    );
    expect(rows).toEqual([
      { zone: 'DK2', slotStartMs: slot, priceMicro: 1_097_120, priceEurMicro: 147_030 },
      { zone: 'DE', slotStartMs: slot, priceMicro: 243_080, priceEurMicro: 243_080 },
    ]);
  });

  it('skips unknown zones, unconverted DKK prices and misaligned slots', () => {
    expect(
      toSpotRows(
        [
          { slotStartMs: slot, priceArea: 'SE9', dkkPerMwh: 1, eurPerMwh: 1 },
          { slotStartMs: slot, priceArea: 'DK2', dkkPerMwh: null, eurPerMwh: 1 },
          { slotStartMs: slot + 60_000, priceArea: 'DE', dkkPerMwh: 1, eurPerMwh: 1 },
        ],
        zones,
      ),
    ).toEqual([]);
  });
});

describe('toCo2Slots', () => {
  const raw = parseCo2Emissions('CO2EmisProg', fixture('co2-forecast-2026-10-28-dk2-night.json'));

  it('averages three 5-minute values into each 15-minute slot', () => {
    const slots = toCo2Slots(raw);
    expect(slots).toHaveLength(24);
    const first3 = raw.slice(0, 3).map((r) => r.gPerKwh);
    expect(slots[0]).toEqual({
      zone: 'DK2',
      slotStartMs: Date.UTC(2026, 9, 27, 23),
      gPerKwh: Math.round((first3.reduce((a, b) => a + b, 0) / 3) * 100) / 100,
    });
  });

  it('drops slots that are missing a 5-minute value', () => {
    expect(toCo2Slots(raw.slice(1))).toHaveLength(23);
  });

  it('only writes slots whose value changed', () => {
    const slots = toCo2Slots(raw);
    const stored = new Map(slots.map((s) => [`${s.zone}|${s.slotStartMs}`, s.gPerKwh]));
    expect(changedCo2(slots, stored)).toEqual([]);
    stored.set(`DK2|${slots[5]?.slotStartMs}`, 999);
    expect(changedCo2(slots, stored)).toEqual([slots[5]]);
  });
});
