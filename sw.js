const CACHE = "ct-v7";
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
  "./app.js", "./store.js", "./dates.js", "./firebase.js", "./firebase-config.js", "./messaging.js",
  "./vendor/firebase-app.js", "./vendor/firebase-auth.js", "./vendor/firebase-firestore.js", "./vendor/firebase-messaging.js"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // Firestore und Google-Login laufen über eigene Hosts und dürfen niemals aus
  // dem Cache beantwortet werden — Firestore bringt seine eigene Offline-Kopie mit.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit ||
      fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => e.request.mode === "navigate" ? caches.match("./index.html") : Promise.reject(new Error("offline")))
    )
  );
});

// Push aus Firebase Cloud Messaging. Bewusst ohne das Messaging-SDK im Worker:
// ein zweiter Service Worker im selben Scope wuerde diesen hier abloesen, und
// die Nutzlast laesst sich genauso gut direkt lesen.
self.addEventListener("push", e => {
  let title = "Abend-Check-in";
  let body = "Es ist noch etwas offen.";
  try {
    const data = e.data ? e.data.json() : null;
    const n = (data && (data.notification || data.data)) || {};
    if (n.title) title = n.title;
    if (n.body) body = n.body;
  } catch (err) {
    if (e.data) { const t = e.data.text(); if (t) body = t; }
  }
  e.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: "ct-reminder",          // ersetzt eine aeltere Erinnerung, statt zu stapeln
    renotify: false
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("./");
    })
  );
});
