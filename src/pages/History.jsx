import { useState, useMemo, useEffect, useRef } from "react";
import { useHistory } from "../App.jsx";
import Modal from "../Modal.jsx";

const SOURCE_BADGE = {
  new_post: { label: "✨ Novo Post",    bg: "rgba(124,92,252,0.1)",  border: "rgba(124,92,252,0.25)", color: "var(--accent-light)" },
  schedule:  { label: "🗓 Agendado",    bg: "rgba(56,189,248,0.1)",  border: "rgba(56,189,248,0.25)", color: "var(--info)"         },
  warmup:    { label: "🔥 Aquecimento", bg: "rgba(245,158,11,0.1)",  border: "rgba(245,158,11,0.25)", color: "var(--warning)"      },
};
const TYPE_ICON  = { FEED: "🖼", REEL: "🎬", STORY: "⭕" };
const TYPE_LABEL = { FEED: "Feed", REEL: "Reel", STORY: "Story" };

const SORT_OPTIONS = [
  { value: "date_desc",    label: "📅 Mais recente primeiro" },
  { value: "date_asc",     label: "📅 Mais antigo primeiro"  },
  { value: "type",         label: "🏷 Por tipo de post"      },
  { value: "success_desc", label: "✅ Mais publicados"       },
  { value: "fail_first",   label: "❌ Com erros primeiro"    },
];

const GROUP_OPTIONS = [
  { value: "none",  label: "Sem agrupamento" },
  { value: "day",   label: "Por dia"         },
  { value: "type",  label: "Por tipo"        },
  { value: "source",label: "Por origem"      },
];

