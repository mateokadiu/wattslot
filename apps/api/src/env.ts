// Explicit imports (not the ambient Workers globals) so tests type-check under Node too.
import type { D1Database, Workflow } from '@cloudflare/workers-types';

export interface JobParams {
  jobId: string;
}

export interface Env {
  DB: D1Database;
  /** One instance per saved plan (PLAN.md §17.7). */
  JOB_WORKFLOW: Workflow<JobParams>;
  /** `off` pauses the outage overview: no fetching, and the API says it is paused. */
  OUTAGES?: string;
  /** Web Push signing key pair, "<public>.<private>" (Workers Secret; see scripts/secret.mjs). */
  VAPID_PRIVATE_KEY?: string;
  /** Key-encryption key for stored push subscriptions (Workers Secret). */
  PUSH_KEK?: string;
  /** Where notifications lead, and the VAPID contact. */
  SITE_URL?: string;
}

export interface Owner {
  id: string;
  locale: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: { owner: Owner };
}
