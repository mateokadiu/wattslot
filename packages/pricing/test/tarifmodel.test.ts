import { describe, expect, it } from 'vitest';
import { classifyTariffShape, TARIFMODEL_3_BANDS, tarifModel3Shape } from '../src/index.js';

const fromBands = (low: number, high: number, peak: number) =>
  TARIFMODEL_3_BANDS.map((band) => ({ low, high, peak })[band]);

describe('tarifModel3Shape', () => {
  it('recognises Radius winter 2026/27 (DT_C_01)', () => {
    expect(tarifModel3Shape(fromBands(106_175, 318_524, 955_573))).toEqual({
      low: 106_175,
      high: 318_524,
      peak: 955_573,
    });
  });

  it('puts exactly 6 low, 14 high and 4 peak hours in a day', () => {
    const count = (band: string) => TARIFMODEL_3_BANDS.filter((b) => b === band).length;
    expect([count('low'), count('high'), count('peak')]).toEqual([6, 14, 4]);
  });

  it('accepts a flat night-and-day tariff as long as the evening is the peak', () => {
    expect(tarifModel3Shape(fromBands(100, 100, 300))).toEqual({ low: 100, high: 100, peak: 300 });
  });

  it('rejects flat charges, wrong band ordering and broken bands', () => {
    expect(tarifModel3Shape(Array(24).fill(8_000))).toBeNull();
    expect(tarifModel3Shape(fromBands(300, 200, 400))).toBeNull();
    const broken = fromBands(100, 200, 300);
    broken[12] = 250;
    expect(tarifModel3Shape(broken)).toBeNull();
    expect(tarifModel3Shape([1, 2, 3])).toBeNull();
  });
});

describe('classifyTariffShape', () => {
  it('tells Tarifmodel 3.0, flat and other tariffs apart', () => {
    expect(classifyTariffShape(fromBands(60_500, 181_600, 544_900))).toEqual({
      kind: 'tarifmodel3',
      low: 60_500,
      high: 181_600,
      peak: 544_900,
    });
    expect(classifyTariffShape(Array(24).fill(186_400))).toEqual({ kind: 'flat', price: 186_400 });
    // Aal El-Net's weekly tariff: low 00–06, high 06–21, a middle band 21–24 and no evening peak.
    const aal = Array.from({ length: 24 }, (_, h) => (h < 6 ? 38_700 : h < 21 ? 232_500 : 116_300));
    expect(classifyTariffShape(aal)).toEqual({ kind: 'other' });
  });
});
