'use client';

import { cheapestSlots, cheapestWindow } from '@wattslot/planner';
import { localTime } from '@wattslot/pricing';
import { useEffect, useMemo, useState } from 'react';
import { type Co2, type GridCompany, getJson, type Prices, type Zone } from '@/lib/api';
import type { PriceSlot } from '@/lib/chart';
import { clock, duration, price } from '@/lib/format';
import { type Dictionary, dictionaries, type Locale } from '@/lib/i18n';
import { PriceChart } from './PriceChart';

const SLOT = 900_000;
const DURATIONS = [1, 2, 3, 4] as const;
const DEFAULTS = { zone: 'DK2', gln: '5790000705689', hours: 2 };
const STORAGE_KEY = 'wattslot:prefs';

interface Prefs {
  zone: string;
  gln: string;
  hours: number;
  pause: boolean;
}

function readPrefs(): Prefs {
  const url = new URLSearchParams(window.location.search);
  let stored: Partial<Prefs> = {};
  try {
    stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Prefs>;
  } catch {
    stored = {};
  }
  const hours = Number(url.get('hours') ?? stored.hours ?? DEFAULTS.hours);
  return {
    zone: url.get('zone') ?? stored.zone ?? DEFAULTS.zone,
    gln: url.get('gln') ?? stored.gln ?? DEFAULTS.gln,
    hours: DURATIONS.includes(hours as (typeof DURATIONS)[number]) ? hours : DEFAULTS.hours,
    pause: (url.get('pause') ?? String(stored.pause ?? false)) === 'true',
  };
}

function savePrefs(prefs: Prefs) {
  const url = new URL(window.location.href);
  url.searchParams.set('zone', prefs.zone);
  if (prefs.gln) url.searchParams.set('gln', prefs.gln);
  else url.searchParams.delete('gln');
  url.searchParams.set('hours', String(prefs.hours));
  if (prefs.pause) url.searchParams.set('pause', 'true');
  else url.searchParams.delete('pause');
  window.history.replaceState(null, '', url);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // private mode: preferences just aren't remembered
  }
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

