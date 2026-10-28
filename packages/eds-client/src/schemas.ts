import { z } from 'zod';

/** Every dataset endpoint wraps its rows in the same envelope. */
export const envelope = <T extends z.ZodType>(record: T) =>
  z.object({
    total: z.number().int().nonnegative(),
    dataset: z.string(),
    records: z.array(record),
  });

export const dayAheadPriceRecord = z.object({
  TimeUTC: z.string(),
  TimeDK: z.string(),
  PriceArea: z.string(),
  DayAheadPriceEUR: z.number(),
  DayAheadPriceDKK: z.number().nullable(),
});

export const co2EmissionRecord = z.object({
  Minutes5UTC: z.string(),
  Minutes5DK: z.string(),
  PriceArea: z.string(),
  CO2Emission: z.number(),
});

const hourlyPrice = z.number().nullable();

export const datahubPriceRecord = z.object({
  ChargeOwner: z.string().nullable(),
  GLN_Number: z.string(),
  ChargeType: z.string(),
  ChargeTypeCode: z.string(),
  Note: z.string().nullable(),
  Description: z.string().nullable(),
  ValidFrom: z.string(),
  ValidTo: z.string().nullable(),
  TaxIndicator: z.number().nullable(),
  Price1: z.number(),
  Price2: hourlyPrice,
  Price3: hourlyPrice,
  Price4: hourlyPrice,
  Price5: hourlyPrice,
  Price6: hourlyPrice,
  Price7: hourlyPrice,
  Price8: hourlyPrice,
  Price9: hourlyPrice,
  Price10: hourlyPrice,
  Price11: hourlyPrice,
  Price12: hourlyPrice,
  Price13: hourlyPrice,
  Price14: hourlyPrice,
  Price15: hourlyPrice,
  Price16: hourlyPrice,
  Price17: hourlyPrice,
  Price18: hourlyPrice,
  Price19: hourlyPrice,
  Price20: hourlyPrice,
  Price21: hourlyPrice,
  Price22: hourlyPrice,
  Price23: hourlyPrice,
  Price24: hourlyPrice,
});

export type DatahubPriceRecord = z.infer<typeof datahubPriceRecord>;
