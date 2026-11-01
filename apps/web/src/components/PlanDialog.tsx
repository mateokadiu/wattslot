'use client';

import { addDays, localTime } from '@wattslot/pricing';
import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PLAN_TEXT } from '@/content/plan';
import type { Zone } from '@/lib/api';
import { clock, duration, price } from '@/lib/format';
import { dictionaries, LOCALES, type Locale } from '@/lib/i18n';
import { slotsFor, type Task } from '@/lib/insights';
import {
  fetchPlan,
  nextLocalTime,
  type PlanPreview,
  type PlanResult,
  type PlanSummary,
  powerFor,
  sameRuns,
} from '@/lib/plan';

// The "Plan" form (PLAN.md §17.7): what to run and by when, then three ways to do it. Loaded on
// first use, so the live view doesn't pay for it. Nothing is stored.

const HOUR_MS = 3_600_000;
const QUARTER_MS = 900_000;
const LENGTHS = [30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240];
const EV_POWERS = [3.7, 7.4, 11];
/** A "plugged in from" time up to this far back means "already plugged in": start now. */
const RECENT_MS = 12 * HOUR_MS;

const field =
  'h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3.5 text-sm tabular-nums';
const pill =
  'rounded-md px-3 py-1.5 text-sm transition-colors aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)]';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
  task: Task;
  zone: Zone;
  /** Grid company for full prices; null for spot prices only. */
  gln: string | null;
}

/** The next quarter hour on the zone's clock, as HH:MM. */
const nextQuarter = (nowMs: number, timeZone: string) =>
  clock(Math.ceil(nowMs / QUARTER_MS) * QUARTER_MS, timeZone);

