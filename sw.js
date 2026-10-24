// Darb service worker: makes the site installable as an Android app, keeps the
// last-loaded version available offline, and sends deadline reminders for saved items.
// Always tries the network first so the daily opportunity updates show up immediately.
const CACHE = "darb-v1";
const REMINDERS = "darb-reminders"; // saved deadlines written by the page; read here in the background

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});

// Reminder rule: notify once at 7 days and once at 2 days before a saved item's deadline.
async function checkDeadlines() {
  const cache = await caches.open(REMINDERS);
  const res = await cache.match("saved.json");
  if (!res) return;
  const data = await res.json();
  const sent = new Set(data.sent || []);
  const now = Date.now();
  for (const it of data.items || []) {
    const days = Math.ceil((new Date(it.deadline) - now) / 864e5);
    if (days < 0) continue;
    const stage = days <= 2 ? "2" : days <= 7 ? "7" : null;
    if (!stage || sent.has(it.id + ":" + stage)) continue;
    await self.registration.showNotification(days === 0 ? "Closes today" : `${days} day${days === 1 ? "" : "s"} left to apply`, {
      body: it.title, tag: it.id, icon: "icon-192.png", badge: "icon-192.png", data: { id: it.id },
    });
    sent.add(it.id + ":" + stage);
  }
  data.sent = [...sent];
  await cache.put("saved.json", new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } }));
}

// Chrome on Android wakes installed apps periodically; the page also asks for a check on every open.
self.addEventListener("periodicsync", e => { if (e.tag === "darb-deadlines") e.waitUntil(checkDeadlines()); });
self.addEventListener("message", e => { if (e.data === "check-deadlines") e.waitUntil(checkDeadlines()); });

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = self.registration.scope + "#" + encodeURIComponent((e.notification.data || {}).id || "");
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(ws => {
    for (const w of ws) if ("focus" in w) { w.navigate(url); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
