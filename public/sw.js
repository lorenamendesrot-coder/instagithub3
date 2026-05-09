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
  const now   = Date.now();

  // Itens normais de agendamento
  const due = queue.filter(
    (x) => !x.type && x.scheduledAt <= now && x.status === "pending"
  );
  for (const item of due) await runItem(item);

  // Itens de finalização de vídeo (criados quando o publish retorna pending:true)
  await runVideoFinishItems();
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

      // Trata vídeos com pending: true
      // Salva no IndexedDB como "video_finish" — processado num tick futuro (60s+)
      // NÃO usamos sleep() aqui — o SW pode ser morto pelo browser antes de terminar
      const pendingResults = results.filter((r) => r.pending && r.creation_id);
      if (pendingResults.length > 0) {
        for (const pr of pendingResults) {
          await saveVideoFinish({
            id:          `vf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type:        "video_finish",
            status:      "pending",
            creation_id: pr.creation_id,
            account_id:  pr.account_id,
            username:    pr.username || "",
            accounts:    item.accounts,
            scheduledAt: Date.now() + 60000, // tenta 60s depois — dá tempo ao Instagram
            parentId:    item.id,
            mediaUrl:    mediaUrl,
            postType:    item.postType,
            mediaType:   item.mediaType,
            caption:     item.caption || "",
            createdAt:   new Date().toISOString(),
            attempts:    0,
            maxAttempts: 8, // 8 ticks × 20s = ~2.5 min de janela total
          });
          console.log(`[SW] Vídeo pendente salvo → @${pr.username} creation_id:${pr.creation_id}`);
        }
        // Remove pending dos resultados imediatos — o histórico será atualizado quando concluir
        results = results.filter((r) => !r.pending);
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

// ─── Salva item video_finish no IndexedDB ────────────────────────────────────
async function saveVideoFinish(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("queue", "readwrite");
    tx.objectStore("queue").put(item);
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
}

// ─── Processa items video_finish pendentes no tick ────────────────────────────
// Chamada a cada tick — encontra itens tipo "video_finish" com scheduledAt <= now
async function runVideoFinishItems() {
  const queue = await readQueue();
  const now   = Date.now();
  const due   = queue.filter(
    (x) => x.type === "video_finish" && x.status === "pending" && x.scheduledAt <= now
  );
  for (const item of due) {
    await runVideoFinish(item);
  }
}

async function runVideoFinish(item) {
  // Marca como running para não processar duas vezes
  await updateItem(item.id, { status: "running" });

  const origin = self.location.origin;

  try {
    const res = await fetch(`${origin}/.netlify/functions/publish-finish`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        pending:  [{ account_id: item.account_id, creation_id: item.creation_id, username: item.username }],
        accounts: item.accounts,
      }),
    });

    if (!res.ok) throw new Error(`publish-finish HTTP ${res.status}`);
    const data    = await res.json();
    const results = data.results || [];
    const result  = results[0];

    if (result?.success) {
      // Sucesso — salva no histórico e remove da fila
      await appendHistory({
        id:             Date.now(),
        post_type:      item.postType,
        media_url:      item.mediaUrl,
        media_type:     item.mediaType,
        default_caption: item.caption,
        results:        [result],
        created_at:     new Date().toISOString(),
        from_scheduler: true,
        video_finish:   true,
      });
      await updateItem(item.id, { status: "done", result, finishedAt: new Date().toISOString() });
      console.log(`[SW] video_finish OK — @${item.username} media_id:${result.media_id}`);

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
      // Erro definitivo do Instagram — não tenta mais
      const errMsg = result.error || "Erro desconhecido";
      console.warn(`[SW] video_finish FALHOU — @${item.username}: ${errMsg}`);
      await updateItem(item.id, { status: "error", error: errMsg });
      notifyClients({ type: "QUEUE_UPDATE" });

    } else {
      // Sem resultado — reagenda para daqui a 30s se ainda tiver tentativas
      const attempts = (item.attempts || 0) + 1;
      if (attempts >= item.maxAttempts) {
        await updateItem(item.id, { status: "error", error: `Timeout: vídeo não processou após ${attempts} tentativas` });
        notifyClients({ type: "QUEUE_UPDATE" });
      } else {
        await updateItem(item.id, { status: "pending", attempts, scheduledAt: Date.now() + 30000 });
      }
    }

  } catch (err) {
    const attempts = (item.attempts || 0) + 1;
    if (attempts >= item.maxAttempts) {
      await updateItem(item.id, { status: "error", error: err.message });
      notifyClients({ type: "QUEUE_UPDATE" });
    } else {
      // Falha de rede — tenta novamente no próximo tick
      await updateItem(item.id, { status: "pending", attempts, scheduledAt: Date.now() + 20000 });
    }
  }
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
