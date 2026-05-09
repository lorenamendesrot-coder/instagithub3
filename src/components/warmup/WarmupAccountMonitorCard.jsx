// WarmupAccountMonitorCard.jsx — card de monitoramento de conta no aquecimento
import { warmupDay, isNewAccount, shadowScore } from "./WarmupUtils.js";

export default function AccountMonitorCard({ acc, queueItems }) {
  const day        = warmupDay(acc.connected_at || new Date().toISOString());
  const score      = shadowScore(acc.insights);
  const risk       = score?.drop > 70 ? "high" : score?.drop > 40 ? "medium" : "ok";
  const warmupItems= queueItems.filter((q) => q.accountId === acc.id && q.warmup);
  const done       = warmupItems.filter((q) => q.status === "done").length;
  const pending    = warmupItems.filter((q) => q.status === "pending").length;
  const total      = warmupItems.length;
  const riskStyle  = {
    high:   { border: "rgba(239,68,68,0.35)",  bg: "rgba(239,68,68,0.04)"  },
    medium: { border: "rgba(245,158,11,0.3)",  bg: "rgba(245,158,11,0.04)" },
    ok:     { border: "var(--border)",          bg: "var(--bg2)"            },
  }[risk];

  return (
    <div style={{ padding: "16px 18px", borderRadius: 12, background: riskStyle.bg, border: `1px solid ${riskStyle.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{acc.nickname || acc.name || `@${acc.username}`}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>@{acc.username}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
            {isNewAccount(acc) ? `🔥 Conta nova — Dia ${day} de aquecimento` : `Conta ativa — Dia ${day}`}
          </div>
        </div>
        {!score   ? <span className="badge badge-gray"    style={{ fontSize: 10 }}>Sem dados</span>
        : risk === "high"   ? <span className="badge badge-danger"  style={{ fontSize: 10 }}>⚠️ Shadowban?</span>
        : risk === "medium" ? <span className="badge badge-warning" style={{ fontSize: 10 }}>⚠️ Queda</span>
        :                     <span className="badge badge-success" style={{ fontSize: 10 }}>✅ Normal</span>}
      </div>

      {total > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>Posts agendados</span>
            <span style={{ fontSize: 11, fontWeight: 600 }}>{done}/{total}</span>
          </div>
          <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${total > 0 ? (done/total)*100 : 0}%`, background: "linear-gradient(90deg, var(--accent), #9b4dfc)", borderRadius: 2, transition: "width 0.5s" }} />
          </div>
          <div style={{ marginTop: 4, display: "flex", gap: 12, fontSize: 10, color: "var(--muted)" }}>
            <span>✅ {done} publicados</span>
            <span>⏳ {pending} pendentes</span>
          </div>
        </div>
      )}

      {score && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "8px 12px", borderRadius: 8, background: "rgba(0,0,0,0.2)" }}>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Média <b style={{ color: "var(--text)" }}>{score.avg.toLocaleString()}</b> views</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Último <b style={{ color: "var(--text)" }}>{score.last.toLocaleString()}</b></div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            Variação <b style={{ color: score.drop > 40 ? "var(--danger)" : "var(--success)" }}>
              {score.drop > 0 ? `-${score.drop}%` : `+${Math.abs(score.drop)}%`}
            </b>
          </div>
        </div>
      )}

      {total === 0 && (
        <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", padding: "4px 0" }}>
          Sem agendamentos de aquecimento para esta conta
        </div>
      )}
    </div>
  );
}


