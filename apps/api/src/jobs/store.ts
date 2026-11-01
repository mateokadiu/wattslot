// An explicit import (not the ambient Workers global) so tests type-check under Node too.
import type { D1Database } from '@cloudflare/workers-types';
import { schema } from '@wattslot/db';
import type { Run } from '@wattslot/planner';
import { fromMicro } from '@wattslot/pricing';
import { and, desc, eq, gt, inArray, or } from 'drizzle-orm';
import type { Db } from '../ingest/store.ts';
import type { OptionKind, Planned } from '../plans/preview.ts';
import { type Action, nextAction } from './actions.ts';

// Saved plans (PLAN.md §17.7). A job is what to run and by when; each plan is one version of
// when to run it. Everything is scoped to an owner: another owner's job simply doesn't exist.

export const TASKS = ['dishwasher', 'washing', 'dryer', 'ev'] as const;
export type Task = (typeof TASKS)[number];

/** Per owner and globally (PLAN.md §17.7, "Limits and abuse"). */
export const LIMITS = { livePerOwner: 5, newPerOwnerPerDay: 20, liveTotal: 500 };
/** Ended jobs stay visible (and stored) this long. */
export const KEEP_ENDED_MS = 7 * 86_400_000;
const DAY_MS = 86_400_000;
const LIVE = ['planned', 'running'] as const;

type JobRow = typeof schema.jobs.$inferSelect;
type PlanRow = typeof schema.plans.$inferSelect;

export interface NewJob {
  ownerId: string;
  task: Task;
  zone: string;
  gln: string | null;
  markupMicro: number;
  co2PriceMicroPerKg: number;
  energyWh: number;
  maxPowerW: number;
  contiguous: boolean;
  earliestMs: number;
  deadlineMs: number;
  objective: OptionKind;
}

/** Why a new job can't be saved right now, if it can't. */
export async function quota(
  d1: D1Database,
  ownerId: string,
  nowMs: number,
): Promise<'owner_live' | 'owner_daily' | 'full' | null> {
  const row = await d1
    .prepare(
      `SELECT
         (SELECT count(*) FROM jobs WHERE owner_id = ?1 AND status IN ('planned', 'running')) AS live,
         (SELECT count(*) FROM jobs WHERE owner_id = ?1 AND created_at_ms > ?2) AS today,
         (SELECT count(*) FROM jobs WHERE status IN ('planned', 'running')) AS total`,
    )
    .bind(ownerId, nowMs - DAY_MS)
    .first<{ live: number; today: number; total: number }>();
  if (!row) return null;
  if (row.total >= LIMITS.liveTotal) return 'full';
  if (row.live >= LIMITS.livePerOwner) return 'owner_live';
  if (row.today >= LIMITS.newPerOwnerPerDay) return 'owner_daily';
  return null;
}

/**
 * Stores the job and its first plan in one batch; the job's workflow is started by the caller.
 * Slots go in as one JSON parameter: D1 caps a statement at 100 bound values.
 */
export async function insertJob(
  d1: D1Database,
  job: NewJob,
  plan: Planned,
  provisional: boolean,
  baselines: { startNow: Planned | null; midnight: Planned | null },
  nowMs: number,
): Promise<string> {
  const id = crypto.randomUUID();
  const planId = crypto.randomUUID();
  const { detail } = plan;
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO jobs (id, owner_id, task, zone, grid_gln, supplier_markup_micro,
           co2_price_micro_per_kg, energy_wh, max_power_w, earliest_ms, deadline_ms, contiguous,
           objective, status, workflow_id, created_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'planned', ?1, ?14)`,
      )
      .bind(
        id,
        job.ownerId,
        job.task,
        job.zone,
        job.gln,
        job.markupMicro,
        job.co2PriceMicroPerKg,
        job.energyWh,
        job.maxPowerW,
        job.earliestMs,
        job.deadlineMs,
        job.contiguous ? 1 : 0,
        job.objective,
        nowMs,
      ),
    d1
      .prepare(
        `INSERT INTO plans (id, job_id, version, reason, provisional, runs, cost_micro, co2_grams,
           baseline_now_micro, baseline_midnight_micro, created_at_ms)
         VALUES (?, ?, 1, 'created', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        planId,
        id,
        provisional ? 1 : 0,
        JSON.stringify(detail.runs),
        detail.costMicro,
        detail.co2Grams,
        baselines.startNow?.detail.costMicro ?? null,
        baselines.midnight?.detail.costMicro ?? null,
        nowMs,
      ),
    d1
      .prepare(
        `INSERT INTO plan_slots (plan_id, slot_start_ms, energy_wh, price_micro, co2_g_per_kwh,
           estimated)
         SELECT ?1, value ->> '$[0]', value ->> '$[1]', value ->> '$[2]', value ->> '$[3]',
           value ->> '$[4]'
         FROM json_each(?2)`,
      )
      .bind(
        planId,
        JSON.stringify(
          detail.slots.map((s) => [
            s.startMs,
            s.energyWh,
            s.priceMicro,
            s.co2,
            s.estimated ? 1 : 0,
          ]),
        ),
      ),
  ]);
  return id;
}

export async function deleteJob(d1: D1Database, id: string): Promise<void> {
  await d1.prepare('DELETE FROM jobs WHERE id = ?').bind(id).run();
}