export function Dashboard({ locale }: { locale: Locale }) {
  const t: Dictionary = dictionaries[locale];
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [companies, setCompanies] = useState<GridCompany[]>([]);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [co2, setCo2] = useState<Co2 | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [day, setDay] = useState<'today' | 'tomorrow'>('today');
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    setPrefs(readPrefs());
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    getJson<{ zones: Zone[] }>('/v1/zones')
      .then((r) => setZones(r.zones))
      .catch(() => setState('error'));
    return () => window.clearInterval(timer);
  }, []);

  const zone =
    zones.find((z) => z.code === prefs?.zone) ?? zones.find((z) => z.code === DEFAULTS.zone);
  const timeZone = zone?.timeZone ?? 'Europe/Copenhagen';

  // Grid companies for the zone; keep the chosen one if it belongs, else the largest supported.
  useEffect(() => {
    if (!prefs || !zone) return;
    if (!zone.fullPrice) {
      setCompanies([]);
      if (prefs.gln) setPrefs({ ...prefs, gln: '' });
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
          setPrefs({ ...prefs, gln: gridCompanies.find((g) => g.supported)?.gln ?? '' });
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

  const view = useMemo(() => {
    if (!prices || !prefs || nowMs === 0) return null;
    const slots = prices.slots.map(toSlot);
    const today = localTime(nowMs, timeZone).date;
    const byDay = {
      today: slots.filter((s) => localTime(s.startMs, timeZone).date === today),
      tomorrow: slots.filter((s) => localTime(s.startMs, timeZone).date > today),
    };
    const tomorrowReady = byDay.tomorrow.length >= 92;
    const shown = day === 'tomorrow' && tomorrowReady ? 'tomorrow' : 'today';
    const daySlots = byDay[shown];
    const candidates =
      shown === 'today' ? daySlots.filter((s) => s.startMs + SLOT > nowMs) : daySlots;
    const scored = candidates.map((s) => ({ startMs: s.startMs, score: s.total }));
    const count = prefs.hours * 4;
    const best = prefs.pause ? cheapestSlots(scored, count) : cheapestWindow(scored, count);
    const average = (total: number) => total / count;
    const dayAverage = daySlots.reduce((sum, s) => sum + s.total, 0) / Math.max(1, daySlots.length);
    const startNow =
      shown === 'today' && scored.length >= count
        ? cheapestWindow(scored.slice(0, count), count)
        : null;
    const baseline =
      shown === 'today' ? (startNow ? average(startNow.totalScore) : null) : dayAverage;
    const current = byDay.today.find((s) => nowMs >= s.startMs && nowMs < s.startMs + SLOT);
    const priciest = daySlots.reduce<PriceSlot | null>(
      (m, s) => (m === null || s.total > m.total ? s : m),
      null,
    );
    return {
      shown,
      tomorrowReady,
      daySlots,
      best,
      bestAverage: best ? average(best.totalScore) : null,
      baseline,
      current,
      dayAverage,
      priciest,
      highlighted: new Set(best?.slots.map((s) => s.startMs) ?? []),
      co2: new Map(
        (co2?.slots ?? [])
          .map((s) => [Date.parse(s.start), s.actual ?? s.forecast] as const)
          .filter((e): e is readonly [number, number] => e[1] !== null),
      ),
    };
  }, [prices, prefs, co2, nowMs, day, timeZone]);

  const unit =
    prices?.currency === 'DKK' && locale === 'da' ? 'kr./kWh' : `${prices?.currency ?? 'DKK'}/kWh`;
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

  const fieldClass =
    'mt-1 block w-full rounded-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]';

  return (
    <section aria-labelledby="dashboard-title" className="space-y-6">
      <h2 id="dashboard-title" className="sr-only">
        {t.chartLabel}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          {t.priceArea}
          <select
            className={fieldClass}
            value={prefs?.zone ?? DEFAULTS.zone}
            onChange={(e) => update({ zone: e.target.value })}
          >
            {zones.map((z) => (
              <option key={z.code} value={z.code}>
                {z.code === 'DK1' || z.code === 'DK2'
                  ? t.areas[z.code]
                  : `${z.code} · ${t.areas.other}`}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          {t.gridCompany}
          <select
            className={fieldClass}
            value={prefs?.gln ?? ''}
            disabled={!zone?.fullPrice}
            onChange={(e) => update({ gln: e.target.value })}
          >
            <option value="">{t.chooseCompany}</option>
            {companies.map((g) => (
              <option key={g.gln} value={g.gln}>
                {g.supported ? g.name : `${g.name} (${t.spotOnlySuffix})`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div
          role="tablist"
          aria-label={t.today}
          className="inline-flex rounded-md border border-[var(--border)] p-0.5"
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
              className="rounded px-3 py-1.5 text-sm aria-selected:bg-[var(--foreground)] aria-selected:text-[var(--background)] disabled:opacity-40"
            >
              {t[d]}
            </button>
          ))}
        </div>
        <fieldset className="flex items-center gap-2 text-sm">
          <legend className="sr-only">{t.duration}</legend>
          <span className="text-[var(--muted)]">{t.duration}</span>
          {DURATIONS.map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={prefs?.hours === h}
              onClick={() => update({ hours: h })}
              className="rounded-md border border-[var(--border)] px-2.5 py-1 tabular-nums aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--accent)] aria-pressed:text-[var(--on-accent)]"
            >
              {h}
              {t.hourShort}
            </button>
          ))}
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={prefs?.pause ?? false}
            onChange={(e) => update({ pause: e.target.checked })}
            className="size-4 accent-[var(--accent)]"
          />
          {t.canPause}
        </label>
      </div>

      {note && (
        <p
          className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] px-4 py-3 text-sm"
          role="status"
        >
          <strong className="font-semibold">{t.spotOnly}.</strong> {note}
        </p>
      )}

      {state === 'error' && (
        <p
          className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] px-4 py-3 text-sm"
          role="alert"
        >
          {t.error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3" aria-live="polite" aria-busy={state === 'loading'}>
        <Card label={view?.shown === 'today' ? t.now : t.dayAverage}>
          {view && (view.shown === 'today' ? view.current : true) ? (
            <>
              <Value>
                {price(
                  view.shown === 'today' ? (view.current?.total ?? 0) : view.dayAverage,
                  locale,
                )}
              </Value>
              <Sub>
                {unit}
                {view.shown === 'today' && view.current
                  ? ` · ${t.until} ${clock(view.current.startMs + SLOT, timeZone)}`
                  : ''}
              </Sub>
            </>
          ) : view ? (
            <Value>–</Value>
          ) : (
            <Skeleton />
          )}
        </Card>
        <Card label={`${t.cheapest} ${duration(prefs?.hours ?? DEFAULTS.hours, t.words)}`} accent>
          {view?.best && view.bestAverage !== null ? (
            <>
              <Value>
                {prefs?.pause
                  ? t.split
                  : `${clock(view.best.slots[0]?.startMs ?? 0, timeZone)}–${clock((view.best.slots.at(-1)?.startMs ?? 0) + SLOT, timeZone)}`}
              </Value>
              <Sub>
                {price(view.bestAverage, locale)} {unit}
                {view.baseline !== null && view.baseline > view.bestAverage
                  ? ` · ${Math.round((1 - view.bestAverage / view.baseline) * 100)}% ${t.cheaper} ${view.shown === 'today' ? t.vsNow : t.vsAverage}`
                  : ''}
              </Sub>
            </>
          ) : view ? (
            <Sub>{t.noWindow}</Sub>
          ) : (
            <Skeleton />
          )}
        </Card>
        <Card label={t.priciest}>
          {view?.priciest ? (
            <>
              <Value>{clock(view.priciest.startMs, timeZone)}</Value>
              <Sub>
                {price(view.priciest.total, locale)} {unit}
              </Sub>
            </>
          ) : (
            <Skeleton />
          )}
        </Card>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <Legend t={t} showCo2={(view?.co2.size ?? 0) > 0} />
        <div className="mt-3 min-h-[300px] overflow-hidden">
          {view && view.daySlots.length > 0 ? (
            <PriceChart
              slots={view.daySlots}
              co2={view.co2}
              highlighted={view.highlighted}
              nowMs={view.shown === 'today' ? nowMs : 0}
              timeZone={timeZone}
              unit={unit}
              locale={locale}
              t={t}
            />
          ) : (
            <p className="flex h-[300px] items-center justify-center text-sm text-[var(--muted)]">
              {state === 'error' ? t.error : state === 'loading' ? t.loading : t.noPrices}
            </p>
          )}
        </div>
        {view && view.daySlots.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-[var(--muted)]">{t.showTable}</summary>
            <div className="mt-2 max-h-80 overflow-auto">
              <table className="w-full text-right tabular-nums">
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
                  {view.daySlots.map((s) => (
                    <tr
                      key={s.startMs}
                      className={view.highlighted.has(s.startMs) ? 'bg-[var(--highlight)]' : ''}
                    >
                      <td className="py-0.5 text-left">{clock(s.startMs, timeZone)}</td>
                      <td>{price(s.spot, locale)}</td>
                      <td>{price(s.gridTariff, locale)}</td>
                      <td>{price(s.tsoTariffs, locale)}</td>
                      <td>{price(s.electricityTax, locale)}</td>
                      <td>{price(s.vat, locale)}</td>
                      <td className="font-medium">{price(s.total, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

function Card({
  label,
  accent,
  children,
}: {
  label: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border bg-[var(--card)] p-4 ${accent ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <div className="mt-2 min-h-[3.25rem]">{children}</div>
    </div>
  );
}

const Value = ({ children }: { children: React.ReactNode }) => (
  <p className="text-2xl font-semibold tabular-nums tracking-tight">{children}</p>
);
const Sub = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-0.5 text-sm text-[var(--muted)]">{children}</p>
);
const Skeleton = () => <div className="h-8 w-24 animate-pulse rounded bg-[var(--grid)]" />;

function Legend({ t, showCo2 }: { t: Dictionary; showCo2: boolean }) {
  const items = ['spot', 'gridTariff', 'tsoTariffs', 'electricityTax', 'vat'] as const;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
      {items.map((series) => (
        <li key={series} className="flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-sm"
            style={{ background: `var(--${series})` }}
          />
          {t.series[series]}
        </li>
      ))}
      {showCo2 && (
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 bg-[var(--co2)]" />
          {t.series.co2}
        </li>
      )}
    </ul>
  );
}
