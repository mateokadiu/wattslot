/** A 15-minute slot with a score to minimise (an all-in price, a CO₂ value, or a blend). */
export interface ScoredSlot {
  startMs: number;
  score: number;
}

export const SLOT_MS = 15 * 60_000;

export interface Selection<T extends ScoredSlot> {
  slots: T[];
  totalScore: number;
}

/**
 * The cheapest run of `length` consecutive slots, for loads that can't pause (a dishwasher
 * programme). Windows never span a gap in the data. Ties go to the earliest window.
 * `slots` must be sorted by start time.
 */
export function cheapestWindow<T extends ScoredSlot>(
  slots: readonly T[],
  length: number,
): Selection<T> | null {
  if (!Number.isInteger(length) || length < 1)
    throw new RangeError(`length must be ≥ 1, got ${length}`);
  let best: { start: number; total: number } | null = null;
  let runStart = 0;
  let sum = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i] as T;
    if (i > 0 && slot.startMs - (slots[i - 1] as T).startMs !== SLOT_MS) {
      runStart = i; // a gap: start a new contiguous run
      sum = 0;
    }
    sum += slot.score;
    if (i - runStart + 1 > length) sum -= (slots[i - length] as T).score;
    if (i - runStart + 1 >= length) {
      const start = i - length + 1;
      if (best === null || sum < best.total) best = { start, total: sum };
    }
  }
  if (best === null) return null;
  return { slots: slots.slice(best.start, best.start + length), totalScore: best.total };
}

/**
 * The `count` cheapest slots in any order, for loads that can pause (EV charging). Returned in
 * time order. Ties go to the earlier slot.
 */
export function cheapestSlots<T extends ScoredSlot>(
  slots: readonly T[],
  count: number,
): Selection<T> | null {
  if (!Number.isInteger(count) || count < 1)
    throw new RangeError(`count must be ≥ 1, got ${count}`);
  if (slots.length < count) return null;
  const chosen = [...slots]
    .sort((a, b) => a.score - b.score || a.startMs - b.startMs)
    .slice(0, count)
    .sort((a, b) => a.startMs - b.startMs);
  return { slots: chosen, totalScore: chosen.reduce((sum, s) => sum + s.score, 0) };
}