/** The latest plan of each job. */
async function latestPlans(db: Db, jobIds: string[]): Promise<Map<string, PlanRow>> {
  if (jobIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(schema.plans)
    .where(inArray(schema.plans.jobId, jobIds))
    .orderBy(desc(schema.plans.version));
  const latest = new Map<string, PlanRow>();
  for (const r of rows) if (!latest.has(r.jobId)) latest.set(r.jobId, r);
  return latest;
}

/** The owner's live jobs and those ended in the last week, newest first. */
export async function listJobs(db: Db, ownerId: string, nowMs: number) {
  const j = schema.jobs;
  const jobs = await db
    .select()
    .from(j)
    .where(
      and(
        eq(j.ownerId, ownerId),
        or(inArray(j.status, [...LIVE]), gt(j.endedAtMs, nowMs - KEEP_ENDED_MS)),
      ),
    )
    .orderBy(desc(j.createdAtMs))
    .limit(20);
  const plans = await latestPlans(
    db,
    jobs.map((x) => x.id),
  );
  return jobs.flatMap((job) => {
    const plan = plans.get(job.id);
    return plan ? [toJson(job, plan, nowMs)] : [];
  });
}

export async function getJob(db: Db, ownerId: string, id: string, nowMs: number) {
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.id, id), eq(schema.jobs.ownerId, ownerId)));
  if (!job) return null;
  const plan = (await latestPlans(db, [id])).get(id);
  return plan ? toJson(job, plan, nowMs) : null;
}

/** Marks a live job cancelled. Returns its workflow id, or null if it wasn't live (or isn't theirs). */
export async function cancelJob(
  d1: D1Database,
  ownerId: string,
  id: string,
  nowMs: number,
): Promise<string | null> {
  const row = await d1
    .prepare(
      `UPDATE jobs SET status = 'cancelled', ended_at_ms = ?3
       WHERE id = ?1 AND owner_id = ?2 AND status IN ('planned', 'running')
       RETURNING workflow_id AS workflowId`,
    )
    .bind(id, ownerId, nowMs)
    .first<{ workflowId: string }>();
  return row?.workflowId ?? null;
}

/** Workflow ids of the owner's live jobs, to stop them before the owner is deleted. */
export async function liveWorkflowIds(d1: D1Database, ownerId: string): Promise<string[]> {
  const { results } = await d1
    .prepare(
      `SELECT workflow_id AS id FROM jobs WHERE owner_id = ? AND status IN ('planned', 'running')`,
    )
    .bind(ownerId)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

// For the job workflow ---------------------------------------------------------------------------

/** The current plan's version and runs, or null if the job is gone or no longer live. */
export async function currentPlan(
  d1: D1Database,
  jobId: string,
): Promise<{ version: number; runs: Run[] } | null> {
  const row = await d1
    .prepare(
      `SELECT p.version, p.runs FROM plans p JOIN jobs j ON j.id = p.job_id
       WHERE p.job_id = ? AND j.status IN ('planned', 'running')
       ORDER BY p.version DESC LIMIT 1`,
    )
    .bind(jobId)
    .first<{ version: number; runs: string }>();
  return row ? { version: row.version, runs: JSON.parse(row.runs) as Run[] } : null;
}

/**
 * Records that an action's moment has come: a start makes the job running, the finish makes it
 * done. Returns false if the job was cancelled (or deleted) meanwhile, so the workflow stops.
 */
export async function takeAction(
  d1: D1Database,
  jobId: string,
  action: Action,
  nowMs: number,
): Promise<boolean> {
  if (action.kind === 'stop') {
    const row = await d1
      .prepare(`SELECT 1 AS live FROM jobs WHERE id = ? AND status = 'running'`)
      .bind(jobId)
      .first();
    return row !== null;
  }
  const result = await (action.kind === 'start'
    ? d1
        .prepare(
          `UPDATE jobs SET status = 'running' WHERE id = ? AND status IN ('planned', 'running')`,
        )
        .bind(jobId)
    : d1
        .prepare(
          `UPDATE jobs SET status = 'done', ended_at_ms = ?2
             WHERE id = ?1 AND status IN ('planned', 'running')`,
        )
        .bind(jobId, nowMs)
  ).run();
  return result.meta.changes > 0;
}

// API shape --------------------------------------------------------------------------------------

const iso = (ms: number) => new Date(ms).toISOString();

function toJson(job: JobRow, plan: PlanRow, nowMs: number) {
  const runs = plan.runs;
  const next = LIVE.includes(job.status as (typeof LIVE)[number]) ? nextAction(runs, nowMs) : null;
  return {
    id: job.id,
    task: job.task,
    status: job.status,
    objective: job.objective,
    zone: job.zone,
    gln: job.gridGln,
    energyWh: job.energyWh,
    maxPowerW: job.maxPowerW,
    contiguous: job.contiguous,
    earliest: iso(job.earliestMs),
    deadline: iso(job.deadlineMs),
    createdAt: iso(job.createdAtMs),
    endedAt: job.endedAtMs === null ? null : iso(job.endedAtMs),
    plan: {
      version: plan.version,
      provisional: plan.provisional,
      runs: runs.map((r) => ({
        start: iso(r.startMs),
        end: iso(r.endMs),
        energyWh: Math.round(r.energyWh),
      })),
      cost: fromMicro(plan.costMicro),
      co2Kg: plan.co2Grams === null ? null : Math.round(plan.co2Grams) / 1000,
      baselines: {
        startNow: plan.baselineNowMicro === null ? null : fromMicro(plan.baselineNowMicro),
        midnight:
          plan.baselineMidnightMicro === null ? null : fromMicro(plan.baselineMidnightMicro),
      },
    },
    next: next ? { action: next.kind, at: iso(next.atMs) } : null,
  };
}

export type JobJson = ReturnType<typeof toJson>;
