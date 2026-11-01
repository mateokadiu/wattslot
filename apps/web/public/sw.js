// wattslot's service worker: it only shows the notifications for saved plans and opens the site
// when one is tapped. No caching, no offline mode — the pages stay exactly as served.
// Messages use Safari's Declarative Web Push format (PLAN.md §17.7), read here on every browser.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    // not ours: show nothing rather than something wrong
    return;
  }
  const n = message.notification;
  if (!n || typeof n.title !== 'string') return;
  event.waitUntil(
    self.registration.showNotification(n.title, {
      body: n.body,
      tag: n.tag,
      lang: n.lang,
      icon: '/icons/icon-192.png',
      data: { navigate: n.navigate },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.navigate ?? '/', self.location.origin);
  // Only ever open this site's own pages.
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === target.origin);
      if (open) {
        await open.focus();
        return open.navigate ? open.navigate(target.href).catch(() => undefined) : undefined;
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
