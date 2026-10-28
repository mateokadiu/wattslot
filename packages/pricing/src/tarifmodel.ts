import type { Micro } from './money.js';

/** Danish grid-tariff bands (Tarifmodel 3.0): low 00–06, high 06–17 and 21–24, peak 17–21. */
export type TariffBand = 'low' | 'high' | 'peak';

export const TARIFMODEL_3_BANDS: readonly TariffBand[] = Array.from({ length: 24 }, (_, hour) =>
  hour < 6 ? 'low' : hour >= 17 && hour < 21 ? 'peak' : 'high',
);

export interface TariffShape {
  low: Micro;
  high: Micro;
  peak: Micro;
}

/**
 * The three band prices if 24 hourly prices follow Tarifmodel 3.0 — one price per band and
 * low ≤ high < peak — otherwise null. Used to recognise household tariffs in DataHub and to
 * detect when a grid company changes its tariff structure.
 */
export function tarifModel3Shape(hourly: readonly Micro[]): TariffShape | null {
  if (hourly.length !== 24) return null;
  const bands: Record<TariffBand, Set<Micro>> = {
    low: new Set(),
    high: new Set(),
    peak: new Set(),
  };
  hourly.forEach((price, hour) => {
    bands[TARIFMODEL_3_BANDS[hour] as TariffBand].add(price);
  });
  if (bands.low.size !== 1 || bands.high.size !== 1 || bands.peak.size !== 1) return null;
  const [low] = bands.low;
  const [high] = bands.high;
  const [peak] = bands.peak;
  if (low === undefined || high === undefined || peak === undefined) return null;
  return low <= high && high < peak ? { low, high, peak } : null;
}

export type TariffShapeKind =
  | ({ kind: 'tarifmodel3' } & TariffShape)
  | { kind: 'flat'; price: Micro }
  | { kind: 'other' };

/** How a 24-hour tariff is structured: Tarifmodel 3.0, one flat price, or something else. */
export function classifyTariffShape(hourly: readonly Micro[]): TariffShapeKind {
  if (hourly.length === 24 && hourly.every((price) => price === hourly[0])) {
    return { kind: 'flat', price: hourly[0] as Micro };
  }
  const shape = tarifModel3Shape(hourly);
  return shape ? { kind: 'tarifmodel3', ...shape } : { kind: 'other' };
}
