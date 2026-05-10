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

// ─── History — IndexedDB ─────────────────────────────────────────────────────
let _historyInstance = null;
export const useHistory = () => {
  const [history, setHistory]       = useState([]);
  const [totalCount, setTotalCount] = useState(0);

  const reload = useCallback(async () => {
    const all = await dbGetAll("history");
    all.sort((a, b) => b.id - a.id);
    setTotalCount(all.length);
    setHistory(all.slice(0, 500));
  }, []);

  useEffect(() => { reload(); }, []);

  const addEntry    = async (entry) => { await dbPut("history", entry); reload(); };
  const clearHistory = async () => { await dbClear("history"); setHistory([]); setTotalCount(0); };

  return { history, totalCount, addEntry, clearHistory, reloadHistory: reload };
};

// ─── Scheduler Context — roda globalmente independente de qual aba está aberta ─
const SchedulerContext = createContext(null);
export const useScheduler = () => useContext(SchedulerContext);

function SchedulerProvider({ addEntry, children }) {
  const [queue, setQueue] = useState([]);
  const runningRef = useRef(new Set());

  const reload = useCallback(async () => {
    const all = await dbGetAll("queue");
    all.sort((a, b) => a.scheduledAt - b.scheduledAt);
    setQueue(all);
  }, []);

  useEffect(() => {
    reload();
    const h = () => reload();
    window.addEventListener("sw:queue-update", h);
    return () => window.removeEventListener("sw:queue-update", h);
  }, [reload]);

  // ─── Tick do scheduler — roda a cada 10s globalmente ───────────────────────
  useEffect(() => {
    // Ao montar: reseta itens "running" que ficaram travados (ex: após reload da página)
    const resetStuck = async () => {
      const all = await dbGetAll("queue");
      const stuck = all.filter((x) => x.status === "running");
      for (const item of stuck) {
        await dbPut("queue", { ...item, status: "pending", scheduledAt: Date.now() + 5000 });
      }
    };
    resetStuck().catch(() => {});

    const tick = async () => {
      const all = await dbGetAll("queue");
      const now = Date.now();
      const due = all.filter((x) => !x.type && x.scheduledAt <= now && x.status === "pending");
      const dueFin = all.filter((x) => x.type === "video_finish" && x.status === "pending" && x.scheduledAt <= now);

      // Processar video_finish (fallback quando o SW não está ativo)
      for (const vf of dueFin) {
        if (runningRef.current.has(vf.id)) continue;
        runningRef.current.add(vf.id);
        try {
          await dbPut("queue", { ...vf, status: "running" });
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
            await dbPut("queue", { ...vf, status: "done", result, finishedAt: new Date().toISOString() });
          } else if (result && !result.success) {
            const all2 = await dbGetAll("history");
            const histEntry = all2.find((h) => h.id === vf.historyId) || null;
            if (histEntry) {
              const updatedResults = [...(histEntry.results || []), { account_id: vf.account_id, username: vf.username, success: false, error: result.error }];
              const updatedPending = (histEntry.pending_accounts || []).filter((a) => a.account_id !== vf.account_id);
              await dbPut("history", { ...histEntry, results: updatedResults, pending_accounts: updatedPending });
            }
            await dbPut("queue", { ...vf, status: "error", error: result.error });
          } else {
            // Ainda processando — reagenda
            const attempts = (vf.attempts || 0) + 1;
            if (attempts >= (vf.maxAttempts || 20)) {
              await dbPut("queue", { ...vf, status: "error", error: "Timeout: vídeo não processou" });
            } else {
              await dbPut("queue", { ...vf, status: "pending", attempts, scheduledAt: Date.now() + 20000 });
            }
          }
        } catch (err) {
          // Garante que o item sai de "running" mesmo em caso de erro inesperado
          const attempts = (vf.attempts || 0) + 1;
          if (attempts >= (vf.maxAttempts || 20)) {
            await dbPut("queue", { ...vf, status: "error", error: err.message }).catch(() => {});
          } else {
            await dbPut("queue", { ...vf, status: "pending", attempts, scheduledAt: Date.now() + 20000 }).catch(() => {});
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
        await dbPut("queue", { ...item, status: "running" });
        reload();

        try {
          const urlsToPost = item.mediaUrls || [item.mediaUrl];

          for (let mi = 0; mi < urlsToPost.length; mi++) {
            const mediaUrl = urlsToPost[mi];
            if (mi > 0) await new Promise(r => setTimeout(r, 3000));

            const MAX_RETRIES = 3;
            let res, lastErr;
            for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
              if (attempt > 0) {
                const waitMs = 5000 * Math.pow(3, attempt - 1);
                await new Promise(r => setTimeout(r, waitMs));
              }
              try {
                res = await fetch("/.netlify/functions/publish", {
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
                    skip_rate_limit: !!item.warmup,
                  }),
                });
                if (res.ok || (res.status >= 400 && res.status < 500)) break;
                lastErr = new Error(`HTTP ${res.status}`);
              } catch (fetchErr) {
                lastErr = fetchErr;
                res = null;
              }
            }

            if (!res || !res.ok) throw lastErr || new Error(`HTTP ${res?.status}`);
            const data = await res.json();
            const results = data.results || [];

            // Separar contas com vídeo ainda processando das já finalizadas
            const pendingResults  = results.filter((r) => r.pending && r.creation_id);
            const finishedResults = results.filter((r) => !r.pending);

            const historyId = `h-${Date.now()}-${mi}`;

            // Para cada conta com vídeo pendente, criar item video_finish na fila
            for (const pr of pendingResults) {
              const vfId = `vf-${historyId}-${pr.account_id}`;
              await dbPut("queue", {
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
              id: historyId,
              post_type: item.postType,
              media_url: mediaUrl,
              media_type: item.mediaType,
              default_caption: item.caption,
              results: finishedResults,
              pending_accounts: pendingAccounts,
              created_at: new Date().toISOString(),
              from_scheduler: true,
            });
          }

          if (item.loop) {
            await dbPut("queue", { ...item, status: "pending", scheduledAt: item.scheduledAt + 86400000, runCount: (item.runCount || 0) + 1 });
          } else {
            await dbPut("queue", { ...item, status: "done" });
          }
        } catch (err) {
          await dbPut("queue", { ...item, status: "error", error: err.message, failedAt: new Date().toISOString(), retryCount: (item.retryCount || 0) + 1 });
        }

        runningRef.current.delete(item.id);
        reload();
      }
    };

    const iv = setInterval(tick, 10000);
    tick(); // roda imediatamente ao montar
    return () => clearInterval(iv);
  }, [addEntry, reload]);

  const addBatch   = async (b) => { await dbPutMany("queue", b); reload(); };
  const updateItem = async (item) => { await dbPut("queue", item); reload(); };
  const removeItem = async (id) => { await dbDelete("queue", id); setQueue((p) => p.filter((x) => x.id !== id)); };
  const clearQueue = async () => { await dbClear("queue"); setQueue([]); };

  return (
    <SchedulerContext.Provider value={{ queue, addBatch, updateItem, removeItem, clearQueue, reload }}>
      {children}
    </SchedulerContext.Provider>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
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
