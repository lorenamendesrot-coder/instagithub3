// Queue.jsx — Fila de agendamentos com filtros de status + data
import { useState, useEffect, useRef, useMemo } from "react";
import { useScheduler } from "../App.jsx";
import Modal from "../Modal.jsx";

const STATUS_INFO = {
  pending: { label: "Agendado", color: "var(--info)",    bg: "rgba(56,189,248,0.08)"  },
  running: { label: "Rodando",  color: "var(--warning)", bg: "rgba(245,158,11,0.08)"  },
  done:    { label: "Feito",    color: "var(--success)", bg: "rgba(34,197,94,0.06)"   },
  error:   { label: "Erro",     color: "var(--danger)",  bg: "rgba(239,68,68,0.06)"   },
};

// ─── Helpers de data ──────────────────────────────────────────────────────────
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function dateLabel(ts) {
  const today     = startOfDay(new Date());
  const tomorrow  = today + 86_400_000;
  const dayAfter  = today + 2 * 86_400_000;
  const dayStart  = startOfDay(new Date(ts));

  if (dayStart === today)    return "Hoje";
  if (dayStart === tomorrow) return "Amanhã";
  if (dayStart === dayAfter) return "Depois de amanhã";

  const d = new Date(ts);
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

// Agrupa timestamps por dia — retorna array de { label, startMs, endMs, count }
function buildDayGroups(items) {
  const map = {};
  for (const item of items) {
    const start = startOfDay(new Date(item.scheduledAt));
    if (!map[start]) map[start] = { startMs: start, endMs: endOfDay(new Date(start)), count: 0 };
    map[start].count++;
  }
  return Object.values(map)
    .sort((a, b) => a.startMs - b.startMs)
    .map((g) => ({ ...g, label: dateLabel(g.startMs) }));
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function Queue() {
  const { queue, updateItem, removeItem, clearQueue, reload: reloadQueue } = useScheduler();
  const [editModal,    setEditModal]    = useState(null);
  const [editTime,     setEditTime]     = useState("");
  const [editCaption,  setEditCaption]  = useState("");
  const [confirmModal, setConfirmModal] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDay,    setFilterDay]    = useState("all");
  const [selected,     setSelected]     = useState(new Set()); // IDs selecionados
  const [selecting,    setSelecting]    = useState(false);     // modo seleção ativo

  // Separar itens normais dos video_finish (tarefas internas do SW)
  const mainQueue   = useMemo(() => queue.filter((q) => !q.type), [queue]);
  const videoFinish = useMemo(() => queue.filter((q) => q.type === "video_finish"), [queue]);

  // Mapa historyId → video_finish items
  const vfByParent = useMemo(() => {
    const map = {};
    for (const vf of videoFinish) {
      const key = vf.historyId || vf.parentId;
      if (!key) continue;
      if (!map[key]) map[key] = [];
      map[key].push(vf);
    }
    return map;
  }, [videoFinish]);

  // Contadores de status
  const pendingCount = mainQueue.filter((q) => q.status === "pending").length;
  const runningCount = mainQueue.filter((q) => q.status === "running").length;
  const doneCount    = mainQueue.filter((q) => q.status === "done").length;
  const errorCount   = mainQueue.filter((q) => q.status === "error").length;

  // Grupos por dia (apenas itens pendentes/rodando — futuros)
  const dayGroups = useMemo(() => {
    const upcoming = mainQueue.filter((q) => q.status === "pending" || q.status === "running");
    return buildDayGroups(upcoming);
  }, [mainQueue]);

  // Filtro combinado: status + dia
  const filtered = useMemo(() => {
    let items = mainQueue;

    // Filtro de status
    if (filterStatus !== "all") {
      items = items.filter((q) => q.status === filterStatus);
    }

    // Filtro de dia
    if (filterDay !== "all") {
      const startMs = Number(filterDay);
      const endMs   = startMs + 86_400_000 - 1;
      items = items.filter((q) => q.scheduledAt >= startMs && q.scheduledAt <= endMs);
    }

    // Ordenar por scheduledAt
    return [...items].sort((a, b) => a.scheduledAt - b.scheduledAt);
  }, [mainQueue, filterStatus, filterDay]);

  // ─── Funções de seleção múltipla ──────────────────────────────────────────
  const toggleSelect = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const selectAll  = () => setSelected(new Set(filtered.map((i) => i.id)));
  const selectNone = () => setSelected(new Set());

  const removeSelected = async () => {
    const ids = [...selected];
    for (const id of ids) await removeItem(id);
    setSelected(new Set());
    setSelecting(false);
    setConfirmModal(null);
  };

  // Auto-reload enquanto há video_finish pendentes
  const hasPendingVF = videoFinish.some((v) => v.status === "pending" || v.status === "running");
  const pollRef = useRef(null);
  useEffect(() => {
    if (hasPendingVF) {
      pollRef.current = setInterval(reloadQueue, 8000);
    } else {
      clearInterval(pollRef.current);
    }
    return () => clearInterval(pollRef.current);
  }, [hasPendingVF, reloadQueue]);

  // Escuta SW updates
  useEffect(() => {
    const h = () => reloadQueue?.();
    window.addEventListener("sw:queue-update", h);
    return () => window.removeEventListener("sw:queue-update", h);
  }, [reloadQueue]);

  // Forçar reload ao montar (garante que novos agendamentos aparecem)
  useEffect(() => { reloadQueue?.(); }, []);

  const openEdit = (item) => {
    setEditModal(item);
    const d      = new Date(item.scheduledAt);
    const offset = d.getTimezoneOffset() * 60000;
    const local  = new Date(d.getTime() - offset);
    setEditTime(local.toISOString().slice(0, 16));
    setEditCaption(item.caption || "");
  };

  const saveEdit = async () => {
    if (!editModal) return;
    await updateItem({ ...editModal, scheduledAt: new Date(editTime).getTime(), caption: editCaption, status: "pending" });
    setEditModal(null);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">🗂 Fila de Agendamentos</div>
          <div className="page-subtitle">
            {pendingCount} pendente(s) · {doneCount} feito(s)
            {errorCount  > 0 && <span style={{ color: "var(--danger)",  marginLeft: 6 }}>· {errorCount} erro(s)</span>}
            {runningCount > 0 && <span style={{ color: "var(--warning)", marginLeft: 6 }}>· {runningCount} rodando</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => reloadQueue?.()}>↻ Atualizar</button>
          {filtered.length > 0 && (
            <button
              className={`btn btn-sm ${selecting ? "btn-primary" : "btn-ghost"}`}
              onClick={() => { setSelecting((p) => !p); setSelected(new Set()); }}
            >
              {selecting ? "✕ Cancelar" : "☑ Selecionar"}
            </button>
          )}
          {queue.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmModal({ type: "clearQueue" })}>
              🗑 Limpar tudo
            </button>
          )}
        </div>
      </div>

      {/* Barra de seleção em massa */}
      {selecting && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "10px 14px", borderRadius: 10, marginBottom: 14,
          background: "rgba(124,92,252,0.08)", border: "1px solid rgba(124,92,252,0.25)",
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent-light)" }}>
            {selected.size} selecionado(s)
          </span>
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={selectAll}>
            ✓ Todos ({filtered.length})
          </button>
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={selectNone}>
            ✕ Nenhum
          </button>
          {selected.size > 0 && (
            <button
              className="btn btn-danger btn-sm"
              style={{ fontSize: 12, marginLeft: "auto" }}
              onClick={() => setConfirmModal({ type: "removeSelected" })}
            >
              🗑 Remover {selected.size} selecionado(s)
            </button>
          )}
        </div>
      )}

      {/* Stats */}
      {mainQueue.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
          {[
            { label: "Total",      value: mainQueue.length, color: "var(--text)"    },
            { label: "Pendentes",  value: pendingCount,     color: "var(--info)"    },
            { label: "Publicados", value: doneCount,        color: "var(--success)" },
            { label: "Erros",      value: errorCount,       color: "var(--danger)"  },
          ].map(({ label, value, color }) => (
            <div key={label} className="card card-sm" style={{ textAlign: "center", cursor: "pointer" }}
              onClick={() => setFilterStatus(label === "Total" ? "all" : label === "Pendentes" ? "pending" : label === "Publicados" ? "done" : "error")}>
              <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Filtros ─────────────────────────────────────────────────────────── */}
      {mainQueue.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>

          {/* Filtro de status */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { id: "all",     label: "Todos",     count: mainQueue.length },
              { id: "pending", label: "Pendentes", count: pendingCount     },
              { id: "running", label: "Rodando",   count: runningCount     },
              { id: "done",    label: "Feitos",    count: doneCount        },
              { id: "error",   label: "Erros",     count: errorCount       },
            ].filter(({ id, count }) => count > 0 || id === "all").map(({ id, label, count }) => (
              <button
                key={id}
                onClick={() => setFilterStatus(id)}
                className={`btn btn-sm ${filterStatus === id ? "btn-primary" : "btn-ghost"}`}
                style={{ fontSize: 12 }}
              >
                {label} {count > 0 && <span style={{ marginLeft: 4, opacity: 0.8 }}>({count})</span>}
              </button>
            ))}
          </div>

          {/* Filtro de data — só aparece se há grupos de dias */}
          {dayGroups.length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>📅</span>
              <button
                onClick={() => setFilterDay("all")}
                className={`btn btn-sm ${filterDay === "all" ? "btn-primary" : "btn-ghost"}`}
                style={{ fontSize: 12 }}
              >
                Todos os dias
              </button>
              {dayGroups.map((g) => (
                <button
                  key={g.startMs}
                  onClick={() => setFilterDay(String(g.startMs))}
                  className={`btn btn-sm ${filterDay === String(g.startMs) ? "btn-primary" : "btn-ghost"}`}
                  style={{ fontSize: 12 }}
                >
                  {g.label}
                  <span style={{ marginLeft: 5, opacity: 0.75, fontSize: 11 }}>({g.count})</span>
                </button>
              ))}
            </div>
          )}

          {/* Indicador de filtro ativo */}
          {(filterStatus !== "all" || filterDay !== "all") && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--muted)" }}>
              <span>Exibindo {filtered.length} de {mainQueue.length} item(ns)</span>
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => { setFilterStatus("all"); setFilterDay("all"); }}
                style={{ fontSize: 11 }}
              >
                ✕ Limpar filtros
              </button>
            </div>
          )}
        </div>
      )}

      {/* Lista agrupada por dia quando filtrando todos */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px 20px", color: "var(--muted)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>◷</div>
          <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 15, marginBottom: 6 }}>
            {queue.length === 0 ? "Fila vazia" : "Nenhum item neste filtro"}
          </div>
          <div style={{ fontSize: 12 }}>
            {queue.length === 0
              ? "Vá em Aquecimento para programar publicações."
              : "Tente outro filtro acima."}
          </div>
        </div>
      ) : (
        <QueueList
          items={filtered}
          filterDay={filterDay}
          vfByParent={vfByParent}
          onEdit={openEdit}
          onRemove={(id) => setConfirmModal({ type: "removeItem", id })}
          selecting={selecting}
          selected={selected}
          onToggleSelect={toggleSelect}
        />
      )}

      {/* Modal edição */}
      {editModal && (
        <div onClick={() => setEditModal(null)} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 16, padding: 28, width: "100%", maxWidth: 440, boxShadow: "0 24px 80px rgba(0,0,0,0.5)" }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 18 }}>✎ Editar agendamento</div>
            <div className="form-row">
              <label>Novo horário</label>
              <input type="datetime-local" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
            </div>
            <div className="form-row">
              <label>Legenda</label>
              <textarea value={editCaption} onChange={(e) => setEditCaption(e.target.value)} style={{ minHeight: 80, fontSize: 13 }} />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditModal(null)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" onClick={saveEdit}>Salvar</button>
            </div>
          </div>
        </div>
      )}

      <Modal open={confirmModal?.type === "clearQueue"} title="Limpar fila?" message="Todos os agendamentos serão removidos permanentemente." confirmLabel="Limpar tudo" confirmDanger
        onConfirm={() => { clearQueue(); setConfirmModal(null); }} onCancel={() => setConfirmModal(null)} />
      <Modal open={confirmModal?.type === "removeItem"} title="Remover agendamento?" message="Este item será removido da fila." confirmLabel="Remover" confirmDanger
        onConfirm={() => { removeItem(confirmModal.id); setConfirmModal(null); }} onCancel={() => setConfirmModal(null)} />
      <Modal open={confirmModal?.type === "removeSelected"} title={`Remover ${selected.size} item(s)?`} message={`${selected.size} agendamento(s) selecionado(s) serão removidos permanentemente.`} confirmLabel={`Remover ${selected.size}`} confirmDanger
        onConfirm={removeSelected} onCancel={() => setConfirmModal(null)} />
    </div>
  );
}

