import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env, JobParams } from '../env.ts';
import { planActions } from './actions.ts';
import { currentPlan, takeAction } from './store.ts';

/**
 * One instance per saved plan (PLAN.md §17.7): sleeps until each of the plan's moments, then
 * acts. A workflow re-runs this function from the top after every sleep, using the recorded
 * results of finished steps — so everything outside a step must come from a step's result, never
 * from the clock. The list of actions is derived from the stored plan alone, and step names are
 * fixed per plan version and moment, so a retried or replayed step never acts twice.
 */
export class JobWorkflow extends WorkflowEntrypoint<Env, JobParams> {
  override async run(event: Readonly<WorkflowEvent<JobParams>>, step: WorkflowStep) {
    const { jobId } = event.payload;
    const plan = await step.do('load plan', () => currentPlan(this.env.DB, jobId));
    if (!plan) return 'gone';
    for (const action of planActions(plan.runs)) {
      const name = `${action.kind} v${plan.version} ${new Date(action.atMs).toISOString()}`;
      await step.sleepUntil(`until ${name}`, new Date(action.atMs));
      const live = await step.do(name, () => takeAction(this.env.DB, jobId, action, Date.now()));
      if (!live) return 'cancelled';
    }
    return 'done';
  }
}
