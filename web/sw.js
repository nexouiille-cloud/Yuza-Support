/* Service Worker : notifications Web Push (fonctionne onglet fermé). */
self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data.json();
  } catch {}
  event.waitUntil(
    self.registration.showNotification(d.title || 'Yuza Support', {
      body: d.body || '',
      tag: d.userId || 'yuza',
      data: { userId: d.userId || null },
      renotify: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        for (const c of list) {
          if ('focus' in c) return c.focus();
        }
        if (clients.openWindow) return clients.openWindow('/');
      }),
  );
});
