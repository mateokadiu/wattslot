import { describe, expect, it } from 'vitest';
import {
  clockAt,
  dayAheadTargetDays,
  dueTasks,
  type Task,
  type TaskState,
} from '../src/ingest/schedule.ts';

/** A UTC instant from Danish local time on 28 Oct 2026 (CET, UTC+1). */
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return Date.UTC(2026, 9, 28, h - 1, m);
};
const done = (ms: number): TaskState => ({ lastSuccessAtMs: ms, nextAttemptAtMs: null });
const recent = new Map<Task, TaskState>([
  ['tariffs', done(at('02:00'))],
  ['cleanup', done(at('02:00'))],
]);
const OUTAGE_TASKS: Task[] = ['outages', 'outages_planned'];
/** Due tasks apart from the outage portal's, which have their own test below. */
const due = (hhmm: string, states: Map<Task, TaskState> = recent) =>
  dueTasks(clockAt(at(hhmm)), states).filter((t) => !OUTAGE_TASKS.includes(t));

describe('dueTasks', () => {
  it('polls day-ahead prices every 5 minutes around publication', () => {
    for (const t of ['12:50', '12:55', '13:00', '13:40', '14:30']) {
      expect(due(t)).toContain('day_ahead');
    }
    expect(due('12:45')).not.toContain('day_ahead');
    expect(due('14:35')).not.toContain('day_ahead');
  });

  it('otherwise catches up on day-ahead prices every 30 minutes', () => {
    expect(due('09:00')).toContain('day_ahead');
    expect(due('09:30')).toContain('day_ahead');
    expect(due('09:05')).not.toContain('day_ahead');
  });

  it('fetches CO₂ forecasts on the half hour and actuals a quarter later', () => {
    expect(due('10:00')).toEqual(expect.arrayContaining(['co2_forecast']));
    expect(due('10:30')).toContain('co2_forecast');
    expect(due('10:15')).toEqual(['co2_actual']);
    expect(due('10:45')).toEqual(['co2_actual']);
    expect(due('10:10')).toEqual([]);
  });

  it('refreshes tariffs at 02:00, or straight away when they are over a day old', () => {
    expect(due('02:00', new Map())).toContain('tariffs');
    expect(due('03:10', new Map())).toContain('tariffs');
    expect(due('03:10')).not.toContain('tariffs');
    expect(due('02:00')).toContain('tariffs');
  });

  it('cleans up old data at 03:30, or straight away when it has been missed', () => {
    expect(due('03:30')).toContain('cleanup');
    expect(due('03:35')).not.toContain('cleanup');
    expect(due('10:10', new Map([['tariffs', done(at('02:00'))]]))).toEqual(['cleanup']);
  });

  it('fetches current outages every tick and planned work hourly at :05', () => {
    const planned = new Map(recent).set('outages_planned', done(at('09:05')));
    const outages = (hhmm: string) =>
      dueTasks(clockAt(at(hhmm)), planned).filter((t) => OUTAGE_TASKS.includes(t));
    expect(outages('09:30')).toEqual(['outages']);
    expect(outages('10:05')).toEqual(['outages', 'outages_planned']);
    expect(outages('10:10')).toEqual(['outages']);
    // More than two hours without planned work: fetch it straight away.
    expect(outages('11:20')).toEqual(['outages', 'outages_planned']);
  });

  it('skips a task while it backs off after a rate limit', () => {
    const backingOff = new Map(recent).set('day_ahead', {
      lastSuccessAtMs: null,
      nextAttemptAtMs: at('13:04'),
    });
    expect(due('13:00', backingOff)).not.toContain('day_ahead');
    expect(due('13:05', backingOff)).toContain('day_ahead');
  });
});

describe('dayAheadTargetDays', () => {
  it('wants tomorrow only once prices can have been published', () => {
    expect(dayAheadTargetDays(clockAt(at('12:45')))).toEqual(['2026-10-28']);
    expect(dayAheadTargetDays(clockAt(at('12:50')))).toEqual(['2026-10-28', '2026-10-29']);
  });

  it('uses Danish dates around midnight UTC', () => {
    expect(clockAt(Date.UTC(2026, 9, 27, 23, 30)).today).toBe('2026-10-28');
  });
});
