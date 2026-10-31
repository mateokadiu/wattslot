import { type Bytes, concat, fromBase64Url, toBase64Url } from './bytes.ts';

/** An uncompressed P-256 public key: 0x04 || x || y (65 bytes). */
const POINT_LENGTH = 65;

/** A P-256 key pair as base64url: the 65-byte public point and the 32-byte private scalar. */
export interface P256KeyPair {
  publicKey: string;
  privateKey: string;
}

function jwk(publicKey: Bytes, privateKey?: Bytes): JsonWebKey {
  if (publicKey.length !== POINT_LENGTH || publicKey[0] !== 4) {
    throw new Error('Expected an uncompressed P-256 public key (65 bytes, starting 0x04)');
  }
  return {
    kty: 'EC',
    crv: 'P-256',
    x: toBase64Url(publicKey.slice(1, 33)),
    y: toBase64Url(publicKey.slice(33, 65)),
    ...(privateKey ? { d: toBase64Url(privateKey) } : {}),
    ext: true,
  };
}

export const importEcdhPublic = (publicKey: Bytes) =>
  crypto.subtle.importKey('raw', publicKey, { name: 'ECDH', namedCurve: 'P-256' }, true, []);

export const importEcdhPrivate = (pair: P256KeyPair) =>
  crypto.subtle.importKey(
    'jwk',
    jwk(fromBase64Url(pair.publicKey), fromBase64Url(pair.privateKey)),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );

export const importSigningKey = (pair: P256KeyPair) =>
  crypto.subtle.importKey(
    'jwk',
    jwk(fromBase64Url(pair.publicKey), fromBase64Url(pair.privateKey)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

export const importVerifyingKey = (publicKey: string) =>
  crypto.subtle.importKey(
    'jwk',
    jwk(fromBase64Url(publicKey)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );

/** A fresh P-256 key pair: for VAPID (once, kept as a secret) or a test subscription. */
export async function generateKeyPair(): Promise<P256KeyPair> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  if (!d) throw new Error('Key export returned no private scalar');
  return { publicKey: toBase64Url(publicKey), privateKey: d };
}

export const rawPublicKey = async (key: CryptoKey): Promise<Bytes> =>
  concat(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
