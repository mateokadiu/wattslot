// Runs the RFC 8291 example and a full push request inside workerd (Cloudflare's runtime), so
// the test proves the package needs nothing Node-specific.
import {
  decryptPayload,
  encryptPayload,
  fromBase64Url,
  generateKeyPair,
  pushRequest,
  toBase64Url,
} from '../../src/index.ts';
import { RFC8291 } from '../rfc8291.ts';

export default {
  async fetch(): Promise<Response> {
    const vector = await encryptPayload(
      new TextEncoder().encode(RFC8291.plaintext),
      { p256dh: RFC8291.browser.publicKey, auth: RFC8291.browser.auth },
      { salt: fromBase64Url(RFC8291.salt), serverKeys: RFC8291.server },
    );
    const browser = {
      ...(await generateKeyPair()),
      auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    };
    const request = await pushRequest(
      {
        endpoint: 'https://push.example.com/send/1',
        keys: { p256dh: browser.publicKey, auth: browser.auth },
      },
      'Start nu',
      { vapid: { keys: await generateKeyPair(), subject: 'mailto:t@example.com' }, ttl: 60 },
    );
    const roundTrip = new TextDecoder().decode(
      await decryptPayload(new Uint8Array(await request.arrayBuffer()), browser),
    );
    return Response.json({ vector: toBase64Url(vector), roundTrip });
  },
};
