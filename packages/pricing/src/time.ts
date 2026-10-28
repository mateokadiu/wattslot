export const SLOT_MINUTES = 15;
export const SLOT_MS = SLOT_MINUTES * 60_000;

export interface LocalTime {
  /** `YYYY-MM-DD` in the zone. */
  date: string;
  /** 0–23. On a fall-back day the repeated hour appears twice. */
  hour: number;
  minute: number;
  /** `YYYY-MM-DDTHH:mm:ss`, the same format EDS uses for tariff validity. */
  wallClock: string;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function wallParts(utcMs: number, timeZone: string) {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(utcMs)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function localTime(utcMs: number, timeZone: string): LocalTime {
  const w = wallParts(utcMs, timeZone);
  const date = `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
  return {
    date,
    hour: w.hour,
    minute: w.minute,
    wallClock: `${date}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`,
  };
}

/** Zone offset at an instant, in ms (Copenhagen: +1h in winter, +2h in summer). */
function offsetMs(utcMs: number, timeZone: string): number {
  const w = wallParts(utcMs, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

function parseDate(date: string): [number, number, number] {
  const m = DATE.exec(date);
  if (!m) throw new RangeError(`expected YYYY-MM-DD, got ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parseDate(date);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(next.getUTCFullYear(), 4)}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** The UTC instant of local midnight starting `date` in `timeZone`. */
export function localMidnight(date: string, timeZone: string): number {
  const [y, m, d] = parseDate(date);
  const wall = Date.UTC(y, m - 1, d);
  // Two passes: the offset at the guess may differ from the offset at the wall time.
  let utc = wall - offsetMs(wall, timeZone);
  utc = wall - offsetMs(utc, timeZone);
  const check = localTime(utc, timeZone);
  if (check.date !== date || check.hour !== 0 || check.minute !== 0) {
    throw new RangeError(`no local midnight on ${date} in ${timeZone}`);
  }
  return utc;
}

/**
 * Every 15-minute slot start (UTC ms) that falls on `date` in `timeZone`:
 * 96 on a normal day, 92 when clocks spring forward, 100 when they fall back.
 */
export function slotsForLocalDate(date: string, timeZone: string): number[] {
  const start = localMidnight(date, timeZone);
  const end = localMidnight(addDays(date, 1), timeZone);
  const slots: number[] = [];
  for (let t = start; t < end; t += SLOT_MS) slots.push(t);
  return slots;
}
