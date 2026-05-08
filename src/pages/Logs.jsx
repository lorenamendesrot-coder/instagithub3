// Logs.jsx — Checklist de atividade e log de publicações
import { useState, useEffect, useCallback } from "react";
import { dbGetAll, dbClear } from "../useDB.js";

const STATUS_COLOR = {
  published: "#22c55e", failed: "#ef4444", pending: "#f59e0b",
  running: "#38bdf8", done: "#22c55e", error: "#ef4444", scheduled: "#a78bfa",
};
const STATUS_LABEL = {
  published: "Publicado", failed: "Falhou", pending: "Aguardando",
  running: "Publicando", done: "Concluído", error: "Erro", scheduled: "Agendado",
};
const TYPE_ICON = { FEED: "🖼", REEL: "🎬", STORY: "⭕" };

function fmt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ── Checklist items ───────────────────────────────────────────────────────────
const CHECKLIST = [
  { id: "conn",    label: "Contas conectadas via OAuth",           desc: "Pelo menos 1 conta ativa" },
  { id: "token",   label: "Tokens sem expiração",                  desc: "Nenhum token marcado como expirado" },
  { id: "sw",      label: "Service Worker ativo",                  desc: "Scheduler em background funcionando" },
  { id: "sched",   label: "Posts agendados na fila",               desc: "Fila com itens pendentes" },
  { id: "pub",     label: "Publicação bem-sucedida recente",       desc: "Ao menos 1 post publicado" },
  { id: "nofail",  label: "Sem erros recentes",                    desc: "Últimas publicações sem falha" },
];

