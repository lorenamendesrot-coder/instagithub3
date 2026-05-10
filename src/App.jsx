import { Routes, Route, useLocation } from "react-router-dom";
import { useEffect, useState, useCallback, useRef, createContext, useContext } from "react";

// Páginas
import Accounts from "./pages/Accounts.jsx";
import NewPost   from "./pages/NewPost.jsx";
import Schedule  from "./pages/Schedule.jsx";
import Queue     from "./pages/Queue.jsx";
import History   from "./pages/History.jsx";
import Warmup      from "./pages/Warmup.jsx";
import Protection  from "./pages/Protection.jsx";
import Logs        from "./pages/Logs.jsx";
import Insights    from "./pages/Insights.jsx";

// Hooks e componentes isolados
import { useAccounts }     from "./useAccounts.js";
import { useToast }        from "./useToast.js";
import { useServiceWorker } from "./useServiceWorker.js";
import { useTokenCheck }   from "./useTokenCheck.js";
import { useOAuthUrl }     from "./useOAuthUrl.js";
import { dbGetAll, dbPut, dbPutMany, dbDelete, dbClear } from "./useDB.js";
import Sidebar from "./Sidebar.jsx";
import Toast   from "./Toast.jsx";
import MobileBottomNav from "./MobileBottomNav.jsx";

export { useAccounts };

// ─── History Context — instância única compartilhada ─────────────────────────
const HistoryContext = createContext(null);

export const useHistory = () => useContext(HistoryContext);

