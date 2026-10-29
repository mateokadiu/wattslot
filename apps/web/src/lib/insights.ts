import { cheapestSlots, cheapestWindow } from '@wattslot/planner';
import type { PriceSlot } from './chart';

export const SLOT_MS = 900_000;

export type Level = 'cheap' | 'normal' | 'expensive';

/** Value at quantile q (0–1) of a sorted list, interpolated. */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo);
}

/**
 * Cheap, normal or expensive by thirds of the given slots' all-in prices. A flat day is all
 * normal — nothing is cheap if nothing is cheaper.
 */
export function priceLevels(
  slots: readonly Pick<PriceSlot, 'startMs' | 'total'>[],
): Map<number, Level> {
  const sorted = slots.map((s) => s.total).sort((a, b) => a - b);
  const low = quantile(sorted, 1 / 3);
  const high = quantile(sorted, 2 / 3);
  const flat = (sorted.at(-1) ?? 0) - (sorted[0] ?? 0) < 1e-9;
  return new Map(
    slots.map((s) => [
      s.startMs,
      flat ? 'normal' : s.total <= low ? 'cheap' : s.total >= high ? 'expensive' : 'normal',
    ]),
  );
}

export type Verdict =
  | { kind: 'now'; current: PriceSlot }
  | { kind: 'wait'; current: PriceSlot; from: number; average: number; saving: number }
  | { kind: 'unknown' };

/** Waiting has to save at least this much to be worth saying so. */
const WORTH_WAITING = 0.1;

/**
 * Is now a good time? Compares the current quarter hour with the cheapest hour in the next 24
 * hours of published prices. "Wait" only when that hour is at least 10% cheaper.
 */
export function verdict(slots: readonly PriceSlot[], nowMs: number): Verdict {
  const current = slots.find((s) => nowMs >= s.startMs && nowMs < s.startMs + SLOT_MS);
  if (!current) return { kind: 'unknown' };
  const horizon = slots.filter(
    (s) => s.startMs >= current.startMs && s.startMs < current.startMs + 24 * 3_600_000,
  );
  const best = cheapestWindow(
    horizon.map((s) => ({ startMs: s.startMs, score: s.total })),
    Math.min(4, horizon.length),
  );
  if (!best) return { kind: 'now', current };
  const average = best.totalScore / best.slots.length;
  const from = best.slots[0]?.startMs ?? current.startMs;
  const saving = current.total > 0 ? 1 - average / current.total : 0;
  return from > current.startMs && saving >= WORTH_WAITING
    ? { kind: 'wait', current, from, average, saving }
    : { kind: 'now', current };
}

export interface Task {
  id: string;
  energyKwh: number;
  powerKw: number;
  canPause: boolean;
}

/** Typical consumption; the UI states these numbers so the estimate is honest. */
export const TASKS: readonly Task[] = [
  { id: 'dishwasher', energyKwh: 1.1, powerKw: 0.55, canPause: false },
  { id: 'washing', energyKwh: 0.9, powerKw: 0.45, canPause: false },
  { id: 'dryer', energyKwh: 2, powerKw: 1, canPause: false },
  { id: 'ev', energyKwh: 20, powerKw: 7.4, canPause: true },
];

export interface TaskPlan {
  slots: PriceSlot[];
  start: number;
  end: number;
  /** Cost of the task in the plan, in the price currency. */
  cost: number;
  /** Cost of the same task in the comparison case, or null if there isn't one. */
  baselineCost: number | null;
}

/** How many quarter hours a task runs, at full power except possibly the last. */
export const slotsFor = (task: Task) => Math.ceil(task.energyKwh / (task.powerKw / 4) - 1e-9);

/**
 * The cheapest way to run a task within `candidates`, compared with `baseline` slots (starting
 * now, or the day's average). Energy is spread evenly over the chosen quarter hours.
 */
export function planTask(
  candidates: readonly PriceSlot[],
  task: Task,
  baseline: 'start' | 'average',
): TaskPlan | null {
  const count = slotsFor(task);
  const scored = candidates.map((s) => ({ startMs: s.startMs, score: s.total, slot: s }));
  const best = task.canPause ? cheapestSlots(scored, count) : cheapestWindow(scored, count);
  if (!best) return null;
  const perSlot = task.energyKwh / count;
  const cost = best.totalScore * perSlot;
  let baselineCost: number | null = null;
  if (baseline === 'start') {
    const first = cheapestWindow(scored.slice(0, count), count);
    baselineCost = first ? first.totalScore * perSlot : null;
  } else if (candidates.length > 0) {
    baselineCost =
      (candidates.reduce((sum, s) => sum + s.total, 0) / candidates.length) * task.energyKwh;
  }
  const slots = best.slots.map((s) => s.slot);
  return {
    slots,
    start: slots[0]?.startMs ?? 0,
    end: (slots.at(-1)?.startMs ?? 0) + SLOT_MS,
    cost,
    baselineCost,
  };
}

/** Averages each run of four quarter hours into one hourly bar (for narrow screens). */
export function hourly(slots: readonly PriceSlot[]): PriceSlot[] {
  const hours: PriceSlot[] = [];
  for (let i = 0; i < slots.length; i += 4) {
    const group = slots.slice(i, i + 4);
    const avg = (key: keyof Omit<PriceSlot, 'startMs'>) =>
      group.reduce((sum, s) => sum + s[key], 0) / group.length;
    hours.push({
      startMs: group[0]?.startMs ?? 0,
      spot: avg('spot'),
      gridTariff: avg('gridTariff'),
      tsoTariffs: avg('tsoTariffs'),
      electricityTax: avg('electricityTax'),
      vat: avg('vat'),
      total: avg('total'),
    });
  }
  return hours;
}
