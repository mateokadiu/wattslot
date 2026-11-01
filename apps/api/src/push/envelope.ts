import { fromBase64Url } from '@wattslot/webpush';

/** Bytes backed by a plain ArrayBuffer, as Web Crypto wants them. */
type Bytes = Uint8Array<ArrayBuffer>;

// Envelope encryption for secrets at rest (PLAN.md §12.1): each value is sealed with its own
// random AES-256-GCM data key, and that key is wrapped with the key-encryption key, a Workers
// Secret that never touches D1 or the repo. Both layers bind the same associated data (here the
// owner id), so a sealed value moved to another row won't open.

const IV_BYTES = 12;
const encoder = new TextEncoder();

async function aes(raw: Bytes, usages: ('encrypt' | 'decrypt')[]) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usages);
}

/** The key-encryption key: 32 random bytes, base64url (see scripts/secret.mjs). */
export function parseKek(value: string | undefined): Bytes | null {
  if (!value) return null;
  const raw = fromBase64Url(value.trim());
  return raw.length === 32 ? raw : null;
}

async function encrypt(raw: Bytes, plaintext: Bytes, aad: string) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await aes(raw, ['encrypt']);
  const body = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
      key,
      plaintext,
    ),
  );
  const out = new Uint8Array(IV_BYTES + body.length);
  out.set(iv);
  out.set(body, IV_BYTES);
  return out;
}

async function decrypt(raw: Bytes, sealed: Bytes, aad: string) {
  const key = await aes(raw, ['decrypt']);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.slice(0, IV_BYTES), additionalData: encoder.encode(aad) },
      key,
      sealed.slice(IV_BYTES),
    ),
  );
}

export async function seal(kek: Bytes, plaintext: Bytes, aad: string) {
  const dataKey = crypto.getRandomValues(new Uint8Array(32));
  return {
    sealed: await encrypt(dataKey, plaintext, aad),
    wrappedKey: await encrypt(kek, dataKey, aad),
  };
}

/** Throws if the data was changed, belongs to other associated data, or the key is wrong. */
export async function open(
  kek: Bytes,
  sealed: Bytes,
  wrappedKey: Bytes,
  aad: string,
): Promise<Bytes> {
  return decrypt(await decrypt(kek, wrappedKey, aad), sealed, aad);
}
