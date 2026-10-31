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

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * The UTC instant of a local wall-clock time ("2026-11-05T07:00[:00]"). In the hour that
 * repeats when clocks go back, the first (summer-time) occurrence; in the hour skipped when
 * they go forward, the instant one hour later on the wall clock.
 */
export function wallClockToUtc(wallClock: string, timeZone: string): number {
  const m = WALL_CLOCK.exec(wallClock);
  if (!m) throw new RangeError(`expected YYYY-MM-DDTHH:MM, got ${wallClock}`);
  const wall = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
  );
  // A zone's offset changes at most once a day here, so the offsets a day either side are the
  // only ones that can apply; keep the candidates that map back to the same wall clock.
  const candidates = [
    ...new Set([-86_400_000, 0, 86_400_000].map((d) => wall - offsetMs(wall + d, timeZone))),
  ];
  const exact = candidates
    .filter((utc) => utc + offsetMs(utc, timeZone) === wall)
    .sort((a, b) => a - b)[0];
  return exact ?? Math.max(...candidates);
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
