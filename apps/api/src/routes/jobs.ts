import { createRoute, z } from '@hono/zod-openapi';
import { toMicro } from '@wattslot/pricing';
import type { Env } from '../env.ts';
import { openDb } from '../ingest/store.ts';
import {
  cancelJob,
  deleteJob,
  getJob,
  insertJob,
  listJobs,
  liveWorkflowIds,
  quota,
  TASKS,
} from '../jobs/store.ts';
import { createOwner, LOCALES, requireOwner } from '../owners/auth.ts';
import { planPreview, WindowTooShortError } from '../plans/preview.ts';
import { ErrorBody, router } from '../router.ts';
import { LoadFields, RunBody, windowProblem } from './plans.ts';

// Saved plans (PLAN.md §17.7): an anonymous owner token, jobs that belong to it, and one workflow
// per job. Another owner's job is a 404, never a 403.

const error = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorBody } },
});
const bearer = [{ ownerToken: [] }];

const Job = z
  .object({
    id: z.string(),
    task: z.enum(TASKS),
    status: z.enum(['planned', 'running', 'done', 'cancelled', 'failed']),
    objective: z.enum(['cheapest', 'balanced', 'greenest']),
    zone: z.string(),
    gln: z.string().nullable(),
    energyWh: z.number(),
    maxPowerW: z.number(),
    contiguous: z.boolean(),
    earliest: z.string(),
    deadline: z.string(),
    createdAt: z.string(),
    endedAt: z.string().nullable(),
    plan: z.object({
      version: z.number(),
      provisional: z.boolean(),
      runs: z.array(RunBody),
      cost: z.number(),
      co2Kg: z.number().nullable(),
      baselines: z.object({ startNow: z.number().nullable(), midnight: z.number().nullable() }),
    }),
    next: z
      .object({ action: z.enum(['start', 'stop', 'finish']), at: z.string() })
      .nullable()
      .openapi({ description: 'The next moment to act, while the job is live' }),
  })
  .openapi('Job');

const createOwnerRoute = createRoute({
  method: 'post',
  path: '/owners',
  summary: 'Get an owner token for saving plans',
  description:
    'No account: the token is the only key to the plans saved with it, and it is shown once. Keep it in the browser that saved the plans.',
  request: {
    body: {
      content: {
        'application/json': { schema: z.object({ locale: z.enum(LOCALES).default('en') }) },
      },
      required: true,
    },
  },
  responses: {
    201: {
      description: 'The new owner token',
      content: { 'application/json': { schema: z.object({ ownerToken: z.string() }) } },
    },
    400: error('Invalid request'),
    503: error('Too many new owners today; try again tomorrow'),
  },
});

const deleteOwnerRoute = createRoute({
  method: 'delete',
  path: '/owners/me',
  summary: 'Delete the owner and everything saved with it',
  security: bearer,
  responses: { 204: { description: 'Deleted' }, 401: error('No valid owner token') },
});

const createJobRoute = createRoute({
  method: 'post',
  path: '/jobs',
  summary: 'Save a plan',
  description:
    'Plans the load as /v1/plan-preview does, stores the chosen option and follows it through: the job becomes running at its first start and done at its end.',
  security: bearer,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              ...LoadFields,
              task: z.enum(TASKS),
              objective: z.enum(['cheapest', 'balanced', 'greenest']).default('cheapest'),
            })
            .openapi('JobRequest'),
        },
      },
      required: true,
    },
  },
  responses: {
    201: { description: 'The saved job', content: { 'application/json': { schema: Job } } },
    400: error('Invalid request'),
    401: error('No valid owner token'),
    404: error('Unknown zone or grid company'),
    422: error("The window can't hold the load, or there are no prices for it yet"),
    429: error('This owner has too many plans'),
    503: error('Plans are full right now'),
  },
});

const listJobsRoute = createRoute({
  method: 'get',
  path: '/jobs',
  summary: 'Live plans, and those that ended in the last week',
  security: bearer,
  responses: {
    200: {
      description: 'Newest first',
      content: { 'application/json': { schema: z.object({ jobs: z.array(Job) }) } },
    },
    401: error('No valid owner token'),
  },
});

const idParam = z.object({ id: z.uuid() });

const getJobRoute = createRoute({
  method: 'get',
  path: '/jobs/{id}',
  summary: 'One saved plan',
  security: bearer,
  request: { params: idParam },
  responses: {
    200: { description: 'The job', content: { 'application/json': { schema: Job } } },
    401: error('No valid owner token'),
    404: error('No such job'),
  },
});

const cancelJobRoute = createRoute({
  method: 'delete',
  path: '/jobs/{id}',
  summary: 'Cancel a plan',
  description: 'Stops its workflow. Cancelling an ended job changes nothing.',
  security: bearer,
  request: { params: idParam },
  responses: {
    200: {
      description: 'The job, now cancelled',
      content: { 'application/json': { schema: Job } },
    },
    401: error('No valid owner token'),
    404: error('No such job'),
  },
});

