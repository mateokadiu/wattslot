'use client';

import { useId, useState } from 'react';
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
import { clock, duration } from '@/lib/format';
import { dictionaries, LOCALES, type Locale } from '@/lib/i18n';
import { downloadIcs, toIcs } from '@/lib/ics';
import { slotsFor, type Task } from '@/lib/insights';
import { type Job, saveJob, type TaskId } from '@/lib/owner';
import {
  fetchPlan,
  nextLocalTime,
  type OptionKind,
  type PlanPreview,
  type PlanRequest,
  type PlanResult,
  type PlanSummary,
  powerFor,
  sameRuns,
} from '@/lib/plan';
import { NotifyControl } from './NotifyControl';
import { describeRuns, moneyFormat, planEvents, useWhen } from './plan-format';

// The "Plan" form (PLAN.md §17.7): what to run and by when, then three ways to do it. Loaded on
// first use, so the live view doesn't pay for it. Nothing is stored until a plan is saved.

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
  const [request, setRequest] = useState<PlanRequest | null>(null);
  const [saving, setSaving] = useState<OptionKind | null>(null);
  const [saved, setSaved] = useState<{ kind: OptionKind; job: Job } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const money = moneyFormat(locale, zone.currency);

  async function save(kind: OptionKind) {
    if (!request) return;
    setSaving(kind);
    setSaveError(null);
    const outcome = await saveJob(locale, {
      ...request,
      task: task.id as TaskId,
      objective: kind,
    });
    setSaving(null);
    if (outcome.kind === 'ok') setSaved({ kind, job: outcome.job });
    else {
      setSaveError(
        outcome.reason === 'too_many_plans'
          ? p.tooMany
          : outcome.reason === 'plans_full' || outcome.reason === 'owners_full'
            ? p.full
            : p.saveError,
      );
    }
  }

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
    const body: PlanRequest = {
      zone: zone.code,
      ...(gln ? { gln } : {}),
      energyWh,
      maxPowerW,
      contiguous: !(task.canPause && mayPause),
      ...(earliestMs > nowMs ? { earliest: new Date(earliestMs).toISOString() } : {}),
      deadline: new Date(deadlineMs).toISOString(),
    };
    setBusy(true);
    setSaved(null);
    setSaveError(null);
    setRequest(body);
    setResult(await fetchPlan(body));
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
          {result && (
            <Results
              result={result}
              locale={locale}
              timeZone={timeZone}
              money={money}
              saving={saving}
              saved={saved}
              saveError={saveError}
              onSave={save}
              onCalendar={(job) =>
                downloadIcs('wattslot-plan.ics', toIcs(planEvents(job, locale, money), Date.now()))
              }
            />
          )}
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
  saving,
  saved,
  saveError,
  onSave,
  onCalendar,
}: {
  result: PlanResult;
  locale: Locale;
  timeZone: string;
  money: (value: number) => string;
  saving: OptionKind | null;
  saved: { kind: OptionKind; job: Job } | null;
  saveError: string | null;
  onSave: (kind: OptionKind) => void;
  onCalendar: (job: Job) => void;
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
              {saved?.kind === option.kind ? (
                <div className="mt-3 space-y-2">
                  <p
                    role="status"
                    className="text-sm font-medium"
                    style={{ color: 'var(--accent)' }}
                  >
                    ✓ {p.saved}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 rounded-lg"
                      onClick={() => onCalendar(saved.job)}
                    >
                      {p.calendar}
                    </Button>
                  </div>
                  <NotifyControl locale={locale} />
                </div>
              ) : (
                !saved && (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 h-10 rounded-lg"
                    disabled={saving !== null}
                    onClick={() => onSave(option.kind)}
                  >
                    {saving === option.kind ? p.saving : p.save}
                  </Button>
                )
              )}
            </li>
          );
        })}
      </ol>
      {saveError && (
        <p
          role="alert"
          className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-4 py-3 text-sm"
        >
          {saveError}
        </p>
      )}
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
