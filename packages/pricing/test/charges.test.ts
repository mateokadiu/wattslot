import { describe, expect, it } from 'vitest';
import {
  type Charge,
  chargeFromDkk,
  MissingChargeError,
  OverlappingChargeError,
  sumCharges,
} from '../src/index.js';

const at = (wallClock: string, hour: number) => ({
  date: wallClock.slice(0, 10),
  hour,
  minute: 0,
  wallClock,
});

const flat = (code: string, value: number, validFrom: string, validTo: string | null) =>
  chargeFromDkk({
    ownerGln: 'G',
    code,
    validFrom,
    validTo,
    hourlyDkkPerKwh: Array(24).fill(value),
  });

describe('chargeFromDkk', () => {
  it('needs 24 hourly prices and a sane validity window', () => {
    const base = { ownerGln: 'G', code: 'X', validFrom: '2026-01-01T00:00:00', validTo: null };
    expect(() => chargeFromDkk({ ...base, hourlyDkkPerKwh: [1] })).toThrow(RangeError);
    expect(() =>
      chargeFromDkk({
        ...base,
        validTo: '2025-01-01T00:00:00',
        hourlyDkkPerKwh: Array(24).fill(1),
      }),
    ).toThrow(RangeError);
    expect(() =>
      chargeFromDkk({ ...base, validFrom: '2026-01-01', hourlyDkkPerKwh: Array(24).fill(1) }),
    ).toThrow(RangeError);
  });
});

describe('sumCharges', () => {
  const tou: Charge = chargeFromDkk({
    ownerGln: 'G',
    code: 'TOU',
    validFrom: '2026-10-01T00:00:00',
    validTo: '2027-04-01T00:00:00',
    hourlyDkkPerKwh: Array.from({ length: 24 }, (_, h) => (h >= 17 && h < 21 ? 0.9 : 0.1)),
  });

  it('picks the hour of the local wall clock', () => {
    expect(sumCharges([tou], at('2026-11-02T18:15:00', 18))).toBe(900_000);
    expect(sumCharges([tou], at('2026-11-02T03:00:00', 3))).toBe(100_000);
  });

  it('treats validFrom as inclusive and validTo as exclusive', () => {
    const before = flat('A', 1, '2026-01-01T00:00:00', '2027-01-01T00:00:00');
    const after = flat('A', 2, '2027-01-01T00:00:00', null);
    expect(sumCharges([before, after], at('2026-12-31T23:45:00', 23))).toBe(1_000_000);
    expect(sumCharges([before, after], at('2027-01-01T00:00:00', 0))).toBe(2_000_000);
  });

  it('adds distinct charges together', () => {
    const a = flat('A', 0.043, '2026-01-01T00:00:00', null);
    const b = flat('B', 0.072, '2026-01-01T00:00:00', null);
    expect(sumCharges([a, b], at('2026-06-01T12:00:00', 12))).toBe(115_000);
  });

  it('refuses to price a gap as zero', () => {
    expect(() => sumCharges([tou], at('2027-05-01T12:00:00', 12))).toThrow(MissingChargeError);
  });

  it('refuses overlapping periods of the same charge', () => {
    const a = flat('A', 1, '2026-01-01T00:00:00', null);
    const b = flat('A', 2, '2026-06-01T00:00:00', null);
    expect(() => sumCharges([a, b], at('2026-07-01T00:00:00', 0))).toThrow(OverlappingChargeError);
  });

  it('is zero when there are no charges at all', () => {
    expect(sumCharges([], at('2026-07-01T00:00:00', 0))).toBe(0);
  });
});
