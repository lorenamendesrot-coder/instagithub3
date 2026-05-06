// Service Worker — Insta Manager Scheduler v4
const TICK_INTERVAL = 20000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
  startTicker();
});

let tickerInterval = null;
function startTicker() {
  if (tickerInterval) clearInterval(tickerInterval);
  tickerInterval = setInterval(tick, TICK_INTERVAL);
  setTimeout(tick, 1000);
}

async function tick() {
  const queue = await readQueue();
  const now = Date.now();
  const due = queue.filter((x) => x.scheduledAt <= now && x.status === "pending");
  for (const item of due) await runItem(item);
}

async function runItem(item) {
  await updateItem(item.id, { status: "running" });
  notifyClients({ type: "QUEUE_UPDATE" });

  try {
    // FIX CRITICO: usar self.location.origin + caminho direto da function
    const origin = self.location.origin;
    const apiUrl = `${origin}/.netlify/functions/publish`;

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accounts: item.accounts,
        media_url: item.mediaUrl,
        media_type: item.mediaType,
        post_type: item.postType,
        captions: item.captions || {},
        default_caption: item.caption || "",
        delay_seconds: 0,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const results = data.results || [];
    const successCount = results.filter((r) => r.success).length;

    await appendHistory({
      id: Date.now(),
      post_type: item.postType,
      media_url: item.mediaUrl,
      media_type: item.mediaType,
      default_caption: item.caption || "",
      results,
      created_at: new Date().toISOString(),
      from_scheduler: true,
    });

    if (item.loop) {
      const next = item.scheduledAt + 24 * 60 * 60 * 1000;
      await updateItem(item.id, { status: "pending", scheduledAt: next, runCount: (item.runCount || 0) + 1, lastResults: results });
    } else {
      await updateItem(item.id, { status: "done", results });
    }

    try {
      if (Notification.permission === "granted") {
        self.registration.showNotification("Insta Manager", {
          body: `✅ ${successCount}/${results.length} conta(s) publicadas`,
          icon: "/favicon.ico", tag: `pub-${item.id}`,
        });
      }
    } catch (_) {}
  } catch (err) {
    await updateItem(item.id, { status: "error", error: err.message });
    try {
      if (Notification.permission === "granted") {
        self.registration.showNotification("Insta Manager — Erro", {
          body: `❌ ${err.message}`, icon: "/favicon.ico", tag: `err-${item.id}`,
        });
      }
    } catch (_) {}
  }
  notifyClients({ type: "QUEUE_UPDATE" });
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("insta_manager", 4); // ✅ mantido em sincronia com useDB.js
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id" });
      if (!db.objectStoreNames.contains("history")) db.createObjectStore("history", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("queue", "readonly");
    const req = tx.objectStore("queue").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function updateItem(id, patch) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("queue", "readwrite");
    const store = tx.objectStore("queue");
    const req = store.get(id);
    req.onsuccess = () => {
      if (!req.result) return resolve();
      store.put({ ...req.result, ...patch });
      tx.oncomplete = resolve;
      tx.onerror = reject;
    };
    req.onerror = reject;
  });
}

async function appendHistory(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("history", "readwrite");
    tx.objectStore("history").put(entry);
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
}

function notifyClients(msg) {
  self.clients.matchAll({ includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage(msg)));
}

self.addEventListener("message", (e) => {
  if (e.data?.type === "PING") e.source?.postMessage({ type: "PONG" });
  if (e.data?.type === "FORCE_TICK") tick();
});
