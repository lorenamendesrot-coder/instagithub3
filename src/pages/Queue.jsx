// Queue.jsx — Fila de agendamentos (aba dedicada)
import { useState, useEffect, useRef } from "react";
import { useScheduler } from "../App.jsx";
import Modal from "../Modal.jsx";

const STATUS_INFO = {
  pending: { label: "Agendado", color: "var(--info)",    bg: "rgba(56,189,248,0.08)"  },
  running: { label: "Rodando",  color: "var(--warning)", bg: "rgba(245,158,11,0.08)"  },
  done:    { label: "Feito",    color: "var(--success)", bg: "rgba(34,197,94,0.06)"   },
  error:   { label: "Erro",     color: "var(--danger)",  bg: "rgba(239,68,68,0.06)"   },
};

export default function Queue() {
  const { queue, updateItem, removeItem, clearQueue, reload: reloadQueue } = useScheduler();
  const [editModal,    setEditModal]    = useState(null);
  const [editTime,     setEditTime]     = useState("");
  const [editCaption,  setEditCaption]  = useState("");
  const [confirmModal, setConfirmModal] = useState(null);
  const [filter,       setFilter]       = useState("all");

  // Separa itens normais dos video_finish (tarefas internas do SW)
  const mainQueue    = queue.filter((q) => !q.type);
  const videoFinish  = queue.filter((q) => q.type === "video_finish");

  // Monta mapa: historyId → { attempts, status, error, username }[]
  const vfByParent = {};
  for (const vf of videoFinish) {
    const key = vf.historyId || vf.parentId;
    if (!key) continue;
    if (!vfByParent[key]) vfByParent[key] = [];
    vfByParent[key].push(vf);
  }

  const pendingCount = mainQueue.filter((q) => q.status === "pending").length;
  const runningCount = mainQueue.filter((q) => q.status === "running").length;
  const doneCount    = mainQueue.filter((q) => q.status === "done").length;
  const errorCount   = mainQueue.filter((q) => q.status === "error").length;

  const filtered = (filter === "all" ? mainQueue : mainQueue.filter((q) => q.status === filter));

  // Auto-reload quando há video_finish pendentes
  const hasPendingVF = videoFinish.some((v) => v.status === "pending" || v.status === "running");
  const { reloadQueue } = useScheduler();
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

  const openEdit = (item) => {
    setEditModal(item);
    const d = new Date(item.scheduledAt);
    const offset = d.getTimezoneOffset() * 60000;
    const local = new Date(d.getTime() - offset);
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
            {errorCount > 0 && <span style={{ color: "var(--danger)", marginLeft: 6 }}>· {errorCount} erro(s)</span>}
            {runningCount > 0 && <span style={{ color: "var(--warning)", marginLeft: 6 }}>· {runningCount} rodando</span>}
          </div>
        </div>
        {queue.length > 0 && (
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmModal({ type: "clearQueue" })}>
            🗑 Limpar tudo
          </button>
        )}
      </div>

      {/* Stats */}
      {queue.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Total",      value: queue.length,  color: "var(--text)"    },
            { label: "Pendentes",  value: pendingCount,  color: "var(--info)"    },
            { label: "Publicados", value: doneCount,     color: "var(--success)" },
            { label: "Erros",      value: errorCount,    color: "var(--danger)"  },
          ].map(({ label, value, color }) => (
            <div key={label} className="card card-sm" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filtros */}
      {queue.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
          {[
            { id: "all",     label: "Todos",     count: queue.length  },
            { id: "pending", label: "Pendentes", count: pendingCount  },
            { id: "running", label: "Rodando",   count: runningCount  },
            { id: "done",    label: "Feitos",    count: doneCount     },
            { id: "error",   label: "Erros",     count: errorCount    },
          ].filter(({ id, count }) => count > 0 || id === "all").map(({ id, label, count }) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`btn btn-sm ${filter === id ? "btn-primary" : "btn-ghost"}`}
              style={{ fontSize: 12 }}
            >
              {label} {count > 0 && <span style={{ marginLeft: 4, opacity: 0.8 }}>({count})</span>}
            </button>
          ))}
        </div>
      )}

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px 20px", color: "var(--muted)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>◷</div>
          <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 15, marginBottom: 6 }}>
            {queue.length === 0 ? "Fila vazia" : "Nenhum item neste filtro"}
          </div>
          <div style={{ fontSize: 12 }}>
            {queue.length === 0
              ? "Vá em Agendar para programar publicações."
              : "Tente outro filtro acima."}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map((item) => {
            const info         = STATUS_INFO[item.status] || STATUS_INFO.pending;
            const scheduledDate = new Date(item.scheduledAt);
            const isPast       = item.scheduledAt < Date.now();
            const thumbUrl     = item.mediaType === "IMAGE" ? item.mediaUrl : null;
            const qty          = item.quantityPerCycle || 1;
            const mediaCount   = item.mediaUrls?.length || 1;

            return (
              <div key={item.id} style={{
                background: info.bg,
                border: `1px solid ${info.color}28`,
                borderLeft: `3px solid ${info.color}`,
                borderRadius: 10, padding: "10px 12px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
                      {item.loop && <span style={{ fontSize: 10, color: "var(--accent-light)" }}>🔁</span>}
                      {item.runCount > 0 && <span style={{ fontSize: 9, color: "var(--muted)" }}>run×{item.runCount}</span>}
                      <span style={{ fontSize: 10, color: isPast && item.status === "pending" ? "var(--warning)" : "var(--muted)", marginLeft: "auto" }}>
                        🕐 {scheduledDate.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        {isPast && item.status === "pending" && " ⚠"}
                      </span>
                    </div>

                    {/* Avatars das contas */}
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

                    {/* Badge de video_finish — mostra tentativas e status por conta */}
                    {vfByParent[item.id] && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                        {vfByParent[item.id].map((vf, i) => {
                          const vfColor = vf.status === "done"    ? "var(--success)"
                            : vf.status === "error"   ? "var(--danger)"
                            : vf.status === "running" ? "var(--warning)"
                            : "var(--info)";
                          const vfBg = vf.status === "done"    ? "rgba(34,197,94,0.08)"
                            : vf.status === "error"   ? "rgba(239,68,68,0.08)"
                            : vf.status === "running" ? "rgba(245,158,11,0.08)"
                            : "rgba(56,189,248,0.08)";
                          const vfIcon = vf.status === "done"    ? "✅"
                            : vf.status === "error"   ? "❌"
                            : vf.status === "running" ? "⟳"
                            : "⏳";
                          return (
                            <div key={i} title={vf.error || ""} style={{
                              fontSize: 10, padding: "2px 7px", borderRadius: 20,
                              background: vfBg, color: vfColor,
                              border: `1px solid ${vfColor}40`,
                              display: "flex", alignItems: "center", gap: 4,
                            }}>
                              <span>{vfIcon}</span>
                              <span>@{vf.username}</span>
                              {vf.attempts > 0 && (
                                <span style={{ opacity: 0.65 }}>×{vf.attempts + 1}</span>
                              )}
                              {vf.error && (
                                <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {" — "}{vf.error}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Ações */}
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {(item.status === "pending" || item.status === "error") && (
                      <button className="btn btn-ghost btn-xs" onClick={() => openEdit(item)} title="Editar" style={{ padding: "4px 8px", fontSize: 12 }}>✎</button>
                    )}
                    <button className="btn btn-ghost btn-xs" style={{ color: "var(--danger)", padding: "4px 8px", fontSize: 12 }}
                      onClick={() => setConfirmModal({ type: "removeItem", id: item.id })} title="Remover">✕</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
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
    </div>
  );
}