export default function PlanDialog({ open, onOpenChange, locale, task, zone, gln }: Props) {
  const p = PLAN_TEXT[locale];
  const t = dictionaries[locale];
  const ids = useId();
  const ev = task.id === 'ev';
  const timeZone = zone.timeZone;

  const [kwhValue, setKwhValue] = useState(String(task.energyKwh));
  const [minutes, setMinutes] = useState(slotsFor(task) * 15);
  const [powerKw, setPowerKw] = useState(task.powerKw);
  const [from, setFrom] = useState(() => nextQuarter(Date.now(), timeZone));
  const [by, setBy] = useState('07:00');
  const [mayPause, setMayPause] = useState(task.canPause);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PlanResult | null>(null);

  const money = (value: number) =>
    zone.currency === 'DKK'
      ? t.money(price(value, locale))
      : `${price(value, locale)} ${zone.currency}`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const energyWh = Math.round(Number(kwhValue.replace(',', '.')) * 1000);
    if (!(energyWh > 0)) return;
    const maxPowerW = ev ? Math.round(powerKw * 1000) : powerFor(energyWh, minutes);
    const nowMs = Date.now();
    const earliestMs = ev
      ? Math.max(nowMs, nextLocalTime(from, timeZone, nowMs - RECENT_MS))
      : nowMs;
    // "Done by 07:00" is the next 07:00; if the load doesn't fit before it, the answer says so.
    const deadlineMs = nextLocalTime(by, timeZone, earliestMs + QUARTER_MS);
    setBusy(true);
    setResult(
      await fetchPlan({
        zone: zone.code,
        ...(gln ? { gln } : {}),
        energyWh,
        maxPowerW,
        contiguous: !(task.canPause && mayPause),
        ...(earliestMs > nowMs ? { earliest: new Date(earliestMs).toISOString() } : {}),
        deadline: new Date(deadlineMs).toISOString(),
      }),
    );
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto bg-[var(--background)] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {p.title}: {t.tasks[task.id as keyof typeof t.tasks]}
          </DialogTitle>
          <DialogDescription className="text-[var(--muted)]">{p.intro}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="label">{p.energy}</span>
            <input
              className={field}
              type="number"
              inputMode="decimal"
              min={0.1}
              max={100}
              step={0.1}
              required
              value={kwhValue}
              onChange={(e) => setKwhValue(e.target.value)}
            />
          </label>

          {ev ? (
            <fieldset className="grid gap-1.5">
              <legend className="label mb-1.5">{p.power}</legend>
              <div className="grid h-11 grid-cols-3 gap-1 rounded-lg border border-[var(--border)] p-1">
                {EV_POWERS.map((kw) => (
                  <button
                    key={kw}
                    type="button"
                    aria-pressed={powerKw === kw}
                    onClick={() => setPowerKw(kw)}
                    className={pill}
                  >
                    {kw.toLocaleString(LOCALES[locale].intl)} kW
                  </button>
                ))}
              </div>
            </fieldset>
          ) : (
            <div className="grid gap-1.5">
              <span id={`${ids}-length`} className="label">
                {p.length}
              </span>
              <Select value={String(minutes)} onValueChange={(v) => setMinutes(Number(v))}>
                <SelectTrigger
                  aria-labelledby={`${ids}-length`}
                  className={`${field} shadow-none data-[size=default]:h-11`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" className="rounded-lg">
                  {LENGTHS.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {duration(m / 60, t.words)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {ev && (
            <label className="grid gap-1.5">
              <span className="label">{p.from}</span>
              <input
                className={field}
                type="time"
                step={900}
                required
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
          )}

          <label className="grid gap-1.5">
            <span className="label">{ev ? p.readyBy : p.doneBy}</span>
            <input
              className={field}
              type="time"
              step={900}
              required
              value={by}
              onChange={(e) => setBy(e.target.value)}
            />
          </label>

          {ev && (
            <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                checked={mayPause}
                onChange={(e) => setMayPause(e.target.checked)}
              />
              {p.mayPause}
            </label>
          )}

          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={busy} className="h-11 rounded-lg px-5">
              {busy ? p.planning : p.submit}
            </Button>
            <p className="text-xs text-[var(--muted)]">{p.privacy}</p>
          </div>
        </form>

        <div aria-live="polite">
          {result && <Results result={result} locale={locale} timeZone={timeZone} money={money} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Results({
  result,
  locale,
  timeZone,
  money,
}: {
  result: PlanResult;
  locale: Locale;
  timeZone: string;
  money: (value: number) => string;
}) {
  const p = PLAN_TEXT[locale];
  const when = useWhen(locale, timeZone);
  if (result.kind !== 'ok') {
    return (
      <p className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-4 py-3 text-sm">
        {result.kind === 'too-short' ? p.tooShort : p.error}
      </p>
    );
  }
  const preview: PlanPreview = result.preview;
  if (preview.options.length === 0) {
    return <p className="text-sm text-[var(--muted)]">{p.none}</p>;
  }
  const { startNow, midnight } = preview.baselines;
  // At night the midnight timer would start now too; then one comparison is enough.
  const midnightBaseline =
    midnight && midnight.runs[0]?.start !== startNow?.runs[0]?.start ? midnight : null;

  return (
    <section className="space-y-3">
      <h3 className="label">{p.options}</h3>
      {(preview.provisional || preview.mode === 'spot-only') && (
        <div className="space-y-1 rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-4 py-3 text-sm">
          {preview.provisional && preview.estimatedFrom && (
            <p>{p.estimated(when.at(Date.parse(preview.estimatedFrom)))}</p>
          )}
          {preview.mode === 'spot-only' && <p>{p.spotOnly}</p>}
        </div>
      )}
      <ol className="space-y-3">
        {preview.options.map((option, i) => {
          const earlier = preview.options.slice(0, i).some((o) => sameRuns(o, option));
          return (
            <li
              key={option.kind}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="font-semibold">
                  {p.kinds[option.kind]}
                  <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                    {option.kind === 'balanced' ? p.hints.balanced(money(1)) : p.hints[option.kind]}
                  </span>
                </h4>
                <p className="font-mono text-lg font-semibold tabular-nums">{money(option.cost)}</p>
              </div>
              <p className="mt-1 text-sm font-medium tabular-nums">
                {earlier ? p.sameAsAbove : describeRuns(option, p, when, timeZone)}
              </p>
              <div className="mt-2 space-y-0.5 text-sm">
                {option.co2Kg !== null && (
                  <p className="text-[var(--muted)]">
                    {p.co2(
                      option.co2Kg.toLocaleString(LOCALES[locale].intl, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }),
                    )}
                  </p>
                )}
                {midnightBaseline && (
                  <Compare
                    against={midnightBaseline}
                    option={option}
                    words={p.vsMidnight}
                    money={money}
                    primary
                  />
                )}
                {startNow && (
                  <Compare against={startNow} option={option} words={p.vsNow} money={money} />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Compare({
  against,
  option,
  words,
  money,
  primary = false,
}: {
  against: PlanSummary;
  option: PlanSummary;
  words: { less: (amount: string) => string; more: (amount: string) => string };
  money: (value: number) => string;
  primary?: boolean;
}) {
  const saving = against.cost - option.cost;
  if (Math.abs(saving) < 0.005) return null;
  return (
    <p
      className={primary && saving > 0 ? '' : 'text-[var(--muted)]'}
      style={primary && saving > 0 ? { color: 'var(--accent)' } : undefined}
    >
      {saving > 0 ? words.less(money(saving)) : words.more(money(-saving))}
    </p>
  );
}

/** On the price area's clock: the day (null for today, "tomorrow", or a weekday) and the time. */
function useWhen(locale: Locale, timeZone: string) {
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

type When = ReturnType<typeof useWhen>;

/** "Start tomorrow 02:45 · done 04:45", or "Charge 01:00–03:15, 04:30–04:45" for several runs. */
function describeRuns(
  summary: PlanSummary,
  p: (typeof PLAN_TEXT)[Locale],
  when: When,
  timeZone: string,
): string {
  const runs = summary.runs.map((r) => ({ start: Date.parse(r.start), end: Date.parse(r.end) }));
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
