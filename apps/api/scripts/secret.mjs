// Makes a new secret for `wrangler secret put` and writes it to stdout — never to a terminal, so
// the value isn't shown on screen or kept in scrollback. Usage (from apps/api):
//
//   node scripts/secret.mjs vapid | pnpm exec wrangler secret put VAPID_PRIVATE_KEY
//   node scripts/secret.mjs kek   | pnpm exec wrangler secret put PUSH_KEK
//
// vapid: a P-256 key pair as "<public point>.<private scalar>", both base64url (RFC 8292).
// kek:   32 random bytes, base64url — the key that wraps every stored push subscription's key.
//        Changing it later makes existing subscriptions unreadable (devices must subscribe again).

const kind = process.argv[2];
if (process.stdout.isTTY) {
  console.error('Refusing to print a secret to the terminal. Pipe it into `wrangler secret put`.');
  process.exit(1);
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64url');

if (kind === 'vapid') {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  process.stdout.write(`${b64(publicKey)}.${d}`);
} else if (kind === 'kek') {
  process.stdout.write(b64(crypto.getRandomValues(new Uint8Array(32))));
} else {
  console.error('Usage: node scripts/secret.mjs vapid|kek | pnpm exec wrangler secret put <NAME>');
  process.exit(1);
}
