import { toBase64Url, utf8 } from './bytes.ts';
import { importSigningKey, type P256KeyPair } from './keys.ts';

// Voluntary Application Server Identification (RFC 8292): a short-lived ES256 JWT that tells the
// push service who is sending, signed with the key the browser subscribed with.

/** Push services reject tokens valid for more than 24 hours; 12 leaves room for clock skew. */
const LIFETIME_S = 12 * 60 * 60;

export interface Vapid {
  keys: P256KeyPair;
  /** Contact for the push service: an https URL or a mailto: address. */
  subject: string;
}

export async function vapidAuthorization(
  endpoint: string,
  vapid: Vapid,
  nowMs = Date.now(),
): Promise<string> {
  const header = toBase64Url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = toBase64Url(
    utf8(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(nowMs / 1000) + LIFETIME_S,
        sub: vapid.subject,
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  // Web Crypto's ECDSA signature is already JWS's raw r || s form.
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      await importSigningKey(vapid.keys),
      utf8(unsigned),
    ),
  );
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${vapid.keys.publicKey}`;
}
