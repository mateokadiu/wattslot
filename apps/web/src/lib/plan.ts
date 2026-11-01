import { addDays, localTime, wallClockToUtc } from '@wattslot/pricing';

// The "Plan" form's side of POST /v1/plan-preview (see apps/api/src/routes/plans.ts).

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

export type OptionKind = 'cheapest' | 'balanced' | 'greenest';

export interface PlanRun {
  start: string;
  end: string;
  energyWh: number;
}

export interface PlanSummary {
  runs: PlanRun[];
  cost: number;
  co2Kg: number | null;
  estimated: boolean;
}

export interface PlanPreview {
  zone: string;
  currency: string;
  mode: 'full' | 'spot-only';
  note: string | null;
  from: string;
  to: string;
  provisional: boolean;
  estimatedFrom: string | null;
  options: ({ kind: OptionKind } & PlanSummary)[];
  baselines: {
    startNow: PlanSummary | null;
    midnight: (PlanSummary & { start: string }) | null;
  };
  message: string | null;
}

export interface PlanRequest {
  zone: string;
  gln?: string;
  energyWh: number;
  maxPowerW: number;
  contiguous: boolean;
  earliest?: string;
  deadline: string;
}

export type PlanResult =
  | { kind: 'ok'; preview: PlanPreview }
  | { kind: 'too-short' }
  | { kind: 'error' };

export async function fetchPlan(body: PlanRequest, signal?: AbortSignal): Promise<PlanResult> {
  try {
    const response = await fetch(`${BASE}/v1/plan-preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (response.status === 422) return { kind: 'too-short' };
    if (!response.ok) return { kind: 'error' };
    return { kind: 'ok', preview: (await response.json()) as PlanPreview };
  } catch {
    return { kind: 'error' };
  }
}

/**
 * The next time the zone's clocks show `hhmm` at or after `notBeforeMs` — "done by 07:00" means
 * the next 07:00 that still leaves time to run.
 */
export function nextLocalTime(hhmm: string, timeZone: string, notBeforeMs: number): number {
  let date = localTime(notBeforeMs, timeZone).date;
  for (let i = 0; i < 3; i++) {
    const at = wallClockToUtc(`${date}T${hhmm}`, timeZone);
    if (at >= notBeforeMs) return at;
    date = addDays(date, 1);
  }
  throw new RangeError(`no ${hhmm} after ${notBeforeMs}`);
}

/** The power that runs `energyWh` in exactly `minutes`, rounded up so it never needs a slot more. */
export const powerFor = (energyWh: number, minutes: number) => Math.ceil((energyWh * 60) / minutes);

/** True when two summaries run at the same times (so an option can say "same as cheapest"). */
export const sameRuns = (a: PlanSummary, b: PlanSummary) =>
  a.runs.length === b.runs.length &&
  a.runs.every((r, i) => r.start === b.runs[i]?.start && r.end === b.runs[i]?.end);
