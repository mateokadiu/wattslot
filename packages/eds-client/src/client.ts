import { EdsHttpError, EdsRateLimitError, EdsSchemaError } from './errors.js';
import { parseCo2Emissions, parseDatahubPricelist, parseDayAheadPrices } from './parse.js';
import type { Co2Emission, DatahubCharge, DayAheadPrice } from './types.js';

export interface EdsClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  userAgent?: string;
}

/**
 * `start`/`end` are Danish local time (`YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`), as EDS interprets
 * them. `end` is exclusive.
 */
export interface TimeRange {
  start: string;
  end: string;
}

export interface AreaQuery extends TimeRange {
  priceAreas?: readonly string[];
}

export interface PricelistQuery {
  /** Only rows whose `ValidFrom` is on or after this date. */
  start?: string;
  ownerGlns?: readonly string[];
  codes?: readonly string[];
  /** D01 subscription, D02 fee, D03 tariff. */
  chargeTypes?: readonly string[];
}

export interface EdsClient {
  dayAheadPrices(query: AreaQuery): Promise<DayAheadPrice[]>;
  co2EmissionForecast(query: AreaQuery): Promise<Co2Emission[]>;
  co2Emission(query: AreaQuery): Promise<Co2Emission[]>;
  datahubPricelist(query: PricelistQuery): Promise<DatahubCharge[]>;
}

const DEFAULT_BASE_URL = 'https://api.energidataservice.dk';
/** Large enough for a year of 15-minute rows for every area; truncation is detected anyway. */
const MAX_RECORDS = '200000';
const DEFAULT_RETRY_SECONDS = 60;

function filterParam(filter: Record<string, readonly string[] | undefined>): string | undefined {
  const entries = Object.entries(filter).filter(
    (entry): entry is [string, readonly string[]] => entry[1] !== undefined && entry[1].length > 0,
  );
  return entries.length > 0 ? JSON.stringify(Object.fromEntries(entries)) : undefined;
}

export function retryAfterSeconds(header: string | null, body: string): number {
  const fromHeader = header === null ? Number.NaN : Number(header);
  if (Number.isFinite(fromHeader) && fromHeader >= 0) return Math.ceil(fromHeader);
  const match = /try again in (\d+) seconds?/i.exec(body);
  return match?.[1] ? Number(match[1]) : DEFAULT_RETRY_SECONDS;
}

export function createEdsClient(options: EdsClientOptions = {}): EdsClient {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const userAgent = options.userAgent ?? 'wattslot-eds-client';

  async function get(
    dataset: string,
    params: Record<string, string | undefined>,
  ): Promise<unknown> {
    const url = new URL(`/dataset/${dataset}`, baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    const response = await doFetch(url, {
      headers: { accept: 'application/json', 'user-agent': userAgent },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text();
    if (response.status === 429) {
      throw new EdsRateLimitError(
        dataset,
        retryAfterSeconds(response.headers.get('retry-after'), body),
      );
    }
    if (!response.ok) throw new EdsHttpError(dataset, response.status, body.slice(0, 500));
    try {
      return JSON.parse(body);
    } catch {
      throw new EdsSchemaError(dataset, ['response is not JSON']);
    }
  }

  const areaParams = (query: AreaQuery, sort: string) => ({
    start: query.start,
    end: query.end,
    filter: filterParam({ PriceArea: query.priceAreas }),
    sort,
    limit: MAX_RECORDS,
  });

  return {
    async dayAheadPrices(query) {
      return parseDayAheadPrices(await get('DayAheadPrices', areaParams(query, 'TimeUTC asc')));
    },
    async co2EmissionForecast(query) {
      const dataset = 'CO2EmisProg';
      return parseCo2Emissions(dataset, await get(dataset, areaParams(query, 'Minutes5UTC asc')));
    },
    async co2Emission(query) {
      const dataset = 'CO2Emis';
      return parseCo2Emissions(dataset, await get(dataset, areaParams(query, 'Minutes5UTC asc')));
    },
    async datahubPricelist(query) {
      return parseDatahubPricelist(
        await get('DatahubPricelist', {
          start: query.start,
          filter: filterParam({
            GLN_Number: query.ownerGlns,
            ChargeTypeCode: query.codes,
            ChargeType: query.chargeTypes,
          }),
          sort: 'ValidFrom asc',
          limit: MAX_RECORDS,
        }),
      );
    },
  };
}
