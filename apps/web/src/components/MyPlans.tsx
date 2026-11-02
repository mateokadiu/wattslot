'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PLAN_TEXT } from '@/content/plan';
import type { Zone } from '@/lib/api';
import { dictionaries, LOCALES, type Locale } from '@/lib/i18n';
import { downloadIcs, toIcs } from '@/lib/ics';
import { cancelJob, deleteEverything, type Job, listJobs, onPlansChanged } from '@/lib/owner';
import { NotifyControl } from './NotifyControl';
import { describeRuns, moneyFormat, planEvents, useWhen } from './plan-format';
import { Skeleton } from './ui/skeleton';

// "My plans" on the live view (PLAN.md §17.7): this browser's saved plans, what happens next,
// cancel, add to calendar, and delete everything. Loaded only in a browser that has saved plans.

const REFRESH_MS = 60_000;
const LIVE = new Set(['planned', 'running']);

export default function MyPlans({ locale, zones }: { locale: Locale; zones: Zone[] }) {
  const p = PLAN_TEXT[locale];
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(() => {
    listJobs()
      .then((list) => {
        setJobs(list);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
    const unsubscribe = onPlansChanged(load);
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [load]);

  if (jobs === null && !error) {
    // This browser has saved plans: keep their place while they load.
    return (
      <section
        aria-labelledby="my-plans"
        className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-6"
      >
        <h2 id="my-plans" className="label">
          {p.myPlans}
        </h2>
        <div role="status" className="mt-3">
          <span className="sr-only">{p.loadingPlans}</span>
          <div aria-hidden="true">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="mt-2 h-4 w-72 max-w-full" />
            <Skeleton className="mt-2 h-3 w-48" />
            <div className="mt-3 flex gap-2">
              <Skeleton className="h-9 w-32 rounded-lg" />
              <Skeleton className="h-9 w-28 rounded-lg" />
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      id="my-plans-section"
      aria-labelledby="my-plans"
      className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-6"
    >
      <h2 id="my-plans" className="label">
        {p.myPlans}
      </h2>
      {error && <p className="mt-3 text-sm">{p.loadError}</p>}
      {jobs && jobs.length === 0 && <p className="mt-3 text-sm text-[var(--muted)]">{p.noPlans}</p>}
      {jobs && jobs.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--border)]">
          {jobs.map((job) => {
            const zone = zones.find((z) => z.code === job.zone);
            return (
              <JobItem
                key={job.id}
                job={job}
                locale={locale}
                timeZone={zone?.timeZone ?? 'Europe/Copenhagen'}
                currency={zone?.currency ?? 'DKK'}
              />
            );
          })}
        </ul>
      )}
      {jobs?.some((j) => LIVE.has(j.status)) && (
        <div className="mt-4 border-t border-[var(--border)] pt-4">
          <NotifyControl locale={locale} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
        <p className="max-w-prose flex-1">{p.plansNote}</p>
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span role="status" className="text-[var(--foreground)]">
              {p.deleteConfirm}
            </span>
            <Button
              type="button"
              className="h-9 rounded-lg"
              onClick={async () => {
                await deleteEverything();
                setConfirming(false);
              }}
            >
              {p.deleteYes}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg"
              onClick={() => setConfirming(false)}
            >
              {p.keep}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg"
            onClick={() => setConfirming(true)}
          >
            {p.deleteAll}
          </Button>
        )}
      </div>
    </section>
  );
}

function JobItem({
  job,
  locale,
  timeZone,
  currency,
}: {
  job: Job;
  locale: Locale;
  timeZone: string;
  currency: string;
}) {
  const p = PLAN_TEXT[locale];
  const t = dictionaries[locale];
  const when = useWhen(locale, timeZone);
  const money = moneyFormat(locale, currency);
  const live = LIVE.has(job.status);
  const [busy, setBusy] = useState(false);

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-semibold">
          {t.tasks[job.task]}
          <span
            className={`ml-2 rounded-md px-1.5 py-0.5 text-xs font-medium ${
              live ? 'bg-[var(--grid)]' : 'text-[var(--muted)]'
            }`}
          >
            {p.statuses[job.status]}
          </span>
        </h3>
        <p className="font-mono font-semibold tabular-nums">{money(job.plan.cost)}</p>
      </div>
      <p className={`mt-1 text-sm tabular-nums ${live ? 'font-medium' : 'text-[var(--muted)]'}`}>
        {describeRuns(job.plan, p, when, timeZone)}
      </p>
      {/* Before it starts, the times above already say what comes next. */}
      {job.status === 'running' && job.next && (
        <p className="mt-0.5 text-sm" style={{ color: 'var(--accent)' }}>
          {p.next[job.next.action](when.at(Date.parse(job.next.at)))}
        </p>
      )}
      <p className="mt-0.5 text-xs text-[var(--muted)]">
        {[
          p.kinds[job.objective],
          job.plan.co2Kg !== null
            ? p.co2(
                job.plan.co2Kg.toLocaleString(LOCALES[locale].intl, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }),
              )
            : null,
          live && job.plan.provisional ? p.estimatedPrices : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {live && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg"
            onClick={() =>
              downloadIcs('wattslot-plan.ics', toIcs(planEvents(job, locale, money), Date.now()))
            }
          >
            {p.calendar}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await cancelJob(job.id).catch(() => undefined);
              setBusy(false);
            }}
          >
            {p.cancel}
          </Button>
        </div>
      )}
    </li>
  );
}
