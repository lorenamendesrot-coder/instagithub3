// AccountUtils.js — funções utilitárias compartilhadas entre sub-componentes de Accounts

export function fmt(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000)    return (n / 1_000).toFixed(0) + "k";
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toLocaleString("pt-BR");
}

export function healthMeta(overall, tokenExpired) {
  if (tokenExpired)          return { color: "var(--danger)",  bg: "rgba(239,68,68,0.10)",  border: "rgba(239,68,68,0.30)",  label: "Token expirado", icon: "🔴" };
  if (overall === "good")    return { color: "var(--success)", bg: "rgba(34,197,94,0.10)",  border: "rgba(34,197,94,0.30)",  label: "Saudável",       icon: "🟢" };
  if (overall === "warning") return { color: "var(--warning)", bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.30)", label: "Atenção",        icon: "🟡" };
  if (overall === "danger")  return { color: "var(--danger)",  bg: "rgba(239,68,68,0.10)",  border: "rgba(239,68,68,0.30)",  label: "Crítico",        icon: "🔴" };
  return { color: "var(--muted)", bg: "var(--bg3)", border: "var(--border)", label: "—", icon: "⚪" };
}
