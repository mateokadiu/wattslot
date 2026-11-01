// An explicit import (not the ambient Workers global) so tests type-check under Node too.
import type { D1Database } from '@cloudflare/workers-types';
import type { PushSubscription } from '@wattslot/webpush';
import { open, seal } from './envelope.ts';

// Devices that get notifications (PLAN.md §17.7). The endpoint and keys are sealed together; the
// endpoint's SHA-256 finds a device again without storing the URL in the clear.

/** Per owner (PLAN.md §17.7, "Limits and abuse"). */
export const MAX_DEVICES = 3;

/**
 * The Worker sends requests to whatever endpoint a browser hands it, so only the browsers' own
 * push services are accepted: Chrome/Edge (FCM), Firefox (Mozilla), Safari (Apple), Windows (WNS).
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

export function isPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    PUSH_HOSTS.some((host) => host.test(url.hostname))
  );
}

const endpointHash = async (endpoint: string) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));

/**
 * Stores this device for the owner, or moves it to them (a device that deleted everything and
 * saved a new plan). Returns false when the owner already has the maximum number of devices.
 */
export async function addSubscription(
  d1: D1Database,
  kek: Uint8Array<ArrayBuffer>,
  ownerId: string,
  subscription: PushSubscription,
): Promise<boolean> {
  const hash = await endpointHash(subscription.endpoint);
  const existing = await d1
    .prepare('SELECT owner_id AS ownerId FROM push_subscriptions WHERE endpoint_hash = ?')
    .bind(hash)
    .first<{ ownerId: string }>();
  if (existing?.ownerId !== ownerId) {
    const count = await d1
      .prepare('SELECT count(*) AS n FROM push_subscriptions WHERE owner_id = ?')
      .bind(ownerId)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_DEVICES) return false;
  }
  const { sealed, wrappedKey } = await seal(
    kek,
    new Uint8Array(new TextEncoder().encode(JSON.stringify(subscription))),
    ownerId,
  );
  await d1
    .prepare(
      `INSERT INTO push_subscriptions (id, owner_id, endpoint_hash, sealed, wrapped_key)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint_hash) DO UPDATE SET owner_id = excluded.owner_id,
         sealed = excluded.sealed, wrapped_key = excluded.wrapped_key, failures = 0`,
    )
    .bind(crypto.randomUUID(), ownerId, hash, sealed, wrappedKey)
    .run();
  return true;
}

/** Forgets this device for the owner; another owner's device is left alone. */
export async function removeSubscription(d1: D1Database, ownerId: string, endpoint: string) {
  await d1
    .prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND owner_id = ?')
    .bind(await endpointHash(endpoint), ownerId)
    .run();
}

export async function hasSubscription(d1: D1Database, ownerId: string, endpoint: string) {
  const row = await d1
    .prepare('SELECT 1 AS yes FROM push_subscriptions WHERE endpoint_hash = ? AND owner_id = ?')
    .bind(await endpointHash(endpoint), ownerId)
    .first();
  return row !== null;
}

export interface Device {
  id: string;
  subscription: PushSubscription;
}

/** The owner's devices, opened. One that won't open (a changed key) is dropped. */
export async function ownerDevices(
  d1: D1Database,
  kek: Uint8Array<ArrayBuffer>,
  ownerId: string,
): Promise<Device[]> {
  const { results } = await d1
    .prepare(
      'SELECT id, sealed, wrapped_key AS wrappedKey FROM push_subscriptions WHERE owner_id = ?',
    )
    .bind(ownerId)
    .all<{ id: string; sealed: ArrayBuffer; wrappedKey: ArrayBuffer }>();
  const devices: Device[] = [];
  for (const row of results) {
    try {
      const plain = await open(
        kek,
        new Uint8Array(row.sealed),
        new Uint8Array(row.wrappedKey),
        ownerId,
      );
      devices.push({
        id: row.id,
        subscription: JSON.parse(new TextDecoder().decode(plain)) as PushSubscription,
      });
    } catch {
      await d1.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(row.id).run();
    }
  }
  return devices;
}
