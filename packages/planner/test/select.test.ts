import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cheapestSlots, cheapestWindow, type ScoredSlot, SLOT_MS } from '../src/index.ts';

const T0 = Date.UTC(2026, 9, 28);
const series = (scores: number[], gapsAfter: number[] = []): ScoredSlot[] => {
  let t = T0;
  return scores.map((score, i) => {
    const slot = { startMs: t, score };
    t += gapsAfter.includes(i) ? 2 * SLOT_MS : SLOT_MS;
    return slot;
  });
};

/** Every contiguous window, the slow way. */
function bruteWindow(slots: ScoredSlot[], length: number) {
  let best: number | null = null;
  for (let i = 0; i + length <= slots.length; i++) {
    const w = slots.slice(i, i + length);
    const contiguous = w.every(
      (s, j) => j === 0 || s.startMs - (w[j - 1]?.startMs ?? 0) === SLOT_MS,
    );
    if (!contiguous) continue;
    const total = w.reduce((sum, s) => sum + s.score, 0);
    if (best === null || total < best) best = total;
  }
  return best;
}

const scores = fc.array(fc.integer({ min: -2_000_000, max: 6_000_000 }), {
  minLength: 1,
  maxLength: 40,
});

describe('cheapestWindow', () => {
  it('finds the overnight trough', () => {
    const s = series([5, 4, 1, 1, 2, 6, 7]);
    expect(cheapestWindow(s, 2)?.slots.map((x) => x.score)).toEqual([1, 1]);
  });

  it('prefers the earliest of equal windows', () => {
    const s = series([3, 1, 1, 9, 1, 1]);
    expect(cheapestWindow(s, 2)?.slots[0]?.startMs).toBe(T0 + SLOT_MS);
  });

  it('never spans a gap in the data', () => {
    const s = series([9, 1, 1, 9], [1]); // gap between the two cheap slots
    expect(cheapestWindow(s, 2)?.slots.map((x) => x.score)).toEqual([9, 1]);
  });

  it('returns null when no contiguous run is long enough', () => {
    expect(cheapestWindow(series([1, 2], [0]), 2)).toBeNull();
    expect(cheapestWindow(series([1]), 2)).toBeNull();
  });

  it('matches brute force on random prices with random gaps', () => {
    fc.assert(
      fc.property(
        scores,
        fc.array(fc.nat(39)),
        fc.integer({ min: 1, max: 12 }),
        (sc, gaps, len) => {
          const s = series(sc, gaps);
          const result = cheapestWindow(s, len);
          expect(result?.totalScore ?? null).toBe(bruteWindow(s, len));
          if (result) {
            expect(result.slots).toHaveLength(len);
            result.slots.forEach((slot, j) => {
              if (j > 0) expect(slot.startMs - (result.slots[j - 1]?.startMs ?? 0)).toBe(SLOT_MS);
            });
          }
        },
      ),
    );
  });

  it('rejects nonsense lengths', () => {
    expect(() => cheapestWindow(series([1]), 0)).toThrow(RangeError);
    expect(() => cheapestWindow(series([1]), 1.5)).toThrow(RangeError);
  });
});

describe('cheapestSlots', () => {
  it('picks the cheapest slots wherever they are, in time order', () => {
    const s = series([5, 1, 7, 2, 0, 9]);
    expect(cheapestSlots(s, 3)?.slots.map((x) => x.score)).toEqual([1, 2, 0]);
  });

  it('is never worse than the best contiguous window, and optimal for its size', () => {
    fc.assert(
      fc.property(scores, fc.integer({ min: 1, max: 12 }), (sc, n) => {
        const s = series(sc);
        const picked = cheapestSlots(s, n);
        if (s.length < n) {
          expect(picked).toBeNull();
          return;
        }
        const sorted = [...sc].sort((a, b) => a - b).slice(0, n);
        expect(picked?.totalScore).toBe(sorted.reduce((a, b) => a + b, 0));
        const window = cheapestWindow(s, n);
        if (window) expect(picked?.totalScore).toBeLessThanOrEqual(window.totalScore);
        const times = picked?.slots.map((x) => x.startMs) ?? [];
        expect(times).toEqual([...times].sort((a, b) => a - b));
      }),
    );
  });
});
