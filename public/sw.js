// Service Worker — Insta Manager Scheduler v6
// Fix: vídeos pendentes salvos no IDB, atualizando o mesmo item do histórico
const TICK_INTERVAL = 20000;

self.addEventListener("install",  (e) => { e.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); startTicker(); });

let tickerInterval = null;
function startTicker() {
  if (tickerInterval) clearInterval(tickerInterval);
  tickerInterval = setInterval(tick, TICK_INTERVAL);
  setTimeout(tick, 1000);
}

// ─── Tick principal ───────────────────────────────────────────────────────────
async function tick() {
  const queue = await readQueue();
  const now   = Date.now();

  // 1. Itens normais de agendamento (sem type)
  const due = queue.filter(
    (x) => !x.type && x.scheduledAt <= now && x.status === "pending"
  );
  for (const item of due) await runItem(item);

  // 2. Itens video_finish (vídeos aguardando processamento do Instagram)
  const dueFin = queue.filter(
    (x) => x.type === "video_finish" && x.status === "pending" && x.scheduledAt <= now
  );
  for (const item of dueFin) await runVideoFinish(item);
}

// ─── runItem — agendamento normal ────────────────────────────────────────────
async function runItem(item) {
  await updateItem(item.id, { status: "running" });
  notifyClients({ type: "QUEUE_UPDATE" });

  try {
    const origin  = self.location.origin;
    const apiUrl  = `${origin}/.netlify/functions/publish`;
    const urlsToPost = item.mediaUrls?.length > 0 ? item.mediaUrls : [item.mediaUrl];

    let totalSuccesses = 0;
    let totalResults   = [];

    for (let mi = 0; mi < urlsToPost.length; mi++) {
      const mediaUrl = urlsToPost[mi];
      if (mi > 0) await sleep(3000);

      const historyId = `h-${Date.now()}-${mi}`;
      const allResults = [];
      const pendingAccounts = [];

      // ── Publica UMA conta por request para não estourar rate limit da Meta ──
      for (let ai = 0; ai < item.accounts.length; ai++) {
        if (ai > 0) await sleep(3000); // 3s entre cada conta
        const account = item.accounts[ai];

        let res, data;
        try {
          res  = await fetch(apiUrl, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accounts:        [account],  // ← 1 conta por vez
              media_url:       mediaUrl,
              media_type:      item.mediaType,
              post_type:       item.postType,
              captions:        item.captions || {},
              default_caption: item.caption  || "",
              delay_seconds:   0,
              skip_rate_limit: !!item.warmup,
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          data = await res.json();
        } catch (fetchErr) {
          allResults.push({ account_id: account.id, username: account.username, success: false, error: fetchErr.message });
          continue;
        }

        const result = (data.results || [])[0] || { account_id: account.id, username: account.username, success: false, error: "Sem resposta" };

        if (result.pending && result.creation_id) {
          // Vídeo ainda processando — cria video_finish
          const vfId = `vf-${historyId}-${account.id}`;
          await saveItem("queue", {
            id:          vfId,
            type:        "video_finish",
            status:      "pending",
            creation_id: result.creation_id,
            account_id:  account.id,
            username:    account.username || account.id,
            accounts:    [account],
            scheduledAt: Date.now() + 30000,
            historyId,
            mediaUrl,
            postType:    item.postType,
            mediaType:   item.mediaType,
            caption:     item.caption || "",
            createdAt:   new Date().toISOString(),
            attempts:    0,
            maxAttempts: 20,
          });
          console.log(`[SW] video_finish criado → @${account.username} historyId:${historyId}`);
          pendingAccounts.push({ account_id: account.id, username: account.username || account.id });
        } else {
          allResults.push(result);
          if (result.success) totalSuccesses++;
        }
      }

      totalResults = totalResults.concat(allResults);

      await saveItem("history", {
        id:               historyId,
        post_type:        item.postType,
        media_url:        mediaUrl,
        media_type:       item.mediaType,
        default_caption:  item.caption || "",
        results:          allResults,
        pending_accounts: pendingAccounts,
        created_at:       new Date().toISOString(),
        from_scheduler:   true,
        source:           item.warmup ? "warmup" : "schedule",
        cycle_index:      mi,
        cycle_total:      urlsToPost.length,
      });
    }

    if (item.loop) {
      await updateItem(item.id, {
        status:      "pending",
        scheduledAt: item.scheduledAt + 24 * 60 * 60 * 1000,
        runCount:    (item.runCount || 0) + 1,
        lastResults: totalResults,
      });
    } else {
      await updateItem(item.id, { status: "done", results: totalResults });
    }

    try {
      if (Notification.permission === "granted") {
        const qty   = urlsToPost.length;
        const label = qty > 1 ? `${qty} mídias` : "1 mídia";
        self.registration.showNotification("Insta Manager", {
          body: `✅ ${label} · ${totalSuccesses}/${totalResults.length} conta(s)`,
          icon: "/favicon.ico",
          tag:  `pub-${item.id}`,
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
          tag:  `err-${item.id}`,
        });
      }
    } catch (_) {}
  }

  notifyClients({ type: "QUEUE_UPDATE" });
}

// ─── runVideoFinish — finaliza vídeos pendentes ───────────────────────────────
async function runVideoFinish(item) {
  await updateItem(item.id, { status: "running" });

  const origin = self.location.origin;

  try {
    const res = await fetch(`${origin}/.netlify/functions/publish-finish`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pending:  [{ account_id: item.account_id, creation_id: item.creation_id, username: item.username }],
        accounts: item.accounts,
      }),
    });

    if (!res.ok) throw new Error(`publish-finish HTTP ${res.status}`);
    const data   = await res.json();
    const result = (data.results || [])[0];

    if (result?.success) {
      // ── Sucesso: atualiza o item do histórico (não cria um novo) ──────────
      const histEntry = await getHistoryItem(item.historyId);
      if (histEntry) {
        // Remove erros anteriores desta conta (retry bem-sucedido) e adiciona o sucesso
        const prevResults     = (histEntry.results || []).filter((r) => r.account_id !== item.account_id);
        const updatedResults  = [...prevResults, result];
        const updatedPending  = (histEntry.pending_accounts || []).filter(
          (a) => a.account_id !== item.account_id
        );
        await saveItem("history", {
          ...histEntry,
          results:          updatedResults,
          pending_accounts: updatedPending,
        });
      }

      // Remove da fila de video_finish
      await updateItem(item.id, { status: "done", result, finishedAt: new Date().toISOString() });
      console.log(`[SW] video_finish ✅ @${item.username} media_id:${result.media_id}`);

      notifyClients({ type: "QUEUE_UPDATE" });

      try {
        if (Notification.permission === "granted") {
          self.registration.showNotification("Insta Manager", {
            body: `✅ Reel publicado — @${item.username}`,
            icon: "/favicon.ico",
            tag:  `vf-${item.id}`,
          });
        }
      } catch (_) {}

    } else if (result && !result.success) {
      // ── Erro definitivo do Instagram ──────────────────────────────────────
      const errMsg = result.error || "Erro desconhecido";
      console.warn(`[SW] video_finish ❌ @${item.username}: ${errMsg}`);

      // Atualiza histórico: move da lista pending_accounts para results com erro
      const histEntry = await getHistoryItem(item.historyId);
      if (histEntry) {
        const updatedResults = [...(histEntry.results || []), {
          account_id: item.account_id,
          username:   item.username,
          success:    false,
          error:      errMsg,
        }];
        const updatedPending = (histEntry.pending_accounts || []).filter(
          (a) => a.account_id !== item.account_id
        );
        await saveItem("history", { ...histEntry, results: updatedResults, pending_accounts: updatedPending });
      }

      await updateItem(item.id, { status: "error", error: errMsg });
      notifyClients({ type: "QUEUE_UPDATE" });

    } else {
      // ── Ainda não está pronto — reagenda ─────────────────────────────────
      const attempts = (item.attempts || 0) + 1;
      if (attempts >= item.maxAttempts) {
        const errMsg = `Timeout: vídeo não processou após ${attempts} tentativas`;
        const histEntry = await getHistoryItem(item.historyId);
        if (histEntry) {
          const updatedResults = [...(histEntry.results || []), {
            account_id: item.account_id, username: item.username, success: false, error: errMsg,
          }];
          const updatedPending = (histEntry.pending_accounts || []).filter(
            (a) => a.account_id !== item.account_id
          );
          await saveItem("history", { ...histEntry, results: updatedResults, pending_accounts: updatedPending });
        }
        await updateItem(item.id, { status: "error", error: errMsg });
        notifyClients({ type: "QUEUE_UPDATE" });
      } else {
        // Ainda há tentativas — reagenda para 30s depois
        await updateItem(item.id, { status: "pending", attempts, scheduledAt: Date.now() + 20000 });
      }
    }

  } catch (err) {
    const attempts = (item.attempts || 0) + 1;
    if (attempts >= item.maxAttempts) {
      await updateItem(item.id, { status: "error", error: err.message });
      notifyClients({ type: "QUEUE_UPDATE" });
    } else {
      await updateItem(item.id, { status: "pending", attempts, scheduledAt: Date.now() + 20000 });
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
    req.onerror  = () => reject(req.error);
    req.onblocked = () => console.warn("[SW] IDB bloqueado por outra aba.");
  });
}

async function readQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction("queue", "readonly");
    const req = tx.objectStore("queue").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

async function updateItem(id, patch) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction("queue", "readwrite");
    const store = tx.objectStore("queue");
    const req   = store.get(id);
    req.onsuccess = () => {
      if (!req.result) return resolve();
      store.put({ ...req.result, ...patch });
      tx.oncomplete = resolve;
      tx.onerror    = reject;
    };
    req.onerror = reject;
  });
}

// Salva (put) em qualquer store
async function saveItem(store, item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(item);
    tx.oncomplete = resolve;
    tx.onerror    = reject;
  });
}

// Busca item do histórico por id
async function getHistoryItem(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction("history", "readonly");
    const req = tx.objectStore("history").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = () => reject(req.error);
  });
}

function notifyClients(msg) {
  self.clients.matchAll({ includeUncontrolled: true })
    .then((cs) => cs.forEach((c) => c.postMessage(msg)));
}

self.addEventListener("message", (e) => {
  if (e.data?.type === "PING")       e.source?.postMessage({ type: "PONG" });
  if (e.data?.type === "FORCE_TICK") tick();
});