function dayKey(dateStr) {
  return new Date(dateStr).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

function groupEntries(entries, groupBy) {
  if (groupBy === "none") return [{ key: null, label: null, items: entries }];

  const map = new Map();
  for (const e of entries) {
    let key;
    if (groupBy === "day")    key = new Date(e.created_at || 0).toDateString();
    if (groupBy === "type")   key = e.post_type || "OUTRO";
    if (groupBy === "source") key = e.source || (e.from_scheduler ? "schedule" : "new_post");
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }

  return Array.from(map.entries()).map(([key, items]) => {
    let label = key;
    if (groupBy === "day")    label = dayKey(items[0].created_at);
    if (groupBy === "type")   label = `${TYPE_ICON[key] || "📌"} ${TYPE_LABEL[key] || key}`;
    if (groupBy === "source") label = SOURCE_BADGE[key]?.label || key;
    return { key, label, items };
  });
}

function toTs(e) {
  // created_at é string ISO; id pode ser número ou string — usa o mais confiável
  if (e.created_at) return new Date(e.created_at).getTime();
  return typeof e.id === "number" ? e.id : parseInt(e.id, 10) || 0;
}

function sortEntries(entries, sortBy) {
  const copy = [...entries];
  if (sortBy === "date_desc")    return copy.sort((a, b) => toTs(b) - toTs(a));
  if (sortBy === "date_asc")     return copy.sort((a, b) => toTs(a) - toTs(b));
  if (sortBy === "type")         return copy.sort((a, b) => (a.post_type || "").localeCompare(b.post_type || ""));
  if (sortBy === "success_desc") return copy.sort((a, b) => {
    const sa = (b.results || []).filter(r => r.success).length;
    const sb = (a.results || []).filter(r => r.success).length;
    return sa - sb;
  });
  if (sortBy === "fail_first") return copy.sort((a, b) => {
    const fa = (a.results || []).some(r => !r.success) ? 0 : 1;
    const fb = (b.results || []).some(r => !r.success) ? 0 : 1;
    return fa - fb;
  });
  return copy;
}

// ─── HistoryCard ──────────────────────────────────────────────────────────────
function HistoryCard({ entry, isExpanded, onToggle }) {
  const successCount  = (entry.results || []).filter((r) => r.success).length;
  const finishedCount = (entry.results || []).length;
  const pendingCount  = (entry.pending_accounts || []).length;
  const totalAcc      = finishedCount + pendingCount;

  const src = SOURCE_BADGE[entry.source]
    || (entry.from_scheduler ? SOURCE_BADGE.schedule : SOURCE_BADGE.new_post);

  const allOk  = successCount === finishedCount && pendingCount === 0;
  const allBad = successCount === 0 && pendingCount === 0 && finishedCount > 0;

  return (
    <div className="card card-hover" style={{ cursor: "pointer" }} onClick={onToggle}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>

        {/* Thumb */}
        <div style={{ width: 52, height: 52, borderRadius: 8, overflow: "hidden", background: "var(--bg3)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)" }}>
          {entry.media_type === "IMAGE" ? (
            <img src={entry.media_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => { e.target.style.display = "none"; e.target.parentElement.innerHTML = '<span style="font-size:20px">🖼</span>'; }} />
          ) : <span style={{ fontSize: 20 }}>{TYPE_ICON[entry.post_type] || "📌"}</span>}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Row 1: badges + data */}
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 5 }}>
            <span className={`badge ${allOk ? "badge-success" : allBad ? "badge-danger" : "badge-warning"}`}>
              {pendingCount > 0 && <span style={{ marginRight: 4 }}>⏳</span>}
              {successCount}/{totalAcc} publicado(s)
            </span>

            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 600, background: src.bg, border: `1px solid ${src.border}`, color: src.color }}>
              {src.label}
            </span>

            <span className="badge badge-gray" style={{ fontSize: 10 }}>
              {TYPE_ICON[entry.post_type]} {TYPE_LABEL[entry.post_type] || entry.post_type}
            </span>

            <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>
              {new Date(entry.created_at).toLocaleString("pt-BR")}
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{isExpanded ? "▲" : "▼"}</span>
          </div>

          {/* Legenda */}
          {entry.default_caption && (
            <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 8, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: isExpanded ? 999 : 2, WebkitBoxOrient: "vertical" }}>
              {entry.default_caption}
            </div>
          )}

          {/* Pills de contas */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {(entry.pending_accounts || []).map((a, i) => (
              <span key={`p-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 500, background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.2)", color: "var(--info)" }}>
                ⏳ @{a.username}
              </span>
            ))}
            {(entry.results || []).map((r, i) => (
              <span key={i} title={r.error || ""} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 500, background: r.success ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${r.success ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`, color: r.success ? "var(--success)" : "var(--danger)" }}>
                {r.success ? "✓" : "✗"} @{r.username}
              </span>
            ))}
          </div>

          {/* Detalhes expandidos */}
          {isExpanded && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Detalhes</div>
              <div style={{ fontSize: 12, color: "var(--text2)", display: "flex", flexDirection: "column", gap: 5 }}>
                <div>📎 URL: <a href={entry.media_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent3)", textDecoration: "underline", fontSize: 11 }} onClick={(e) => e.stopPropagation()}>{entry.media_url}</a></div>
                <div>📁 Tipo: {entry.media_type} · {entry.post_type}</div>
                {entry.delay_seconds > 0 && <div>⏱ Delay: {entry.delay_seconds}s entre contas</div>}
              </div>
              {(entry.results || []).some((r) => r.error) && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--danger)", marginBottom: 5, fontWeight: 600 }}>Erros:</div>
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
}

