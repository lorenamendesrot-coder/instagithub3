// MobileBottomNav.jsx — Barra de navegação inferior para mobile
import { NavLink } from "react-router-dom";

// Apenas os itens mais usados ficam na barra inferior
// Os demais ficam em "Mais"
const PRIMARY_NAV = [
  { to: "/",            label: "Contas",      icon: "👤" },
  { to: "/aquecimento", label: "Aquecimento", icon: "🔥" },
  { to: "/fila",        label: "Fila",        icon: "🗂️" },
  { to: "/historico",   label: "Histórico",   icon: "📋" },
  { to: "/insights",    label: "Insights",    icon: "📊" },
];

const EXTRA_NAV = [
  { to: "/aquecimento", label: "Aquecimento", icon: "🔥" },
  { to: "/protecao",    label: "Proteção",    icon: "🛡️" },
  { to: "/logs",        label: "Logs",        icon: "📋" },
];

export default function MobileBottomNav() {
  return (
    <>
      <nav style={{
        display: "none", // controlado por @media no CSS
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 150,
        background: "var(--bg2)",
        borderTop: "1px solid var(--border)",
        padding: "6px 0 max(6px, env(safe-area-inset-bottom))",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }} className="mobile-bottom-nav">
        {PRIMARY_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            style={({ isActive }) => ({
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flex: 1,
              gap: 3,
              padding: "4px 2px",
              color: isActive ? "var(--accent-light)" : "var(--muted)",
              textDecoration: "none",
              fontSize: 10,
              fontWeight: isActive ? 700 : 400,
              transition: "color 0.12s",
              position: "relative",
            })}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <div style={{
                    position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
                    width: 24, height: 2, borderRadius: 2,
                    background: "var(--accent)",
                  }} />
                )}
                <span style={{ fontSize: 20, lineHeight: 1 }}>{item.icon}</span>
                <span style={{ fontSize: 9.5, letterSpacing: 0 }}>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <style>{`
        @media (max-width: 768px) {
          .mobile-bottom-nav {
            display: flex !important;
          }
        }
      `}</style>
    </>
  );
}
