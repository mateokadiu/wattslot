import { utf8 } from './bytes.ts';
import { encryptPayload, type SubscriptionKeys } from './encrypt.ts';
import { type Vapid, vapidAuthorization } from './vapid.ts';

export { fromBase64Url, toBase64Url } from './bytes.ts';
export { decryptPayload, encryptPayload, MAX_PLAINTEXT, type SubscriptionKeys } from './encrypt.ts';
export { generateKeyPair, importVerifyingKey, type P256KeyPair } from './keys.ts';
export { type Vapid, vapidAuthorization } from './vapid.ts';

export interface PushSubscription {
  endpoint: string;
  keys: SubscriptionKeys;
}

export interface PushOptions {
  vapid: Vapid;
  /** Seconds the push service may hold the message for an offline device. */
  ttl: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  /** Replaces an undelivered message with the same topic (≤ 32 base64url characters). */
  topic?: string;
}

/** A ready-to-send Web Push request (RFC 8030) with an encrypted body. */
export async function pushRequest(
  subscription: PushSubscription,
  message: string,
  options: PushOptions,
): Promise<Request> {
  const endpoint = new URL(subscription.endpoint);
  if (endpoint.protocol !== 'https:') throw new Error('Push endpoints must be https');
  if (options.topic && !/^[A-Za-z0-9_-]{1,32}$/.test(options.topic)) {
    throw new Error('Topic must be 1–32 base64url characters');
  }
  const body = await encryptPayload(utf8(message), subscription.keys);
  const headers: Record<string, string> = {
    authorization: await vapidAuthorization(subscription.endpoint, options.vapid),
    'content-encoding': 'aes128gcm',
    'content-type': 'application/octet-stream',
    ttl: String(Math.max(0, Math.round(options.ttl))),
    urgency: options.urgency ?? 'normal',
  };
  if (options.topic) headers.topic = options.topic;
  return new Request(endpoint, { method: 'POST', headers, body });
}
