import { Routes, Route, useLocation } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";

// Páginas
import Accounts from "./pages/Accounts.jsx";
import NewPost   from "./pages/NewPost.jsx";
import Schedule  from "./pages/Schedule.jsx";
import History   from "./pages/History.jsx";
import Warmup      from "./pages/Warmup.jsx";
import Protection  from "./pages/Protection.jsx";
import Logs        from "./pages/Logs.jsx";

// Hooks e componentes isolados
import { useAccounts }     from "./useAccounts.js";
import { useToast }        from "./useToast.js";
import { useServiceWorker } from "./useServiceWorker.js";
import { useTokenCheck }   from "./useTokenCheck.js";
import { useOAuthUrl }     from "./useOAuthUrl.js";
import { dbGetAll, dbPut, dbClear } from "./useDB.js";
import Sidebar from "./Sidebar.jsx";
import Toast   from "./Toast.jsx";

export { useAccounts };

// ─── History — IndexedDB ─────────────────────────────────────────────────────
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

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const { addAccounts, accounts, reloadAccounts, syncing, loading: accountsLoading } = useAccounts();
  const { toast, showToast }   = useToast();
  const { swStatus }           = useServiceWorker();
  const { oauthUrl }           = useOAuthUrl();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  // Fechar menu mobile ao navegar
  useEffect(() => { setMobileMenuOpen(false); }, [location.pathname]);

  // ✅ Alerta proativo de token expirado
  useTokenCheck({
    accounts,
    onExpired: useCallback((expired) => {
      reloadAccounts(); // atualiza badge na sidebar
      const nomes = expired.map((a) => `@${a.username}`).join(", ");
      showToast("error", `Token expirado para: ${nomes}. Reconecte em Contas.`);
    }, [showToast, reloadAccounts]),
  });

  // OAuth callback e erros da URL
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
          console.error("OAuth import error:", err);
          showToast("error", "Erro ao salvar contas: " + err.message);
        }
      })();
    }
    if (error) showToast("error", decodeURIComponent(error));
  }, []);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* ── Sidebar Desktop ── */}
      <aside style={{
        width: 230, background: "var(--bg2)",
        borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column",
        flexShrink: 0,
        position: "sticky", top: 0, height: "100vh",
      }} className="sidebar-desktop">
        <Sidebar accounts={accounts} swStatus={swStatus} oauthUrl={oauthUrl} syncing={syncing} loading={accountsLoading} />
      </aside>

      {/* ── Mobile Header ── */}
      <div className="mobile-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: "linear-gradient(135deg, var(--accent), #9b4dfc)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
          }}>📱</div>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Insta Manager</span>
        </div>
        <button
          onClick={() => setMobileMenuOpen((p) => !p)}
          style={{ background: "none", border: "none", color: "var(--text)", fontSize: 22, padding: 4 }}
        >
          {mobileMenuOpen ? "✕" : "☰"}
        </button>
      </div>

      {/* ── Mobile Drawer ── */}
      {mobileMenuOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        }} onClick={() => setMobileMenuOpen(false)}>
          <aside
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 260, height: "100%", background: "var(--bg2)",
              borderRight: "1px solid var(--border)",
              display: "flex", flexDirection: "column",
              animation: "slideInLeft 0.2s ease",
            }}
          >
            <Sidebar accounts={accounts} swStatus={swStatus} oauthUrl={oauthUrl} syncing={syncing} loading={accountsLoading} />
          </aside>
        </div>
      )}

      {/* ── Main ── */}
      <main style={{ flex: 1, overflow: "auto", minWidth: 0, background: "var(--bg)" }}>
        <Toast toast={toast} />

        {swStatus === "unsupported" && (
          <div style={{ margin: "16px 32px 0", padding: "10px 16px", borderRadius: 10, fontSize: 12, background: "rgba(245,158,11,0.1)", color: "var(--warning)", border: "1px solid rgba(245,158,11,0.25)" }}>
            ⚠️ Navegador não suporta Service Worker. Agendamentos só funcionam com a aba aberta.
          </div>
        )}

        <Routes>
          <Route path="/"          element={<Accounts />} />
          <Route path="/novo"      element={<NewPost />} />
          <Route path="/agendar"   element={<Schedule />} />
          <Route path="/historico"   element={<History />} />
          <Route path="/aquecimento" element={<Warmup />} />
          <Route path="/protecao"     element={<Protection />} />
          <Route path="/logs"          element={<Logs />} />
        </Routes>
      </main>

      <style>{`
        @keyframes slideIn      { from { opacity: 0; transform: translateX(20px);  } to { opacity: 1; transform: translateX(0); } }
        @keyframes slideInLeft  { from { opacity: 0; transform: translateX(-100%); } to { opacity: 1; transform: translateX(0); } }
        .sidebar-desktop { display: flex; }
        .mobile-header   { display: none; }
        @media (max-width: 768px) {
          .sidebar-desktop { display: none !important; }
          .mobile-header {
            display: flex; align-items: center; justify-content: space-between;
            position: fixed; top: 0; left: 0; right: 0; z-index: 100;
            padding: 12px 16px;
            background: var(--bg2); border-bottom: 1px solid var(--border);
            height: 56px;
          }
          main { padding-top: 56px; }
        }
      `}</style>
    </div>
  );
}
