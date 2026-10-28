import { describe, expect, it } from 'vitest';
import type { PriceSlot } from '../src/lib/chart';
import {
  hourly,
  planTask,
  priceLevels,
  SLOT_MS,
  slotsFor,
  TASKS,
  type Task,
  verdict,
} from '../src/lib/insights';

const T0 = Date.UTC(2026, 9, 27, 23); // 00:00 Copenhagen, 28 Oct
const day = (totals: number[]): PriceSlot[] =>
  totals.map((total, i) => ({
    startMs: T0 + i * SLOT_MS,
    spot: total * 0.6,
    gridTariff: total * 0.2,
    tsoTariffs: 0,
    electricityTax: 0,
    vat: total * 0.2,
    total,
  }));
const task = (id: string): Task => TASKS.find((t) => t.id === id) ?? (TASKS[0] as Task);

describe('priceLevels', () => {
  it('splits a day into thirds', () => {
    const levels = priceLevels(day([1, 2, 3, 4, 5, 6]));
    expect([...levels.values()]).toEqual([
      'cheap',
      'cheap',
      'normal',
      'normal',
      'expensive',
      'expensive',
    ]);
  });
  it('calls nothing cheap on a flat day', () => {
    expect(new Set(priceLevels(day([2, 2, 2, 2])).values())).toEqual(new Set(['normal']));
  });
});

describe('verdict', () => {
  it('says wait when a cheaper hour is coming', () => {
    const slots = day([4, 4, 4, 4, 1, 1, 1, 1, 4, 4]);
    const v = verdict(slots, T0 + 60_000);
    expect(v).toMatchObject({ kind: 'wait', from: T0 + 4 * SLOT_MS, average: 1 });
    if (v.kind === 'wait') expect(v.saving).toBeCloseTo(0.75, 9);
  });
  it('says now when nothing is meaningfully cheaper', () => {
    expect(verdict(day([2, 2, 1.9, 1.9, 1.95, 2]), T0).kind).toBe('now');
  });
  it('knows nothing outside the published prices', () => {
    expect(verdict(day([1, 2]), T0 - SLOT_MS).kind).toBe('unknown');
  });
});

describe('planTask', () => {
  it('needs whole quarter hours at the appliance’s power', () => {
    expect(slotsFor(task('dishwasher'))).toBe(8); // 1.1 kWh at 0.55 kW = 2 h
    expect(slotsFor(task('ev'))).toBe(11); // 20 kWh at 7.4 kW = 2.7 h → 11 quarter hours
  });

  it('prices a dishwasher run in kroner and compares it with starting now', () => {
    const prices = day([5, 5, 5, 5, 5, 5, 5, 5, 1, 1, 1, 1, 1, 1, 1, 1]);
    const plan = planTask(prices, task('dishwasher'), 'start');
    expect(plan?.start).toBe(T0 + 8 * SLOT_MS);
    expect(plan?.cost).toBeCloseTo(1.1, 9); // 1.1 kWh at 1 kr.
    expect(plan?.baselineCost).toBeCloseTo(5.5, 9); // 1.1 kWh at 5 kr.
  });

  it('lets an EV charge in the cheapest scattered quarter hours', () => {
    const prices = day([1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9]);
    const plan = planTask(prices, task('ev'), 'average');
    expect(plan?.slots.every((s) => s.total === 1)).toBe(true);
    expect(plan?.cost).toBeCloseTo(20, 9);
    expect(plan?.baselineCost).toBeCloseTo(100, 9); // average 5 kr. × 20 kWh
  });

  it('returns null when the task does not fit', () => {
    expect(planTask(day([1, 2, 3]), task('dishwasher'), 'start')).toBeNull();
  });
});

describe('hourly', () => {
  it('averages quarter hours into hours', () => {
    const hours = hourly(day([1, 2, 3, 4, 5, 5, 5, 5]));
    expect(hours.map((h) => h.total)).toEqual([2.5, 5]);
    expect(hours[1]?.startMs).toBe(T0 + 4 * SLOT_MS);
  });
});
