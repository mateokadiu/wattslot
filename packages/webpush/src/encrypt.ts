import { type Bytes, concat, fromBase64Url, utf8 } from './bytes.ts';
import { importEcdhPrivate, importEcdhPublic, type P256KeyPair, rawPublicKey } from './keys.ts';

// Message encryption for Web Push (RFC 8291) in the aes128gcm content coding (RFC 8188):
// one record, so payloads stay under the record size (4096 bytes, about 3,993 of plaintext).

const RECORD_SIZE = 4096;
/** 16-byte tag, 1-byte padding delimiter. */
export const MAX_PLAINTEXT = RECORD_SIZE - 16 - 1 - 86;

export interface SubscriptionKeys {
  /** The browser's ECDH public key, base64url (65 bytes). */
  p256dh: string;
  /** The browser's authentication secret, base64url (16 bytes). */
  auth: string;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/** The content key and nonce both sides derive (RFC 8291 §3.3–3.4). */
async function contentKeys(
  ecdhSecret: Bytes,
  authSecret: Bytes,
  uaPublic: Bytes,
  asPublic: Bytes,
  salt: Bytes,
) {
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const [cek, nonce] = await Promise.all([
    hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16),
    hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12),
  ]);
  return { cek, nonce };
}

async function sharedSecret(privateKey: CryptoKey, publicKey: Bytes): Promise<Bytes> {
  // The Workers types misname ECDH's `public` member; the runtime takes the standard name.
  const algorithm = { name: 'ECDH', public: await importEcdhPublic(publicKey) };
  const bits = await crypto.subtle.deriveBits(
    algorithm as unknown as Parameters<SubtleCrypto['deriveBits']>[0],
    privateKey,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * Encrypts a push message for one subscription. `salt` and `serverKeys` are for test vectors
 * only; normally both are fresh for every message, as RFC 8291 requires.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  subscription: SubscriptionKeys,
  testing: { salt?: Bytes; serverKeys?: P256KeyPair } = {},
): Promise<Bytes> {
  if (plaintext.length > MAX_PLAINTEXT) {
    throw new Error(`Push payload is ${plaintext.length} bytes; the limit is ${MAX_PLAINTEXT}`);
  }
  const uaPublic = fromBase64Url(subscription.p256dh);
  const authSecret = fromBase64Url(subscription.auth);
  const salt = testing.salt ?? crypto.getRandomValues(new Uint8Array(16));

  let asPrivate: CryptoKey;
  let asPublic: Bytes;
  if (testing.serverKeys) {
    asPrivate = await importEcdhPrivate(testing.serverKeys);
    asPublic = fromBase64Url(testing.serverKeys.publicKey);
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = await rawPublicKey(pair.publicKey);
  }

  const ecdh = await sharedSecret(asPrivate, uaPublic);
  const { cek, nonce } = await contentKeys(ecdh, authSecret, uaPublic, asPublic, salt);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      concat(plaintext, new Uint8Array([2])),
    ),
  );

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

/**
 * The browser's side: decrypts a push message body with the subscription's private key. Used by
 * tests (a fake push service checks every message really decrypts).
 */
export async function decryptPayload(
  body: Uint8Array,
  subscription: P256KeyPair & { auth: string },
): Promise<Bytes> {
  const salt = concat(body.slice(0, 16));
  const idLength = body[20] ?? 0;
  const asPublic = concat(body.slice(21, 21 + idLength));
  const ciphertext = concat(body.slice(21 + idLength));
  const uaPrivate = await importEcdhPrivate(subscription);
  const ecdh = await sharedSecret(uaPrivate, asPublic);
  const { cek, nonce } = await contentKeys(
    ecdh,
    fromBase64Url(subscription.auth),
    fromBase64Url(subscription.publicKey),
    asPublic,
    salt,
  );
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext),
  );
  const end = padded.lastIndexOf(2);
  if (end < 0) throw new Error('Missing padding delimiter');
  return concat(padded.slice(0, end));
}
