import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyRate,
  perMwhToMicroPerKwh,
  roundHalfAwayFromZero,
  toMicro,
  toOre,
} from '../src/index.ts';

describe('money', () => {
  it('converts DKK/kWh and DKK/MWh to integer micro-DKK/kWh', () => {
    expect(toMicro(0.955573)).toBe(955_573);
    expect(toMicro(0.008)).toBe(8_000);
    expect(perMwhToMicroPerKwh(1097.123456)).toBe(1_097_123);
    expect(perMwhToMicroPerKwh(-12.5)).toBe(-12_500);
  });

  it('rounds half away from zero, symmetrically', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(Object.is(roundHalfAwayFromZero(-0.4), 0)).toBe(true);
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: 1e9, noNaN: true }), (x) => {
        expect(roundHalfAwayFromZero(-x)).toBe(-roundHalfAwayFromZero(x) || 0);
      }),
    );
  });

  it('applies VAT in basis points and mirrors negative amounts', () => {
    expect(applyRate(1_326_175, 2500)).toBe(331_544);
    fc.assert(
      fc.property(fc.integer({ min: -1e8, max: 1e8 }), (amount) => {
        expect(applyRate(-amount, 2500)).toBe(-applyRate(amount, 2500) || 0);
      }),
    );
  });

  it('rejects rates outside 0–100%', () => {
    expect(() => applyRate(100, -1)).toThrow(RangeError);
    expect(() => applyRate(100, 10_001)).toThrow(RangeError);
    expect(() => applyRate(100, 12.5)).toThrow(RangeError);
  });

  it('rounds to whole øre for display', () => {
    expect(toOre(1_657_719)).toBe(166);
    expect(toOre(-5_000)).toBe(-1);
  });
});
