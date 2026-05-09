// Service Worker — Insta Manager Scheduler v5 (com suporte a mediaUrls por ciclo)
const TICK_INTERVAL = 20000;

self.addEventListener("install", (e) => {
  // skipWaiting imediato garante que novo SW substitui versão antiga em cache
  e.waitUntil(self.skipWaiting());
});
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
    const origin = self.location.origin;
    const apiUrl = `${origin}/.netlify/functions/publish`;

    // Suporte a múltiplas mídias por ciclo (novo campo mediaUrls)
    // Retrocompatível: se não tiver mediaUrls, usa mediaUrl legado
    const urlsToPost = item.mediaUrls && item.mediaUrls.length > 0
      ? item.mediaUrls
      : [item.mediaUrl];

    let totalSuccesses = 0;
    let totalResults = [];

    for (let mi = 0; mi < urlsToPost.length; mi++) {
      const mediaUrl = urlsToPost[mi];

      // Pequeno delay entre mídias do mesmo ciclo (exceto a primeira)
      if (mi > 0) await sleep(3000);

      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accounts: item.accounts,
          media_url: mediaUrl,
          media_type: item.mediaType,
          post_type: item.postType,
          captions: item.captions || {},
          default_caption: item.caption || "",
          delay_seconds: 0,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      let results = data.results || [];

      // Trata vídeos com pending: true — tenta media_publish separado após aguardar
      const pendingResults = results.filter((r) => r.pending && r.creation_id);
      if (pendingResults.length > 0) {
        await sleep(25000); // aguarda 25s — Instagram leva tempo para processar vídeos
        const retryRes = await fetch(`${origin}/.netlify/functions/publish-finish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pending: pendingResults, accounts: item.accounts }),
        });
        if (retryRes.ok) {
          const retryData = await retryRes.json();
          // Substitui os resultados pending pelos finais
          results = results.map((r) => {
            if (!r.pending) return r;
            const finished = (retryData.results || []).find((f) => f.account_id === r.account_id);
            return finished || r;
          });
        }
      }

      totalResults = [...totalResults, ...results];
      totalSuccesses += results.filter((r) => r.success).length;

      await appendHistory({
        id: Date.now() + mi,
        post_type: item.postType,
        media_url: mediaUrl,
        media_type: item.mediaType,
        default_caption: item.caption || "",
        results,
        created_at: new Date().toISOString(),
        from_scheduler: true,
        cycle_index: mi,
        cycle_total: urlsToPost.length,
      });
    }

    if (item.loop) {
      const next = item.scheduledAt + 24 * 60 * 60 * 1000;
      await updateItem(item.id, {
        status: "pending",
        scheduledAt: next,
        runCount: (item.runCount || 0) + 1,
        lastResults: totalResults,
      });
    } else {
      await updateItem(item.id, { status: "done", results: totalResults });
    }

    try {
      if (Notification.permission === "granted") {
        const qty = urlsToPost.length;
        const label = qty > 1 ? `${qty} mídias` : "1 mídia";
        self.registration.showNotification("Insta Manager", {
          body: `✅ ${label} · ${totalSuccesses}/${totalResults.length} conta(s) publicadas`,
          icon: "/favicon.ico",
          tag: `pub-${item.id}`,
        });
      }
    } catch (_) {}
  } catch (err) {
    await updateItem(item.id, { status: "error", error: err.message });
    try {
      if (Notification.permission === "granted") {
        self.registration.showNotification("Insta Manager — Erro", {
          body: `❌ ${err.message}`,
          icon: "/favicon.ico",
          tag: `err-${item.id}`,
        });
      }
    } catch (_) {}
  }

  notifyClients({ type: "QUEUE_UPDATE" });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// DB version deve ser SEMPRE igual ao useDB.js — atualmente v5
const SW_DB_VERSION = 5;
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("insta_manager", SW_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("queue")) {
        db.createObjectStore("queue", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("history")) {
        const hs = db.createObjectStore("history", { keyPath: "id" });
        try { hs.createIndex("created_at", "created_at", { unique: false }); } catch(_){}
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("protection")) {
        db.createObjectStore("protection", { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onclose = () => { _db = null; };
      _db.onerror = () => { _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      // Outra aba com versão antiga aberta — avisa e aguarda
      console.warn("[SW] IDB bloqueado por outra aba. Aguardando...");
    };
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
