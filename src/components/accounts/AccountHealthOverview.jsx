// AccountHealthOverview.jsx — painel de saúde geral no topo de Accounts
export default function HealthOverview({ accounts, insights, onRefreshAll, refreshingAll, refreshProgress }) {
  let good = 0, warning = 0, danger = 0, scoreSum = 0, scored = 0;
  const alerts = [];

  for (const acc of accounts) {
    const ins          = insights[acc.id];
    const tokenExpired = acc.token_status === "expired";
    const overall      = tokenExpired ? "danger" : (ins?.health?.overall ?? null);

    if (overall === "good")         good++;
    else if (overall === "warning") warning++;
    else if (overall === "danger")  danger++;

    const sc = tokenExpired ? 0 : (ins?.health?.score ?? null);
    if (sc != null) { scoreSum += sc; scored++; }

    if (tokenExpired) {
      alerts.push({ username: acc.username, msg: "Token expirado — reconecte." });
    } else if (overall === "danger" && ins?.health?.issues?.length) {
      alerts.push({ username: acc.username, msg: ins.health.issues[0] });
    }
  }

  const avgScore = scored > 0 ? Math.round(scoreSum / scored) : null;
  const pending  = accounts.filter((a) => !insights[a.id] && a.token_status !== "expired").length;

  const cards = [
    { label: "SAUDÁVEIS", count: good,    color: "var(--success)", bg: "rgba(34,197,94,0.08)",  border: "rgba(34,197,94,0.25)",  icon: "🟢" },
    { label: "ATENÇÃO",   count: warning, color: "var(--warning)", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", icon: "🟡" },
    { label: "CRÍTICAS",  count: danger,  color: "var(--danger)",  bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.25)",  icon: "🔴" },
  ];

  const avgColor = avgScore == null ? "var(--muted)"
    : avgScore >= 75 ? "var(--success)"
    : avgScore >= 45 ? "var(--warning)"
    : "var(--danger)";

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Status de Saúde
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            {accounts.length} conta(s) monitorada(s){pending > 0 && ` · ${pending} aguardando dados`}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onRefreshAll}
          disabled={refreshingAll || accounts.length === 0}
        >
          {refreshingAll
            ? `↻ Atualizando ${refreshProgress.done}/${refreshProgress.total}...`
            : "↻ Atualizar tudo"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }} className="health-grid">
        {cards.map((c) => (
          <div key={c.label} style={{
            padding: "12px 10px",
            background: c.bg, border: `1px solid ${c.border}`,
            borderRadius: 10,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 4, textAlign: "center",
          }}>
            <div style={{ fontSize: 20 }}>{c.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.color, lineHeight: 1 }}>{c.count}</div>
            <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{c.label}</div>
          </div>
        ))}

        <div style={{
          padding: "12px 10px",
          background: "var(--bg2)", border: "1px solid var(--border2)",
          borderRadius: 10,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 4, textAlign: "center",
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: "50%",
            background: `conic-gradient(${avgColor} ${(avgScore || 0) * 3.6}deg, var(--bg3) 0deg)`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%", background: "var(--bg2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 800, color: avgColor,
            }}>
              {avgScore ?? "—"}
            </div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: avgColor }}>
            {avgScore == null ? "Carregando" : avgScore >= 75 ? "Bom" : avgScore >= 45 ? "Regular" : "Ruim"}
          </div>
          <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Score médio</div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div style={{
          marginTop: 10, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.22)",
          borderRadius: 9, padding: "10px 13px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--danger)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            ⚠ Alertas críticos ({alerts.length})
          </div>
          {alerts.slice(0, 3).map((a, i) => (
            <div key={i} style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5, marginBottom: 3 }}>
              <span style={{ color: "var(--danger)", fontWeight: 700 }}>@{a.username}</span>
              <span style={{ color: "var(--muted)" }}> — </span>
              {a.msg}
            </div>
          ))}
          {alerts.length > 3 && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              + {alerts.length - 3} alerta(s) adicional(is)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
