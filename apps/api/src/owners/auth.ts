// An explicit import (not the ambient Workers global) so tests type-check under Node too.
import type { D1Database } from '@cloudflare/workers-types';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env.ts';

// Owners (PLAN.md §17.7): no accounts — a 256-bit random token, kept in one browser, is the only
// key to its plans. The database stores only SHA-256 hashes, so a leaked database holds no
// usable token.

export const LOCALES = ['en', 'da', 'de', 'nb', 'sv'] as const;
export type OwnerLocale = (typeof LOCALES)[number];

/** Global cap on new owners a day; past it, sign-ups get a polite 503 (free-plan headroom). */
export const MAX_NEW_OWNERS_PER_DAY = 500;
/** `last_seen_ms` is refreshed at most this often, to keep D1 writes down. */
const SEEN_EVERY_MS = 3_600_000;
const DAY_MS = 86_400_000;

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

/** 32 random bytes, base64url: 43 characters. */
export function newToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function tokenHash(token: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Creates an owner and returns its token — the only time the token exists outside the browser. */
export async function createOwner(
  d1: D1Database,
  locale: OwnerLocale,
  nowMs: number,
): Promise<{ id: string; token: string } | 'full'> {
  const recent = await d1
    .prepare('SELECT count(*) AS n FROM owners WHERE created_at_ms > ?')
    .bind(nowMs - DAY_MS)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_NEW_OWNERS_PER_DAY) return 'full';
  const id = crypto.randomUUID();
  const token = newToken();
  await d1
    .prepare(
      'INSERT INTO owners (id, token_hash, locale, created_at_ms, last_seen_ms) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(id, await tokenHash(token), locale, nowMs, nowMs)
    .run();
  return { id, token };
}

/**
 * Requires `Authorization: Bearer <owner token>` and sets `c.var.owner`. Anything else is 401
 * with no hint whether the token was malformed or unknown.
 */
export const requireOwner: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '')?.[1];
  const unauthorized = () => c.json({ error: 'unauthorized' }, 401);
  if (!token || !TOKEN.test(token)) return unauthorized();
  const row = await c.env.DB.prepare(
    'SELECT id, locale, last_seen_ms AS lastSeenMs FROM owners WHERE token_hash = ?',
  )
    .bind(await tokenHash(token))
    .first<{ id: string; locale: string; lastSeenMs: number }>();
  if (!row) return unauthorized();
  const nowMs = Date.now();
  if (nowMs - row.lastSeenMs > SEEN_EVERY_MS) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE owners SET last_seen_ms = ? WHERE id = ?').bind(nowMs, row.id).run(),
    );
  }
  c.set('owner', { id: row.id, locale: row.locale });
  c.header('Cache-Control', 'no-store');
  await next();
};
