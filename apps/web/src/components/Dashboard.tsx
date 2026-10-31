'use client';

import { cheapestWindow } from '@wattslot/planner';
import { localTime } from '@wattslot/pricing';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { type Co2, type GridCompany, getJson, type Prices, type Zone } from '@/lib/api';
import type { PriceSlot } from '@/lib/chart';
import { clock, duration, kwh, perKwh, price } from '@/lib/format';
import { type Dictionary, dictionaries, LOCALES, type Locale } from '@/lib/i18n';
import { planTask, SLOT_MS, slotsFor, TASKS, type Task, verdict } from '@/lib/insights';
import { readPrefs as readStoredPrefs, writePrefs } from '@/lib/place';
import { type ChartMode, PriceChart } from './PriceChart';

/** Same size as a picker, so the lazily loaded controls replace it without moving the page. */
function PickerPlaceholder() {
  return (
    <div aria-hidden="true">
      <div className="mb-1.5 h-[17px]" />
      <div className="h-11 rounded-lg border border-[var(--border)] bg-[var(--card)]" />
    </div>
  );
}

// The pickers (Radix + cmdk) load after the page has painted; they're not needed for first paint.
const AreaPicker = dynamic(() => import('./Pickers').then((m) => m.AreaPicker), {
  ssr: false,
  loading: PickerPlaceholder,
});
const GridCompanyPicker = dynamic(() => import('./Pickers').then((m) => m.GridCompanyPicker), {
  ssr: false,
  loading: PickerPlaceholder,
});

// The default price area depends on the page's language; see LOCALES.
const DEFAULTS = {
  gln: '5790000705689',
  task: 'dishwasher',
  mode: 'level' as ChartMode,
};
const DAY_MS = 24 * 3_600_000;

interface Prefs {
  zone: string;
  gln: string;
  task: string;
  mode: ChartMode;
  /** See StoredPrefs: the company's name, and whether the visitor chose this place. */
  name: string | null;
  chosen: boolean;
}

function initialPrefs(defaultZone: string): Prefs {
  const url = new URLSearchParams(window.location.search);
  const stored = readStoredPrefs();
  const task = url.get('task') ?? stored.task ?? DEFAULTS.task;
  const mode = url.get('view') ?? stored.mode ?? DEFAULTS.mode;
  const zone = url.get('zone') ?? stored.zone ?? defaultZone;
  const gln = url.get('gln') ?? stored.gln ?? DEFAULTS.gln;
  // A shared link can show another place; it only becomes "yours" when you pick it.
  const same = zone === stored.zone && gln === (stored.gln ?? '');
  return {
    zone,
    gln,
    task: TASKS.some((t) => t.id === task) ? task : DEFAULTS.task,
    mode: mode === 'breakdown' ? 'breakdown' : 'level',
    name: same ? (stored.name ?? null) : null,
    chosen: same && stored.chosen === true,
  };
}

function savePrefs(prefs: Prefs) {
  const url = new URL(window.location.href);
  url.searchParams.set('zone', prefs.zone);
  if (prefs.gln) url.searchParams.set('gln', prefs.gln);
  else url.searchParams.delete('gln');
  url.searchParams.set('task', prefs.task);
  if (prefs.mode === 'breakdown') url.searchParams.set('view', 'breakdown');
  else url.searchParams.delete('view');
  window.history.replaceState(null, '', url);
  const stored = readStoredPrefs();
  // Looking at a shared link doesn't overwrite the place you chose.
  writePrefs(
    prefs.chosen || !stored.chosen ? prefs : { ...stored, task: prefs.task, mode: prefs.mode },
  );
}

const toSlot = (s: Prices['slots'][number]): PriceSlot => ({
  startMs: Date.parse(s.start),
  spot: s.spot,
  gridTariff: s.gridTariff + s.supplierMarkup,
  tsoTariffs: s.tsoTariffs,
  electricityTax: s.electricityTax,
  vat: s.vat,
  total: s.total,
});

