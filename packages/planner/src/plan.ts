import { type ScoredSlot, SLOT_MS } from './select.ts';

// Energy-exact plans. A load needs E Wh at up to P W; a 15-minute slot holds at most P/4 Wh, so
// a plan uses k = ceil(E / (P/4)) slots, all at full power except possibly one.

export interface PlanInput {
  /** Candidate slots in time order; `score` is per kWh (an all-in price, or price plus CO₂). */
  slots: readonly ScoredSlot[];
  energyWh: number;
  maxPowerW: number;
  /** True for loads that can't pause once started (a dishwasher programme). */
  contiguous: boolean;
}

export interface PlannedSlot {
  startMs: number;
  score: number;
  energyWh: number;
}

/** A stretch of uninterrupted running: what a notification or a calendar event describes. */
export interface Run {
  startMs: number;
  endMs: number;
  energyWh: number;
}

export interface Plan {
  /** In time order. */
  slots: PlannedSlot[];
  runs: Run[];
  /** Σ score × kWh: the plan's cost (or cost plus CO₂ value) in the score's units. */
  totalScore: number;
}

const EPS = 1e-9;

/** How many slots a load occupies: full ones, and a last one only as full as it needs. */
export function slotCount(energyWh: number, maxPowerW: number): number {
  if (!(energyWh > 0) || !(maxPowerW > 0)) {
    throw new RangeError('energyWh and maxPowerW must be positive');
  }
  return Math.max(1, Math.ceil(energyWh / (maxPowerW / 4) - EPS));
}

const isNext = (a: ScoredSlot, b: ScoredSlot) => b.startMs - a.startMs === SLOT_MS;

const MINUTE_MS = 60_000;

/**
 * Groups planned slots into runs. A part-full slot runs at the start of its quarter hour, or at
 * the end when that joins it to the slot after (so 0.5 + 1 slots is one run, not two). Its time
 * rounds up to a whole minute: people start and stop things on the minute, and a few seconds
 * more never deliver less.
 */
export function toRuns(slots: readonly PlannedSlot[], maxPowerW: number): Run[] {
  const capacityWh = maxPowerW / 4;
  const chosen = new Set(slots.map((s) => s.startMs));
  const runs: Run[] = [];
  for (const s of slots) {
    const exactMs = (Math.min(s.energyWh, capacityWh) / capacityWh) * SLOT_MS;
    const durationMs = Math.min(SLOT_MS, Math.ceil(exactMs / MINUTE_MS - EPS) * MINUTE_MS);
    const late =
      durationMs < SLOT_MS && !chosen.has(s.startMs - SLOT_MS) && chosen.has(s.startMs + SLOT_MS);
    const startMs = late ? s.startMs + SLOT_MS - durationMs : s.startMs;
    const last = runs.at(-1);
    if (last && last.endMs === startMs) {
      last.endMs = startMs + durationMs;
      last.energyWh += s.energyWh;
    } else {
      runs.push({ startMs, endMs: startMs + durationMs, energyWh: s.energyWh });
    }
  }
  return runs;
}

function finish(chosen: PlannedSlot[], maxPowerW: number): Plan {
  chosen.sort((a, b) => a.startMs - b.startMs);
  return {
    slots: chosen,
    runs: toRuns(chosen, maxPowerW),
    totalScore: chosen.reduce((sum, s) => sum + (s.score * s.energyWh) / 1000, 0),
  };
}

const fill = (slots: readonly ScoredSlot[], capacityWh: number, lastWh: number, partial: number) =>
  slots.map((s, j) => ({
    startMs: s.startMs,
    score: s.score,
    energyWh: j === partial ? lastWh : capacityWh,
  }));

/**
 * The plan with the lowest total score that delivers exactly `energyWh`, or null if the slots
 * can't hold it. Interruptible loads take the k best slots with the part-full one being the
 * worst of them (optimal, as in a fractional knapsack); contiguous loads take the best window
 * of k back-to-back slots, part-full at the end, never across a gap in the data. Slots run from
 * their start (a programme starts on the quarter hour). Ties go to the earliest choice.
 */
export function planEnergy({ slots, energyWh, maxPowerW, contiguous }: PlanInput): Plan | null {
  const k = slotCount(energyWh, maxPowerW);
  const capacityWh = maxPowerW / 4;
  const lastWh = energyWh - (k - 1) * capacityWh;
  if (slots.length < k) return null;

  if (!contiguous) {
    const ranked = [...slots]
      .sort((a, b) => a.score - b.score || a.startMs - b.startMs)
      .slice(0, k);
    return finish(fill(ranked, capacityWh, lastWh, k - 1), maxPowerW);
  }

  // prefix[i] = Σ score of slots[0..i); a window [s, s+k) costs cap × Σ(first k−1) + last × end.
  const prefix = [0];
  for (const s of slots) prefix.push((prefix.at(-1) as number) + s.score);
  let best: { start: number; cost: number } | null = null;
  let runStart = 0;
  for (let i = 0; i < slots.length; i++) {
    if (i > 0 && !isNext(slots[i - 1] as ScoredSlot, slots[i] as ScoredSlot)) runStart = i;
    const start = i - k + 1;
    if (start < runStart) continue;
    const cost =
      capacityWh * ((prefix[i] as number) - (prefix[start] as number)) +
      lastWh * (slots[i] as ScoredSlot).score;
    if (best === null || cost < best.cost - EPS * Math.max(1, Math.abs(best.cost))) {
      best = { start, cost };
    }
  }
  if (best === null) return null;
  return finish(
    fill(slots.slice(best.start, best.start + k), capacityWh, lastWh, k - 1),
    maxPowerW,
  );
}

/**
 * Running at full power from `slots[from]` until the energy is delivered: the "start now" and
 * "midnight timer" baselines (§8.5). Null if the slots run out or have a gap first.
 */
export function runFrom(
  slots: readonly ScoredSlot[],
  from: number,
  energyWh: number,
  maxPowerW: number,
): Plan | null {
  const k = slotCount(energyWh, maxPowerW);
  const capacityWh = maxPowerW / 4;
  const window = slots.slice(from, from + k);
  if (from < 0 || window.length < k) return null;
  for (let j = 1; j < k; j++) {
    if (!isNext(window[j - 1] as ScoredSlot, window[j] as ScoredSlot)) return null;
  }
  return finish(fill(window, capacityWh, energyWh - (k - 1) * capacityWh, k - 1), maxPowerW);
}
