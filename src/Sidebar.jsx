// Sidebar.jsx
import { NavLink } from "react-router-dom";

const NAV = [
  { to: "/",           label: "Contas",       icon: "👤", desc: "Gerencie suas contas" },
  { to: "/novo",       label: "Novo Post",    icon: "✨", desc: "Criar publicação"     },
  { to: "/agendar",   label: "Agendar",      icon: "🗓️", desc: "Programar posts"      },
  { to: "/historico",  label: "Histórico",    icon: "📊", desc: "Posts publicados"     },
  { to: "/aquecimento",label: "Aquecimento",  icon: "🔥", desc: "Aquecer contas"       },
  { to: "/protecao",   label: "Proteção",     icon: "🛡️", desc: "Segurança da conta"   },
];

export default function Sidebar({ accounts, swStatus, oauthUrl, syncing }) {
  const swInfo = {
    active:      { color: "#22c55e", title: "Scheduler ativo" },
    error:       { color: "#ef4444", title: "Erro no scheduler" },
    unsupported: { color: "#f59e0b", title: "SW não suportado" },
    loading:     { color: "#666678", title: "Iniciando..." },
  }[swStatus] || { color: "#666678", title: "" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* Logo */}
      <div style={{ padding: "20px 18px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 12,
            background: "linear-gradient(135deg, var(--accent), #9b4dfc)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, flexShrink: 0, boxShadow: "0 2px 16px rgba(124,92,252,0.45)",
          }}>📱</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-0.02em" }}>Insta Manager</div>
            <div style={{ fontSize: 10, color: "var(--muted)", display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: swInfo.color, display: "inline-block",
                boxShadow: `0 0 6px ${swInfo.color}`,
              }} title={swInfo.title} />
              <span>Meta Graph API v21</span>
              {syncing && <span style={{ color: "var(--accent-light)", animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Contador de contas — só o número, sem lista */}
      {accounts.length > 0 && (
        <NavLink to="/" end style={{ textDecoration: "none" }}>
          <div style={{
            margin: "10px 10px 0",
            padding: "8px 12px",
            borderRadius: 10,
            background: "rgba(124,92,252,0.07)",
            border: "1px solid rgba(124,92,252,0.15)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: "linear-gradient(135deg, var(--accent), #9b4dfc)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, flexShrink: 0,
            }}>👥</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-light)" }}>
                {accounts.length} conta{accounts.length > 1 ? "s" : ""} conectada{accounts.length > 1 ? "s" : ""}
              </div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>
                {accounts.filter(a => a.token_status === "expired").length > 0
                  ? `⚠️ ${accounts.filter(a => a.token_status === "expired").length} token(s) expirado(s)`
                  : "Todas ativas"}
              </div>
            </div>
          </div>
        </NavLink>
      )}

      {/* Nav */}
      <nav style={{ padding: "8px 10px", flex: 1, marginTop: 6 }}>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/"}
            style={({ isActive }) => ({
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 12px", borderRadius: 10, marginBottom: 2,
              color: isActive ? "var(--accent-light)" : "var(--muted)",
              background: isActive ? "rgba(124,92,252,0.13)" : "transparent",
              fontWeight: isActive ? 700 : 400, fontSize: 13,
              transition: "all 0.12s",
              borderLeft: `2px solid ${isActive ? "var(--accent)" : "transparent"}`,
              textDecoration: "none",
            })}
          >
            <span style={{
              fontSize: 17, lineHeight: 1, minWidth: 22, textAlign: "center",
              filter: "drop-shadow(0 0 4px rgba(124,92,252,0.3))",
            }}>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Conectar */}
      <div style={{ padding: "12px 10px", borderTop: "1px solid var(--border)" }}>
        <a href={oauthUrl} className="btn btn-primary" style={{ width: "100%", fontSize: 13, textAlign: "center" }}>
          ＋ Conectar conta
        </a>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
