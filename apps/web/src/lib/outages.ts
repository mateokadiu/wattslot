'use client';

import { useEffect, useState } from 'react';
import type { Outages } from './api';
import { getJson } from './api';
import { LOCALES, type Locale } from './i18n';

const TZ = 'Europe/Copenhagen';
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<Outages> }>();

/** One request per URL per minute, however many components ask (the API caches 60 s too). */
export function fetchOutages(path: string): Promise<Outages> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = getJson<Outages>(path);
  cache.set(path, { at: Date.now(), promise });
  promise.catch(() => cache.delete(path));
  return promise;
}

export type Loaded = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: Outages };

/** Outages from the API, refreshed every two minutes while the page is visible. */
export function useOutages(path: string | null): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(path ? { state: 'loading' } : null);
  useEffect(() => {
    if (!path) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    const load = () =>
      fetchOutages(path)
        .then((data) => !cancelled && setLoaded({ state: 'ready', data }))
        .catch(() => !cancelled && setLoaded({ state: 'error' }));
    setLoaded({ state: 'loading' });
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 2 * CACHE_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [path]);
  return loaded;
}

/** True if an outage is happening now (not restored, not a future notice). */
export const isCurrent = (o: { kind: string; restored: boolean; start: string | null }) =>
  !o.restored &&
  (o.kind === 'unplanned' || o.kind === 'announced') &&
  (o.start === null || Date.parse(o.start) <= Date.now());

/**
 * "kl. 14:30" / "14:30" today, otherwise "søn. 1. nov. kl. 07:00" / "Sun 1 Nov 07:00", in Danish
 * time. Times use a colon everywhere on the site, Danish pages add "kl.".
 */
export function when(iso: string, locale: Locale): string {
  const ms = Date.parse(iso);
  const day = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(t);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ms);
  const clockText = locale === 'da' ? `kl. ${time}` : time;
  if (day(ms) === day(Date.now())) return clockText;
  const date = new Intl.DateTimeFormat(LOCALES[locale].intl, {
    timeZone: TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(ms);
  return `${date.replace(',', '')} ${clockText}`;
}
