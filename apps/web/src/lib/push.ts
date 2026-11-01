'use client';

import { addDevice, type DeviceResult, removeDevice } from './owner';

// Notifications on this device (PLAN.md §17.7): a service worker that only shows messages, and a
// push subscription made with the browser's own push service.

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';
const CHANGED = 'wattslot:push-changed';

/** Calls `onChange` when notifications are turned on or off anywhere on the page. */
export function onPushChanged(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  return () => window.removeEventListener(CHANGED, onChange);
}
const changed = () => window.dispatchEvent(new Event(CHANGED));

export type PushSupport = 'yes' | 'ios-install' | 'no';

/** iPhone and iPad allow web push only for a site added to the Home Screen (iOS 16.4+). */
export function pushSupport(): PushSupport {
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
    return 'yes';
  }
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios ? 'ios-install' : 'no';
}

/** The key browsers subscribe with, or null when notifications are off on the server. */
async function serverKey(): Promise<string | null> {
  try {
    const response = await fetch(`${BASE}/v1/push/key`);
    return response.ok ? ((await response.json()) as { publicKey: string }).publicKey : null;
  } catch {
    return null;
  }
}

const bytes = (base64url: string) =>
  Uint8Array.from(atob(base64url.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function registration() {
  return navigator.serviceWorker.getRegistration('/');
}

export type PushState = 'on' | 'off' | 'denied' | 'unavailable';

/** Where this device stands: on (subscribed), off, blocked by the user, or not possible here. */
export async function pushState(): Promise<PushState> {
  if (pushSupport() !== 'yes' || !(await serverKey())) return 'unavailable';
  if (Notification.permission === 'denied') return 'denied';
  const subscription = await (await registration())?.pushManager.getSubscription();
  return subscription ? 'on' : 'off';
}

/** Asks for permission, subscribes this device and tells wattslot. */
export async function enablePush(): Promise<DeviceResult | 'denied'> {
  const key = await serverKey();
  if (!key) return 'off';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    const ready = await navigator.serviceWorker.ready;
    const existing = await ready.pushManager.getSubscription();
    // A subscription made with an older key can't receive messages signed with the new one.
    const current =
      existing &&
      new Uint8Array(existing.options.applicationServerKey ?? new ArrayBuffer(0)).join() ===
        bytes(key).join()
        ? existing
        : null;
    if (existing && !current) await existing.unsubscribe();
    const subscription =
      current ??
      (await ready.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes(key),
      }));
    const result = await addDevice(subscription.toJSON());
    if (result !== 'on') await subscription.unsubscribe();
    changed();
    return result;
  } catch {
    return 'error';
  }
}

export async function disablePush(): Promise<void> {
  const subscription = await (await registration())?.pushManager.getSubscription();
  if (!subscription) return;
  await removeDevice(subscription.endpoint);
  await subscription.unsubscribe();
  changed();
}
