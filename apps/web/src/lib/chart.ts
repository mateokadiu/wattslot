/** Pure chart geometry for the stacked 15-minute price chart. Units: currency per kWh. */

export interface PriceSlot {
  startMs: number;
  spot: number;
  gridTariff: number;
  tsoTariffs: number;
  electricityTax: number;
  vat: number;
  total: number;
}

export const SERIES = ['spot', 'gridTariff', 'tsoTariffs', 'electricityTax', 'vat'] as const;
export type Series = (typeof SERIES)[number];

export interface Segment {
  series: Series;
  /** Lower and upper value of the bar segment; from < to. */
  from: number;
  to: number;
}

/**
 * Stacks a slot's components into bar segments. Positive parts stack upward from zero in
 * SERIES order; a negative part (spot below zero, or negative VAT on a negative subtotal)
 * extends downward from zero, so the bar's net height still reads correctly.
 */
export function stackSlot(slot: PriceSlot): Segment[] {
  const segments: Segment[] = [];
  let up = 0;
  let down = 0;
  for (const series of SERIES) {
    const value = slot[series];
    if (value > 0) {
      segments.push({ series, from: up, to: up + value });
      up += value;
    } else if (value < 0) {
      segments.push({ series, from: down + value, to: down });
      down += value;
    }
  }
  return segments;
}

/** A tidy axis: about `target` intervals at steps of 1, 2, 2.5 or 5 × 10^k, always including 0. */
export function niceTicks(min: number, max: number, target = 6): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (hi === lo) return [0];
  const rough = (hi - lo) / target;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  const first = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= hi + step * 1e-9; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  if (ticks.at(-1) !== undefined && (ticks.at(-1) as number) < hi) {
    ticks.push((ticks.at(-1) as number) + step);
  }
  return ticks.map((t) => Number(t.toPrecision(12)));
}

/** The value range the bars need, before rounding to ticks. */
export function valueExtent(slots: readonly PriceSlot[]): [number, number] {
  let min = 0;
  let max = 0;
  for (const slot of slots) {
    for (const s of stackSlot(slot)) {
      min = Math.min(min, s.from);
      max = Math.max(max, s.to);
    }
  }
  return [min, max];
}

/** Maps a value to a y pixel, top = highest tick. */
export const yScale =
  (ticks: readonly number[], top: number, bottom: number) =>
  (value: number): number => {
    const lo = ticks[0] ?? 0;
    const hi = ticks.at(-1) ?? 1;
    return bottom - ((value - lo) / (hi - lo || 1)) * (bottom - top);
  };