/** Stops a job's workflow; one that already ended (or never started) is fine. */
async function stopWorkflow(env: Env, workflowId: string) {
  try {
    await (await env.JOB_WORKFLOW.get(workflowId)).terminate();
  } catch (e) {
    console.warn(JSON.stringify({ event: 'workflow_terminate', workflowId, message: String(e) }));
  }
}

const QUOTA = {
  owner_live: [429, 'too_many_plans', 'You already have 5 plans waiting. Cancel one first.'],
  owner_daily: [429, 'too_many_plans', "That's 20 new plans today. Try again tomorrow."],
  full: [503, 'plans_full', 'Plans are full right now. Try again later.'],
} as const;

export const jobRoutes = router();
jobRoutes.use('/owners/me', requireOwner);
jobRoutes.use('/jobs', requireOwner);
jobRoutes.use('/jobs/*', requireOwner);

jobRoutes
  .openapi(createOwnerRoute, async (c) => {
    const { locale } = c.req.valid('json');
    const owner = await createOwner(c.env.DB, locale, Date.now());
    c.header('Cache-Control', 'no-store');
    if (owner === 'full') {
      return c.json(
        { error: 'owners_full', message: 'Too many new plan owners today. Try again tomorrow.' },
        503,
      );
    }
    return c.json({ ownerToken: owner.token }, 201);
  })
  .openapi(deleteOwnerRoute, async (c) => {
    const owner = c.get('owner');
    for (const id of await liveWorkflowIds(c.env.DB, owner.id)) await stopWorkflow(c.env, id);
    // Jobs, plans and slots go with it (ON DELETE CASCADE).
    await c.env.DB.prepare('DELETE FROM owners WHERE id = ?').bind(owner.id).run();
    return c.body(null, 204);
  })
  .openapi(createJobRoute, async (c) => {
    const body = c.req.valid('json');
    const owner = c.get('owner');
    const nowMs = Date.now();
    const deadlineMs = Date.parse(body.deadline);
    const earliestMs = body.earliest ? Date.parse(body.earliest) : undefined;
    const problem = windowProblem(deadlineMs, earliestMs, nowMs);
    if (problem) return c.json({ error: 'invalid_request', message: problem }, 400);
    const limited = await quota(c.env.DB, owner.id, nowMs);
    if (limited) {
      const [status, code, message] = QUOTA[limited];
      return c.json({ error: code, message }, status);
    }

    const db = openDb(c.env.DB);
    let preview: Awaited<ReturnType<typeof planPreview>>;
    try {
      preview = await planPreview(db, c.env.DB, { ...body, earliestMs, deadlineMs }, nowMs);
    } catch (e) {
      if (e instanceof WindowTooShortError) {
        return c.json({ error: 'window_too_short', message: e.message }, 422);
      }
      throw e;
    }
    // Balanced and greenest need CO₂ data; without it, they are the cheapest plan.
    const option =
      preview.options.find((o) => o.kind === body.objective) ??
      preview.options.find((o) => o.kind === 'cheapest');
    if (!option) {
      return c.json(
        { error: 'no_prices', message: 'Not enough prices in this window yet to plan it.' },
        422,
      );
    }

    const jobId = await insertJob(
      c.env.DB,
      {
        ownerId: owner.id,
        task: body.task,
        zone: preview.priced.zone.code,
        gln: preview.priced.mode === 'full' ? (body.gln ?? null) : null,
        markupMicro: toMicro(body.markup),
        co2PriceMicroPerKg: toMicro(body.co2Price),
        energyWh: body.energyWh,
        maxPowerW: body.maxPowerW,
        contiguous: body.contiguous,
        earliestMs: preview.fromMs,
        deadlineMs: preview.toMs,
        objective: option.kind,
      },
      option,
      preview.estimatedFromMs !== null,
      preview.baselines,
      nowMs,
    );
    try {
      await c.env.JOB_WORKFLOW.create({ id: jobId, params: { jobId } });
    } catch (e) {
      await deleteJob(c.env.DB, jobId);
      throw e;
    }
    const job = await getJob(db, owner.id, jobId, nowMs);
    if (!job) throw new Error(`job ${jobId} vanished after saving`);
    return c.json(job, 201);
  })
  .openapi(listJobsRoute, async (c) => {
    const jobs = await listJobs(openDb(c.env.DB), c.get('owner').id, Date.now());
    return c.json({ jobs }, 200);
  })
  .openapi(getJobRoute, async (c) => {
    const job = await getJob(
      openDb(c.env.DB),
      c.get('owner').id,
      c.req.valid('param').id,
      Date.now(),
    );
    return job ? c.json(job, 200) : c.json({ error: 'not_found' }, 404);
  })
  .openapi(cancelJobRoute, async (c) => {
    const { id } = c.req.valid('param');
    const owner = c.get('owner');
    const nowMs = Date.now();
    const workflowId = await cancelJob(c.env.DB, owner.id, id, nowMs);
    if (workflowId) await stopWorkflow(c.env, workflowId);
    const job = await getJob(openDb(c.env.DB), owner.id, id, nowMs);
    return job ? c.json(job, 200) : c.json({ error: 'not_found' }, 404);
  });
