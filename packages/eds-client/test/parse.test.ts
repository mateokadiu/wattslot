import { describe, expect, it } from 'vitest';
import {
  EdsSchemaError,
  EdsTruncatedError,
  parseCo2Emissions,
  parseDatahubPricelist,
  parseDayAheadPrices,
} from '../src/index.js';
import { fixture } from './fixtures.js';

describe('parseDayAheadPrices', () => {
  it('parses a recorded day into 15-minute UTC slots per area', () => {
    const prices = parseDayAheadPrices(fixture('dayahead-2026-10-28.json'));
    const dk2 = prices.filter((p) => p.priceArea === 'DK2');

    expect(dk2).toHaveLength(96);
    // 00:00 Danish time on 28 Oct is 23:00 UTC the day before (CET, UTC+1).
    expect(dk2[0]?.slotStartMs).toBe(Date.UTC(2026, 9, 27, 23, 0));
    for (let i = 1; i < dk2.length; i++) {
      expect((dk2[i]?.slotStartMs ?? 0) - (dk2[i - 1]?.slotStartMs ?? 0)).toBe(15 * 60_000);
    }
    expect(dk2.every((p) => typeof p.dkkPerMwh === 'number')).toBe(true);
  });

  it('has 92 slots on the spring-forward day and 100 on the fall-back day', () => {
    const count = (name: string) =>
      parseDayAheadPrices(fixture(name)).filter((p) => p.priceArea === 'DK1').length;
    expect(count('dayahead-2026-03-29-dst-spring.json')).toBe(92);
    expect(count('dayahead-2026-10-25-dst-fall.json')).toBe(100);
  });

  it('rejects a response whose shape changed', () => {
    const broken = { total: 1, dataset: 'DayAheadPrices', records: [{ TimeUTC: 'x' }] };
    expect(() => parseDayAheadPrices(broken)).toThrow(EdsSchemaError);
  });

  it('rejects timestamps that are not EDS wall-clock format', () => {
    const json = {
      total: 1,
      dataset: 'DayAheadPrices',
      records: [
        {
          TimeUTC: '2026-10-28T00:00:00Z',
          TimeDK: '2026-10-28T01:00:00',
          PriceArea: 'DK1',
          DayAheadPriceEUR: 1,
          DayAheadPriceDKK: 7.46,
        },
      ],
    };
    expect(() => parseDayAheadPrices(json)).toThrow(EdsSchemaError);
  });

  it('detects truncated responses', () => {
    const json = fixture('dayahead-2026-10-28.json') as { total: number };
    expect(() => parseDayAheadPrices({ ...json, total: json.total + 1 })).toThrow(
      EdsTruncatedError,
    );
  });
});

describe('parseCo2Emissions', () => {
  it('parses 5-minute forecast rows', () => {
    const rows = parseCo2Emissions(
      'CO2EmisProg',
      fixture('co2-forecast-2026-10-28-dk2-night.json'),
    );
    expect(rows).toHaveLength(72);
    expect(rows[0]).toEqual({
      timeMs: Date.UTC(2026, 9, 27, 23, 0),
      priceArea: 'DK2',
      gPerKwh: 29,
    });
  });
});

describe('parseDatahubPricelist', () => {
  const charges = parseDatahubPricelist(fixture('datahub-pricelist-radius-energinet.json'));

  it('expands flat charges to the same price in every hour', () => {
    const tax = charges.find((c) => c.code === 'EA-001' && c.validFrom.startsWith('2026'));
    expect(tax?.hourlyDkkPerKwh).toEqual(Array(24).fill(0.008));
    expect(tax?.isTax).toBe(true);
  });

  it('keeps time-of-use tariffs hour by hour', () => {
    const winter = charges.find(
      (c) => c.code === 'DT_C_01' && c.validFrom === '2026-10-01T00:00:00',
    );
    expect(winter?.hourlyDkkPerKwh).toHaveLength(24);
    expect(winter?.hourlyDkkPerKwh[0]).toBe(0.106175); // 00–06 low
    expect(winter?.hourlyDkkPerKwh[12]).toBe(0.318524); // 06–17 high
    expect(winter?.hourlyDkkPerKwh[18]).toBe(0.955573); // 17–21 peak
    expect(winter?.validTo).toBe('2027-04-01T00:00:00');
    expect(winter?.isTax).toBe(false);
  });
});
