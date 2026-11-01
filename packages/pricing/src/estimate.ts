import { addDays, localTime, offsetMs, SLOT_MS, wallClockToUtc } from './time.ts';

// Estimates for slots that aren't published yet (§8.4): the day-ahead auction publishes
// tomorrow's prices around 13:00, and CO₂ forecasts reach only to the end of tomorrow.

const DAY_MS = 86_400_000;
const WEEKS = [7, 14, 21, 28];
const WEEK = [1, 2, 3, 4, 5, 6, 7];
/** Days back that an estimate looks at: the last week day by day, then the same weekday. */
export const HISTORY_DAYS = [...WEEK, 14, 21, 28] as const;
const LONGEST = 28;

/**
 * Maps a slot to the same local wall-clock time some days earlier (so 18:00 stays 18:00 across a
 * DST change), for slots in [fromMs, toMs). `Intl` is slow — a few microseconds a call, and an
 * estimate needs thousands of these — so the zone offset is looked up once at each end of the
 * range and, when they differ, the one change in between is found by bisection. Assumes at most
 * one offset change in the range, which holds for ranges under five months in European zones.
 */
export function historyClock(timeZone: string, fromMs: number, toMs: number) {
  const lo = fromMs - (LONGEST + 1) * DAY_MS;
  const hi = toMs;
  const before = offsetMs(lo, timeZone);
  const after = offsetMs(hi, timeZone);
  // The first slot start with the later offset (offsets change on a slot boundary).
  let a = Math.floor(lo / SLOT_MS);
  let b = Math.ceil(hi / SLOT_MS);
  if (before !== after) {
    while (b - a > 1) {
      const mid = Math.floor((a + b) / 2);
      if (offsetMs(mid * SLOT_MS, timeZone) === before) a = mid;
      else b = mid;
    }
  }
  const changeMs = b * SLOT_MS;
  const offset = (ms: number) => (ms < changeMs ? before : after);

  return {
    timeZone,
    before(slotMs: number, days: number): number {
      const wall = slotMs + offset(slotMs) - days * DAY_MS;
      const guess = slotMs - days * DAY_MS;
      const utc = guess + offset(slotMs) - offset(guess);
      if (utc + offset(utc) === wall) return utc;
      // That wall-clock time didn't exist (clocks went forward): ask Intl.
      const t = localTime(slotMs, timeZone);
      return wallClockToUtc(`${addDays(t.date, -days)}${t.wallClock.slice(10)}`, timeZone);
    },
  };
}

export type HistoryClock = ReturnType<typeof historyClock>;

/** Every slot start an estimate for `slotMs` may read, for one batched lookup. */
export function historyTimes(slotMs: number, clock: HistoryClock): number[] {
  return HISTORY_DAYS.map((d) => clock.before(slotMs, d));
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

const lookup = (
  slotMs: number,
  days: readonly number[],
  clock: HistoryClock,
  history: ReadonlyMap<number, number>,
) =>
  days.map((d) => history.get(clock.before(slotMs, d))).filter((v): v is number => v !== undefined);

/**
 * A spot price estimate: the median of the same weekday and time over the last four weeks, or,
 * until four weeks of history exist, the median of that time over the last seven days. Null
 * without any history. `history` maps slot starts to stored prices.
 */
export function estimateSpot(
  slotMs: number,
  clock: HistoryClock,
  history: ReadonlyMap<number, number>,
): number | null {
  const weekly = lookup(slotMs, WEEKS, clock, history);
  const value =
    weekly.length === WEEKS.length ? median(weekly) : median(lookup(slotMs, WEEK, clock, history));
  return value === null ? null : Math.round(value);
}

/** A CO₂ intensity estimate: the average for that time over the last seven days, or null. */
export function estimateCo2(
  slotMs: number,
  clock: HistoryClock,
  history: ReadonlyMap<number, number>,
): number | null {
  const values = lookup(slotMs, WEEK, clock, history);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
