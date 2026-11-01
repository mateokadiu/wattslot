export interface JobParams {
  jobId: string;
}

export interface Env {
  DB: D1Database;
  /** One instance per saved plan (PLAN.md §17.7). */
  JOB_WORKFLOW: Workflow<JobParams>;
  /** `off` pauses the outage overview: no fetching, and the API says it is paused. */
  OUTAGES?: string;
}

export interface Owner {
  id: string;
  locale: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { owner: Owner };
}
