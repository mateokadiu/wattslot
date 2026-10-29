import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GridCompany, Prices } from './api';
import { type Company, groupCompanies } from './companies';
import { FACT_ZONES, FACTS_BY_LOCALE } from './fact-zones';
import { type DayFacts, dayFacts, nextDate } from './facts';
import type { Locale } from './i18n';
import { type TariffPeriod, type TariffsBody, tariffPeriods } from './tariffs';

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

interface PricesFile {
  file: string;
  timeZone: string;
}

/** Today and, once published, tomorrow, from saved price files (one column each). */
function factsFrom(files: PricesFile[]): FactsDay[] {
  const { date } = buildPrices();
  const sources = files.map(({ file, timeZone }) => ({ timeZone, prices: readJson<Prices>(file) }));
  const days: FactsDay[] = [];
  for (const [kind, day] of [
    ['today', date],
    ['tomorrow', nextDate(date)],
  ] as const) {
    const zones = sources.flatMap(({ timeZone, prices }) => {
      const quarters = prices.slots.map((s) => ({ startMs: Date.parse(s.start), total: s.total }));
      const facts = dayFacts(quarters, day, timeZone);
      return facts
        ? [
            {
              zone: prices.zone,
              company: prices.gridCompany?.name ?? null,
              currency: prices.currency,
              mode: prices.mode,
              facts,
            },
          ]
        : [];
    });
    // A day is shown only when every column has it.
    if (zones.length === sources.length && zones.length > 0) days.push({ date: day, kind, zones });
  }
  return days;
}

/** The saved prices for an area (with its largest grid company's tariff where it has one). */
export const readPrices = (code: string): Prices => readJson<Prices>(`${code}.json`);

const zoneFile = (code: string): PricesFile => ({
  file: `${code}.json`,
  timeZone: FACT_ZONES[code]?.timeZone ?? 'Europe/Copenhagen',
});

/** The areas this language's home page shows. */
export const factsFor = (locale: Locale): FactsDay[] =>
  factsFrom((FACTS_BY_LOCALE[locale] ?? []).map(zoneFile));

/** One price area, with its largest grid company's tariff. */
export const areaFacts = (code: string): FactsDay[] => factsFrom([zoneFile(code)]);

/** All-in prices with one grid company's tariff. */
export const companyFacts = (gln: string): FactsDay[] =>
  factsFrom([{ file: `company-${gln}.json`, timeZone: 'Europe/Copenhagen' }]);

export const gridCompanyList = (): GridCompany[] =>
  readJson<{ gridCompanies: GridCompany[] }>('grid-companies.json').gridCompanies;

/** Supported grid companies, one per company, largest first. */
export const companies = (): Company[] => groupCompanies(gridCompanyList());

export const companyTariffs = (gln: string): TariffsBody =>
  readJson<TariffsBody>(`tariffs-${gln}.json`);

export const companyPeriods = (gln: string): TariffPeriod[] => tariffPeriods(companyTariffs(gln));
