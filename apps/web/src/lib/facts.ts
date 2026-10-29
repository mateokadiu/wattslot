import { cheapestWindow, SLOT_MS } from '@wattslot/planner';
import { localTime } from '@wattslot/pricing';
import { type Level, priceLevels } from './insights';

/** A quarter hour's all-in price (or spot price, for spot-only areas). */
export interface Quarter {
  startMs: number;
  total: number;
}

export interface Span {
  startMs: number;
  endMs: number;
  /** Average price over the span. */
  average: number;
}

export interface DayFacts {
  average: number;
  /** Cheapest two hours in a row: a dishwasher or washing-machine programme. */
  cheapest2h: Span | null;
  priciestHour: Span | null;
  /** One entry per hour of the local day (23 or 25 on DST days), with its price level. */
  hours: (Span & { level: Level })[];
}

/** A day counts once it's published in full: 92, 96 or 100 quarter hours. */
const MIN_QUARTERS = 92;

/** Facts for one local calendar day, or null if that day isn't fully published. */
export function dayFacts(
  quarters: readonly Quarter[],
  date: string,
  timeZone: string,
): DayFacts | null {
  const day = quarters
    .filter((q) => localTime(q.startMs, timeZone).date === date)
    .sort((a, b) => a.startMs - b.startMs);
  if (day.length < MIN_QUARTERS) return null;

  const hours: Span[] = [];
  for (let i = 0; i < day.length; i += 4) {
    const group = day.slice(i, i + 4);
    hours.push({
      startMs: group[0]?.startMs ?? 0,
      endMs: (group.at(-1)?.startMs ?? 0) + SLOT_MS,
      average: group.reduce((sum, q) => sum + q.total, 0) / group.length,
    });
  }
  const levels = priceLevels(hours.map((h) => ({ startMs: h.startMs, total: h.average })));

  const best = cheapestWindow(
    day.map((q) => ({ startMs: q.startMs, score: q.total })),
    8,
  );
  const priciest = hours.reduce<Span | null>(
    (max, h) => (max === null || h.average > max.average ? h : max),
    null,
  );

  return {
    average: day.reduce((sum, q) => sum + q.total, 0) / day.length,
    cheapest2h: best
      ? {
          startMs: best.slots[0]?.startMs ?? 0,
          endMs: (best.slots.at(-1)?.startMs ?? 0) + SLOT_MS,
          average: best.totalScore / best.slots.length,
        }
      : null,
    priciestHour: priciest,
    hours: hours.map((h) => ({ ...h, level: levels.get(h.startMs) ?? 'normal' })),
  };
}

/** The calendar day after `date` (YYYY-MM-DD). */
export function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
