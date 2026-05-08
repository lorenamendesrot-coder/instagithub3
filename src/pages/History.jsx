import { useState, useMemo } from "react";
import { useHistory } from "../App.jsx";
import Modal from "../Modal.jsx";

const STATUS_BADGE = { published: "badge-success", failed: "badge-danger", success: "badge-success" };
const TYPE_ICON = { FEED: "🖼", REEL: "🎬", STORY: "⭕" };
const TYPE_LABEL = { FEED: "Feed", REEL: "Reel", STORY: "Story" };

export default function History() {
  const { history, totalCount, clearHistory, reloadHistory } = useHistory();
  const [confirmClear, setConfirmClear] = useState(false);
  const [filterType, setFilterType]     = useState("ALL");   // ALL | FEED | REEL | STORY
  const [filterStatus, setFilterStatus] = useState("ALL");   // ALL | success | fail
  const [search, setSearch]             = useState("");
  const [expanded, setExpanded]         = useState({});

  const filtered = useMemo(() => {
    return history.filter((e) => {
      if (filterType !== "ALL" && e.post_type !== filterType) return false;
      const ok = (e.results || []).filter((r) => r.success).length;
      const total = (e.results || []).length;
      if (filterStatus === "success" && ok !== total) return false;
      if (filterStatus === "fail" && ok === total) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const inCaption = (e.default_caption || "").toLowerCase().includes(q);
        const inAccounts = (e.results || []).some((r) => r.username?.toLowerCase().includes(q));
        if (!inCaption && !inAccounts) return false;
      }
      return true;
    });
  }, [history, filterType, filterStatus, search]);

  const toggleExpanded = (id) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Histórico</div>
          <div className="page-subtitle">
            {filtered.length} de {totalCount} publicação(ões)
            {totalCount > 500 && <span style={{ color: "var(--warning)", marginLeft: 8 }}>⚠️ Exibindo 500 mais recentes</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={reloadHistory}>↻ Atualizar</button>
          {history.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmClear(true)}>Limpar</button>
          )}
        </div>
      </div>

      {/* Filtros */}
      {history.length > 0 && (
        <div className="card card-sm" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {/* Busca */}
          <input
            placeholder="Buscar legenda ou @conta..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: "1 1 160px", minWidth: 0, padding: "7px 11px", fontSize: 12 }}
          />
          {/* Tipo */}
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {["ALL", "FEED", "REEL", "STORY"].map((t) => (
              <button key={t} onClick={() => setFilterType(t)}
                className={`btn btn-sm ${filterType === t ? "btn-primary" : "btn-ghost"}`}
                style={{ fontSize: 11, padding: "5px 10px" }}>
                {t === "ALL" ? "Todos" : `${TYPE_ICON[t]} ${TYPE_LABEL[t]}`}
              </button>
            ))}
          </div>
          {/* Status */}
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {[["ALL", "Todos"], ["success", "✓ OK"], ["fail", "✗ Falhou"]].map(([v, l]) => (
              <button key={v} onClick={() => setFilterStatus(v)}
                className={`btn btn-sm ${filterStatus === v ? "btn-primary" : "btn-ghost"}`}
                style={{ fontSize: 11, padding: "5px 10px" }}>
                {l}
              </button>
            ))}
          </div>
          {(search || filterType !== "ALL" || filterStatus !== "ALL") && (
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
              onClick={() => { setSearch(""); setFilterType("ALL"); setFilterStatus("ALL"); }}>
              ✕ Limpar filtros
            </button>
          )}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">≡</div>
          <div className="empty-title">{history.length === 0 ? "Nenhuma publicação ainda" : "Nenhum resultado para os filtros"}</div>
          <div style={{ fontSize: 13 }}>{history.length === 0 ? "Posts publicados e agendados aparecerão aqui." : "Tente ajustar os filtros."}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((entry) => {
            const successCount = (entry.results || []).filter((r) => r.success).length;
            const totalCount   = (entry.results || []).length;
            const isExpanded   = expanded[entry.id];

            return (
              <div key={entry.id} className="card card-hover" style={{ cursor: "pointer" }} onClick={() => toggleExpanded(entry.id)}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  {/* Thumb */}
                  <div style={{ width: 54, height: 54, borderRadius: 8, overflow: "hidden", background: "var(--bg3)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)" }}>
                    {entry.media_type === "IMAGE" ? (
                      <img src={entry.media_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => { e.target.style.display = "none"; e.target.parentElement.innerHTML = '<span style="font-size:22px">🖼</span>'; }} />
                    ) : <span style={{ fontSize: 22 }}>🎬</span>}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 5 }}>
                      <span style={{ fontSize: 15 }}>{TYPE_ICON[entry.post_type] || "📌"}</span>
                      <span className={`badge ${successCount === totalCount ? "badge-success" : successCount === 0 ? "badge-danger" : "badge-warning"}`}>
                        {successCount}/{totalCount} publicado(s)
                      </span>
                      {entry.from_scheduler && <span className="badge badge-purple">Agendado</span>}
                      <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>
                        {new Date(entry.created_at).toLocaleString("pt-BR")}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{isExpanded ? "▲" : "▼"}</span>
                    </div>

                    {entry.default_caption && (
                      <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: isExpanded ? 12 : 0, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: isExpanded ? 999 : 2, WebkitBoxOrient: "vertical" }}>
                        {entry.default_caption}
                      </div>
                    )}

                    {/* Resultados por conta — sempre visíveis resumidos */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                      {(entry.results || []).map((r, i) => (
                        <div key={i} title={r.error || ""}
                          style={{
                            display: "flex", alignItems: "center", gap: 4,
                            padding: "3px 9px", borderRadius: 20,
                            background: r.success ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                            border: `1px solid ${r.success ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                            fontSize: 11, fontWeight: 500,
                            color: r.success ? "var(--success)" : "var(--danger)",
                          }}>
                          <span>{r.success ? "✓" : "✗"}</span>
                          <span>@{r.username}</span>
                        </div>
                      ))}
                    </div>

                    {/* Detalhes expandidos */}
                    {isExpanded && (
                      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Detalhes</div>
                        <div style={{ fontSize: 12, color: "var(--text2)", display: "flex", flexDirection: "column", gap: 5 }}>
                          <div>📎 URL: <a href={entry.media_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent3)", textDecoration: "underline", fontSize: 11 }} onClick={(e) => e.stopPropagation()}>{entry.media_url}</a></div>
                          <div>📁 Tipo: {entry.media_type} • {entry.post_type}</div>
                          {entry.delay_seconds > 0 && <div>⏱ Delay: {entry.delay_seconds}s entre contas</div>}
                        </div>
                        {(entry.results || []).some((r) => r.error) && (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: 11, color: "var(--danger)", marginBottom: 5 }}>Erros:</div>
                            {(entry.results || []).filter((r) => r.error).map((r, i) => (
                              <div key={i} style={{ fontSize: 11, color: "var(--danger)", padding: "4px 8px", background: "rgba(239,68,68,0.06)", borderRadius: 6, marginBottom: 4 }}>
                                @{r.username}: {r.error}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={confirmClear}
        title="Limpar histórico?"
        message="Todo o histórico de publicações será removido permanentemente."
        confirmLabel="Limpar tudo"
        confirmDanger
        onConfirm={() => { clearHistory(); setConfirmClear(false); }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
