'use client';

import { useSyncExternalStore } from 'react';
import type { Locale } from './i18n';
import type { OptionKind, PlanRequest, PlanRun } from './plan';

// Saved plans (PLAN.md §17.7): this browser's owner token is the only key to them. It lives in
// local storage, is sent only as a bearer token to wattslot's own API, and is never shown.

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';
const KEY = 'wattslot:owner';
const CHANGED = 'wattslot:plans-changed';

export type JobStatus = 'planned' | 'running' | 'done' | 'cancelled' | 'failed';
export type TaskId = 'dishwasher' | 'washing' | 'dryer' | 'ev';

export interface Job {
  id: string;
  task: TaskId;
  status: JobStatus;
  objective: OptionKind;
  zone: string;
  contiguous: boolean;
  plan: {
    version: number;
    provisional: boolean;
    runs: PlanRun[];
    cost: number;
    co2Kg: number | null;
  };
  next: { action: 'start' | 'stop' | 'finish'; at: string } | null;
}

function readToken(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(KEY, token);
    else window.localStorage.removeItem(KEY);
  } catch {
    // private browsing: plans can't be kept
  }
  changed();
}

/** Tells every "My plans" view on the page to refresh. */
export function changed() {
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/** Whether this browser has saved plans (has an owner token); false while rendering on the server. */
export function useHasOwner(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readToken() !== null,
    () => false,
  );
}

/** Calls `onChange` whenever plans may have changed; returns the unsubscribe function. */
export const onPlansChanged = subscribe;

class Unauthorized extends Error {}

async function call<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401) throw new Unauthorized();
  if (!response.ok) {
    const error = ((await response.json().catch(() => ({}))) as { error?: string }).error;
    throw new Error(error ?? `HTTP ${response.status}`);
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

async function newOwner(locale: Locale): Promise<string> {
  const response = await fetch(`${BASE}/v1/owners`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locale }),
  });
  if (!response.ok) throw new Error(response.status === 503 ? 'owners_full' : 'error');
  const { ownerToken } = (await response.json()) as { ownerToken: string };
  writeToken(ownerToken);
  return ownerToken;
}

export type SaveResult = { kind: 'ok'; job: Job } | { kind: 'error'; reason: string };

/** Saves a plan, getting this browser an owner token first if it has none (or a stale one). */
export async function saveJob(
  locale: Locale,
  body: PlanRequest & { task: TaskId; objective: OptionKind },
): Promise<SaveResult> {
  try {
    let token = readToken() ?? (await newOwner(locale));
    try {
      return { kind: 'ok', job: await call<Job>('POST', '/jobs', token, body) };
    } catch (e) {
      // Plans and their owner are deleted after 90 days without a visit; start afresh.
      if (!(e instanceof Unauthorized)) throw e;
      token = await newOwner(locale);
      return { kind: 'ok', job: await call<Job>('POST', '/jobs', token, body) };
    }
  } catch (e) {
    return { kind: 'error', reason: e instanceof Error ? e.message : 'error' };
  } finally {
    changed();
  }
}

/** This browser's plans, or null if it has none (or its owner is gone). */
export async function listJobs(): Promise<Job[] | null> {
  const token = readToken();
  if (!token) return null;
  try {
    return (await call<{ jobs: Job[] }>('GET', '/jobs', token)).jobs;
  } catch (e) {
    if (e instanceof Unauthorized) {
      writeToken(null);
      return null;
    }
    throw e;
  }
}

export async function cancelJob(id: string): Promise<void> {
  const token = readToken();
  if (token) await call('DELETE', `/jobs/${id}`, token);
  changed();
}

/** Deletes the owner and everything saved with it, then forgets the token. */
export async function deleteEverything(): Promise<void> {
  const token = readToken();
  if (token) {
    try {
      await call('DELETE', '/owners/me', token);
    } catch (e) {
      if (!(e instanceof Unauthorized)) throw e;
    }
  }
  writeToken(null);
}
