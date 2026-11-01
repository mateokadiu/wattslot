import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env, JobParams } from '../env.ts';
import { notifyJob } from '../push/send.ts';
import { planActions } from './actions.ts';
import { currentPlan, takeAction } from './store.ts';

/** A workflow instance may make 50 requests on the free plan; pushes stay under that. */
const PUSH_BUDGET = 45;

/**
 * One instance per saved plan (PLAN.md §17.7): sleeps until each of the plan's moments, then
 * acts. A workflow re-runs this function from the top after every sleep, using the recorded
 * results of finished steps — so everything outside a step must come from a step's result, never
 * from the clock. The list of actions is derived from the stored plan alone, and step names are
 * fixed per plan version and moment, so a retried or replayed step never acts twice. Status
 * changes and notifications are separate steps: a failed push never undoes or repeats a change.
 */
export class JobWorkflow extends WorkflowEntrypoint<Env, JobParams> {
  override async run(event: Readonly<WorkflowEvent<JobParams>>, step: WorkflowStep) {
    const { jobId } = event.payload;
    const plan = await step.do('load plan', () => currentPlan(this.env.DB, jobId));
    if (!plan) return 'gone';
    // Pushes used so far: a sum of step results, so it replays exactly.
    let pushes = await step.do(`notify planned v${plan.version}`, () =>
      notifyJob(this.env, jobId, 'planned', plan.runs[0]?.startMs ?? 0, PUSH_BUDGET),
    );
    for (const action of planActions(plan.runs)) {
      const name = `${action.kind} v${plan.version} ${new Date(action.atMs).toISOString()}`;
      await step.sleepUntil(`until ${name}`, new Date(action.atMs));
      const live = await step.do(name, () => takeAction(this.env.DB, jobId, action, Date.now()));
      if (!live) return 'cancelled';
      const left = PUSH_BUDGET - pushes;
      pushes += await step.do(`notify ${name}`, () =>
        notifyJob(this.env, jobId, action.kind, action.atMs, left),
      );
    }
    return 'done';
  }
}
