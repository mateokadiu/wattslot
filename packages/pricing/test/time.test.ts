import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  DK_TIME_ZONE,
  localMidnight,
  localTime,
  SLOT_MS,
  slotsForLocalDate,
  wallClockToUtc,
} from '../src/index.ts';

const tz = DK_TIME_ZONE;

describe('local time in Europe/Copenhagen', () => {
  it('maps UTC instants to local wall-clock time across both offsets', () => {
    expect(localTime(Date.UTC(2026, 9, 27, 23, 0), tz)).toEqual({
      date: '2026-10-28',
      hour: 0,
      minute: 0,
      wallClock: '2026-10-28T00:00:00',
    });
    expect(localTime(Date.UTC(2026, 6, 1, 15, 45), tz).wallClock).toBe('2026-07-01T17:45:00');
  });

  it('finds local midnight in winter and summer', () => {
    expect(localMidnight('2026-10-28', tz)).toBe(Date.UTC(2026, 9, 27, 23));
    expect(localMidnight('2026-07-01', tz)).toBe(Date.UTC(2026, 5, 30, 22));
  });

  it('has 92 slots when clocks spring forward and skips 02:00–03:00', () => {
    const slots = slotsForLocalDate('2026-03-29', tz);
    expect(slots).toHaveLength(92);
    expect(slots.map((s) => localTime(s, tz).hour)).not.toContain(2);
  });

  it('has 100 slots when clocks fall back and repeats 02:00–03:00', () => {
    const slots = slotsForLocalDate('2026-10-25', tz);
    expect(slots).toHaveLength(100);
    expect(slots.filter((s) => localTime(s, tz).hour === 2)).toHaveLength(8);
  });

  it('rejects malformed dates', () => {
    expect(() => slotsForLocalDate('2026-3-29', tz)).toThrow(RangeError);
  });

  it('tiles time exactly: every day is contiguous and days join without gaps', () => {
    const day = fc.integer({ min: 0, max: 365 * 40 }).map((n) => addDays('2000-01-01', n));

    fc.assert(
      fc.property(day, (date) => {
        const slots = slotsForLocalDate(date, tz);
        expect([92, 96, 100]).toContain(slots.length);
        for (let i = 1; i < slots.length; i++) {
          expect((slots[i] as number) - (slots[i - 1] as number)).toBe(SLOT_MS);
        }
        expect(slots.every((s) => localTime(s, tz).date === date)).toBe(true);
        const next = slotsForLocalDate(addDays(date, 1), tz);
        expect(next[0]).toBe((slots.at(-1) as number) + SLOT_MS);
      }),
      { numRuns: 300 },
    );
  });
});

describe('wallClockToUtc', () => {
  const tz = 'Europe/Copenhagen';
  const iso = (ms: number) => new Date(ms).toISOString();

  it('converts winter and summer local times', () => {
    expect(iso(wallClockToUtc('2026-11-05T07:00:00', tz))).toBe('2026-11-05T06:00:00.000Z');
    expect(iso(wallClockToUtc('2027-06-01T07:00', tz))).toBe('2027-06-01T05:00:00.000Z');
  });

  it('takes the first 02:30 when the clocks go back', () => {
    expect(iso(wallClockToUtc('2026-10-25T02:30:00', tz))).toBe('2026-10-25T00:30:00.000Z');
  });

  it('moves a skipped 02:30 an hour on when the clocks go forward', () => {
    expect(iso(wallClockToUtc('2027-03-28T02:30:00', tz))).toBe('2027-03-28T01:30:00.000Z');
  });

  it('round-trips every quarter hour of a year', () => {
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 15 * 60_000) {
      const local = localTime(t, tz).wallClock;
      const back = wallClockToUtc(local, tz);
      // In the repeated hour the earlier instant is returned; everywhere else it's exact.
      expect(localTime(back, tz).wallClock).toBe(local);
      expect(back === t || back === t - 3_600_000).toBe(true);
    }
  });

  it('rejects text that is not a wall-clock time', () => {
    expect(() => wallClockToUtc('5 Nov 2026', tz)).toThrow(RangeError);
  });
});
