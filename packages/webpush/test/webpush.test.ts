import { describe, expect, it } from 'vitest';
import {
  decryptPayload,
  encryptPayload,
  fromBase64Url,
  generateKeyPair,
  importVerifyingKey,
  MAX_PLAINTEXT,
  pushRequest,
  toBase64Url,
  vapidAuthorization,
} from '../src/index.ts';
import { RFC8291 } from './rfc8291.ts';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const keys = { p256dh: RFC8291.browser.publicKey, auth: RFC8291.browser.auth };

describe('message encryption (RFC 8291)', () => {
  it('reproduces the RFC’s example byte for byte', async () => {
    const body = await encryptPayload(new TextEncoder().encode(RFC8291.plaintext), keys, {
      salt: fromBase64Url(RFC8291.salt),
      serverKeys: RFC8291.server,
    });
    expect(toBase64Url(body.slice(0, 86))).toBe(RFC8291.header);
    expect(toBase64Url(body.slice(86))).toBe(RFC8291.ciphertext);
    expect(toBase64Url(body)).toBe(RFC8291.body);
  });

  it('decrypts the RFC’s example with the browser’s private key', async () => {
    const plain = await decryptPayload(fromBase64Url(RFC8291.body), RFC8291.browser);
    expect(text(plain)).toBe(RFC8291.plaintext);
  });

  it('round-trips with fresh keys and salt, and never repeats a ciphertext', async () => {
    const browser = {
      ...(await generateKeyPair()),
      auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    };
    const message = new TextEncoder().encode(JSON.stringify({ title: 'Start opvaskemaskinen nu' }));
    const sub = { p256dh: browser.publicKey, auth: browser.auth };
    const [a, b] = await Promise.all([encryptPayload(message, sub), encryptPayload(message, sub)]);
    expect(toBase64Url(a)).not.toBe(toBase64Url(b));
    expect(text(await decryptPayload(a, browser))).toBe(text(message));
  });

  it('refuses a payload too big for one push', async () => {
    await expect(encryptPayload(new Uint8Array(MAX_PLAINTEXT + 1), keys)).rejects.toThrow(/limit/);
  });

  it('can’t be read without the browser’s auth secret', async () => {
    const wrong = { ...RFC8291.browser, auth: toBase64Url(new Uint8Array(16)) };
    await expect(decryptPayload(fromBase64Url(RFC8291.body), wrong)).rejects.toThrow();
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs a token for the push service’s origin that verifies with the public key', async () => {
    const vapid = { keys: await generateKeyPair(), subject: 'https://wattslot.mateokadiu.com' };
    const now = Date.UTC(2026, 10, 1);
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, now);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(m).not.toBeNull();
    const [, h, c, sig, k] = m as unknown as string[];
    expect(k).toBe(vapid.keys.publicKey);
    expect(JSON.parse(text(fromBase64Url(h ?? '')))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(text(fromBase64Url(c ?? '')))).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now / 1000 + 12 * 3600,
      sub: 'https://wattslot.mateokadiu.com',
    });
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await importVerifyingKey(vapid.keys.publicKey),
      fromBase64Url(sig ?? ''),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });
});

describe('push request', () => {
  it('is an encrypted POST with the headers push services require', async () => {
    const browser = {
      ...(await generateKeyPair()),
      auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    };
    const request = await pushRequest(
      {
        endpoint: 'https://push.example.com/send/xyz',
        keys: { p256dh: browser.publicKey, auth: browser.auth },
      },
      '{"title":"Start nu"}',
      {
        vapid: { keys: await generateKeyPair(), subject: 'mailto:test@example.com' },
        ttl: 900,
        urgency: 'high',
        topic: 'job-1',
      },
    );
    expect(request.method).toBe('POST');
    expect(request.headers.get('content-encoding')).toBe('aes128gcm');
    expect(request.headers.get('ttl')).toBe('900');
    expect(request.headers.get('urgency')).toBe('high');
    expect(request.headers.get('topic')).toBe('job-1');
    expect(request.headers.get('authorization')).toMatch(/^vapid t=/);
    const body = new Uint8Array(await request.arrayBuffer());
    expect(text(await decryptPayload(body, browser))).toBe('{"title":"Start nu"}');
  });

  it('refuses plain http endpoints and malformed topics', async () => {
    const vapid = { keys: await generateKeyPair(), subject: 'mailto:t@example.com' };
    const sub = { endpoint: 'http://push.example.com/x', keys };
    await expect(pushRequest(sub, 'x', { vapid, ttl: 60 })).rejects.toThrow(/https/);
    await expect(
      pushRequest({ ...sub, endpoint: 'https://push.example.com/x' }, 'x', {
        vapid,
        ttl: 60,
        topic: 'has spaces',
      }),
    ).rejects.toThrow(/Topic/);
  });
});
