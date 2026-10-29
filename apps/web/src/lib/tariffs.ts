import { TARIFMODEL_3_BANDS } from '@wattslot/pricing';

/** Shape of `GET /v1/tariffs`. */
export interface TariffsBody {
  gridCompany: { gln: string; name: string; zone: string };
  tariffs: {
    chargeCode: string;
    role: 'tariff' | 'discount';
    periods: { validFrom: string; validTo: string | null; hourly: number[] }[];
  }[];
}

/** A stretch of time with one 24-hour price list (DKK/kWh excl. VAT), all charges added up. */
export interface TariffPeriod {
  validFrom: string;
  validTo: string | null;
  hourly: number[];
}

export type TariffShape =
  | { kind: 'bands'; low: number; high: number; peak: number }
  | { kind: 'flat'; price: number }
  | { kind: 'hourly'; hourly: number[] };

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * A company's household tariff over time. Some companies have more than one charge (a regional
 * tariff, a time-limited discount); their periods are split at every boundary and summed.
 */
export function tariffPeriods(body: TariffsBody): TariffPeriod[] {
  const periods = body.tariffs.flatMap((t) => t.periods.map((p) => ({ ...p, role: t.role })));
  const bounds = [
    ...new Set(periods.flatMap((p) => (p.validTo ? [p.validFrom, p.validTo] : [p.validFrom]))),
  ].sort();
  const result: TariffPeriod[] = [];
  bounds.forEach((from, i) => {
    const to = bounds[i + 1] ?? null;
    const active = periods.filter(
      (p) => p.validFrom <= from && (p.validTo === null || (to !== null && p.validTo >= to)),
    );
    if (!active.some((p) => p.role === 'tariff')) return;
    const hourly = Array.from({ length: 24 }, (_, h) =>
      active.reduce((sum, p) => sum + (p.hourly[h] ?? 0), 0),
    );
    const last = result.at(-1);
    if (last && last.validTo === from && last.hourly.every((v, h) => close(v, hourly[h] ?? 0))) {
      last.validTo = to;
    } else {
      result.push({ validFrom: from, validTo: to, hourly });
    }
  });
  return result;
}

/** One price, Tarifmodel 3.0's three bands, or (if neither fits) the full 24 hours. */
export function tariffShape(hourly: readonly number[]): TariffShape {
  if (hourly.every((v) => close(v, hourly[0] ?? 0))) return { kind: 'flat', price: hourly[0] ?? 0 };
  const band = (name: string) => hourly.filter((_, h) => TARIFMODEL_3_BANDS[h] === name);
  const [low, high, peak] = ['low', 'high', 'peak'].map(band) as [number[], number[], number[]];
  const uniform = (values: number[]) => values.every((v) => close(v, values[0] ?? 0));
  return uniform(low) && uniform(high) && uniform(peak)
    ? { kind: 'bands', low: low[0] ?? 0, high: high[0] ?? 0, peak: peak[0] ?? 0 }
    : { kind: 'hourly', hourly: [...hourly] };
}
