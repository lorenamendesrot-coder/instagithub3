// Sidebar.jsx — Componente isolado de navegação lateral
import { NavLink } from "react-router-dom";

const NAV = [
  { to: "/",          label: "Contas",       icon: "👤" },
  { to: "/novo",        label: "Novo post",    icon: "✦"  },
  { to: "/agendar",    label: "Agendamentos", icon: "◷"  },
  { to: "/historico",  label: "Histórico",    icon: "≡"  },
  { to: "/aquecimento",label: "Aquecimento",  icon: "🔥" },
  { to: "/protecao",   label: "Proteção",     icon: "🛡️" },
];

export default function Sidebar({ accounts, swStatus, oauthUrl }) {
  const swInfo = {
    active:      { color: "#22c55e", label: "●", title: "Scheduler ativo" },
    error:       { color: "#ef4444", label: "●", title: "Erro no scheduler" },
    unsupported: { color: "#f59e0b", label: "●", title: "SW não suportado" },
    loading:     { color: "#666678", label: "●", title: "Iniciando..." },
  }[swStatus] || { color: "#666678", label: "●" };

  return (
    <>
      {/* Logo */}
      <div style={{ padding: "22px 20px 18px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, var(--accent), #9b4dfc)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, flexShrink: 0, boxShadow: "0 2px 12px rgba(124,92,252,0.4)",
          }}>📱</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.01em" }}>Insta Manager</div>
            <div style={{ fontSize: 10, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: swInfo.color, fontSize: 8 }} title={swInfo.title}>{swInfo.label}</span>
              Meta Graph API v21
            </div>
          </div>
        </div>
      </div>

      {/* Contas na sidebar */}
      {accounts.length > 0 && (
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, letterSpacing: "0.08em", marginBottom: 10, textTransform: "uppercase" }}>
            Contas ({accounts.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 180, overflowY: "auto" }}>
            {accounts.map((acc) => (
              <div key={acc.id} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  {acc.profile_picture ? (
                    <img
                      src={acc.profile_picture} alt=""
                      style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", border: "1.5px solid var(--border2)" }}
                      onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
                    />
                  ) : null}
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    background: "linear-gradient(135deg, var(--accent), #9b4dfc)",
                    display: acc.profile_picture ? "none" : "flex",
                    alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 700, color: "#fff",
                    border: "1.5px solid var(--border2)", flexShrink: 0,
                  }}>
                    {(acc.username || "?")[0].toUpperCase()}
                  </div>
                  {/* ✅ Badge de token expirado */}
                  {acc.token_status === "expired" && (
                    <span title="Token expirado — reconecte esta conta" style={{
                      position: "absolute", bottom: -2, right: -2,
                      width: 10, height: 10, borderRadius: "50%",
                      background: "#ef4444", border: "1.5px solid var(--bg2)",
                      fontSize: 6, display: "flex", alignItems: "center", justifyContent: "center",
                    }}>!</span>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, fontWeight: 500,
                    color: acc.token_status === "expired" ? "var(--danger)" : "var(--text)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    @{acc.username || "conta"}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)" }}>
                    {acc.token_status === "expired" ? "⚠ Token expirado" : (acc.account_type || "BUSINESS")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Nav */}
      <nav style={{ padding: "10px", flex: 1 }}>
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === "/"}
            style={({ isActive }) => ({
              display: "flex", alignItems: "center", gap: 11,
              padding: "10px 13px", borderRadius: 10, marginBottom: 3,
              color: isActive ? "var(--accent3)" : "var(--muted)",
              background: isActive ? "rgba(124,92,252,0.12)" : "transparent",
              fontWeight: isActive ? 600 : 400, fontSize: 13.5,
              transition: "all 0.12s", borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
            })}
          >
            <span style={{ fontSize: 16, lineHeight: 1, minWidth: 20, textAlign: "center" }}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Conectar */}
      <div style={{ padding: "14px 12px", borderTop: "1px solid var(--border)" }}>
        <a href={oauthUrl} className="btn btn-primary" style={{ width: "100%", fontSize: 13 }}>
          + Conectar conta
        </a>
      </div>
    </>
  );
}
