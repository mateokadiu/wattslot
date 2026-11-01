import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Plan, planEnergy, runFrom, type ScoredSlot, SLOT_MS } from '../src/index.ts';

const T0 = Date.UTC(2026, 10, 2);
const series = (scores: number[], gapsAfter: number[] = []): ScoredSlot[] => {
  let t = T0;
  return scores.map((score, i) => {
    const slot = { startMs: t, score };
    t += gapsAfter.includes(i) ? 2 * SLOT_MS : SLOT_MS;
    return slot;
  });
};

const energyOf = (plan: Plan) => plan.slots.reduce((sum, s) => sum + s.energyWh, 0);
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

/** The best cost over every set of k slots and every choice of the part-full one. */
function bruteInterruptible(slots: ScoredSlot[], energyWh: number, maxPowerW: number) {
  const cap = maxPowerW / 4;
  const k = Math.ceil(energyWh / cap - 1e-9);
  const last = energyWh - (k - 1) * cap;
  let best: number | null = null;
  for (let mask = 0; mask < 1 << slots.length; mask++) {
    const chosen = slots.filter((_, i) => mask & (1 << i));
    if (chosen.length !== k) continue;
    for (const partial of chosen) {
      const cost = chosen.reduce(
        (sum, s) => sum + (s.score * (s === partial ? last : cap)) / 1000,
        0,
      );
      if (best === null || cost < best) best = cost;
    }
  }
  return best;
}

/** The best cost over every start of k back-to-back slots, part-full at the end. */
function bruteContiguous(slots: ScoredSlot[], energyWh: number, maxPowerW: number) {
  const cap = maxPowerW / 4;
  const k = Math.ceil(energyWh / cap - 1e-9);
  const last = energyWh - (k - 1) * cap;
  let best: number | null = null;
  for (let i = 0; i + k <= slots.length; i++) {
    const w = slots.slice(i, i + k);
    if (w.some((s, j) => j > 0 && s.startMs - (w[j - 1] as ScoredSlot).startMs !== SLOT_MS)) {
      continue;
    }
    const cost = w.reduce((sum, s, j) => sum + (s.score * (j === k - 1 ? last : cap)) / 1000, 0);
    if (best === null || cost < best) best = cost;
  }
  return best;
}

const input = (maxSlots: number) =>
  fc.record({
    scores: fc.array(fc.integer({ min: -2_000_000, max: 6_000_000 }), {
      minLength: 1,
      maxLength: maxSlots,
    }),
    gaps: fc.array(fc.nat(maxSlots), { maxLength: 2 }),
    maxPowerW: fc.integer({ min: 100, max: 22_000 }),
    // Energy as a fraction of one slot's capacity: from a sliver to six slots.
    slotsWorth: fc.double({ min: 0.01, max: 6, noNaN: true }),
    contiguous: fc.boolean(),
  });