function HistoryProvider({ children }) {
  const [history, setHistory]       = useState([]);
  const [totalCount, setTotalCount] = useState(0);

  const reload = useCallback(async () => {
    const all = await dbGetAll("history");
    all.sort((a, b) => b.id - a.id);
    setTotalCount(all.length);
    setHistory(all.slice(0, 500));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Escuta evento do SW para recarregar
  useEffect(() => {
    const h = () => reload();
    window.addEventListener("sw:queue-update", h);
    return () => window.removeEventListener("sw:queue-update", h);
  }, [reload]);

  const addEntry    = useCallback(async (entry) => { await dbPut("history", entry); reload(); }, [reload]);
  const clearHistory = useCallback(async () => { await dbClear("history"); setHistory([]); setTotalCount(0); }, []);

  return (
    <HistoryContext.Provider value={{ history, totalCount, addEntry, clearHistory, reloadHistory: reload }}>
      {children}
    </HistoryContext.Provider>
  );
}

// ─── WarmupContext — persiste arquivos de upload entre trocas de aba ──────────
const WarmupContext = createContext(null);
export const useWarmupFiles = () => useContext(WarmupContext);

function WarmupProvider({ children }) {
  const [files, setFiles] = useState({ reels: [], feed: [], stories: [] });

  const addFiles = useCallback((typeId, newFiles) => {
    const entries = Array.from(newFiles).map((file) => ({
      id: `${typeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file, name: file.name, size: file.size,
      status: "idle", progress: 0, url: "", error: "", typeId,
    }));
    setFiles((prev) => ({ ...prev, [typeId]: [...(prev[typeId] || []), ...entries] }));
  }, []);

  const removeFile = useCallback((typeId, fileId) => {
    setFiles((prev) => ({ ...prev, [typeId]: prev[typeId].filter((f) => f.id !== fileId) }));
  }, []);

  const updateFile = useCallback((typeId, fileId, patch) => {
    setFiles((prev) => ({ ...prev, [typeId]: prev[typeId].map((f) => f.id === fileId ? { ...f, ...patch } : f) }));
  }, []);

  const clearFiles = useCallback((typeId) => {
    if (typeId) setFiles((prev) => ({ ...prev, [typeId]: [] }));
    else setFiles({ reels: [], feed: [], stories: [] });
  }, []);

  return (
    <WarmupContext.Provider value={{ files, setFiles, addFiles, removeFile, updateFile, clearFiles }}>
      {children}
    </WarmupContext.Provider>
  );
}
const SchedulerContext = createContext(null);
export const useScheduler = () => useContext(SchedulerContext);

// Helpers para a fila no Blobs (acessível de qualquer dispositivo)
const qApi = {
  getAll:  ()       => fetch("/api/queue").then((r) => r.json()).catch(() => []),
  save:    (items)  => fetch("/api/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Array.isArray(items) ? items : [items]) }).catch(() => {}),
  update:  (item)   => fetch("/api/queue", { method: "PUT",  headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) }).then((r) => r.json()).catch(() => item),
  remove:  (id)     => fetch(`/api/queue?id=${id}`, { method: "DELETE" }).catch(() => {}),
  clear:   ()       => fetch("/api/queue", { method: "DELETE" }).catch(() => {}),
};

function SchedulerProvider({ addEntry, children }) {
  const [queue, setQueue] = useState([]);
  const runningRef = useRef(new Set());

  const reload = useCallback(async () => {
    const all = await qApi.getAll();
    if (!Array.isArray(all)) return;
    all.sort((a, b) => (a.scheduledAt || 0) - (b.scheduledAt || 0));
    setQueue(all);
    // Espelha no IndexedDB local para o SW
    try { await dbClear("queue"); await dbPutMany("queue", all); } catch {}
  }, []);

  useEffect(() => {
    reload();
    const h = () => reload();
    window.addEventListener("sw:queue-update", h);
    return () => window.removeEventListener("sw:queue-update", h);
  }, [reload]);

  // ─── Tick do scheduler ───────────────────────────────────────────────────────
  useEffect(() => {
    // Reseta itens "running" travados
    const resetStuck = async () => {
      const all = await qApi.getAll();
      if (!Array.isArray(all)) return;
      const stuck = all.filter((x) => x.status === "running");
      for (const item of stuck) {
        await qApi.update({ ...item, status: "pending", scheduledAt: Date.now() + 5000 });
      }
    };
    resetStuck().catch(() => {});

    const tick = async () => {
      const all = await qApi.getAll();
      if (!Array.isArray(all)) return;
      const now    = Date.now();
      const due    = all.filter((x) => !x.type && x.scheduledAt <= now && x.status === "pending");
      const dueFin = all.filter((x) => x.type === "video_finish" && x.status === "pending" && x.scheduledAt <= now);

      // Processar video_finish
      for (const vf of dueFin) {
        if (runningRef.current.has(vf.id)) continue;
        runningRef.current.add(vf.id);
        try {
          await qApi.update({ ...vf, status: "running" });
          const res = await fetch("/.netlify/functions/publish-finish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pending:  [{ account_id: vf.account_id, creation_id: vf.creation_id, username: vf.username }],
              accounts: vf.accounts,
            }),
          });
          if (!res.ok) throw new Error(`publish-finish HTTP ${res.status}`);
          const data   = await res.json();
          const result = (data.results || [])[0];
          if (result?.success) {
            const all2 = await dbGetAll("history");
            const histEntry = all2.find((h) => h.id === vf.historyId) || null;
            if (histEntry) {
              const prevResults    = (histEntry.results || []).filter((r) => r.account_id !== vf.account_id);
              const updatedResults = [...prevResults, result];
              const updatedPending = (histEntry.pending_accounts || []).filter((a) => a.account_id !== vf.account_id);
              await dbPut("history", { ...histEntry, results: updatedResults, pending_accounts: updatedPending });
            }
            await qApi.update({ ...vf, status: "done", result, finishedAt: new Date().toISOString() });
          } else if (result && !result.success) {
            const all2 = await dbGetAll("history");
            const histEntry = all2.find((h) => h.id === vf.historyId) || null;
            if (histEntry) {
              const updatedResults = [...(histEntry.results || []), { account_id: vf.account_id, username: vf.username, success: false, error: result.error }];
              const updatedPending = (histEntry.pending_accounts || []).filter((a) => a.account_id !== vf.account_id);
              await dbPut("history", { ...histEntry, results: updatedResults, pending_accounts: updatedPending });
            }
            await qApi.update({ ...vf, status: "error", error: result.error });
          } else {
            const attempts = (vf.attempts || 0) + 1;
            if (attempts >= (vf.maxAttempts || 20)) {
              await qApi.update({ ...vf, status: "error", error: "Timeout: vídeo não processou" });
            } else {
              await qApi.update({ ...vf, status: "pending", attempts, scheduledAt: Date.now() + 20000 });
            }
          }
        } catch (err) {
          const attempts = (vf.attempts || 0) + 1;
          if (attempts >= (vf.maxAttempts || 20)) {
            await qApi.update({ ...vf, status: "error", error: err.message }).catch(() => {});
          } else {
            await qApi.update({ ...vf, status: "pending", attempts, scheduledAt: Date.now() + 20000 }).catch(() => {});
          }
        } finally {
          runningRef.current.delete(vf.id);
        }
        reload();
      }

      if (!due.length) return;

      for (const item of due) {
        if (runningRef.current.has(item.id)) continue;
        runningRef.current.add(item.id);
        await qApi.update({ ...item, status: "running" });
        reload();

        try {
          const urlsToPost = item.mediaUrls || [item.mediaUrl];

          for (let mi = 0; mi < urlsToPost.length; mi++) {
            const mediaUrl = urlsToPost[mi];
            if (mi > 0) await new Promise(r => setTimeout(r, 3000));

            const MAX_RETRIES = 3;
            let res, lastErr;
            for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
              if (attempt > 0) await new Promise(r => setTimeout(r, 5000 * Math.pow(3, attempt - 1)));
              try {
                res = await fetch("/.netlify/functions/publish", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    accounts:        item.accounts,
                    media_url:       mediaUrl,
                    media_type:      item.mediaType,
                    post_type:       item.postType,
                    captions:        item.captions || {},
                    default_caption: item.caption  || "",
                    delay_seconds:   0,
                    skip_rate_limit: !!item.warmup,
                  }),
                });
                if (res.ok || (res.status >= 400 && res.status < 500)) break;
                lastErr = new Error(`HTTP ${res.status}`);
              } catch (fetchErr) { lastErr = fetchErr; res = null; }
            }

            if (!res || !res.ok) throw lastErr || new Error(`HTTP ${res?.status}`);
            const data    = await res.json();
            const results = data.results || [];

            const pendingResults  = results.filter((r) => r.pending && r.creation_id);
            const finishedResults = results.filter((r) => !r.pending);
            const historyId       = `h-${Date.now()}-${mi}`;

            for (const pr of pendingResults) {
              const vfId = `vf-${historyId}-${pr.account_id}`;
              await qApi.save({
                id:          vfId,
                type:        "video_finish",
                status:      "pending",
                creation_id: pr.creation_id,
                account_id:  pr.account_id,
                username:    pr.username || pr.account_id,
                accounts:    item.accounts,
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
            }

            const pendingAccounts = pendingResults.map((r) => ({
              account_id: r.account_id,
              username:   r.username || r.account_id,
            }));

            await addEntry({
              id:               historyId,
              post_type:        item.postType,
              media_url:        mediaUrl,
              media_type:       item.mediaType,
              default_caption:  item.caption,
              results:          finishedResults,
              pending_accounts: pendingAccounts,
              created_at:       new Date().toISOString(),
              from_scheduler:   true,
              source:           item.warmup ? "warmup" : "schedule",
            });
          }

          if (item.loop) {
            await qApi.update({ ...item, status: "pending", scheduledAt: item.scheduledAt + 86400000, runCount: (item.runCount || 0) + 1 });
          } else {
            await qApi.update({ ...item, status: "done" });
          }
        } catch (err) {
          await qApi.update({ ...item, status: "error", error: err.message, failedAt: new Date().toISOString(), retryCount: (item.retryCount || 0) + 1 });
        }

        runningRef.current.delete(item.id);
        reload();
      }
    };

    const iv = setInterval(tick, 10000);
    tick();
    return () => clearInterval(iv);
  }, [addEntry, reload]);

  const addBatch   = async (items) => { await qApi.save(items); reload(); };
  const updateItem = async (item)  => { await qApi.update(item); reload(); };
  const removeItem = async (id)    => { await qApi.remove(id); setQueue((p) => p.filter((x) => x.id !== id)); };
  const clearQueue = async ()      => { await qApi.clear(); setQueue([]); };

  return (
    <SchedulerContext.Provider value={{ queue, addBatch, updateItem, removeItem, clearQueue, reload }}>
      {children}
    </SchedulerContext.Provider>
  );
}

// ─── AppShell — usa os contextos (precisa estar dentro dos providers) ─────────
function AppShell() {
  const { addAccounts, accounts, reloadAccounts, syncing, loading: accountsLoading } = useAccounts();
  const { toast, showToast }   = useToast();
  const { swStatus }           = useServiceWorker();
  const { oauthUrl }           = useOAuthUrl();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { addEntry } = useHistory();

  useEffect(() => { setMobileMenuOpen(false); }, [location.pathname]);

  useTokenCheck({
    accounts,
    onExpired: useCallback((expired) => {
      reloadAccounts();
      const nomes = expired.map((a) => `@${a.username}`).join(", ");
      showToast("error", `Token expirado para: ${nomes}. Reconecte em Contas.`);
    }, [showToast, reloadAccounts]),
  });

  useEffect(() => {
    const params  = new URLSearchParams(window.location.search);
    const encoded = params.get("accounts");
    const error   = params.get("error");
    window.history.replaceState({}, "", window.location.pathname);
    if (encoded) {
      (async () => {
        try {
          const accs = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")));
          showToast("success", `Salvando ${accs.length} conta(s) na nuvem...`);
          await addAccounts(accs);
          showToast("success", `✅ ${accs.length} conta(s) conectada(s) e salvas!`);
        } catch (err) {
          showToast("error", "Erro ao salvar contas: " + err.message);
        }
      })();
    }
    if (error) showToast("error", decodeURIComponent(error));
  }, []);

  return (
    <SchedulerProvider addEntry={addEntry}>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <aside style={{ width: 230, background: "var(--bg2)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", flexShrink: 0, position: "sticky", top: 0, height: "100vh" }} className="sidebar-desktop">
          <Sidebar accounts={accounts} swStatus={swStatus} oauthUrl={oauthUrl} syncing={syncing} loading={accountsLoading} />
        </aside>

        <div className="mobile-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg, var(--accent), #9b4dfc)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>📱</div>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Insta Manager</span>
            {syncing && <span style={{ color: "var(--accent-light)", animation: "spin 1s linear infinite", display: "inline-block", fontSize: 14 }}>⟳</span>}
          </div>
          <a href={oauthUrl} style={{ fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 8, background: "linear-gradient(135deg, var(--accent), #9b4dfc)", color: "#fff", textDecoration: "none" }}>+ Conta</a>
        </div>

        <MobileBottomNav />

        <main style={{ flex: 1, overflow: "auto", minWidth: 0, background: "var(--bg)" }}>
          <Toast toast={toast} />

          {swStatus === "unsupported" && (
            <div style={{ margin: "16px 32px 0", padding: "10px 16px", borderRadius: 10, fontSize: 12, background: "rgba(245,158,11,0.1)", color: "var(--warning)", border: "1px solid rgba(245,158,11,0.25)" }}>
              ⚠️ Navegador não suporta Service Worker. O scheduler roda via React enquanto o site estiver aberto.
            </div>
          )}

          <Routes>
            <Route path="/"            element={<Accounts />} />
            <Route path="/novo"        element={<NewPost />} />
            <Route path="/agendar"     element={<Schedule />} />
            <Route path="/fila"        element={<Queue />} />
            <Route path="/historico"   element={<History />} />
            <Route path="/aquecimento" element={<Warmup />} />
            <Route path="/protecao"    element={<Protection />} />
            <Route path="/logs"        element={<Logs />} />
            <Route path="/insights"    element={<Insights />} />
          </Routes>
        </main>

        <style>{`
          @keyframes slideIn      { from { opacity: 0; transform: translateX(20px);  } to { opacity: 1; transform: translateX(0); } }
          @keyframes slideInLeft  { from { opacity: 0; transform: translateX(-100%); } to { opacity: 1; transform: translateX(0); } }
          @keyframes spin         { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          .sidebar-desktop { display: flex; }
          .mobile-header   { display: none; }
          @media (max-width: 768px) {
            .sidebar-desktop { display: none !important; }
            .mobile-header { display: flex; align-items: center; justify-content: space-between; position: fixed; top: 0; left: 0; right: 0; z-index: 100; padding: 10px 16px; background: var(--bg2); border-bottom: 1px solid var(--border); height: 52px; }
            main { padding-top: 52px; padding-bottom: 70px; }
          }
        `}</style>
      </div>
    </SchedulerProvider>
  );
}

// ─── App — fornece os providers e renderiza AppShell ─────────────────────────
export default function App() {
  return (
    <HistoryProvider>
      <WarmupProvider>
        <AppShell />
      </WarmupProvider>
    </HistoryProvider>
  );
}
