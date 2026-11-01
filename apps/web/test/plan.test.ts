import { describe, expect, it } from 'vitest';
import { nextLocalTime, powerFor, sameRuns } from '../src/lib/plan';

const tz = 'Europe/Copenhagen';

describe('nextLocalTime', () => {
  it('takes today’s time if it’s still ahead, otherwise tomorrow’s', () => {
    const morning = Date.UTC(2026, 10, 2, 5, 0); // 06:00 in Copenhagen
    expect(nextLocalTime('07:00', tz, morning)).toBe(Date.UTC(2026, 10, 2, 6, 0));
    expect(nextLocalTime('05:00', tz, morning)).toBe(Date.UTC(2026, 10, 3, 4, 0));
  });

  it('follows the local clock across a change of offset', () => {
    // 24 Oct 2026, 22:00 summer time; 07:00 the next morning is winter time.
    expect(nextLocalTime('07:00', tz, Date.UTC(2026, 9, 24, 20, 0))).toBe(
      Date.UTC(2026, 9, 25, 6, 0),
    );
  });
});

describe('powerFor', () => {
  it('never needs more quarter hours than the programme length', () => {
    for (let minutes = 15; minutes <= 240; minutes += 15) {
      for (const wh of [450, 900, 1000, 1100, 2000, 2345]) {
        const w = powerFor(wh, minutes);
        expect(Math.ceil(wh / (w / 4) - 1e-9)).toBe(minutes / 15);
      }
    }
  });
});

describe('sameRuns', () => {
  const run = (start: string) => ({ start, end: `${start}e`, energyWh: 1 });
  const summary = (...starts: string[]) => ({
    runs: starts.map(run),
    cost: 0,
    co2Kg: null,
    estimated: false,
  });
  it('compares the run times only', () => {
    expect(sameRuns(summary('a'), summary('a'))).toBe(true);
    expect(sameRuns(summary('a'), summary('b'))).toBe(false);
    expect(sameRuns(summary('a'), summary('a', 'b'))).toBe(false);
  });
});
