import { addDays, DK_TIME_ZONE, type LocalTime, localTime } from '@wattslot/pricing';

export const TASKS = ['day_ahead', 'co2_forecast', 'co2_actual', 'tariffs', 'cleanup'] as const;
export type Task = (typeof TASKS)[number];

export interface TaskState {
  lastSuccessAtMs: number | null;
  nextAttemptAtMs: number | null;
}

export interface Clock {
  nowMs: number;
  /** Danish local time; every schedule below is in Copenhagen time. */
  local: LocalTime;
  today: string;
  tomorrow: string;
}

export function clockAt(nowMs: number): Clock {
  const local = localTime(nowMs, DK_TIME_ZONE);
  return { nowMs, local, today: local.date, tomorrow: addDays(local.date, 1) };
}

const minuteOfDay = (local: LocalTime) => local.hour * 60 + local.minute;

/** Day-ahead results are published around 12:55; poll closely until 14:30. */
export const PUBLICATION_START = 12 * 60 + 50;
const PUBLICATION_END = 14 * 60 + 30;
const DAY_MS = 86_400_000;

/**
 * Which tasks the 5-minute cron should run now. Each task makes at most one request per
 * dataset, and a task backing off after HTTP 429 is skipped until its next attempt time.
 */
export function dueTasks(clock: Clock, states: ReadonlyMap<Task, TaskState>): Task[] {
  const minute = minuteOfDay(clock.local);
  const inHalfHour = clock.local.minute % 30;
  const due: Record<Task, boolean> = {
    // Close polling around publication; otherwise every 30 minutes as a catch-up.
    day_ahead: (minute >= PUBLICATION_START && minute <= PUBLICATION_END) || inHalfHour < 5,
    co2_forecast: inHalfHour < 5,
    co2_actual: inHalfHour >= 15 && inHalfHour < 20,
    // Nightly at 02:00, or as soon as possible if the last success is over a day old.
    tariffs:
      (clock.local.hour === 2 && clock.local.minute < 5) ||
      (states.get('tariffs')?.lastSuccessAtMs ?? 0) < clock.nowMs - DAY_MS - 3_600_000,
    // Nightly at 03:30, after the tariff refresh, or as soon as possible if it's been missed.
    cleanup:
      (clock.local.hour === 3 && clock.local.minute >= 30 && clock.local.minute < 35) ||
      (states.get('cleanup')?.lastSuccessAtMs ?? 0) < clock.nowMs - DAY_MS - 3_600_000,
  };
  return TASKS.filter((task) => {
    const next = states.get(task)?.nextAttemptAtMs;
    return due[task] && (next === null || next === undefined || next <= clock.nowMs);
  });
}

/** Days whose day-ahead prices we should hold right now: today, and tomorrow once published. */
export function dayAheadTargetDays(clock: Clock): string[] {
  return minuteOfDay(clock.local) >= PUBLICATION_START
    ? [clock.today, clock.tomorrow]
    : [clock.today];
}
