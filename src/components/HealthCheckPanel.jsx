// HealthCheckPanel.jsx — Painel de Health Check com pausa automática
import { useState } from "react";

const STATUS_INFO = {
  ok:            { icon: "✅", label: "Saudável",       color: "var(--success)", bg: "rgba(34,197,94,0.06)",  border: "rgba(34,197,94,0.2)"  },
  warn:          { icon: "⚠️", label: "Atenção",        color: "var(--warning)", bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.2)" },
  paused:        { icon: "⏸️", label: "Pausada",        color: "var(--danger)",  bg: "rgba(239,68,68,0.06)",  border: "rgba(239,68,68,0.2)"  },
  token_expired: { icon: "🔑", label: "Token expirado", color: "var(--danger)",  bg: "rgba(239,68,68,0.06)",  border: "rgba(239,68,68,0.2)"  },
  error:         { icon: "❌", label: "Erro",           color: "var(--muted)",   bg: "var(--bg3)",            border: "var(--border)"        },
};

function ScoreBar({ score }) {
  const color = score >= 75 ? "var(--success)" : score >= 45 ? "var(--warning)" : "var(--danger)";
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>
        <span>Score de saúde</span>
        <span style={{ color, fontWeight: 700 }}>{score}/100</span>
      </div>
      <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${score}%`, background: color, borderRadius: 2, transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

function AccountHealthCard({ r, accounts }) {
  const [expanded, setExpanded] = useState(false);
  const info = STATUS_INFO[r.status] || STATUS_INFO.error;
  const acc  = accounts?.find((a) => a.id === r.id);

  return (
    <div style={{ padding: "12px 14px", borderRadius: 10, background: info.bg, border: `1px solid ${info.border}`, marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Avatar */}
        {acc?.profile_picture
          ? <img src={acc.profile_picture} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
          : <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg, var(--accent), #9b4dfc)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
              {(r.username || "?")[0].toUpperCase()}
            </div>}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              @{r.username}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: info.color, flexShrink: 0 }}>
              {info.icon} {info.label}
            </span>
          </div>

          {r.score !== null && <ScoreBar score={r.score} />}
        </div>

        <button onClick={() => setExpanded(p => !p)} style={{ background: "none", color: "var(--muted)", fontSize: 12, padding: "0 4px", flexShrink: 0 }}>
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          {/* Métricas de reach */}
          {(r.reach_7d !== null || r.reach_prev_7d !== null) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
              {[
                { label: "Reach 7d",      value: r.reach_7d      ?? "—" },
                { label: "Reach prev 7d", value: r.reach_prev_7d ?? "—" },
                { label: "Queda",         value: r.reach_drop_pct !== null ? `${r.reach_drop_pct > 0 ? "-" : "+"}${Math.abs(r.reach_drop_pct)}%` : "—", color: r.reach_drop_pct >= 50 ? "var(--danger)" : r.reach_drop_pct >= 30 ? "var(--warning)" : "var(--success)" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ textAlign: "center", padding: "7px 6px", background: "var(--bg3)", borderRadius: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: color || "var(--text)" }}>{value}</div>
                  <div style={{ fontSize: 10, color: "var(--muted)" }}>{label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Issues */}
          {r.issues?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.04em" }}>Problemas detectados</div>
              {r.issues.map((issue, i) => (
                <div key={i} style={{ fontSize: 11, color: "var(--text)", padding: "5px 9px", background: "var(--bg3)", borderRadius: 6, marginBottom: 4, lineHeight: 1.5 }}>
                  {r.status === "paused" || r.status === "token_expired" ? "🚨 " : "⚠️ "}{issue}
                </div>
              ))}
            </div>
          )}

          {/* Pausa automática */}
          {r.auto_paused && (
            <div style={{ marginTop: 8, padding: "7px 10px", borderRadius: 7, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", fontSize: 11, color: "var(--danger)", fontWeight: 600 }}>
              ⏸️ Conta pausada automaticamente — publicações suspensas até revisão manual
            </div>
          )}

          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 8 }}>
            Verificado em: {new Date(r.checked_at).toLocaleString("pt-BR")}
          </div>
        </div>
      )}
    </div>
  );
}

export default function HealthCheckPanel({ result, loading, lastRun, stats, onRunCheck, accounts, thresholds }) {
  const [showAll, setShowAll] = useState(false);
  const results = result?.results || [];
  const criticals = results.filter(r => r.status === "paused" || r.status === "token_expired");
  const warnings  = results.filter(r => r.status === "warn");
  const oks       = results.filter(r => r.status === "ok");
  const displayed = showAll ? results : [...criticals, ...warnings, ...oks].slice(0, 8);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>🩺 Health Check</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            {lastRun ? `Última verificação: ${lastRun.toLocaleString("pt-BR")}` : "Ainda não executado hoje"}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => onRunCheck(true)} disabled={loading}>
          {loading ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Verificando...</> : "▶ Verificar agora"}
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
          {[
            { label: "Saudáveis",  value: stats.ok,      color: "var(--success)", icon: "✅" },
            { label: "Atenção",    value: stats.warned,  color: "var(--warning)", icon: "⚠️" },
            { label: "Pausadas",   value: stats.paused,  color: "var(--danger)",  icon: "⏸️" },
            { label: "Exp. token", value: stats.expired, color: "var(--danger)",  icon: "🔑" },
          ].map(({ label, value, color, icon }) => (
            <div key={label} style={{ textAlign: "center", padding: "10px 8px", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10 }}>
              <div style={{ fontSize: 18, marginBottom: 2 }}>{icon}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Thresholds configurados */}
      {thresholds && (
        <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 8, background: "var(--bg2)", border: "1px solid var(--border)", fontSize: 11, color: "var(--muted)", display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span>⏸️ Pausa automática se queda ≥ <strong style={{ color: "var(--danger)" }}>{thresholds.reach_drop_critical}%</strong></span>
          <span>⚠️ Alerta se queda ≥ <strong style={{ color: "var(--warning)" }}>{thresholds.reach_drop_warn}%</strong></span>
          <span>📉 Score crítico ≤ <strong style={{ color: "var(--danger)" }}>{thresholds.score_danger}</strong></span>
        </div>
      )}

      {/* Lista de contas */}
      {loading && !results.length ? (
        <div style={{ textAlign: "center", padding: "32px 0", color: "var(--muted)" }}>
          <div className="spinner" style={{ width: 24, height: 24, margin: "0 auto 12px" }} />
          <div style={{ fontSize: 13 }}>Verificando todas as contas...</div>
        </div>
      ) : results.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0", color: "var(--muted)", fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>🩺</div>
          Clique em "Verificar agora" para rodar o Health Check
        </div>
      ) : (
        <>
          {displayed.map((r) => (
            <AccountHealthCard key={r.id} r={r} accounts={accounts} />
          ))}
          {results.length > 8 && (
            <button className="btn btn-ghost btn-sm" style={{ width: "100%", marginTop: 4 }}
              onClick={() => setShowAll(p => !p)}>
              {showAll ? "Mostrar menos" : `Ver todas (${results.length})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
