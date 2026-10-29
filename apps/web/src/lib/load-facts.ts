import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Prices } from './api';
import { FACT_ZONES, FACTS_BY_LOCALE } from './fact-zones';
import { type DayFacts, dayFacts, nextDate } from './facts';
import type { Locale } from './i18n';

// Build time only: reads the prices saved by scripts/fetch-prices.ts (or recorded ones).

export interface BuildPrices {
  /** Copenhagen date the build treats as today. */
  date: string;
  generatedAt: string;
}

export interface ZoneFacts {
  zone: string;
  company: string | null;
  currency: string;
  mode: Prices['mode'];
  facts: DayFacts;
}

export interface FactsDay {
  date: string;
  kind: 'today' | 'tomorrow';
  zones: ZoneFacts[];
}

const dir = () => resolve(process.cwd(), process.env.WATTSLOT_PRICES_DIR ?? '.prices');

function readJson<T>(file: string): T {
  const path = join(dir(), file);
  if (!existsSync(path)) {
    throw new Error(
      `${path} is missing. Run \`node scripts/fetch-prices.ts\`, or set WATTSLOT_PRICES_DIR=e2e/fixtures/prices.`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export const buildPrices = (): BuildPrices => readJson<BuildPrices>('meta.json');

/** Today and, once published, tomorrow, for the areas this language's page shows. */
export function factsFor(locale: Locale): FactsDay[] {
  const { date } = buildPrices();
  const zones = (FACTS_BY_LOCALE[locale] ?? []).map((code) => ({
    config: FACT_ZONES[code] ?? { zone: code, timeZone: 'Europe/Copenhagen' },
    prices: readJson<Prices>(`${code}.json`),
  }));
  const days: FactsDay[] = [];
  for (const [kind, day] of [
    ['today', date],
    ['tomorrow', nextDate(date)],
  ] as const) {
    const facts = zones.flatMap(({ config, prices }) => {
      const quarters = prices.slots.map((s) => ({ startMs: Date.parse(s.start), total: s.total }));
      const f = dayFacts(quarters, day, config.timeZone);
      return f
        ? [
            {
              zone: config.zone,
              company: prices.gridCompany?.name ?? null,
              currency: prices.currency,
              mode: prices.mode,
              facts: f,
            },
          ]
        : [];
    });
    // A day is shown only when every area has it.
    if (facts.length === zones.length && facts.length > 0)
      days.push({ date: day, kind, zones: facts });
  }
  return days;
}
