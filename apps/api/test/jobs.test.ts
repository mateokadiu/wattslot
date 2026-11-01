import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planActions } from '../src/jobs/actions.ts';
import { type Harness, startWorker } from './harness.ts';

// Saved plans against the real worker: owner tokens, jobs scoped to their owner, limits, and the
// job workflow running in workerd. Jobs are planned from the real clock, so DK2 gets a week of
// made-up history to estimate from; workflow tests store plans whose moments are seconds away.

let h: Harness;
const DAY = 86_400_000;
const SLOT = 900_000;

beforeAll(async () => {
  h = await startWorker();
  const now = Math.floor(Date.now() / SLOT) * SLOT;
  const rows: [number, number][] = [];
  for (let t = now - 8 * DAY; t < now; t += SLOT) {
    rows.push([t, 500_000 + ((t / SLOT) % 96) * 10_000]);
  }
  await h.db
    .prepare(
      `INSERT INTO spot_prices (zone, slot_start_ms, price_micro, price_eur_micro, source)
       SELECT 'DK2', value ->> '$[0]', value ->> '$[1]', 0, 'test' FROM json_each(?)`,
    )
    .bind(JSON.stringify(rows))
    .run();
}, 60_000);

afterAll(async () => {
  await h?.dispose();
});

const call = (method: string, path: string, token?: string, body?: unknown) =>
  h.mf.dispatchFetch(`http://api/v1${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

async function newOwner(): Promise<string> {
  const response = await call('POST', '/owners', undefined, { locale: 'da' });
  expect(response.status).toBe(201);
  return ((await response.json()) as { ownerToken: string }).ownerToken;
}

async function ownerId(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const row = await h.db
    .prepare('SELECT id FROM owners WHERE token_hash = ?')
    .bind(hash)
    .first<{ id: string }>();
  if (!row) throw new Error('owner not found');
  return row.id;
}

const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const dishwasher = (objective = 'cheapest') => ({
  zone: 'DK2',
  task: 'dishwasher',
  energyWh: 1100,
  maxPowerW: 550,
  contiguous: true,
  deadline: inHours(8),
  objective,
});

interface Job {
  id: string;
  status: string;
  objective: string;
  plan: { version: number; provisional: boolean; runs: { start: string; end: string }[] };
  next: { action: string; at: string } | null;
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 15_000) {
  const until = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 100));
    value = await read();
  }
  return value;
}

const jobStatus = (id: string) =>
  h.db
    .prepare('SELECT status FROM jobs WHERE id = ?')
    .bind(id)
    .first<{ status: string }>()
    .then((r) => r?.status ?? 'gone');

describe('planActions', () => {
  it('starts each run, pauses between runs and finishes at the end of the last', () => {
    expect(
      planActions([
        { startMs: 1, endMs: 2, energyWh: 1 },
        { startMs: 5, endMs: 9, energyWh: 1 },
      ]),
    ).toEqual([
      { kind: 'start', atMs: 1 },
      { kind: 'stop', atMs: 2 },
      { kind: 'start', atMs: 5 },
      { kind: 'finish', atMs: 9 },
    ]);
  });
});

describe('owners', () => {
  it('issues a 256-bit token and stores only its hash', async () => {
    const token = await newOwner();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await h.db
      .prepare('SELECT * FROM owners WHERE id = ?')
      .bind(await ownerId(token))
      .first<Record<string, unknown>>();
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row?.locale).toBe('da');
  });

  it('refuses requests without a valid token, saying nothing more', async () => {
    for (const token of [undefined, 'nope', 'A'.repeat(43)]) {
      const response = await call('GET', '/jobs', token);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('keeps personal responses out of the shared edge cache', async () => {
    const response = await call('GET', '/jobs', await newOwner());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-cache')).toBeNull();
  });
});

describe('jobs', () => {
  it('saves a plan, starts its workflow and lists it', async () => {
    const token = await newOwner();
    const response = await call('POST', '/jobs', token, dishwasher('balanced'));
    expect(response.status).toBe(201);
    const job = (await response.json()) as Job;
    expect(job.status).toBe('planned');
    expect(job.plan.version).toBe(1);
    expect(job.plan.provisional).toBe(true); // nothing ahead is published: all estimates
    // Without CO₂ data for the window, balanced is the cheapest plan.
    expect(job.objective).toBe('cheapest');
    expect(job.plan.runs).toHaveLength(1);
    expect(job.next?.action).toBe('start');

    const status = await waitFor(
      () => h.workflowStatus(job.id),
      (s) => s.status !== 'queued',
    );
    expect(['running', 'waiting']).toContain(status.status);

    const list = (await (await call('GET', '/jobs', token)).json()) as { jobs: Job[] };
    expect(list.jobs.map((j) => j.id)).toEqual([job.id]);
    const slots = await h.db.prepare('SELECT count(*) AS n FROM plan_slots').first<{ n: number }>();
    expect(slots?.n).toBeGreaterThanOrEqual(8);
  });

  it('cancels a plan and stops its workflow; other owners can’t see or touch it', async () => {
    const token = await newOwner();
    const job = (await (await call('POST', '/jobs', token, dishwasher())).json()) as Job;
    const stranger = await newOwner();
    expect((await call('GET', `/jobs/${job.id}`, stranger)).status).toBe(404);
    expect((await call('DELETE', `/jobs/${job.id}`, stranger)).status).toBe(404);
    expect(await jobStatus(job.id)).toBe('planned');

    const cancelled = (await (await call('DELETE', `/jobs/${job.id}`, token)).json()) as Job;
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.next).toBeNull();
    const status = await waitFor(
      () => h.workflowStatus(job.id),
      (s) => s.status === 'terminated',
    );
    expect(status.status).toBe('terminated');
    // Cancelling again changes nothing.
    expect((await call('DELETE', `/jobs/${job.id}`, token)).status).toBe(200);
  });

  it('allows five live plans per owner', async () => {
    const token = await newOwner();
    for (let i = 0; i < 5; i++) {
      expect((await call('POST', '/jobs', token, dishwasher())).status).toBe(201);
    }
    const sixth = await call('POST', '/jobs', token, dishwasher());
    expect(sixth.status).toBe(429);
    expect(((await sixth.json()) as { error: string }).error).toBe('too_many_plans');
  });

  it('answers 422 when the window is too short', async () => {
    const response = await call('POST', '/jobs', await newOwner(), {
      ...dishwasher(),
      deadline: inHours(1),
    });
    expect(response.status).toBe(422);
  });

  it('deletes the owner and everything saved with it', async () => {
    const token = await newOwner();
    const job = (await (await call('POST', '/jobs', token, dishwasher())).json()) as Job;
    expect((await call('DELETE', '/owners/me', token)).status).toBe(204);
    expect((await call('GET', '/jobs', token)).status).toBe(401);
    expect(await jobStatus(job.id)).toBe('gone');
    const status = await waitFor(
      () => h.workflowStatus(job.id),
      (s) => s.status === 'terminated',
    );
    expect(status.status).toBe('terminated');
  });
});

describe('job workflow', () => {
  /** Stores a live job whose runs are the given offsets (ms from now) and starts its workflow. */
  async function storeJob(runs: [number, number][], status = 'planned') {
    const owner = await ownerId(await newOwner());
    const id = crypto.randomUUID();
    const now = Date.now();
    const deadline = now + 3_600_000;
    await h.db.batch([
      h.db
        .prepare(
          `INSERT INTO jobs (id, owner_id, task, zone, energy_wh, max_power_w, earliest_ms,
             deadline_ms, contiguous, objective, status, workflow_id)
           VALUES (?1, ?2, 'ev', 'DK2', 1000, 7400, ?3, ?4, 0, 'cheapest', ?5, ?1)`,
        )
        .bind(id, owner, now, deadline, status),
      h.db
        .prepare(
          `INSERT INTO plans (id, job_id, version, reason, provisional, runs, cost_micro)
           VALUES (?, ?, 1, 'created', 0, ?, 1000000)`,
        )
        .bind(
          crypto.randomUUID(),
          id,
          JSON.stringify(
            runs.map(([a, b]) => ({ startMs: now + a, endMs: now + b, energyWh: 500 })),
          ),
        ),
    ]);
    await h.startWorkflow(id);
    return id;
  }

  it('follows a plan through: running at the first start, done at the end', async () => {
    const id = await storeJob([
      [1_000, 1_500],
      [2_000, 2_500],
    ]);
    expect(
      await waitFor(
        () => jobStatus(id),
        (s) => s === 'running',
      ),
    ).toBe('running');
    expect(
      await waitFor(
        () => jobStatus(id),
        (s) => s === 'done',
      ),
    ).toBe('done');
    const status = await waitFor(
      () => h.workflowStatus(id),
      (s) => s.status === 'complete',
    );
    expect(status).toMatchObject({ status: 'complete', output: 'done' });
    const ended = await h.db
      .prepare('SELECT ended_at_ms AS t FROM jobs WHERE id = ?')
      .bind(id)
      .first<{ t: number | null }>();
    expect(ended?.t).toBeGreaterThan(0);
  });

  it('stops when the job was cancelled before a moment came', async () => {
    const id = await storeJob([[1_000, 3_000]]);
    expect(
      await waitFor(
        () => jobStatus(id),
        (s) => s === 'running',
      ),
    ).toBe('running');
    await h.db.prepare("UPDATE jobs SET status = 'cancelled' WHERE id = ?").bind(id).run();
    // The finish comes and goes; the job stays cancelled and the workflow ends there.
    const status = await waitFor(
      () => h.workflowStatus(id),
      (s) => s.status === 'complete',
    );
    expect(status).toMatchObject({ status: 'complete', output: 'cancelled' });
    expect(await jobStatus(id)).toBe('cancelled');
  });

  it('does nothing for a job that is no longer live', async () => {
    const id = await storeJob([[500, 1_000]], 'cancelled');
    const status = await waitFor(
      () => h.workflowStatus(id),
      (s) => s.status === 'complete',
    );
    expect(status).toMatchObject({ status: 'complete', output: 'gone' });
    expect(await jobStatus(id)).toBe('cancelled');
  });
});

describe('retention', () => {
  it('deletes ended plans after a week and owners unseen for 90 days', async () => {
    // The harness cron runs on 28 Oct 2026; these rows are dated relative to that day.
    const day = (d: number) => Date.UTC(2026, 9, d);
    const insertOwner = (id: string, lastSeen: number) =>
      h.db
        .prepare(
          `INSERT INTO owners (id, token_hash, locale, created_at_ms, last_seen_ms)
           VALUES (?, randomblob(32), 'en', ?, ?)`,
        )
        .bind(id, lastSeen, lastSeen)
        .run();
    const insertJob = (
      id: string,
      owner: string,
      status: string,
      deadline: number,
      ended: number | null,
    ) =>
      h.db
        .prepare(
          `INSERT INTO jobs (id, owner_id, task, zone, energy_wh, max_power_w, earliest_ms,
             deadline_ms, contiguous, objective, status, workflow_id, ended_at_ms)
           VALUES (?1, ?2, 'dishwasher', 'DK2', 1100, 550, ?3 - 7200000, ?3, 1, 'cheapest', ?4, ?1, ?5)`,
        )
        .bind(id, owner, deadline, status, ended)
        .run();
    await insertOwner('gone-owner', Date.UTC(2026, 6, 1)); // last seen 1 July
    await insertOwner('kept-owner', day(27));
    await insertJob('old-job', 'kept-owner', 'done', day(15), day(15));
    await insertJob('recent-job', 'kept-owner', 'done', day(25), day(25));
    await insertJob('stuck-job', 'kept-owner', 'planned', day(20), null);
    await insertJob('gone-owners-job', 'gone-owner', 'done', day(26), day(26));

    await h.tick('03:30');

    const ids = async (table: string) =>
      (await h.db.prepare(`SELECT id FROM ${table}`).all<{ id: string }>()).results.map(
        (r) => r.id,
      );
    expect(await ids('owners')).not.toContain('gone-owner');
    expect(await ids('owners')).toContain('kept-owner');
    const jobs = await ids('jobs');
    expect(jobs).not.toContain('old-job');
    expect(jobs).not.toContain('gone-owners-job');
    expect(jobs).toContain('recent-job');
    expect(await jobStatus('stuck-job')).toBe('failed');
  });
});

describe('global limits', () => {
  it('turns new owners away politely after 500 in a day', async () => {
    await h.db
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500)
         INSERT INTO owners (id, token_hash, locale, created_at_ms)
         SELECT lower(hex(randomblob(16))), randomblob(32), 'en', ? FROM n`,
      )
      .bind(Date.now())
      .run();
    const response = await call('POST', '/owners', undefined, { locale: 'en' });
    expect(response.status).toBe(503);
  });
});
