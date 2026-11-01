'use client';

import { addDays, localTime } from '@wattslot/pricing';
import { useMemo } from 'react';
import { PLAN_TEXT, type PlanText } from '@/content/plan';
import { clock, price } from '@/lib/format';
import { dictionaries, LOCALES, type Locale } from '@/lib/i18n';
import type { IcsEvent } from '@/lib/ics';
import type { PlanRun } from '@/lib/plan';

// How plans read, shared by the plan form and My plans.

/** "12,34 kr." for Danish kroner, "1.23 EUR" otherwise. */
export function moneyFormat(locale: Locale, currency: string) {
  const t = dictionaries[locale];
  return (value: number) =>
    currency === 'DKK' ? t.money(price(value, locale)) : `${price(value, locale)} ${currency}`;
}

/** On the price area's clock: the day (null for today, "tomorrow", or a weekday) and the time. */
export function useWhen(locale: Locale, timeZone: string) {
  const p = PLAN_TEXT[locale];
  return useMemo(() => {
    const weekday = new Intl.DateTimeFormat(LOCALES[locale].intl, { weekday: 'long', timeZone });
    const today = localTime(Date.now(), timeZone).date;
    const tomorrow = addDays(today, 1);
    const day = (ms: number) => {
      const date = localTime(ms, timeZone).date;
      return date === today ? null : date === tomorrow ? p.tomorrow : weekday.format(ms);
    };
    return { day, at: (ms: number) => p.at(day(ms), clock(ms, timeZone)) };
  }, [locale, timeZone, p]);
}

export type When = ReturnType<typeof useWhen>;

/** "Start tomorrow 02:45 · done 04:45", or "Charge 01:00–03:15, 04:30–04:45" for several runs. */
export function describeRuns(
  plan: { runs: readonly PlanRun[] },
  p: PlanText,
  when: When,
  timeZone: string,
): string {
  const runs = plan.runs.map((r) => ({ start: Date.parse(r.start), end: Date.parse(r.end) }));
  const [first] = runs;
  if (!first) return '';
  // A run that ends on the day it starts names that day once.
  const sameDay = (r: { start: number; end: number }) =>
    localTime(r.start, timeZone).date === localTime(r.end - 1, timeZone).date;
  if (runs.length === 1) {
    const done = sameDay(first) ? p.at(null, clock(first.end, timeZone)) : when.at(first.end);
    return `${p.start(when.at(first.start))} · ${p.done(done)}`;
  }
  // Runs on the same day as the one before don't repeat the day: "tomorrow 00:00–02:30, 03:00–03:13".
  const span = (r: { start: number; end: number }, i: number) => {
    if (!sameDay(r)) return `${when.at(r.start)}–${when.at(r.end)}`;
    const previous = runs[i - 1];
    const day =
      previous && localTime(previous.end - 1, timeZone).date === localTime(r.start, timeZone).date
        ? null
        : when.day(r.start);
    return p.span(day, clock(r.start, timeZone), clock(r.end, timeZone));
  };
  return `${p.charge} ${runs.map(span).join(', ')}`;
}

/** A saved plan's calendar events: one per run, titled by what to do. */
export function planEvents(
  job: {
    id: string;
    task: keyof PlanText['events'];
    plan: { version: number; runs: readonly PlanRun[]; cost: number };
  },
  locale: Locale,
  money: (value: number) => string,
): IcsEvent[] {
  const p = PLAN_TEXT[locale];
  const url = `${window.location.origin}${LOCALES[locale].path}`;
  return job.plan.runs.map((run, i) => ({
    uid: `${job.id}-${i}@${window.location.hostname}`,
    sequence: job.plan.version,
    startMs: Date.parse(run.start),
    endMs: Date.parse(run.end),
    title: p.events[job.task],
    description: p.eventNote(money(job.plan.cost)),
    url,
  }));
}