/** Whole percent, but never a misleading 0% for a real saving. */
const pct = (fraction: number): string => {
  const value = Math.round(fraction * 100);
  return value === 0 && fraction > 0 ? '<1' : String(value);
};

export function Dashboard({ locale }: { locale: Locale }) {
  const t: Dictionary = dictionaries[locale];
  const defaultZone = LOCALES[locale].zone;
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [companies, setCompanies] = useState<GridCompany[]>([]);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [co2, setCo2] = useState<Co2 | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [day, setDay] = useState<'today' | 'tomorrow'>('today');
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    setPrefs(initialPrefs(defaultZone));
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    getJson<{ zones: Zone[] }>('/v1/zones')
      .then((r) => setZones(r.zones))
      .catch(() => setState('error'));
    return () => window.clearInterval(timer);
  }, [defaultZone]);

  const zone =
    zones.find((z) => z.code === prefs?.zone) ?? zones.find((z) => z.code === defaultZone);
  const timeZone = zone?.timeZone ?? 'Europe/Copenhagen';

  useEffect(() => {
    if (!prefs || !zone) return;
    if (!zone.fullPrice) {
      setCompanies([]);
      if (prefs.gln) setPrefs({ ...prefs, gln: '', name: null });
      return;
    }
    const controller = new AbortController();
    getJson<{ gridCompanies: GridCompany[] }>(
      `/v1/grid-companies?zone=${zone.code}`,
      controller.signal,
    )
      .then(({ gridCompanies }) => {
        setCompanies(gridCompanies);
        if (!gridCompanies.some((g) => g.gln === prefs.gln)) {
          setPrefs({
            ...prefs,
            gln: gridCompanies.find((g) => g.supported)?.gln ?? '',
            name: null,
          });
        }
      })
      .catch(() => controller.signal.aborted || setState('error'));
    return () => controller.abort();
  }, [prefs, zone]);

  useEffect(() => {
    if (!prefs || !zone) return;
    savePrefs(prefs);
    const controller = new AbortController();
    const today = localTime(Date.now(), timeZone).date;
    const gln = prefs.gln ? `&gln=${prefs.gln}` : '';
    setState('loading');
    Promise.all([
      getJson<Prices>(`/v1/prices?zone=${zone.code}${gln}&date=${today}&days=2`, controller.signal),
      zone.fullPrice
        ? getJson<Co2>(`/v1/co2?zone=${zone.code}&date=${today}&days=2`, controller.signal)
        : Promise.resolve(null),
    ])
      .then(([p, c]) => {
        setPrices(p);
        setCo2(c);
        setState('ready');
      })
      .catch(() => controller.signal.aborted || setState('error'));
    return () => controller.abort();
  }, [prefs, zone, timeZone]);

  const task: Task = TASKS.find((x) => x.id === prefs?.task) ?? (TASKS[0] as Task);

  const view = useMemo(() => {
    if (!prices || nowMs === 0) return null;
    const slots = prices.slots.map(toSlot);
    const today = localTime(nowMs, timeZone).date;
    const byDay = {
      today: slots.filter((s) => localTime(s.startMs, timeZone).date === today),
      tomorrow: slots.filter((s) => localTime(s.startMs, timeZone).date > today),
    };
    const tomorrowReady = byDay.tomorrow.length >= 92;
    const shown = day === 'tomorrow' && tomorrowReady ? 'tomorrow' : 'today';
    const daySlots = byDay[shown];
    // Advice looks ahead 24 hours from now, across midnight.
    const ahead = slots.filter((s) => s.startMs + SLOT_MS > nowMs && s.startMs < nowMs + DAY_MS);
    const plan = planTask(ahead, task, 'start');
    const cheapestHour = cheapestWindow(
      daySlots.map((s) => ({ startMs: s.startMs, score: s.total })),
      4,
    );
    const priciest = daySlots.reduce<PriceSlot | null>(
      (m, s) => (m === null || s.total > m.total ? s : m),
      null,
    );
    const co2Map = new Map(
      (co2?.slots ?? [])
        .map((s) => [Date.parse(s.start), s.actual ?? s.forecast] as const)
        .filter((e): e is readonly [number, number] => e[1] !== null),
    );
    const nowSlot = Math.floor(nowMs / SLOT_MS) * SLOT_MS;
    return {
      shown,
      tomorrowReady,
      daySlots,
      verdict: verdict(slots, nowMs),
      plan,
      cheapestHour,
      priciest,
      co2: co2Map,
      co2Now: co2Map.get(nowSlot) ?? null,
      highlighted: new Set(plan?.slots.map((s) => s.startMs) ?? []),
    };
  }, [prices, co2, nowMs, day, timeZone, task]);

  const unit = perKwh(prices?.currency ?? 'DKK', locale);
  const money = (value: number) =>
    prices?.currency === 'DKK'
      ? t.money(price(value, locale))
      : `${price(value, locale)} ${prices?.currency ?? ''}`;
  const company = companies.find((g) => g.gln === prefs?.gln);
  const update = (patch: Partial<Prefs>) => prefs && setPrefs({ ...prefs, ...patch });
  const note =
    prices?.mode === 'spot-only'
      ? !zone?.fullPrice
        ? t.zoneSpotOnly(zone?.code ?? '')
        : !prefs?.gln
          ? t.chooseForFull
          : t.companySpotOnly(company?.name ?? prefs.gln)
      : null;

  const v = view?.verdict;
  const headline =
    !v || v.kind === 'unknown'
      ? t.verdictUnknown
      : v.kind === 'now'
        ? t.verdictNow
        : t.verdictWait(clock(v.from, timeZone), pct(v.saving));
  const verdictTone =
    v?.kind === 'wait' ? 'var(--expensive)' : v?.kind === 'now' ? 'var(--cheap)' : 'var(--muted)';

  const pill =
    'rounded-md px-3 py-1.5 text-sm transition-colors aria-selected:bg-[var(--foreground)] aria-selected:text-[var(--background)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)] disabled:opacity-40';

  return (
    <section aria-label={t.chartLabel} className="space-y-4">
      {/* On phones, keep the answer in view while scrolling. Always rendered, so it never shifts the page. */}
      <div className="sticky top-0 z-20 -mx-4 h-10 border-b border-[var(--border)] bg-[var(--background)]/90 px-4 backdrop-blur sm:hidden">
        <p className="flex h-full items-center gap-2 text-sm">
          <span className="size-2 shrink-0 rounded-full" style={{ background: verdictTone }} />
          {v && v.kind !== 'unknown' ? (
            <>
              <span className="font-mono tabular-nums">
                {price(v.current.total, locale)} {unit}
              </span>
              <span className="truncate text-[var(--muted)]">· {headline}</span>
            </>
          ) : (
            <span className="text-[var(--muted)]">
              {state === 'loading' ? t.loading : headline}
            </span>
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <AreaPicker
          t={t}
          zones={zones}
          value={prefs?.zone ?? defaultZone}
          onChange={(z) => update({ zone: z, name: null, chosen: true })}
        />
        <GridCompanyPicker
          t={t}
          locale={locale}
          companies={companies}
          value={prefs?.gln ?? ''}
          disabled={!zone?.fullPrice}
          onChange={(gln) =>
            update({
              gln,
              name: companies.find((g) => g.gln === gln)?.name ?? null,
              chosen: true,
            })
          }
        />
      </div>

      {note && (
        <p
          className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-4 py-3 text-sm"
          role="status"
        >
          <strong className="font-semibold">{t.spotOnly}.</strong> {note}
        </p>
      )}
      {state === 'error' && (
        <p
          className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-4 py-3 text-sm"
          role="alert"
        >
          {t.error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <article
          className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 lg:col-span-3"
          aria-live="polite"
        >
          <p className="label">{t.now}</p>
          {v && v.kind !== 'unknown' ? (
            <div className="fade-in" key={`${v.current.startMs}${prices?.gridCompany?.gln ?? ''}`}>
              <p className="mt-3 font-mono text-5xl font-semibold tabular-nums tracking-tight sm:text-6xl">
                {price(v.current.total, locale)}
                <span className="ml-2 text-base font-normal text-[var(--muted)]">{unit}</span>
              </p>
              <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                {t.until} {clock(v.current.startMs + SLOT_MS, timeZone)}
              </p>
              <p className="mt-5 flex items-center gap-2.5 text-lg font-medium">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: verdictTone }}
                />
                {headline}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {v.kind === 'wait'
                  ? t.verdictWaitDetail(`${price(v.average, locale)} ${unit}`)
                  : t.verdictNowDetail}
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="h-14 w-48 animate-pulse rounded-lg bg-[var(--grid)]" />
              <p className="text-sm text-[var(--muted)]">
                {state === 'loading' ? t.loading : headline}
              </p>
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 lg:col-span-2">
          <div role="tablist" aria-label={t.taskLabel} className="grid grid-cols-2 gap-1">
            {TASKS.map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={task.id === x.id}
                onClick={() => update({ task: x.id })}
                className={pill}
              >
                {t.tasks[x.id as keyof typeof t.tasks]}
              </button>
            ))}
          </div>
          {view?.plan ? (
            <div className="fade-in mt-5" key={`${task.id}${view.plan.start}`}>
              <p className="label">{task.canPause ? t.spread : t.startAt}</p>
              <p className="mt-1 font-mono text-3xl font-semibold tabular-nums tracking-tight">
                {task.canPause
                  ? `${clock(view.plan.start, timeZone)}–${clock(view.plan.end, timeZone)}`
                  : clock(view.plan.start, timeZone)}
                {!task.canPause && (
                  <span className="ml-2 text-base font-normal text-[var(--muted)]">
                    {t.doneBy} {clock(view.plan.end, timeZone)}
                  </span>
                )}
              </p>
              <p className="mt-3 text-sm">
                {t.costs}{' '}
                <strong className="font-mono font-semibold">{money(view.plan.cost)}</strong>
              </p>
              <p className="mt-0.5 text-sm" style={{ color: 'var(--accent)' }}>
                {view.plan.baselineCost !== null && view.plan.baselineCost - view.plan.cost >= 0.005
                  ? t.savesVsNow(
                      money(view.plan.baselineCost - view.plan.cost),
                      pct(1 - view.plan.cost / view.plan.baselineCost),
                    )
                  : t.noSaving}
              </p>
              <p className="mt-3 text-xs text-[var(--muted)]">
                {task.id === 'ev'
                  ? t.evAssumption
                  : t.taskAssumption(
                      kwh(task.energyKwh, locale),
                      duration(slotsFor(task) / 4, t.words),
                    )}
              </p>
            </div>
          ) : (
            <p className="mt-5 text-sm text-[var(--muted)]">{view ? t.taskNoFit : t.loading}</p>
          )}
        </article>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label={t.cheapestHour}>
          {view?.cheapestHour ? (
            <>
              <StatValue>{clock(view.cheapestHour.slots[0]?.startMs ?? 0, timeZone)}</StatValue>
              <StatSub>
                {price(view.cheapestHour.totalScore / 4, locale)} {unit}
              </StatSub>
            </>
          ) : (
            <StatValue>–</StatValue>
          )}
        </Stat>
        <Stat label={t.priciest}>
          {view?.priciest ? (
            <>
              <StatValue>{clock(view.priciest.startMs, timeZone)}</StatValue>
              <StatSub>
                {price(view.priciest.total, locale)} {unit}
              </StatSub>
            </>
          ) : (
            <StatValue>–</StatValue>
          )}
        </Stat>
        <Stat label={t.co2Now} className="col-span-2 sm:col-span-1">
          <StatValue>{view?.co2Now != null ? Math.round(view.co2Now) : '–'}</StatValue>
          <StatSub>g/kWh</StatSub>
        </Stat>
      </div>

      <article className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label={t.today}
            className="inline-flex rounded-lg border border-[var(--border)] p-0.5"
          >
            {(['today', 'tomorrow'] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={view?.shown === d}
                disabled={d === 'tomorrow' && !view?.tomorrowReady}
                title={d === 'tomorrow' && !view?.tomorrowReady ? t.tomorrowPending : undefined}
                onClick={() => setDay(d)}
                className={pill}
              >
                {t[d]}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
            {(['level', 'breakdown'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={(prefs?.mode ?? 'level') === m}
                onClick={() => update({ mode: m })}
                className={pill}
              >
                {t.chartModes[m]}
              </button>
            ))}
          </div>
        </div>
        <Legend t={t} mode={prefs?.mode ?? 'level'} showCo2={(view?.co2.size ?? 0) > 0} />
        <div className="mt-3 min-h-[300px]">
          {view && view.daySlots.length > 0 ? (
            <PriceChart
              slots={view.daySlots}
              co2={view.co2}
              highlighted={view.highlighted}
              nowMs={view.shown === 'today' ? nowMs : 0}
              timeZone={timeZone}
              unit={unit}
              locale={locale}
              mode={prefs?.mode ?? 'level'}
              t={t}
            />
          ) : (
            <p className="flex h-[300px] items-center justify-center text-sm text-[var(--muted)]">
              {state === 'error' ? t.error : state === 'loading' ? t.loading : t.noPrices}
            </p>
          )}
        </div>
        {view && view.daySlots.length > 0 && (
          <PriceTable
            t={t}
            slots={view.daySlots}
            highlighted={view.highlighted}
            timeZone={timeZone}
            locale={locale}
          />
        )}
      </article>
    </section>
  );
}

function Stat({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 ${className}`}>
      <p className="label">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
const StatValue = ({ children }: { children: React.ReactNode }) => (
  <p className="font-mono text-2xl font-semibold tabular-nums tracking-tight">{children}</p>
);
const StatSub = ({ children }: { children: React.ReactNode }) => (
  <p className="font-mono text-xs text-[var(--muted)]">{children}</p>
);

function Legend({ t, mode, showCo2 }: { t: Dictionary; mode: ChartMode; showCo2: boolean }) {
  const items =
    mode === 'level'
      ? (['cheap', 'normal', 'expensive'] as const).map((l) => ({
          key: l,
          color: `var(--${l})`,
          label: t.levels[l],
        }))
      : (['spot', 'gridTariff', 'tsoTariffs', 'electricityTax', 'vat'] as const).map((s) => ({
          key: s,
          color: `var(--${s})`,
          label: t.series[s],
        }));
  return (
    <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
      {showCo2 && (
        <li className="flex items-center gap-1.5">
          <span className="inline-block w-3 border-t-2 border-dashed border-[var(--co2)]" />
          {t.series.co2}
        </li>
      )}
    </ul>
  );
}

function PriceTable({
  t,
  slots,
  highlighted,
  timeZone,
  locale,
}: {
  t: Dictionary;
  slots: PriceSlot[];
  highlighted: ReadonlySet<number>;
  timeZone: string;
  locale: Locale;
}) {
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-[var(--muted)]">{t.showTable}</summary>
      <div className="mt-2 max-h-80 overflow-auto">
        <table className="w-full text-right font-mono text-xs tabular-nums">
          <thead className="sticky top-0 bg-[var(--card)] text-[var(--muted)]">
            <tr>
              <th className="py-1 text-left font-medium">{t.time}</th>
              <th className="font-medium">{t.series.spot}</th>
              <th className="font-medium">{t.series.gridTariff}</th>
              <th className="font-medium">{t.series.tsoTariffs}</th>
              <th className="font-medium">{t.series.electricityTax}</th>
              <th className="font-medium">{t.series.vat}</th>
              <th className="font-medium">{t.total}</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr
                key={s.startMs}
                className={highlighted.has(s.startMs) ? 'bg-[var(--highlight)]' : ''}
              >
                <td className="py-0.5 text-left">{clock(s.startMs, timeZone)}</td>
                <td>{price(s.spot, locale)}</td>
                <td>{price(s.gridTariff, locale)}</td>
                <td>{price(s.tsoTariffs, locale)}</td>
                <td>{price(s.electricityTax, locale)}</td>
                <td>{price(s.vat, locale)}</td>
                <td className="font-semibold">{price(s.total, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