export default function Logs() {
  const [history,  setHistory]  = useState([]);
  const [queue,    setQueue]    = useState([]);
  const [filter,   setFilter]   = useState("all");
  const [search,   setSearch]   = useState("");
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    const h = await dbGetAll("history");
    const q = await dbGetAll("queue");
    h.sort((a, b) => b.id - a.id);
    q.sort((a, b) => b.scheduledAt - a.scheduledAt);
    setHistory(h);
    setQueue(q);
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, []);

  // ── Montar checklist ──────────────────────────────────────────────────────
  const accounts = (() => {
    try { return JSON.parse(localStorage.getItem("ig_accounts") || "[]"); } catch { return []; }
  })();
  const swActive = navigator.serviceWorker?.controller != null;
  const hasExpired = accounts.some(a => a.token_status === "expired");
  const hasPending = queue.some(q => q.status === "pending" || q.status === "running");
  const hasPublished = history.some(h => (h.results || []).some(r => r.success));
  const hasRecentFail = history.slice(0, 10).some(h => (h.results || []).some(r => !r.success));

  const checks = {
    conn:   accounts.length > 0,
    token:  accounts.length > 0 && !hasExpired,
    sw:     swActive,
    sched:  hasPending,
    pub:    hasPublished,
    nofail: hasPublished && !hasRecentFail,
  };
  const score = Object.values(checks).filter(Boolean).length;

  // ── Filtrar histórico ─────────────────────────────────────────────────────
  const filtered = history.filter(h => {
    const results = h.results || [];
    const ok   = results.some(r => r.success);
    const fail = results.some(r => !r.success);
    if (filter === "ok"   && !ok)   return false;
    if (filter === "fail" && !fail) return false;
    if (search) {
      const s = search.toLowerCase();
      const match = (h.default_caption || "").toLowerCase().includes(s)
        || (h.media_url || "").toLowerCase().includes(s)
        || results.some(r => r.username?.toLowerCase().includes(s));
      if (!match) return false;
    }
    return true;
  });

  const clearAll = async () => {
    if (!confirm("Limpar todo o histórico?")) return;
    setClearing(true);
    await dbClear("history");
    setHistory([]);
    setClearing(false);
  };

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1000, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>📋 Logs & Checklist</div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
            Acompanhe publicações e verifique o status do sistema
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={load}>↻ Atualizar</button>
          {history.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={clearAll} disabled={clearing}>
              {clearing ? "Limpando..." : "Limpar logs"}
            </button>
          )}
        </div>
      </div>

      {/* ── Checklist ── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Status do sistema</div>
          <div style={{
            padding: "4px 14px", borderRadius: 20, fontSize: 13, fontWeight: 700,
            background: score === 6 ? "rgba(34,197,94,0.12)" : score >= 4 ? "rgba(245,158,11,0.12)" : "rgba(239,68,68,0.12)",
            color: score === 6 ? "var(--success)" : score >= 4 ? "var(--warning)" : "var(--danger)",
            border: `1px solid ${score === 6 ? "rgba(34,197,94,0.25)" : score >= 4 ? "rgba(245,158,11,0.25)" : "rgba(239,68,68,0.25)"}`,
          }}>
            {score}/{CHECKLIST.length} OK
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {CHECKLIST.map(item => {
            const ok = checks[item.id];
            return (
              <div key={item.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", borderRadius: 8,
                background: ok ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)",
                border: `1px solid ${ok ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.12)"}`,
              }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{ok ? "✅" : "❌"}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: ok ? "var(--text)" : "var(--text2)" }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{item.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Fila ativa ── */}
      {queue.filter(q => q.status === "pending" || q.status === "running").length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
            ⏳ Fila ativa ({queue.filter(q => q.status === "pending" || q.status === "running").length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {queue.filter(q => q.status === "pending" || q.status === "running").map(item => (
              <div key={item.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px", borderRadius: 8, background: "var(--bg3)",
                border: `1px solid ${item.status === "running" ? "rgba(56,189,248,0.3)" : "var(--border)"}`,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                  background: STATUS_COLOR[item.status],
                  boxShadow: item.status === "running" ? `0 0 6px ${STATUS_COLOR[item.status]}` : "none",
                }} />
                <span className="badge badge-gray" style={{ fontSize: 10 }}>{item.postType}</span>
                <span style={{ fontSize: 12, color: "var(--text2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.mediaUrl?.split("/").pop() || item.mediaUrl}
                </span>
                <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>
                  🕐 {fmt(new Date(item.scheduledAt).toISOString())}
                </span>
                <span style={{ fontSize: 11, color: STATUS_COLOR[item.status], fontWeight: 600 }}>
                  {STATUS_LABEL[item.status]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Histórico ── */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            📜 Histórico ({filtered.length})
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              placeholder="Buscar..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 160, padding: "5px 10px", fontSize: 12 }}
            />
            {["all","ok","fail"].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`btn btn-sm ${filter === f ? "btn-primary" : "btn-ghost"}`}
                style={{ padding: "4px 12px", fontSize: 11 }}>
                {f === "all" ? "Todos" : f === "ok" ? "✅ OK" : "❌ Erros"}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)", fontSize: 13 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
            Nenhum log encontrado
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map(entry => {
              const results = entry.results || [];
              const ok   = results.filter(r => r.success).length;
              const fail = results.filter(r => !r.success).length;
              return (
                <div key={entry.id} style={{
                  padding: "12px 14px", borderRadius: 8, background: "var(--bg3)",
                  border: `1px solid ${fail > 0 && ok === 0 ? "rgba(239,68,68,0.2)" : ok > 0 ? "rgba(34,197,94,0.12)" : "var(--border)"}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 15 }}>{TYPE_ICON[entry.post_type] || "📌"}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.media_url?.split("/").pop() || entry.media_url}
                    </span>
                    {entry.from_scheduler && <span className="badge badge-purple" style={{ fontSize: 10 }}>Agendado</span>}
                    <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>{fmt(entry.created_at)}</span>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
                      background: fail > 0 && ok === 0 ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)",
                      color: fail > 0 && ok === 0 ? "var(--danger)" : "var(--success)",
                    }}>
                      {ok}/{results.length}
                    </span>
                  </div>
                  {entry.default_caption && (
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.default_caption}
                    </div>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {results.map((r, i) => (
                      <div key={i} title={r.error || ""} style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 500,
                        background: r.success ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                        border: `1px solid ${r.success ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                        color: r.success ? "var(--success)" : "var(--danger)",
                        cursor: r.error ? "help" : "default",
                      }}>
                        {r.success ? "✓" : "✗"} @{r.username}
                        {r.error && <span style={{ fontSize: 10, opacity: 0.7 }}> · {r.error.slice(0, 30)}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