// ─── History principal ────────────────────────────────────────────────────────
export default function History() {
  const { history, totalCount, clearHistory, reloadHistory } = useHistory();
  const [confirmClear, setConfirmClear] = useState(false);
  const [filterType,   setFilterType]   = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [search,       setSearch]       = useState("");
  const [sortBy,       setSortBy]       = useState("date_desc");
  const [groupBy,      setGroupBy]      = useState("day");
  const [expanded,     setExpanded]     = useState({});
  const [expandedGroups, setExpandedGroups] = useState({});
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showGroupMenu, setShowGroupMenu] = useState(false);

  // ── Auto-reload ──────────────────────────────────────────────────────────
  useEffect(() => {
    const h = () => reloadHistory();
    window.addEventListener("sw:queue-update", h);
    return () => window.removeEventListener("sw:queue-update", h);
  }, [reloadHistory]);

  const hasPending = history.some((e) => (e.pending_accounts || []).length > 0);
  const pollRef    = useRef(null);
  useEffect(() => {
    if (hasPending) { pollRef.current = setInterval(reloadHistory, 15000); }
    else            { clearInterval(pollRef.current); }
    return () => clearInterval(pollRef.current);
  }, [hasPending, reloadHistory]);

  // ── Filtro → sort → group ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return history.filter((e) => {
      if (filterType !== "ALL" && e.post_type !== filterType) return false;
      const ok    = (e.results || []).filter((r) => r.success).length;
      const total = (e.results || []).length;
      if (filterStatus === "success" && ok !== total) return false;
      if (filterStatus === "fail"    && ok === total) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const inCaption  = (e.default_caption || "").toLowerCase().includes(q);
        const inResults  = (e.results || []).some((r) => r.username?.toLowerCase().includes(q));
        const inAccounts = (e.accounts || []).some((a) => a.username?.toLowerCase().includes(q));
        const inPending  = (e.pending_accounts || []).some((a) => a.username?.toLowerCase().includes(q));
        const inUrl      = (e.media_url || "").toLowerCase().includes(q);
        if (!inCaption && !inResults && !inAccounts && !inPending && !inUrl) return false;
      }
      return true;
    });
  }, [history, filterType, filterStatus, search]);

  const sorted = useMemo(() => sortEntries(filtered, sortBy), [filtered, sortBy]);
  const groups = useMemo(() => groupEntries(sorted, groupBy),  [sorted, groupBy]);

  const toggleExpanded      = (id)  => setExpanded((p) => ({ ...p, [id]: !p[id] }));
  const toggleGroup         = (key) => setExpandedGroups((p) => ({ ...p, [key]: !p[key] }));
  const isGroupCollapsed    = (key) => expandedGroups[key] === true;

  const sortLabel  = SORT_OPTIONS.find(o => o.value === sortBy)?.label  || "Ordenar";
  const groupLabel = GROUP_OPTIONS.find(o => o.value === groupBy)?.label || "Agrupar";

  // Stats rápidas
  const totalSuccess = filtered.reduce((s, e) => s + (e.results || []).filter(r => r.success).length, 0);
  const totalFail    = filtered.reduce((s, e) => s + (e.results || []).filter(r => !r.success).length, 0);

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
          <button className="btn btn-ghost btn-sm" onClick={reloadHistory}>↻</button>
          {history.length > 0 && <button className="btn btn-danger btn-sm" onClick={() => setConfirmClear(true)}>Limpar</button>}
        </div>
      </div>

      {/* Stats rápidas */}
      {filtered.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          {[
            { icon: "📊", label: "Total",     value: filtered.length,   color: "var(--text)" },
            { icon: "✅", label: "Publicados", value: totalSuccess,      color: "var(--success)" },
            { icon: "❌", label: "Com erro",   value: totalFail,         color: totalFail > 0 ? "var(--danger)" : "var(--muted)" },
          ].map(({ icon, label, value, color }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8 }}>
              <span>{icon}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color }}>{value}</span>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Filtros + ordenação + agrupamento */}
      {history.length > 0 && (
        <div className="card card-sm" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>

            {/* Busca */}
            <input placeholder="Buscar legenda ou @conta..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ flex: "1 1 160px", minWidth: 0, padding: "7px 11px", fontSize: 12 }} />

            {/* Tipo */}
            <div style={{ display: "flex", gap: 4 }}>
              {["ALL", "FEED", "REEL", "STORY"].map((t) => (
                <button key={t} onClick={() => setFilterType(t)}
                  className={`btn btn-sm ${filterType === t ? "btn-primary" : "btn-ghost"}`}
                  style={{ fontSize: 11, padding: "5px 10px" }}>
                  {t === "ALL" ? "Todos" : `${TYPE_ICON[t]} ${TYPE_LABEL[t]}`}
                </button>
              ))}
            </div>

            {/* Status */}
            <div style={{ display: "flex", gap: 4 }}>
              {[["ALL", "Todos"], ["success", "✓ OK"], ["fail", "✗ Falhou"]].map(([v, l]) => (
                <button key={v} onClick={() => setFilterStatus(v)}
                  className={`btn btn-sm ${filterStatus === v ? "btn-primary" : "btn-ghost"}`}
                  style={{ fontSize: 11, padding: "5px 10px" }}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Row 2: Ordenação + Agrupamento */}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>

            {/* Dropdown Ordenar */}
            <div style={{ position: "relative" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowSortMenu(p => !p); setShowGroupMenu(false); }}
                style={{ fontSize: 12, gap: 5 }}>
                ↕ {sortLabel} ▾
              </button>
              {showSortMenu && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 100, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10, padding: 6, minWidth: 210, boxShadow: "0 6px 24px rgba(0,0,0,0.4)" }}>
                  {SORT_OPTIONS.map((o) => (
                    <button key={o.value} onClick={() => { setSortBy(o.value); setShowSortMenu(false); }} style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "8px 12px", borderRadius: 7, fontSize: 12, border: "none",
                      background: sortBy === o.value ? "rgba(124,92,252,0.12)" : "transparent",
                      color: sortBy === o.value ? "var(--accent-light)" : "var(--text)",
                      fontWeight: sortBy === o.value ? 600 : 400,
                      cursor: "pointer",
                    }}>
                      {sortBy === o.value && <span style={{ marginRight: 6 }}>✓</span>}{o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Dropdown Agrupar */}
            <div style={{ position: "relative" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowGroupMenu(p => !p); setShowSortMenu(false); }}
                style={{ fontSize: 12, gap: 5 }}>
                ⊞ {groupLabel} ▾
              </button>
              {showGroupMenu && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 100, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10, padding: 6, minWidth: 180, boxShadow: "0 6px 24px rgba(0,0,0,0.4)" }}>
                  {GROUP_OPTIONS.map((o) => (
                    <button key={o.value} onClick={() => { setGroupBy(o.value); setShowGroupMenu(false); }} style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "8px 12px", borderRadius: 7, fontSize: 12, border: "none",
                      background: groupBy === o.value ? "rgba(124,92,252,0.12)" : "transparent",
                      color: groupBy === o.value ? "var(--accent-light)" : "var(--text)",
                      fontWeight: groupBy === o.value ? 600 : 400,
                      cursor: "pointer",
                    }}>
                      {groupBy === o.value && <span style={{ marginRight: 6 }}>✓</span>}{o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Limpar filtros */}
            {(search || filterType !== "ALL" || filterStatus !== "ALL") && (
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                onClick={() => { setSearch(""); setFilterType("ALL"); setFilterStatus("ALL"); }}>
                ✕ Limpar filtros
              </button>
            )}

            <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>
              {filtered.length} resultado(s)
            </span>
          </div>
        </div>
      )}

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">≡</div>
          <div className="empty-title">{history.length === 0 ? "Nenhuma publicação ainda" : "Nenhum resultado"}</div>
          <div style={{ fontSize: 13 }}>{history.length === 0 ? "Posts publicados aparecerão aqui." : "Tente ajustar os filtros."}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: groupBy === "none" ? 10 : 20 }}>
          {groups.map(({ key, label, items }) => (
            <div key={key || "all"}>
              {/* Cabeçalho do grupo */}
              {label && (
                <div
                  onClick={() => toggleGroup(key)}
                  style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, cursor: "pointer", userSelect: "none" }}
                >
                  <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 14px", borderRadius: 20, background: "var(--bg2)", border: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>
                    <span>{label}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>({items.length})</span>
                    <span style={{ fontSize: 10, color: "var(--muted)" }}>{isGroupCollapsed(key) ? "▶" : "▼"}</span>
                  </div>
                  <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                </div>
              )}

              {/* Cards do grupo */}
              {!isGroupCollapsed(key) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {items.map((entry) => (
                    <HistoryCard
                      key={entry.id}
                      entry={entry}
                      isExpanded={!!expanded[entry.id]}
                      onToggle={() => toggleExpanded(entry.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
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
