// An explicit import (not the ambient Workers global) so tests type-check under Node too.
import type { D1Database } from '@cloudflare/workers-types';
import type { Run } from '@wattslot/planner';
import { fromMicro } from '@wattslot/pricing';
import { type P256KeyPair, pushRequest } from '@wattslot/webpush';
import type { Action } from '../jobs/actions.ts';
import type { Task } from '../jobs/store.ts';
import type { OwnerLocale } from '../owners/auth.ts';
import { parseKek } from './envelope.ts';
import { message, payload } from './messages.ts';
import { ownerDevices } from './subscriptions.ts';

// Sending a job's notifications to its owner's devices (PLAN.md §17.7). Called from the job
// workflow's steps, so it must be safe to run twice: each message to each device has an
// idempotency key, and one already delivered isn't sent again.

/** A device is dropped after this many failed sends in a row. */
const MAX_FAILURES = 5;

export interface PushEnv {
  DB: D1Database;
  VAPID_PRIVATE_KEY?: string | undefined;
  PUSH_KEK?: string | undefined;
  SITE_URL?: string | undefined;
}

/** The VAPID key pair from its secret, "<public>.<private>" (see scripts/secret.mjs). */
export function parseVapid(value: string | undefined): P256KeyPair | null {
  const [publicKey, privateKey, extra] = (value ?? '').trim().split('.');
  if (!publicKey || !privateKey || extra !== undefined) return null;
  return /^[A-Za-z0-9_-]{87}$/.test(publicKey) && /^[A-Za-z0-9_-]{43}$/.test(privateKey)
    ? { publicKey, privateKey }
    : null;
}

/** Push is on only when both secrets are set and well formed. */
export function pushConfig(env: PushEnv) {
  const keys = parseVapid(env.VAPID_PRIVATE_KEY);
  const kek = parseKek(env.PUSH_KEK);
  return keys && kek
    ? { keys, kek, site: env.SITE_URL ?? 'https://wattslot.mateokadiu.com' }
    : null;
}

interface JobRow {
  ownerId: string;
  locale: OwnerLocale;
  task: Task;
  timeZone: string;
  currency: string;
  planId: string;
  runs: string;
  costMicro: number;
}

/**
 * Notifies the job's owner on every device, sending at most `budget` requests (a workflow
 * instance may make only 50). Returns how many requests it made.
 */
export async function notifyJob(
  env: PushEnv,
  jobId: string,
  kind: 'planned' | Action['kind'],
  atMs: number,
  budget: number,
  nowMs = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const config = pushConfig(env);
  if (!config || budget <= 0) return 0;
  const d1 = env.DB;
  const job = await d1
    .prepare(
      `SELECT j.owner_id AS ownerId, o.locale, j.task, z.time_zone AS timeZone, z.currency,
         p.id AS planId, p.runs, p.cost_micro AS costMicro
       FROM jobs j JOIN owners o ON o.id = j.owner_id JOIN price_zones z ON z.code = j.zone
       JOIN plans p ON p.job_id = j.id
       WHERE j.id = ? ORDER BY p.version DESC LIMIT 1`,
    )
    .bind(jobId)
    .first<JobRow>();
  if (!job) return 0;
  const m = message(
    kind,
    {
      locale: job.locale,
      task: job.task,
      timeZone: job.timeZone,
      currency: job.currency,
      runs: JSON.parse(job.runs) as Run[],
      cost: fromMicro(job.costMicro),
      siteUrl: config.site,
      jobId,
    },
    atMs,
    nowMs,
  );
  if (!m) return 0;

  let requests = 0;
  for (const device of await ownerDevices(d1, config.kek, job.ownerId)) {
    if (requests >= budget) break;
    const key = `${job.planId}:${kind}:${atMs}:${device.id}`;
    const done = await d1
      .prepare(`SELECT 1 AS ok FROM deliveries WHERE idempotency_key = ? AND status = 'ok'`)
      .bind(key)
      .first();
    if (done) continue;
    await d1
      .prepare(
        `INSERT INTO deliveries (id, subscription_id, plan_id, action, idempotency_key, status)
         VALUES (?, ?, ?, ?, ?, 'pending') ON CONFLICT (idempotency_key) DO NOTHING`,
      )
      .bind(crypto.randomUUID(), device.id, job.planId, kind === 'planned' ? 'notify' : kind, key)
      .run();

    let status = 0;
    let error = '';
    try {
      requests++;
      const response = await fetchImpl(
        await pushRequest(device.subscription, payload(m), {
          vapid: { keys: config.keys, subject: config.site },
          ttl: m.ttl,
          urgency: m.urgency,
          topic: jobId.replaceAll('-', ''),
        }),
      );
      status = response.status;
      if (!response.ok) error = `HTTP ${status}`;
    } catch (e) {
      error = String(e).slice(0, 200);
    }

    if (status >= 200 && status < 300) {
      await d1.batch([
        d1
          .prepare(
            `UPDATE deliveries SET status = 'ok', attempts = attempts + 1 WHERE idempotency_key = ?`,
          )
          .bind(key),
        d1
          .prepare('UPDATE push_subscriptions SET last_ok_ms = ?, failures = 0 WHERE id = ?')
          .bind(nowMs, device.id),
      ]);
    } else if (status === 404 || status === 410) {
      // The device unsubscribed or the subscription expired: forget it (its deliveries go too).
      await d1.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(device.id).run();
    } else {
      await d1.batch([
        d1
          .prepare(
            `UPDATE deliveries SET status = 'failed', attempts = attempts + 1, last_error = ?
             WHERE idempotency_key = ?`,
          )
          .bind(error, key),
        d1
          .prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?')
          .bind(device.id),
        d1
          .prepare('DELETE FROM push_subscriptions WHERE id = ? AND failures >= ?')
          .bind(device.id, MAX_FAILURES),
      ]);
    }
  }
  return requests;
}
