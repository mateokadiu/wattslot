import type { z } from 'zod';
import { EdsSchemaError, EdsTruncatedError } from './errors.ts';
import {
  co2EmissionRecord,
  type DatahubPriceRecord,
  datahubPriceRecord,
  dayAheadPriceRecord,
  envelope,
} from './schemas.ts';
import type { Co2Emission, DatahubCharge, DayAheadPrice } from './types.ts';

const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

function parseEnvelope<T extends z.ZodType>(
  dataset: string,
  record: T,
  json: unknown,
): z.infer<T>[] {
  const result = envelope(record).safeParse(json);
  if (!result.success) {
    throw new EdsSchemaError(
      dataset,
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const { total, records } = result.data;
  if (total > records.length) throw new EdsTruncatedError(dataset, total, records.length);
  return records;
}

/** EDS publishes UTC timestamps without a zone designator. */
function utcMs(dataset: string, value: string): number {
  if (!WALL_CLOCK.test(value)) throw new EdsSchemaError(dataset, [`bad timestamp ${value}`]);
  return Date.parse(`${value}Z`);
}

export function parseDayAheadPrices(json: unknown): DayAheadPrice[] {
  return parseEnvelope('DayAheadPrices', dayAheadPriceRecord, json).map((r) => ({
    slotStartMs: utcMs('DayAheadPrices', r.TimeUTC),
    priceArea: r.PriceArea,
    dkkPerMwh: r.DayAheadPriceDKK,
    eurPerMwh: r.DayAheadPriceEUR,
  }));
}

export function parseCo2Emissions(dataset: string, json: unknown): Co2Emission[] {
  return parseEnvelope(dataset, co2EmissionRecord, json).map((r) => ({
    timeMs: utcMs(dataset, r.Minutes5UTC),
    priceArea: r.PriceArea,
    gPerKwh: r.CO2Emission,
  }));
}

function hourly(r: DatahubPriceRecord): number[] {
  const prices: number[] = [];
  for (let hour = 1; hour <= 24; hour++) {
    const value = r[`Price${hour}` as keyof DatahubPriceRecord] as number | null;
    // A flat charge only fills Price1; Price2..24 are null.
    prices.push(value ?? r.Price1);
  }
  return prices;
}

export function parseDatahubPricelist(json: unknown): DatahubCharge[] {
  const dataset = 'DatahubPricelist';
  return parseEnvelope(dataset, datahubPriceRecord, json).map((r) => {
    for (const value of [r.ValidFrom, r.ValidTo]) {
      if (value !== null && !WALL_CLOCK.test(value)) {
        throw new EdsSchemaError(dataset, [`bad validity ${value}`]);
      }
    }
    return {
      ownerGln: r.GLN_Number,
      ownerName: r.ChargeOwner,
      chargeType: r.ChargeType,
      code: r.ChargeTypeCode,
      note: r.Note,
      validFrom: r.ValidFrom,
      validTo: r.ValidTo,
      hourlyDkkPerKwh: hourly(r),
      isTax: r.TaxIndicator === 1,
    };
  });
}
