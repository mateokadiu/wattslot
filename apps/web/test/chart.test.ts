import { describe, expect, it } from 'vitest';
import { niceTicks, type PriceSlot, stackSlot, valueExtent, yScale } from '../src/lib/chart';
import { clock, duration, kwh, price } from '../src/lib/format';

const slot = (parts: Partial<PriceSlot>): PriceSlot => ({
  startMs: 0,
  spot: 0,
  gridTariff: 0,
  tsoTariffs: 0,
  electricityTax: 0,
  vat: 0,
  total: 0,
  ...parts,
});

describe('stackSlot', () => {
  it('stacks positive components upward in a fixed order', () => {
    const segments = stackSlot(slot({ spot: 1.1, gridTariff: 0.1, tsoTariffs: 0.115, vat: 0.33 }));
    expect(segments.map((s) => s.series)).toEqual(['spot', 'gridTariff', 'tsoTariffs', 'vat']);
    expect(segments[0]).toEqual({ series: 'spot', from: 0, to: 1.1 });
    expect(segments.at(-1)?.to).toBeCloseTo(1.645, 9);
  });

  it('draws a negative spot price below zero while fees stack above', () => {
    const segments = stackSlot(slot({ spot: -0.3, gridTariff: 0.1, tsoTariffs: 0.115 }));
    expect(segments.find((s) => s.series === 'spot')).toEqual({
      series: 'spot',
      from: -0.3,
      to: 0,
    });
    expect(segments.find((s) => s.series === 'tsoTariffs')?.to).toBeCloseTo(0.215, 9);
  });
});

describe('niceTicks', () => {
  it('produces round steps that cover the range and include zero', () => {
    expect(niceTicks(0, 4.35)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(niceTicks(-0.3, 2.4)).toEqual([-0.5, 0, 0.5, 1, 1.5, 2, 2.5]);
    expect(niceTicks(0, 0)).toEqual([0]);
  });
});

describe('valueExtent and yScale', () => {
  it('maps the tick range onto the plot area', () => {
    const slots = [slot({ spot: -0.2, gridTariff: 0.5 }), slot({ spot: 3 })];
    expect(valueExtent(slots)).toEqual([-0.2, 3]);
    const y = yScale([0, 1, 2, 3], 10, 110);
    expect(y(0)).toBe(110);
    expect(y(3)).toBe(10);
    expect(y(1.5)).toBe(60);
  });
});

describe('format', () => {
  it('shows times in the zone, not the viewer’s clock', () => {
    expect(clock(Date.UTC(2026, 9, 28, 17), 'Europe/Copenhagen')).toBe('18:00');
  });
  it('formats prices per locale and durations in words', () => {
    expect(price(2.3219, 'en')).toBe('2.32');
    expect(price(2.3219, 'da')).toBe('2,32');
    expect(price(2.3219, 'de')).toBe('2,32');
    expect(price(2.3219, 'nb')).toBe('2,32');
    expect(price(2.3219, 'sv')).toBe('2,32');
    const words = { hour: 'hour', hours: 'hours', min: 'min' };
    expect(duration(2, words)).toBe('2 hours');
    expect(duration(1.5, words)).toBe('1 hour 30 min');
    expect(duration(0.75, words)).toBe('45 min');
    expect(kwh(1.1, 'en')).toBe('1.1');
    expect(kwh(20, 'da')).toBe('20');
    expect(kwh(0.9, 'da')).toBe('0,9');
  });
});
