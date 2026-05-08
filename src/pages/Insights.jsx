// src/pages/Insights.jsx — Engajamento dos Reels por conta e por dia
import { useState, useEffect, useCallback } from "react";
import { useAccounts } from "../App.jsx";

const API = "/.netlify/functions/reels-insights";

function MetricBox({ label, value, icon, highlight }) {
  const display = value === null || value === undefined ? "—" : value.toLocaleString("pt-BR");
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "10px 14px", borderRadius: 10, minWidth: 72,
      background: highlight ? "rgba(124,92,252,0.12)" : "rgba(255,255,255,0.04)",
      border: `1px solid ${highlight ? "rgba(124,92,252,0.3)" : "var(--border)"}`,
    }}>
      <span style={{ fontSize: 17 }}>{icon}</span>
      <span style={{
        fontSize: 15, fontWeight: 700, marginTop: 2,
        color: highlight ? "var(--accent-light)" : "var(--text)",
      }}>{display}</span>
      <span style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>{label}</span>
    </div>
  );
}

function ReelCard({ reel }) {
  const [expanded, setExpanded] = useState(false);
  const ins = reel.insights || {};

  const captionShort = reel.caption
    ? reel.caption.slice(0, 100) + (reel.caption.length > 100 ? "…" : "")
    : "";

  const time = reel.timestamp
    ? new Date(reel.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div
      className="card card-hover"
      onClick={() => setExpanded((p) => !p)}
      style={{ cursor: "pointer" }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        {/* Thumbnail */}
        <div style={{
          width: 60, height: 60, borderRadius: 10, overflow: "hidden",
          background: "var(--bg3)", flexShrink: 0,
          border: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {reel.thumbnail_url ? (
            <img
              src={reel.thumbnail_url} alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => { e.target.style.display = "none"; e.target.parentElement.innerHTML = '<span style="font-size:26px">🎬</span>'; }}
            />
          ) : <span style={{ fontSize: 26 }}>🎬</span>}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <span className="badge badge-purple">🎬 Reel</span>
            {time && <span style={{ fontSize: 11, color: "var(--muted)" }}>⏰ {time}</span>}
            <a
              href={reel.permalink} target="_blank" rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: 11, color: "var(--accent3)", textDecoration: "underline", marginLeft: "auto" }}
            >
              Ver no Instagram ↗
            </a>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{expanded ? "▲" : "▼"}</span>
          </div>

          {/* Caption */}
          {captionShort && (
            <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 10, lineHeight: 1.4 }}>
              {captionShort}
            </div>
          )}

          {/* Métricas em linha */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <MetricBox icon="▶️" label="Plays"       value={ins.plays}      highlight />
            <MetricBox icon="👁️" label="Alcance"     value={ins.reach}               />
            <MetricBox icon="❤️" label="Curtidas"    value={ins.likes}               />
            <MetricBox icon="💬" label="Comentários" value={ins.comments}            />
            <MetricBox icon="↗️" label="Compart."    value={ins.shares}              />
            <MetricBox icon="🔖" label="Salvos"      value={ins.saved}               />
            <MetricBox icon="✨" label="Engaj. total" value={ins.engagement} highlight />
          </div>

          {/* Detalhes expandidos */}
          {expanded && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              {ins.avgWatch !== null && ins.avgWatch !== undefined && (
                <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 4 }}>
                  ⏱️ <strong>Tempo médio de visualização:</strong>{" "}
                  {ins.avgWatch >= 1000
                    ? `${(ins.avgWatch / 1000).toFixed(1)}s`
                    : `${ins.avgWatch}ms`}
                </div>
              )}
              {ins.totalViewTime !== null && ins.totalViewTime !== undefined && (
                <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 4 }}>
                  🕐 <strong>Tempo total visualizado:</strong>{" "}
                  {ins.totalViewTime >= 60000
                    ? `${Math.round(ins.totalViewTime / 60000)} min`
                    : ins.totalViewTime >= 1000
                    ? `${(ins.totalViewTime / 1000).toFixed(0)}s`
                    : `${ins.totalViewTime}ms`}
                </div>
              )}
              {ins.error && (
                <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>
                  ⚠️ Erro ao buscar métricas: {ins.error}
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                ID: {reel.id}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AccountInsights({ account, date }) {
  const [state, setState] = useState({ loading: false, reels: [], error: null, fetched: false });

  const load = useCallback(async () => {
    setState((p) => ({ ...p, loading: true, error: null }));
    try {
      const params = new URLSearchParams({ ig_id: account.id, token: account.access_token, date });
      const res  = await fetch(`${API}?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setState({ loading: false, reels: data.reels || [], error: null, fetched: true });
    } catch (err) {
      setState({ loading: false, reels: [], error: err.message, fetched: true });
    }
  }, [account.id, account.token, date]);

  // Auto-carrega quando o componente aparece
  useEffect(() => { load(); }, [load]);

  const totalEngagement = state.reels.reduce((s, r) => s + (r.insights?.engagement || 0), 0);
  const totalPlays      = state.reels.reduce((s, r) => s + (r.insights?.plays || 0), 0);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      {/* Header da conta */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        {account.picture ? (
          <img src={account.picture} alt=""
            style={{ width: 42, height: 42, borderRadius: "50%", border: "2px solid var(--accent)", objectFit: "cover" }}
            onError={(e) => { e.target.style.display = "none"; }}
          />
        ) : (
          <div style={{
            width: 42, height: 42, borderRadius: "50%",
            background: "linear-gradient(135deg, var(--accent), #9b4dfc)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>👤</div>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>@{account.username}</div>
          {state.fetched && !state.error && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {state.reels.length === 0
                ? "Nenhum reel nesta data"
                : `${state.reels.length} reel(s) • ${totalPlays.toLocaleString("pt-BR")} plays • ${totalEngagement.toLocaleString("pt-BR")} engajamentos`}
            </div>
          )}
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={load}
          disabled={state.loading}
          style={{ fontSize: 12 }}
        >
          {state.loading ? "⟳ Buscando..." : "↻ Atualizar"}
        </button>
      </div>

      {/* Conteúdo */}
      {state.loading && (
        <div style={{ textAlign: "center", padding: "24px 0", color: "var(--muted)", fontSize: 13 }}>
          <div style={{ fontSize: 28, marginBottom: 8, animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</div>
          <div>Buscando reels e métricas...</div>
        </div>
      )}

      {!state.loading && state.error && (
        <div style={{
          padding: "12px 14px", borderRadius: 8,
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
          fontSize: 12, color: "var(--danger)",
        }}>
          ⚠️ {state.error}
        </div>
      )}

      {!state.loading && state.fetched && !state.error && state.reels.length === 0 && (
        <div style={{ textAlign: "center", padding: "20px 0", color: "var(--muted)", fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 6 }}>🎬</div>
          <div>Nenhum reel postado em {date}</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>Tente outra data ou verifique a conta.</div>
        </div>
      )}

      {!state.loading && state.reels.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {state.reels.map((reel) => (
            <ReelCard key={reel.id} reel={reel} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Insights() {
  const { accounts, loading: accountsLoading } = useAccounts();

  // Data padrão = hoje
  const todayStr = new Date().toISOString().slice(0, 10);
  const [date, setDate]       = useState(todayStr);
  const [inputDate, setInputDate] = useState(todayStr);
  const [selectedAccounts, setSelectedAccounts] = useState("ALL"); // ALL ou id

  const activeAccounts = accounts.filter((a) => a.token_status !== "expired");

  const displayAccounts = selectedAccounts === "ALL"
    ? activeAccounts
    : activeAccounts.filter((a) => a.id === selectedAccounts);

  function applyDate() {
    if (inputDate) setDate(inputDate);
  }

  function setQuickDate(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const s = d.toISOString().slice(0, 10);
    setInputDate(s);
    setDate(s);
  }

  if (accountsLoading) {
    return (
      <div className="page">
        <div className="empty">
          <div style={{ fontSize: 32, marginBottom: 8 }}>⟳</div>
          <div>Carregando contas...</div>
        </div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-icon">🎬</div>
          <div className="empty-title">Nenhuma conta conectada</div>
          <div style={{ fontSize: 13 }}>Conecte uma conta Instagram para ver os insights dos reels.</div>
        </div>
      </div>
    );
  }

  if (activeAccounts.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-icon">⚠️</div>
          <div className="empty-title">Tokens expirados</div>
          <div style={{ fontSize: 13 }}>Reconecte suas contas em <strong>Contas</strong> para ver insights.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">📊 Insights de Reels</div>
          <div className="page-subtitle">Engajamento por reel postado no dia</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="card card-sm" style={{ marginBottom: 20, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        {/* Data */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>📅 Data:</label>
          <input
            type="date"
            value={inputDate}
            max={todayStr}
            onChange={(e) => setInputDate(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyDate()}
            style={{ padding: "6px 10px", fontSize: 13, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)" }}
          />
          <button className="btn btn-primary btn-sm" onClick={applyDate} style={{ fontSize: 12 }}>
            Buscar
          </button>
        </div>

        {/* Atalhos de data */}
        <div style={{ display: "flex", gap: 6 }}>
          {[
            { label: "Hoje",     offset: 0  },
            { label: "Ontem",    offset: -1 },
            { label: "2 dias",   offset: -2 },
            { label: "7 dias",   offset: -7 },
          ].map(({ label, offset }) => (
            <button
              key={offset}
              onClick={() => setQuickDate(offset)}
              className={`btn btn-sm ${date === new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10) ? "btn-primary" : "btn-ghost"}`}
              style={{ fontSize: 11, padding: "5px 10px" }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Filtro de conta */}
        {activeAccounts.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>👤 Conta:</label>
            <select
              value={selectedAccounts}
              onChange={(e) => setSelectedAccounts(e.target.value)}
              style={{ padding: "6px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)" }}
            >
              <option value="ALL">Todas ({activeAccounts.length})</option>
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.id}>@{a.username}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Resultados por conta */}
      <div>
        {displayAccounts.map((account) => (
          <AccountInsights key={`${account.id}-${date}`} account={account} date={date} />
        ))}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