describe('planEnergy', () => {
  it('fills the last slot only as far as needed', () => {
    // 7.4 kW: 1,850 Wh a slot, so 5 kWh is two full slots and 1,300 Wh.
    const plan = planEnergy({
      slots: series([3, 1, 2, 9, 1]),
      energyWh: 5000,
      maxPowerW: 7400,
      contiguous: false,
    });
    expect(plan?.slots.map((s) => [s.score, s.energyWh])).toEqual([
      [1, 1850],
      [2, 1300],
      [1, 1850],
    ]);
  });

  it('puts the part-full slot on the most expensive chosen one', () => {
    const plan = planEnergy({
      slots: series([5, 1, 8, 2]),
      energyWh: 2500,
      maxPowerW: 4000,
      contiguous: false,
    });
    expect(plan?.slots.map((s) => [s.score, s.energyWh])).toEqual([
      [5, 500],
      [1, 1000],
      [2, 1000],
    ]);
  });

  it('runs a contiguous load in one block, part-full at the end', () => {
    // 1 kW: 250 Wh a slot, so 1.1 kWh is four full slots and 100 Wh — the dear slot at the end.
    const plan = planEnergy({
      slots: series([9, 3, 1, 1, 4, 2, 9, 9]),
      energyWh: 1100,
      maxPowerW: 1000,
      contiguous: true,
    });
    expect(plan?.slots.map((s) => [s.score, s.energyWh])).toEqual([
      [3, 250],
      [1, 250],
      [1, 250],
      [4, 250],
      [2, 100],
    ]);
    expect(plan?.runs).toEqual([
      { startMs: T0 + SLOT_MS, endMs: T0 + 5.4 * SLOT_MS, energyWh: 1100 },
    ]);
  });

  it('rounds a part-full slot up to a whole minute', () => {
    // 1,000 Wh of a 1,850 Wh slot: 8.1 minutes, so 9.
    const plan = planEnergy({
      slots: series([1, 9]),
      energyWh: 1000,
      maxPowerW: 7400,
      contiguous: true,
    });
    expect(plan?.runs).toEqual([{ startMs: T0, endMs: T0 + 9 * 60_000, energyWh: 1000 }]);
  });

  it('ends a run early when its last slot is part-full', () => {
    const plan = planEnergy({
      slots: series([1, 1, 9]),
      energyWh: 1500,
      maxPowerW: 4000,
      contiguous: true,
    });
    // One full slot and half a slot: 15 + 7.5 minutes, rounded up to 23.
    expect(plan?.runs).toEqual([{ startMs: T0, endMs: T0 + 23 * 60_000, energyWh: 1500 }]);
  });

  it('runs a lone part-full slot at the end of its quarter hour when that joins the next run', () => {
    // Slots 1 and 2 are cheapest; slot 1 is the dearer of the two, so it's part-full.
    const plan = planEnergy({
      slots: series([9, 2, 1, 9]),
      energyWh: 1500,
      maxPowerW: 4000,
      contiguous: false,
    });
    expect(plan?.runs).toEqual([
      { startMs: T0 + 22 * 60_000, endMs: T0 + 3 * SLOT_MS, energyWh: 1500 },
    ]);
  });

  it('returns null when the window is too short', () => {
    const slots = series([1, 2]);
    expect(planEnergy({ slots, energyWh: 3000, maxPowerW: 4000, contiguous: false })).toBeNull();
    expect(
      planEnergy({ slots: series([1, 2], [0]), energyWh: 1500, maxPowerW: 4000, contiguous: true }),
    ).toBeNull();
  });

  it('rejects energy or power that isn’t positive', () => {
    const slots = series([1]);
    expect(() => planEnergy({ slots, energyWh: 0, maxPowerW: 1, contiguous: true })).toThrow();
    expect(() => planEnergy({ slots, energyWh: 1, maxPowerW: -1, contiguous: true })).toThrow();
  });

  it('never leaves its window, delivers exactly E and never exceeds the power', () => {
    fc.assert(
      fc.property(input(40), ({ scores, gaps, maxPowerW, slotsWorth, contiguous }) => {
        const slots = series(scores, gaps);
        const energyWh = (maxPowerW / 4) * slotsWorth;
        const plan = planEnergy({ slots, energyWh, maxPowerW, contiguous });
        if (!plan) return;
        const starts = new Set(slots.map((s) => s.startMs));
        expect(plan.slots.every((s) => starts.has(s.startMs))).toBe(true);
        expect(new Set(plan.slots.map((s) => s.startMs)).size).toBe(plan.slots.length);
        expect(close(energyOf(plan), energyWh)).toBe(true);
        expect(plan.slots.every((s) => s.energyWh > 0 && s.energyWh <= maxPowerW / 4 + 1e-6)).toBe(
          true,
        );
        // Runs stay inside the chosen slots and add up to the same energy and running time.
        const first = plan.slots[0]?.startMs ?? 0;
        const end = (plan.slots.at(-1)?.startMs ?? 0) + SLOT_MS;
        expect(plan.runs.every((r) => r.startMs >= first && r.endMs <= end)).toBe(true);
        expect(
          close(
            plan.runs.reduce((sum, r) => sum + r.energyWh, 0),
            energyWh,
          ),
        ).toBe(true);
        // Running time matches the energy, give or take the last slot's round-up to a minute.
        const ranMs = plan.runs.reduce((sum, r) => sum + r.endMs - r.startMs, 0);
        const exactMs = (energyWh / maxPowerW) * 3_600_000;
        expect(ranMs).toBeGreaterThanOrEqual(exactMs - 1);
        expect(ranMs).toBeLessThan(exactMs + 60_000);
        expect(plan.runs.every((r) => r.startMs % 60_000 === 0 && r.endMs % 60_000 === 0)).toBe(
          true,
        );
      }),
    );
  });

  it('equals brute force for up to 12 slots', () => {
    fc.assert(
      fc.property(input(12), ({ scores, gaps, maxPowerW, slotsWorth, contiguous }) => {
        const slots = series(scores, gaps);
        const energyWh = (maxPowerW / 4) * slotsWorth;
        const plan = planEnergy({ slots, energyWh, maxPowerW, contiguous });
        const best = contiguous
          ? bruteContiguous(slots, energyWh, maxPowerW)
          : bruteInterruptible(slots, energyWh, maxPowerW);
        expect(plan === null).toBe(best === null);
        if (plan && best !== null) expect(close(plan.totalScore, best)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('plans a contiguous load as exactly one run', () => {
    fc.assert(
      fc.property(input(40), ({ scores, gaps, maxPowerW, slotsWorth }) => {
        const plan = planEnergy({
          slots: series(scores, gaps),
          energyWh: (maxPowerW / 4) * slotsWorth,
          maxPowerW,
          contiguous: true,
        });
        if (plan) expect(plan.runs).toHaveLength(1);
      }),
    );
  });
});

describe('runFrom', () => {
  it('runs at full power from the given slot', () => {
    const plan = runFrom(series([4, 5, 6, 1]), 1, 2500, 4000);
    expect(plan?.slots.map((s) => [s.score, s.energyWh])).toEqual([
      [5, 1000],
      [6, 1000],
      [1, 500],
    ]);
    expect(plan?.totalScore).toBeCloseTo(5 + 6 + 0.5);
  });

  it('returns null past the end of the data or across a gap', () => {
    expect(runFrom(series([1, 2]), 1, 2000, 4000)).toBeNull();
    expect(runFrom(series([1, 2, 3], [0]), 0, 2000, 4000)).toBeNull();
  });
});
