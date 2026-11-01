import {
  decryptPayload,
  fromBase64Url,
  generateKeyPair,
  importVerifyingKey,
  type P256KeyPair,
  toBase64Url,
} from '@wattslot/webpush';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifyJob } from '../src/push/send.ts';
import { type Harness, type Push, startWorker } from './harness.ts';

// Notifications end to end: devices subscribe through the API, the job workflow sends each
// plan's moments, and a fake push service decrypts every message with the test device's own
// private key — exactly what a browser would do.

let h: Harness;
let vapid: P256KeyPair;
const kek = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

beforeAll(async () => {
  vapid = await generateKeyPair();
  h = await startWorker({
    VAPID_PRIVATE_KEY: `${vapid.publicKey}.${vapid.privateKey}`,
    PUSH_KEK: kek,
    SITE_URL: 'https://wattslot.test',
  });
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

async function newOwner(locale = 'da'): Promise<{ token: string; id: string }> {
  const { ownerToken: token } = (await (
    await call('POST', '/owners', undefined, { locale })
  ).json()) as {
    ownerToken: string;
  };
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const row = await h.db
    .prepare('SELECT id FROM owners WHERE token_hash = ?')
    .bind(hash)
    .first<{ id: string }>();
  return { token, id: row?.id ?? '' };
}

/** A browser's side of a subscription: what it sends, and the private key it decrypts with. */
async function device() {
  const keys = await generateKeyPair();
  const auth = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const endpoint = `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`;
  return {
    endpoint,
    subscription: { endpoint, keys: { p256dh: keys.publicKey, auth } },
    decrypt: async (push: Push) =>
      JSON.parse(new TextDecoder().decode(await decryptPayload(push.body, { ...keys, auth }))) as {
        web_push: number;
        notification: { title: string; body: string; navigate: string; tag: string };
      },
  };
}

/** Stores a live job whose runs are offsets (ms) from now; returns its id and that "now". */
async function storeJob(ownerId: string, task: string, runs: [number, number][]) {
  const id = crypto.randomUUID();
  const now = Date.now();
  await h.db.batch([
    h.db
      .prepare(
        `INSERT INTO jobs (id, owner_id, task, zone, energy_wh, max_power_w, earliest_ms,
           deadline_ms, contiguous, objective, status, workflow_id)
         VALUES (?1, ?2, ?3, 'DK2', 1000, 7400, ?4, ?5, 0, 'cheapest', 'planned', ?1)`,
      )
      .bind(id, ownerId, task, now, now + 3_600_000),
    h.db
      .prepare(
        `INSERT INTO plans (id, job_id, version, reason, provisional, runs, cost_micro)
         VALUES (?, ?, 1, 'created', 0, ?, 2345000)`,
      )
      .bind(
        crypto.randomUUID(),
        id,
        JSON.stringify(runs.map(([a, b]) => ({ startMs: now + a, endMs: now + b, energyWh: 500 }))),
      ),
  ]);
  return { id, now };
}

const to = (endpoint: string) => h.pushes.filter((p) => p.endpoint === endpoint);

async function waitFor<T>(read: () => T | Promise<T>, done: (value: T) => boolean, ms = 15_000) {
  const until = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 100));
    value = await read();
  }
  return value;
}

describe('the push key', () => {
  it('publishes the VAPID public key for browsers to subscribe with', async () => {
    const response = await call('GET', '/push/key');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ publicKey: vapid.publicKey });
  });
});

describe('subscriptions', () => {
  it('accepts only the endpoints of real push services', async () => {
    const { token } = await newOwner();
    const { subscription } = await device();
    for (const endpoint of [
      'https://evil.example/fcm/send/x',
      'http://fcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com:8443/fcm/send/x',
      'https://fcm.googleapis.com.evil.example/x',
    ]) {
      const response = await call('POST', '/push/subscriptions', token, {
        ...subscription,
        endpoint,
      });
      expect(response.status, endpoint).toBe(400);
    }
    expect((await call('POST', '/push/subscriptions', token, subscription)).status).toBe(201);
    expect((await call('POST', '/push/subscriptions', undefined, subscription)).status).toBe(401);
  });

  it('stores the endpoint and keys only in sealed form', async () => {
    const { token, id } = await newOwner();
    const { subscription } = await device();
    await call('POST', '/push/subscriptions', token, subscription);
    const row = await h.db
      .prepare('SELECT * FROM push_subscriptions WHERE owner_id = ?')
      .bind(id)
      .first<Record<string, unknown>>();
    const stored = JSON.stringify(row);
    expect(stored).not.toContain('fcm.googleapis.com');
    expect(stored).not.toContain(subscription.keys.p256dh);
    expect(stored).not.toContain(subscription.keys.auth);
  });

  it('allows three devices per owner; the same device again is fine', async () => {
    const { token } = await newOwner();
    const devices = await Promise.all([device(), device(), device(), device()]);
    for (const d of devices.slice(0, 3)) {
      expect((await call('POST', '/push/subscriptions', token, d.subscription)).status).toBe(201);
    }
    expect(
      (await call('POST', '/push/subscriptions', token, devices[0]?.subscription)).status,
    ).toBe(201);
    expect(
      (await call('POST', '/push/subscriptions', token, devices[3]?.subscription)).status,
    ).toBe(429);
    await call('DELETE', '/push/subscriptions', token, { endpoint: devices[0]?.endpoint });
    expect(
      (await call('POST', '/push/subscriptions', token, devices[3]?.subscription)).status,
    ).toBe(201);
  });
});

