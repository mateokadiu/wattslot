import type { Run } from '@wattslot/planner';

// What a plan asks of the household, moment by moment (PLAN.md §17.7): start at the beginning
// of each run, pause between runs, and finish at the end of the last one. The job workflow walks
// this list; notifications (P2c) and the "next" shown in My plans describe the same moments.

export type ActionKind = 'start' | 'stop' | 'finish';

export interface Action {
  kind: ActionKind;
  atMs: number;
}

/** Every action of a plan, in time order. Derived only from the runs, so it never depends on the clock. */
export function planActions(runs: readonly Run[]): Action[] {
  const actions: Action[] = [];
  runs.forEach((run, i) => {
    actions.push({ kind: 'start', atMs: run.startMs });
    actions.push({ kind: i === runs.length - 1 ? 'finish' : 'stop', atMs: run.endMs });
  });
  return actions;
}

/** The first action still ahead at `nowMs`, or null when the plan is over. */
export function nextAction(runs: readonly Run[], nowMs: number): Action | null {
  return planActions(runs).find((a) => a.atMs > nowMs) ?? null;
}
