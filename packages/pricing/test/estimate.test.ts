import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  DK_TIME_ZONE,
  estimateCo2,
  estimateSpot,
  HISTORY_DAYS,
  historyClock,
  historyTimes,
  localTime,
  median,
  SLOT_MS,
} from '../src/index.ts';

const tz = DK_TIME_ZONE;
const DAY = 86_400_000;
// Tuesday 3 November 2026, 18:00 in Copenhagen (UTC+1).
const SLOT = Date.UTC(2026, 10, 3, 17, 0);
const clock = historyClock(tz, SLOT, SLOT + SLOT_MS);
const at = (days: number) => clock.before(SLOT, days);

describe('historyClock', () => {
  it('keeps the local wall-clock time across the change back from summer time', () => {
    expect(at(7)).toBe(SLOT - 7 * DAY); // 27 October: winter time
    expect(at(14)).toBe(Date.UTC(2026, 9, 20, 16, 0)); // summer time
  });

  it('lands on the same local time of day, the given number of days earlier', () => {
    const year = Date.UTC(2026, 0, 1);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 365 * 96 }),
        fc.integer({ min: 0, max: 400 }),
        fc.constantFrom(...HISTORY_DAYS),
        fc.constantFrom('Europe/Copenhagen', 'Europe/Oslo', 'Europe/Berlin'),
        (slot, span, days, zone) => {
          const from = year + slot * SLOT_MS;
          const c = historyClock(zone, from, from + span * SLOT_MS);
          const target = from + Math.floor(span / 2) * SLOT_MS;
          const want = localTime(target, zone);
          const got = localTime(c.before(target, days), zone);
          if (got.wallClock.slice(10) === want.wallClock.slice(10)) {
            expect(got.date).toBe(addDays(want.date, -days));
          } else {
            // Only when that time didn't exist on the earlier day (clocks went forward).
            expect(got.date).toBe(addDays(want.date, -days));
            expect(got.hour).toBe(want.hour + 1);
          }
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('lists every day an estimate may read', () => {
    expect(historyTimes(SLOT, clock)).toHaveLength(10);
  });
});

describe('median', () => {
  it('takes the middle value, or the mean of the middle two', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('estimateSpot', () => {
  it('uses the same weekday over four weeks once that history exists', () => {
    const history = new Map([
      [at(7), 1_000_000],
      [at(14), 3_000_000],
      [at(21), 2_000_000],
      [at(28), 9_000_000],
      [at(1), 50_000_000], // ignored: the weekday pattern wins
    ]);
    expect(estimateSpot(SLOT, clock, history)).toBe(2_500_000);
  });

  it('falls back to the last seven days until four weeks exist', () => {
    const history = new Map([
      [at(1), 1_000_001],
      [at(2), 2_000_000],
      [at(7), 4_000_000],
      [at(14), 9_000_000],
    ]);
    expect(estimateSpot(SLOT, clock, history)).toBe(2_000_000);
  });

  it('returns null without any history', () => {
    expect(estimateSpot(SLOT, clock, new Map())).toBeNull();
  });
});

describe('estimateCo2', () => {
  it('averages the last seven days at that time', () => {
    const history = new Map([
      [at(1), 100],
      [at(3), 200],
      [at(14), 900],
    ]);
    expect(estimateCo2(SLOT, clock, history)).toBe(150);
    expect(estimateCo2(SLOT, clock, new Map())).toBeNull();
  });
});