describe('notifications from the job workflow', () => {
  it('sends an EV plan’s moments, each readable only with the device’s key', {
    timeout: 30_000,
  }, async () => {
    const owner = await newOwner('da');
    const phone = await device();
    await call('POST', '/push/subscriptions', owner.token, phone.subscription);
    const { id: jobId } = await storeJob(owner.id, 'ev', [
      [1_500, 2_500],
      [4_000, 5_000],
    ]);
    await h.startWorkflow(jobId);
    const pushes = await waitFor(
      () => to(phone.endpoint),
      (p) => p.length >= 5,
    );
    const messages = await Promise.all(pushes.map((p) => phone.decrypt(p)));
    expect(messages.map((m) => m.notification.title)).toEqual([
      'Plan gemt: Elbil',
      'Start opladningen nu',
      'Sæt opladningen på pause nu',
      'Start opladningen nu',
      'Opladningen er færdig',
    ]);
    expect(messages[0]?.notification.body).toMatch(/^Starter kl\. \d\d:\d\d · 2,35 kr\.$/);
    expect(messages[2]?.notification.body).toMatch(/^Næste opladning kl\. \d\d:\d\d$/);
    for (const m of messages) {
      expect(m.web_push).toBe(8030);
      expect(m.notification.navigate).toBe('https://wattslot.test/da/#my-plans');
      expect(m.notification.tag).toBe(`job-${jobId}`);
    }

    const [first] = pushes;
    expect(first?.headers['content-encoding']).toBe('aes128gcm');
    expect(first?.headers.topic).toBe(jobId.replaceAll('-', ''));
    expect(Number(first?.headers.ttl)).toBeGreaterThan(0);
    expect(pushes[1]?.headers.urgency).toBe('high');
    // VAPID: a token for this push service, signed with the published key.
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(first?.headers.authorization ?? '');
    expect(match?.[2]).toBe(vapid.publicKey);
    const [header, claims, signature] = (match?.[1] ?? '').split('.') as [string, string, string];
    expect(
      await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        await importVerifyingKey(vapid.publicKey),
        fromBase64Url(signature),
        new TextEncoder().encode(`${header}.${claims}`),
      ),
    ).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(claims)))).toMatchObject({
      aud: 'https://fcm.googleapis.com',
      sub: 'https://wattslot.test',
    });
  });

  it('tells an appliance only when to start', { timeout: 30_000 }, async () => {
    const owner = await newOwner('en');
    const phone = await device();
    await call('POST', '/push/subscriptions', owner.token, phone.subscription);
    const { id: jobId } = await storeJob(owner.id, 'dishwasher', [[1_500, 3_000]]);
    await h.startWorkflow(jobId);
    await waitFor(
      () => h.workflowStatus(jobId),
      (s) => s.status === 'complete',
    );
    const titles = (await Promise.all(to(phone.endpoint).map(phone.decrypt))).map(
      (m) => m.notification.title,
    );
    expect(titles).toEqual(['Plan saved: Dishwasher', 'Start the dishwasher now']);
  });

  it('forgets a device the push service says is gone', { timeout: 30_000 }, async () => {
    const owner = await newOwner();
    const phone = await device();
    await call('POST', '/push/subscriptions', owner.token, phone.subscription);
    h.pushStatus.set(phone.endpoint, 410);
    const { id: jobId } = await storeJob(owner.id, 'dishwasher', [[60_000, 120_000]]);
    await h.startWorkflow(jobId);
    const left = await waitFor(
      async () =>
        (
          await h.db
            .prepare('SELECT count(*) AS n FROM push_subscriptions WHERE owner_id = ?')
            .bind(owner.id)
            .first<{ n: number }>()
        )?.n,
      (n) => n === 0,
    );
    expect(left).toBe(0);
  });
});

describe('notifyJob', () => {
  const env = () => ({
    DB: h.db,
    VAPID_PRIVATE_KEY: `${vapid.publicKey}.${vapid.privateKey}`,
    PUSH_KEK: kek,
    SITE_URL: 'https://wattslot.test',
  });
  const ok: typeof fetch = async () => new Response(null, { status: 201 });

  it('never sends the same message to a device twice', async () => {
    const owner = await newOwner();
    await call('POST', '/push/subscriptions', owner.token, (await device()).subscription);
    const { id: jobId, now } = await storeJob(owner.id, 'ev', [[600_000, 900_000]]);
    const at = now + 600_000;
    expect(await notifyJob(env(), jobId, 'start', at, 45, at + 1_000, ok)).toBe(1);
    expect(await notifyJob(env(), jobId, 'start', at, 45, at + 2_000, ok)).toBe(0);
  });

  it('stays within its request budget, and drops a device after five failures', async () => {
    const owner = await newOwner();
    for (const d of [await device(), await device()]) {
      await call('POST', '/push/subscriptions', owner.token, d.subscription);
    }
    const { id: jobId, now } = await storeJob(owner.id, 'ev', [
      [600_000, 900_000],
      [1_200_000, 1_500_000],
    ]);
    const at = now + 600_000;
    expect(await notifyJob(env(), jobId, 'start', at, 1, at + 1_000, ok)).toBe(1);

    const failing: typeof fetch = async () => new Response(null, { status: 503 });
    // Five different messages (the pause at the end of the first run, five times over).
    const pause = now + 900_000;
    for (let i = 0; i < 5; i++) {
      await notifyJob(env(), jobId, 'stop', pause, 45, pause - 1_000 + i, failing);
      await h.db.prepare("DELETE FROM deliveries WHERE status = 'failed'").run();
    }
    const left = await h.db
      .prepare('SELECT count(*) AS n FROM push_subscriptions WHERE owner_id = ?')
      .bind(owner.id)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it('does nothing while notifications are off', async () => {
    const owner = await newOwner();
    const { id: jobId } = await storeJob(owner.id, 'ev', [[600_000, 900_000]]);
    expect(await notifyJob({ DB: h.db }, jobId, 'start', Date.now(), 45)).toBe(0);
  });
});