// ─── QueueList — lista com separadores de dia ────────────────────────────────
function QueueList({ items, filterDay, vfByParent, onEdit, onRemove, selecting, selected, onToggleSelect }) {
  // Quando "Todos os dias" está ativo, agrupa por dia com separador
  const groups = useMemo(() => {
    if (filterDay !== "all") return [{ label: null, items }];
    const map = {};
    for (const item of items) {
      const key = String(startOfDay(new Date(item.scheduledAt)));
      if (!map[key]) map[key] = { label: dateLabel(item.scheduledAt), items: [] };
      map[key].items.push(item);
    }
    return Object.entries(map)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, g]) => g);
  }, [items, filterDay]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {groups.map((group, gi) => (
        <div key={gi}>
          {/* Separador de dia */}
          {group.label && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              margin: gi > 0 ? "14px 0 8px" : "0 0 8px",
            }}>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span style={{
                fontSize: 11, fontWeight: 700, color: "var(--muted)",
                padding: "2px 10px", borderRadius: 10,
                background: "var(--bg2)", border: "1px solid var(--border)",
                whiteSpace: "nowrap",
              }}>
                📅 {group.label} — {group.items.length} post(s)
              </span>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>
          )}

          {/* Itens do grupo */}
          {group.items.map((item) => (
            <QueueItem
              key={item.id}
              item={item}
              vfItems={vfByParent[item.id]}
              onEdit={onEdit}
              onRemove={onRemove}
              selecting={selecting}
              isSelected={selected?.has(item.id)}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── QueueItem — card individual ─────────────────────────────────────────────
function QueueItem({ item, vfItems, onEdit, onRemove, selecting, isSelected, onToggleSelect }) {
  const info          = STATUS_INFO[item.status] || STATUS_INFO.pending;
  const scheduledDate = new Date(item.scheduledAt);
  const isPast        = item.scheduledAt < Date.now();
  const thumbUrl      = item.mediaType === "IMAGE" ? item.mediaUrl : null;
  const mediaCount    = item.mediaUrls?.length || 1;
  const qty           = item.quantityPerCycle || 1;

  return (
    <div
      style={{
        background: isSelected ? "rgba(124,92,252,0.1)" : info.bg,
        border: `1px solid ${isSelected ? "var(--accent)" : info.color + "28"}`,
        borderLeft: `3px solid ${isSelected ? "var(--accent)" : info.color}`,
        borderRadius: 10, padding: "10px 12px",
        cursor: selecting ? "pointer" : "default",
        transition: "all 0.12s",
      }}
      onClick={selecting ? () => onToggleSelect(item.id) : undefined}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Checkbox no modo seleção */}
        {selecting && (
          <div style={{
            width: 20, height: 20, borderRadius: 5, flexShrink: 0,
            border: `2px solid ${isSelected ? "var(--accent)" : "var(--border2)"}`,
            background: isSelected ? "var(--accent)" : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.12s",
          }}>
            {isSelected && <span style={{ color: "#fff", fontSize: 12, fontWeight: 900 }}>✓</span>}
          </div>
        )}
        {/* Thumbnail */}
        {thumbUrl ? (
          <img src={thumbUrl} alt="" style={{ width: 40, height: 40, borderRadius: 7, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }}
            onError={(e) => { e.target.style.display = "none"; }} />
        ) : (
          <div style={{ width: 40, height: 40, borderRadius: 7, background: "var(--bg3)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, position: "relative" }}>
            🎬
            {mediaCount > 1 && (
              <span style={{ position: "absolute", top: -4, right: -4, background: "var(--accent)", color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: 8, padding: "1px 4px" }}>
                ×{mediaCount}
              </span>
            )}
          </div>
        )}

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: info.color }}>
              {item.status === "running" ? "⟳ " : ""}{info.label.toUpperCase()}
            </span>
            <span style={{ fontSize: 10, color: "var(--muted)", background: "var(--bg3)", padding: "1px 6px", borderRadius: 4 }}>
              {item.postType}
            </span>
            <span style={{ fontSize: 10, color: "var(--muted)" }}>
              {item.mediaType === "IMAGE" ? "🖼" : "🎬"}
            </span>
            {qty > 1 && (
              <span style={{ fontSize: 9, fontWeight: 700, color: "var(--accent-light)", background: "#7c5cfc20", border: "1px solid var(--accent)", padding: "0 5px", borderRadius: 8 }}>
                ×{qty}/ciclo
              </span>
            )}
            {item.loop      && <span style={{ fontSize: 10, color: "var(--accent-light)" }}>🔁</span>}
            {item.runCount > 0 && <span style={{ fontSize: 9, color: "var(--muted)" }}>run×{item.runCount}</span>}
            <span style={{
              fontSize: 10, marginLeft: "auto",
              color: isPast && item.status === "pending" ? "var(--warning)" : "var(--muted)",
              fontWeight: isPast && item.status === "pending" ? 700 : 400,
            }}>
              🕐 {scheduledDate.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              {isPast && item.status === "pending" && " ⚠"}
            </span>
          </div>

          {/* Avatars */}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ display: "flex" }}>
              {(item.accounts || []).slice(0, 6).map((a, i) => (
                <div key={a.id} title={`@${a.username}`} style={{ marginLeft: i > 0 ? -6 : 0, zIndex: 6 - i, position: "relative" }}>
                  {a.profile_picture
                    ? <img src={a.profile_picture} alt="" style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover", border: "1.5px solid var(--bg2)" }} />
                    : <div style={{ width: 18, height: 18, borderRadius: "50%", background: "linear-gradient(135deg, var(--accent), #9b4dfc)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "#fff", fontWeight: 700, border: "1.5px solid var(--bg2)" }}>
                        {(a.username || "?")[0].toUpperCase()}
                      </div>}
                </div>
              ))}
              {(item.accounts || []).length > 6 && (
                <span style={{ fontSize: 9, color: "var(--muted)", marginLeft: 4, alignSelf: "center" }}>
                  +{item.accounts.length - 6}
                </span>
              )}
            </div>
            <span style={{ fontSize: 10, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {mediaCount > 1 ? `${mediaCount} mídias` : item.mediaUrl?.split("/").pop()?.slice(0, 40)}
            </span>
          </div>

          {item.error && (
            <div style={{ fontSize: 10, color: "var(--danger)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              ✗ {item.error}
            </div>
          )}

          {/* video_finish badges */}
          {vfItems?.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
              {vfItems.map((vf, i) => {
                const vfColor = vf.status === "done" ? "var(--success)" : vf.status === "error" ? "var(--danger)" : vf.status === "running" ? "var(--warning)" : "var(--info)";
                const vfBg    = vf.status === "done" ? "rgba(34,197,94,0.08)" : vf.status === "error" ? "rgba(239,68,68,0.08)" : vf.status === "running" ? "rgba(245,158,11,0.08)" : "rgba(56,189,248,0.08)";
                const vfIcon  = vf.status === "done" ? "✅" : vf.status === "error" ? "❌" : vf.status === "running" ? "⟳" : "⏳";
                return (
                  <div key={i} title={vf.error || ""} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: vfBg, color: vfColor, border: `1px solid ${vfColor}40`, display: "flex", alignItems: "center", gap: 4 }}>
                    <span>{vfIcon}</span>
                    <span>@{vf.username}</span>
                    {vf.attempts > 0 && <span style={{ opacity: 0.65 }}>×{vf.attempts + 1}</span>}
                    {vf.error && <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{" — "}{vf.error}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Ações */}
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {(item.status === "pending" || item.status === "error") && (
            <button className="btn btn-ghost btn-xs" onClick={() => onEdit(item)} title="Editar" style={{ padding: "4px 8px", fontSize: 12 }}>✎</button>
          )}
          <button className="btn btn-ghost btn-xs" style={{ color: "var(--danger)", padding: "4px 8px", fontSize: 12 }}
            onClick={() => onRemove(item.id)} title="Remover">✕</button>
        </div>
      </div>
    </div>
  );
}
