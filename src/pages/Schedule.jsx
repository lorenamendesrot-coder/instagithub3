import { useState, useEffect, useCallback, useRef } from "react";
import { useAccounts, useHistory } from "../App.jsx";
import MediaPreview from "../MediaPreview.jsx";
import Modal from "../Modal.jsx";
import CatboxUploader from "../CatboxUploader.jsx";
import { dbGetAll, dbPut, dbPutMany, dbDelete, dbClear } from "../useDB.js";
import BulkCaptions, { pickCaption } from "../components/BulkCaptions.jsx";

const POST_TYPES = [
  { value: "FEED",  label: "Feed",  desc: "Foto ou vídeo", icon: "🖼" },
  { value: "REEL",  label: "Reel",  desc: "Vídeo curto",   icon: "🎬" },
  { value: "STORY", label: "Story", desc: "24 horas",      icon: "⭕" },
];

function nowPlus(minutes = 1) {
  const d = new Date(Date.now() + minutes * 60000);
  d.setSeconds(0, 0);
  const offset = d.getTimezoneOffset() * 60000;
  const local  = new Date(d.getTime() - offset);
  return local.toISOString().slice(0, 16);
}

function localToTimestamp(localStr) {
  return new Date(localStr).getTime();
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function useScheduler(addEntry) {
  const [queue, setQueue] = useState([]);
  const runningRef = useRef(new Set());

  const reload = useCallback(async () => {
    const all = await dbGetAll("queue");
    all.sort((a, b) => a.scheduledAt - b.scheduledAt);
    setQueue(all);
  }, []);

  useEffect(() => {
    reload();
    const h = () => reload();
    window.addEventListener("sw:queue-update", h);
    return () => window.removeEventListener("sw:queue-update", h);
  }, []);

  useEffect(() => {
    const tick = async () => {
      const all = await dbGetAll("queue");
      const now = Date.now();
      const due = all.filter((x) => x.scheduledAt <= now && x.status === "pending");
      if (!due.length) return;

      for (const item of due) {
        if (runningRef.current.has(item.id)) continue;
        runningRef.current.add(item.id);
        await dbPut("queue", { ...item, status: "running" });
        reload();

        try {
          const urlsToPost = item.mediaUrls || [item.mediaUrl];

          for (let mi = 0; mi < urlsToPost.length; mi++) {
            const mediaUrl = urlsToPost[mi];
            if (mi > 0) await new Promise(r => setTimeout(r, 3000));

            const res = await fetch("/.netlify/functions/publish", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                accounts: item.accounts,
                media_url: mediaUrl,
                media_type: item.mediaType,
                post_type: item.postType,
                captions: item.captions || {},
                default_caption: item.caption || "",
                delay_seconds: 0,
              }),
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const results = data.results || [];

            await addEntry({
              id: Date.now() + mi,
              post_type: item.postType,
              media_url: mediaUrl,
              media_type: item.mediaType,
              default_caption: item.caption,
              results,
              created_at: new Date().toISOString(),
              from_scheduler: true,
            });
          }

          if (item.loop) {
            await dbPut("queue", {
              ...item, status: "pending",
              scheduledAt: item.scheduledAt + 86400000,
              runCount: (item.runCount || 0) + 1,
            });
          } else {
            await dbPut("queue", { ...item, status: "done" });
          }
        } catch (err) {
          await dbPut("queue", { ...item, status: "error", error: err.message });
        }

        runningRef.current.delete(item.id);
        reload();
      }
    };

    const iv = setInterval(tick, 10000);
    tick();
    return () => clearInterval(iv);
  }, [addEntry]);

  const addBatch   = async (b) => { await dbPutMany("queue", b); reload(); };
  const updateItem = async (item) => { await dbPut("queue", item); reload(); };
  const removeItem = async (id) => { await dbDelete("queue", id); setQueue((p) => p.filter((x) => x.id !== id)); };
  const clearQueue = async () => { await dbClear("queue"); setQueue([]); };
  return { queue, addBatch, updateItem, removeItem, clearQueue, reload };
}

function AccountPicker({ accounts, selectedIds, onToggle, onSelectAll, onClear }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Contas <span style={{ color: "var(--text)" }}>({selectedIds.length}/{accounts.length})</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-ghost btn-xs" onClick={onSelectAll}>Todas</button>
          <button className="btn btn-ghost btn-xs" onClick={onClear}>Limpar</button>
        </div>
      </div>
      {accounts.length === 0 ? (
        <div style={{ textAlign: "center", padding: "14px 0", color: "var(--muted)", fontSize: 12 }}>Nenhuma conta conectada</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {accounts.map((acc) => {
            const sel = selectedIds.includes(acc.id);
            return (
              <button key={acc.id} onClick={() => onToggle(acc.id)} style={{
                display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 8,
                border: `1px solid ${sel ? "var(--accent)" : "var(--border)"}`,
                background: sel ? "#7c5cfc12" : "var(--bg3)", textAlign: "left", width: "100%", transition: "all 0.12s",
              }}>
                {acc.profile_picture
                  ? <img src={acc.profile_picture} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg, var(--accent), #9b4dfc)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff" }}>
                      {(acc.username || "?")[0].toUpperCase()}
                    </div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: sel ? "var(--accent-light)" : "var(--text)" }}>
                    @{acc.username}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)" }}>{acc.account_type}</div>
                </div>
                <div style={{ width: 15, height: 15, borderRadius: "50%", border: `1.5px solid ${sel ? "var(--accent)" : "var(--border)"}`, background: sel ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
                  {sel && <span style={{ color: "#fff", fontSize: 9 }}>✓</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CycleBadge({ count }) {
  if (count <= 1) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: "linear-gradient(135deg, #7c5cfc22, #9b4dfc22)",
      border: "1px solid var(--accent)", borderRadius: 20,
      padding: "2px 8px", fontSize: 11, fontWeight: 700,
      color: "var(--accent-light)",
    }}>
      {count}× por ciclo
    </span>
  );
}

export default function Schedule() {
  const { accounts } = useAccounts();
  const { addEntry }  = useHistory();
  const { queue, addBatch, updateItem, removeItem, clearQueue } = useScheduler(addEntry);

  const [postType,    setPostType]    = useState("FEED");
  const [mediaType,   setMediaType]   = useState("IMAGE");
  const [caption,     setCaption]     = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [urlList,     setUrlList]     = useState([]);
  const [previewIdx,  setPreviewIdx]  = useState(0);
  const [startTime,   setStartTime]   = useState(nowPlus(1));
  const [intervalMin, setIntervalMin] = useState(0);
  const [intervalMax, setIntervalMax] = useState(20);
  const [loop,        setLoop]        = useState(false);
  const [bulkCaptions,  setBulkCaptions]  = useState("");
  const [captionMode,   setCaptionMode]   = useState("roundrobin");

  // ── NOVOS: Quantidade por Ciclo + Seleção de Mídias ──
  const [quantityPerCycle, setQuantityPerCycle] = useState(1);
  const [mediaSameForAll,  setMediaSameForAll]  = useState("same");

  const [distMode,     setDistMode]     = useState("all");
  const [showUploader, setShowUploader] = useState(false);
  const [bulkUrlText,  setBulkUrlText]  = useState("");
  const [showBulkUrl,  setShowBulkUrl]  = useState(false);
  const [editModal,    setEditModal]    = useState(null);
  const [editTime,     setEditTime]     = useState("");
  const [editCaption,  setEditCaption]  = useState("");
  const [confirmModal, setConfirmModal] = useState(null);

  const isReel = postType === "REEL";

  const handlePostType = (t) => { setPostType(t); if (t === "REEL") setMediaType("VIDEO"); };
  const toggleAcc = (id) => setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const selectAll = () => setSelectedIds(accounts.map((a) => a.id));
  const clearAll  = () => setSelectedIds([]);
  const addUrl    = () => setUrlList((p) => [...p, { id: Date.now(), url: "", type: isReel ? "VIDEO" : mediaType }]);
  const removeUrl = (id) => setUrlList((p) => p.filter((x) => x.id !== id));
  const setUrl    = (id, v) => setUrlList((p) => p.map((x) => x.id === id ? { ...x, url: v } : x));

  const selectedAccounts = accounts.filter((a) => selectedIds.includes(a.id));
  const activeUrl = urlList[previewIdx]?.url || "";
  const validUrls = urlList.filter((x) => x.url.trim());

  useEffect(() => { setStartTime(nowPlus(1)); }, []);

  const handleCatboxUrls = (items) => {
    const newEntries = items.map((item, i) => ({ id: Date.now() + i, url: item.url, type: item.type }));
    setUrlList((p) => {
      const nonEmpty = p.filter((x) => x.url.trim());
      return nonEmpty.length === 0 ? newEntries : [...nonEmpty, ...newEntries];
    });
    const hasVideo = newEntries.some((e) => e.type === "VIDEO");
    if (hasVideo && !isReel) setMediaType("VIDEO");
    else if (!hasVideo && !isReel) setMediaType("IMAGE");
    setShowUploader(false);
  }

  const handleBulkUrls = () => {
    const urls = bulkUrlText.split(/[\n,]/).map((u) => u.trim()).filter((u) => u.startsWith("http"));
    if (!urls.length) return;
    const newEntries = urls.map((url, i) => ({ id: Date.now() + i, url, type: isReel ? "VIDEO" : mediaType }));
    setUrlList((p) => {
      const nonEmpty = p.filter((x) => x.url.trim());
      return [...nonEmpty, ...newEntries];
    });
    setBulkUrlText("");
    setMediaMode("upload");
  };;

  // ── Lógica de geração da fila com suporte a quantityPerCycle ──
  // Parseia bulk captions
  const parsedCaptions = bulkCaptions.split("\n").map(l => l.trim()).filter(Boolean);

  const buildQueueItems = (startTs) => {
    const urls = validUrls.map((x) => x.url.trim());
    const items = [];
    let ts = startTs;
    const qty = Math.max(1, quantityPerCycle);
    let globalIdx = 0; // índice global para round-robin de captions

    const intervalMs = () => randomBetween(
      Math.round(intervalMin * 60000),
      Math.max(Math.round(intervalMax * 60000), Math.round(intervalMin * 60000) + 1000)
    );

    const pickUrls = (accIdx) => {
      if (mediaSameForAll === "same") {
        return Array.from({ length: qty }, (_, i) => urls[i % urls.length]);
      } else {
        const shuffled = shuffle(urls);
        return Array.from({ length: qty }, (_, i) => shuffled[(accIdx * qty + i) % shuffled.length]);
      }
    };

    // Resolve a legenda para um índice global
    const resolveCaption = (idx) => {
      if (parsedCaptions.length === 0) return caption;
      return pickCaption(parsedCaptions, captionMode, idx);
    };

    if (distMode === "all") {
      const mediaUrls = pickUrls(0);
      const resolvedCaption = resolveCaption(globalIdx++);
      items.push({
        id: `${Date.now()}-all-${Math.random().toString(36).slice(2)}`,
        postType, mediaType,
        mediaUrl: mediaUrls[0],
        mediaUrls,
        caption: resolvedCaption,
        bulkCaptions: parsedCaptions,
        captionMode,
        accounts: selectedAccounts,
        scheduledAt: ts, status: "pending",
        loop, runCount: 0, distMode: "all",
        quantityPerCycle: qty, mediaSameForAll,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        createdAt: new Date().toISOString(),
      });

    } else if (distMode === "random") {
      const shuffledAccs = shuffle(selectedAccounts);
      for (let i = 0; i < shuffledAccs.length; i++) {
        if (i > 0) ts += intervalMs();
        const mediaUrls = pickUrls(i);
        const resolvedCaption = resolveCaption(globalIdx++);
        items.push({
          id: `${Date.now()}-rnd-${i}-${Math.random().toString(36).slice(2)}`,
          postType, mediaType,
          mediaUrl: mediaUrls[0],
          mediaUrls,
          caption: resolvedCaption,
          bulkCaptions: parsedCaptions,
          captionMode,
          accounts: [shuffledAccs[i]],
          scheduledAt: ts, status: "pending",
          loop, runCount: 0, distMode: "random",
          quantityPerCycle: qty, mediaSameForAll,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          createdAt: new Date().toISOString(),
        });
      }

    } else if (distMode === "roundrobin") {
      for (let i = 0; i < selectedAccounts.length; i++) {
        if (i > 0) ts += intervalMs();
        const mediaUrls = Array.from({ length: qty }, (_, q) => urls[(i * qty + q) % urls.length]);
        const resolvedCaption = resolveCaption(globalIdx++);
        items.push({
          id: `${Date.now()}-rr-${i}-${Math.random().toString(36).slice(2)}`,
          postType, mediaType,
          mediaUrl: mediaUrls[0],
          mediaUrls,
          caption: resolvedCaption,
          bulkCaptions: parsedCaptions,
          captionMode,
          accounts: [selectedAccounts[i]],
          scheduledAt: ts, status: "pending",
          loop, runCount: 0, distMode: "roundrobin",
          quantityPerCycle: qty, mediaSameForAll,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          createdAt: new Date().toISOString(),
        });
      }
    }

    return items;
  };

  const schedule = async () => {
    if (!validUrls.length)   return alert("Adicione ao menos uma URL de mídia");
    if (!selectedIds.length) return alert("Selecione ao menos uma conta");
    if (!startTime)          return alert("Defina o horário de início");
    const startTs = localToTimestamp(startTime);
    if (startTs <= Date.now()) return alert("O horário precisa ser no futuro");
    const items = buildQueueItems(startTs);
    await addBatch(items);
    setUrlList([]);
    setCaption("");
    setSelectedIds([]);
    setQuantityPerCycle(1);
  };

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
    await updateItem({ ...editModal, scheduledAt: localToTimestamp(editTime), caption: editCaption, status: "pending" });
    setEditModal(null);
  };

  const STATUS_INFO = {
    pending: { label: "Agendado", color: "var(--info)",    bg: "rgba(56,189,248,0.08)"  },
    running: { label: "Rodando",  color: "var(--warning)", bg: "rgba(245,158,11,0.08)"  },
    done:    { label: "Feito",    color: "var(--success)", bg: "rgba(34,197,94,0.06)"   },
    error:   { label: "Erro",     color: "var(--danger)",  bg: "rgba(239,68,68,0.06)"   },
  };

  const pendingCount = queue.filter((q) => q.status === "pending").length;
  const doneCount    = queue.filter((q) => q.status === "done").length;
  const errorCount   = queue.filter((q) => q.status === "error").length;

  const previewDist = () => {
    const urls = validUrls.map((x) => x.url.trim());
    if (!urls.length || !selectedAccounts.length) return [];
    const qty = Math.max(1, quantityPerCycle);
    const mLabel = qty > 1 ? `${qty} mídias` : "1 mídia";
    if (distMode === "all") return [`${mLabel} → ${selectedAccounts.length} conta(s) (${mediaSameForAll === "same" ? "mesmas mídias" : "distribuídas"})`];
    if (distMode === "random") return selectedAccounts.slice(0, 6).map((acc) => `@${acc.username} → ${mLabel} aleatórias`);
    if (distMode === "roundrobin") return selectedAccounts.slice(0, 6).map((acc, i) => {
      const start = (i * qty) % Math.max(urls.length, 1);
      return `@${acc.username} → URL ${start + 1}${qty > 1 ? `..${start + qty}` : ""}`;
    });
    return [];
  };

  const estimatedTotal = () => Math.max(1, quantityPerCycle) * (distMode === "all" ? selectedIds.length : selectedIds.length);

  const scheduleLabel = () => {
    const qty = Math.max(1, quantityPerCycle);
    if (distMode === "all") return `🗓 Agendar — ${qty} mídia(s) × ${selectedIds.length} conta(s)`;
    if (distMode === "random") return `🗓 Agendar — ${qty} mídia(s) aleatórias × ${selectedIds.length} conta(s)`;
    return `🗓 Agendar — round-robin × ${selectedIds.length} conta(s)`;
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Agendamentos</div>
          <div className="page-subtitle">
            {pendingCount} pendente(s) · {doneCount} feito(s)
            {errorCount > 0 && <span style={{ color: "var(--danger)", marginLeft: 6 }}>· {errorCount} erro(s)</span>}
          </div>
        </div>
        {queue.length > 0 && (
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmModal({ type: "clearQueue" })}>Limpar fila</button>
        )}
      </div>

      <div className="schedule-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Tipo de post */}
          <div className="card">
            <div style={{ marginBottom: 12, fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Tipo de post</div>
            <div style={{ display: "flex", gap: 8 }}>
              {POST_TYPES.map((t) => (
                <button key={t.value} onClick={() => handlePostType(t.value)} style={{
                  flex: 1, padding: "10px 6px", borderRadius: 8, border: "1px solid",
                  borderColor: postType === t.value ? "var(--accent)" : "var(--border)",
                  background: postType === t.value ? "#7c5cfc18" : "var(--bg3)",
                  color: postType === t.value ? "var(--accent-light)" : "var(--muted)",
                  textAlign: "center", transition: "all 0.12s",
                }}>
                  <div style={{ fontSize: 16 }}>{t.icon}</div>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{t.label}</div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{t.desc}</div>
                </button>
              ))}
            </div>
            {isReel && (
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--warning)", background: "rgba(245,158,11,0.08)", padding: "7px 10px", borderRadius: 7 }}>
                ⚠️ Reels só aceita vídeo via API do Instagram
              </div>
            )}
          </div>

          {/* Mídias */}
          <div className="card">
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              <button className={`btn btn-sm ${showUploader ? "btn-primary" : "btn-ghost"}`} onClick={() => setShowUploader((p) => !p)}>
                ☁️ Upload mídias
              </button>
              <button className={`btn btn-sm ${showBulkUrl ? "btn-primary" : "btn-ghost"}`} onClick={() => setShowBulkUrl((p) => !p)}>
                🔗 + URL manual
              </button>
              {validUrls.length > 0 && (
                <span style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center", marginLeft: 4 }}>
                  ✓ {validUrls.length} URL{validUrls.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            {/* Painel Upload */}
            {showUploader && (
              <div style={{ marginBottom: 14, padding: "14px", background: "var(--bg3)", borderRadius: 10, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: "var(--accent-light)" }}>☁️ Upload direto para Catbox</div>
                <CatboxUploader onUrlsReady={handleCatboxUrls} mediaType={mediaType} />
              </div>
            )}

            {/* Painel URL em massa */}
            {showBulkUrl && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                <textarea
                  placeholder={"Cole as URLs, uma por linha:\nhttps://files.catbox.moe/abc.mp4\nhttps://r2.exemplo.com/video2.mp4\nhttps://cdn.exemplo.com/video3.mp4"}
                  value={bulkUrlText}
                  onChange={(e) => setBulkUrlText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); handleBulkUrls(); } }}
                  style={{ fontSize: 11, minHeight: 100, resize: "vertical", fontFamily: "monospace", borderRadius: 8 }}
                />
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleBulkUrls}
                    disabled={!bulkUrlText.split(/[\n,]/).some((u) => u.trim().startsWith("http"))}>
                    ✓ Adicionar URLs
                  </button>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>Ctrl+Enter</span>
                </div>
              </div>
            )}

            {/* Contador de URLs adicionadas */}
            {validUrls.length > 0 && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                ✓ {validUrls.length} URL{validUrls.length > 1 ? "s" : ""} adicionada{validUrls.length > 1 ? "s" : ""}
              </div>
            )}
            {activeUrl && (
              <div style={{ marginTop: 12 }}>
                <MediaPreview url={activeUrl} mediaType={isReel ? "VIDEO" : mediaType} onTypeDetected={!isReel ? setMediaType : undefined} />
              </div>
            )}
            {!isReel && (
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                {["IMAGE", "VIDEO"].map((t) => (
                  <button key={t} onClick={() => setMediaType(t)} style={{
                    flex: 1, padding: "7px", borderRadius: 8, border: "1px solid",
                    borderColor: mediaType === t ? "var(--accent)" : "var(--border)",
                    background: mediaType === t ? "#7c5cfc18" : "var(--bg3)",
                    color: mediaType === t ? "var(--accent-light)" : "var(--muted)",
                    fontSize: 12, fontWeight: mediaType === t ? 600 : 400,
                  }}>
                    {t === "IMAGE" ? "🖼 Imagem" : "🎬 Vídeo"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── NOVO: Quantidade por Ciclo ── */}
          <div className="card" style={{ position: "relative", overflow: "hidden" }}>
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, height: 2,
              background: "linear-gradient(90deg, var(--accent), #9b4dfc, var(--accent))",
              opacity: 0.7,
            }} />

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                🎯 Quantidade de mídias por ciclo
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                Quantas mídias cada conta recebe por execução do agendamento
              </div>
            </div>

            {/* Controle stepper */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <button onClick={() => setQuantityPerCycle(q => Math.max(1, q - 1))} style={{
                width: 34, height: 34, borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--bg3)", color: "var(--text)", fontSize: 20, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
              }}>−</button>

              <div style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontSize: 38, fontWeight: 800, color: "var(--accent-light)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                  {quantityPerCycle}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                  {quantityPerCycle === 1 ? "mídia por conta por ciclo" : "mídias por conta por ciclo"}
                </div>
              </div>

              <button onClick={() => setQuantityPerCycle(q => Math.min(20, q + 1))} style={{
                width: 34, height: 34, borderRadius: 8, border: "1px solid var(--accent)",
                background: "#7c5cfc18", color: "var(--accent-light)", fontSize: 20, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
              }}>+</button>

              <input type="number" min="1" max="20" value={quantityPerCycle}
                onChange={(e) => setQuantityPerCycle(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
                style={{ width: 56, fontSize: 13, textAlign: "center", padding: "6px 8px" }}
              />
            </div>

            {/* Presets rápidos */}
            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
              {[1, 2, 3, 5, 10].map((n) => (
                <button key={n} onClick={() => setQuantityPerCycle(n)} style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  border: `1px solid ${quantityPerCycle === n ? "var(--accent)" : "var(--border)"}`,
                  background: quantityPerCycle === n ? "#7c5cfc22" : "var(--bg3)",
                  color: quantityPerCycle === n ? "var(--accent-light)" : "var(--muted)",
                  transition: "all 0.12s",
                }}>{n}×</button>
              ))}
            </div>

            {/* Seleção de mídias */}
            <div style={{ marginBottom: 8, fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Seleção de mídias
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { value: "same",       icon: "📋", label: "Mesmas mídias para todas",   desc: "Todas as contas recebem as mesmas mídias (pool em loop se necessário)" },
                { value: "distribute", icon: "🎲", label: "Distribuir aleatoriamente",  desc: "Cada conta recebe mídias diferentes sorteadas do pool" },
              ].map((opt) => (
                <button key={opt.value} onClick={() => setMediaSameForAll(opt.value)} style={{
                  display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid",
                  borderColor: mediaSameForAll === opt.value ? "var(--accent)" : "var(--border)",
                  background: mediaSameForAll === opt.value ? "#7c5cfc12" : "var(--bg3)",
                  textAlign: "left", width: "100%", transition: "all 0.12s", cursor: "pointer",
                }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{opt.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: mediaSameForAll === opt.value ? "var(--accent-light)" : "var(--text)" }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{opt.desc}</div>
                  </div>
                  <div style={{ width: 15, height: 15, borderRadius: "50%", border: `1.5px solid ${mediaSameForAll === opt.value ? "var(--accent)" : "var(--border)"}`, background: mediaSameForAll === opt.value ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                    {mediaSameForAll === opt.value && <span style={{ color: "#fff", fontSize: 9 }}>✓</span>}
                  </div>
                </button>
              ))}
            </div>

            {/* Info box explicativo */}
            {quantityPerCycle > 1 && (
              <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(124,92,252,0.08)", border: "1px solid rgba(124,92,252,0.2)" }}>
                <div style={{ fontSize: 11, color: "var(--accent-light)", fontWeight: 600, marginBottom: 4 }}>💡 Como vai funcionar:</div>
                <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
                  {distMode === "all" && `Todas as ${selectedIds.length || "N"} conta(s) receberão ${quantityPerCycle} mídias por ciclo.`}
                  {distMode === "random" && `Cada conta receberá ${quantityPerCycle} mídias sorteadas do pool de ${validUrls.length || "N"} URL(s).`}
                  {distMode === "roundrobin" && `Cada conta recebe ${quantityPerCycle} URL(s) sequenciais do pool (round-robin).`}
                  {" Intervalo de 3s entre cada mídia do mesmo lote."}
                  {loop && " Repetição diária ativa."}
                </div>
              </div>
            )}
          </div>

          {/* Distribuição */}
          <div className="card">
            <div style={{ marginBottom: 12, fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              🎲 Distribuição entre contas
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { value: "all",        icon: "📢", label: "Todas recebem tudo",    desc: `${quantityPerCycle > 1 ? `${quantityPerCycle} mídias` : "Cada URL"} postada(s) em todas as contas` },
                { value: "random",     icon: "🎲", label: "Aleatório",             desc: `Cada conta recebe ${quantityPerCycle > 1 ? `${quantityPerCycle} mídias` : "uma mídia"} sorteada(s) do pool` },
                { value: "roundrobin", icon: "🔄", label: "Round-robin",           desc: `Distribui ${quantityPerCycle > 1 ? `${quantityPerCycle} URLs` : "URLs"} em sequência entre as contas` },
              ].map((opt) => (
                <button key={opt.value} onClick={() => setDistMode(opt.value)} style={{
                  display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid",
                  borderColor: distMode === opt.value ? "var(--accent)" : "var(--border)",
                  background: distMode === opt.value ? "#7c5cfc12" : "var(--bg3)",
                  textAlign: "left", width: "100%", transition: "all 0.12s", cursor: "pointer",
                }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{opt.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: distMode === opt.value ? "var(--accent-light)" : "var(--text)" }}>{opt.label}</span>
                      {distMode === opt.value && <CycleBadge count={quantityPerCycle} />}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{opt.desc}</div>
                  </div>
                  <div style={{ width: 15, height: 15, borderRadius: "50%", border: `1.5px solid ${distMode === opt.value ? "var(--accent)" : "var(--border)"}`, background: distMode === opt.value ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                    {distMode === opt.value && <span style={{ color: "#fff", fontSize: 9 }}>✓</span>}
                  </div>
                </button>
              ))}
            </div>

            {validUrls.length > 0 && selectedAccounts.length > 0 && (
              <div style={{ marginTop: 12, background: "var(--bg3)", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 6 }}>PRÉVIA</div>
                {previewDist().slice(0, 5).map((line, i) => (
                  <div key={i} style={{ fontSize: 11, color: "var(--text)", marginBottom: 3 }}>→ {line}</div>
                ))}
                {previewDist().length > 5 && <div style={{ fontSize: 11, color: "var(--muted)" }}>... e mais {previewDist().length - 5}</div>}
                {selectedIds.length > 0 && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--accent-light)", fontWeight: 600 }}>
                    📊 Total estimado: {estimatedTotal()} post(s) por ciclo{loop && " · repete diariamente"}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Legendas em Massa */}
          {(postType === "FEED" || postType === "REEL") && (
            <BulkCaptions
              value={bulkCaptions}
              onChange={setBulkCaptions}
              mode={captionMode}
              onModeChange={setCaptionMode}
              previewCount={Math.min(selectedAccounts.length || 3, 6)}
            />
          )}

          {/* Horário */}
          <div className="card">
            <div className="form-row">
              <label>Início do agendamento</label>
              <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Fuso: {Intl.DateTimeFormat().resolvedOptions().timeZone}</div>
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>Intervalo entre contas (minutos)</label>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input type="number" min="0" max="1440" step="1" value={intervalMin}
                  onChange={(e) => setIntervalMin(Math.max(0, parseFloat(e.target.value) || 0))}
                  style={{ maxWidth: 90, fontSize: 13 }} />
                <span style={{ color: "var(--muted)", fontSize: 12 }}>até</span>
                <input type="number" min="0" max="1440" step="1" value={intervalMax}
                  onChange={(e) => setIntervalMax(Math.max(0, parseFloat(e.target.value) || 0))}
                  style={{ maxWidth: 90, fontSize: 13 }} />
                <span style={{ fontSize: 11, color: "var(--muted)" }}>min</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, padding: "6px 10px", background: "var(--bg3)", borderRadius: 7 }}>
                {intervalMin === 0 && intervalMax === 0
                  ? `Sem intervalo entre contas${quantityPerCycle > 1 ? " · 3s entre mídias do mesmo ciclo" : ""}`
                  : `Intervalo de ${intervalMin}~${intervalMax} min entre contas${quantityPerCycle > 1 ? ` · 3s entre mídias do mesmo ciclo` : ""}`}
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} style={{ width: "auto" }} />
                <span style={{ fontSize: 13, color: "var(--text)", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                  🔁 Repetir diariamente (loop 24h)
                </span>
              </label>
              {loop && quantityPerCycle > 1 && (
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)", padding: "6px 10px", background: "rgba(124,92,252,0.06)", borderRadius: 7 }}>
                  A cada 24h: {quantityPerCycle} mídia(s) por conta, modo {distMode}.
                </div>
              )}
            </div>
          </div>

          {/* Contas */}
          <div className="card">
            <AccountPicker accounts={accounts} selectedIds={selectedIds} onToggle={toggleAcc} onSelectAll={selectAll} onClear={clearAll} />
          </div>

          <button className="btn btn-primary" onClick={schedule} disabled={!validUrls.length || !selectedIds.length}
            style={{ padding: "12px 24px", fontSize: 14 }}>
            {scheduleLabel()}
          </button>
        </div>

        {/* ── Fila ── */}
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
            Fila de agendamentos
            {pendingCount > 0 && <span className="badge badge-info">{pendingCount}</span>}
          </div>

          {queue.length === 0 ? (
            <div className="card" style={{ textAlign: "center", padding: "36px 20px", color: "var(--muted)" }}>
              <div style={{ fontSize: 30, marginBottom: 12 }}>◷</div>
              <div style={{ fontWeight: 500, color: "var(--text)", marginBottom: 6 }}>Fila vazia</div>
              <div style={{ fontSize: 12 }}>Agendamentos aparecem aqui em tempo real.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {queue.map((item) => {
                const info = STATUS_INFO[item.status] || STATUS_INFO.pending;
                const scheduledDate = new Date(item.scheduledAt);
                const isPast = item.scheduledAt < Date.now();
                const thumbUrl = item.mediaType === "IMAGE" ? item.mediaUrl : null;
                const qty = item.quantityPerCycle || 1;
                const mediaCount = item.mediaUrls?.length || 1;

                return (
                  <div key={item.id} style={{ background: info.bg, border: `1px solid ${info.color}28`, borderLeft: `3px solid ${info.color}`, borderRadius: 10, padding: "9px 11px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {thumbUrl ? (
                        <img src={thumbUrl} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }}
                          onError={(e) => { e.target.style.display = "none"; }} />
                      ) : (
                        <div style={{ width: 36, height: 36, borderRadius: 6, background: "var(--bg3)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, position: "relative" }}>
                          🎬
                          {mediaCount > 1 && (
                            <span style={{ position: "absolute", top: -4, right: -4, background: "var(--accent)", color: "#fff", fontSize: 8, fontWeight: 700, borderRadius: 8, padding: "1px 4px", lineHeight: 1.2 }}>
                              ×{mediaCount}
                            </span>
                          )}
                        </div>
                      )}

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: info.color }}>{item.status === "running" ? "⟳ " : ""}{info.label.toUpperCase()}</span>
                          <span style={{ fontSize: 10, color: "var(--muted)", background: "var(--bg3)", padding: "1px 6px", borderRadius: 4 }}>{item.postType}</span>
                          <span style={{ fontSize: 10, color: "var(--muted)" }}>{item.mediaType === "IMAGE" ? "🖼" : "🎬"}</span>
                          {qty > 1 && (
                            <span style={{ fontSize: 9, fontWeight: 700, color: "var(--accent-light)", background: "#7c5cfc20", border: "1px solid var(--accent)", padding: "0 5px", borderRadius: 8 }}>
                              ×{qty}/ciclo
                            </span>
                          )}
                          {item.loop && <span style={{ fontSize: 9, color: "var(--accent-light)" }}>🔁</span>}
                          {item.runCount > 0 && <span style={{ fontSize: 9, color: "var(--muted)" }}>run×{item.runCount}</span>}
                          <span style={{ fontSize: 10, color: isPast && item.status === "pending" ? "var(--warning)" : "var(--muted)", marginLeft: "auto" }}>
                            🕐 {scheduledDate.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                            {isPast && item.status === "pending" && " ⚠"}
                          </span>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <div style={{ display: "flex" }}>
                            {(item.accounts || []).slice(0, 5).map((a, i) => (
                              <div key={a.id} title={`@${a.username}`} style={{ marginLeft: i > 0 ? -6 : 0, zIndex: 5 - i, position: "relative" }}>
                                {a.profile_picture
                                  ? <img src={a.profile_picture} alt="" style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover", border: "1.5px solid var(--bg2)" }} />
                                  : <div style={{ width: 16, height: 16, borderRadius: "50%", background: "linear-gradient(135deg, var(--accent), #9b4dfc)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, color: "#fff", fontWeight: 700, border: "1.5px solid var(--bg2)" }}>
                                      {(a.username || "?")[0].toUpperCase()}
                                    </div>}
                              </div>
                            ))}
                            {(item.accounts || []).length > 5 && <span style={{ fontSize: 9, color: "var(--muted)", marginLeft: 4 }}>+{item.accounts.length - 5}</span>}
                          </div>
                          <span style={{ fontSize: 10, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                            {mediaCount > 1 ? `${mediaCount} mídias agrupadas` : item.mediaUrl?.split("/").pop()}
                          </span>
                        </div>

                        {item.error && <div style={{ fontSize: 10, color: "var(--danger)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✗ {item.error}</div>}
                      </div>

                      <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                        {(item.status === "pending" || item.status === "error") && (
                          <button className="btn btn-ghost btn-xs" onClick={() => openEdit(item)} title="Editar" style={{ padding: "3px 7px", fontSize: 12 }}>✎</button>
                        )}
                        <button className="btn btn-ghost btn-xs" style={{ color: "var(--danger)", padding: "3px 7px", fontSize: 12 }}
                          onClick={() => setConfirmModal({ type: "removeItem", id: item.id })} title="Remover">✕</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

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

      <Modal open={confirmModal?.type === "clearQueue"} title="Limpar fila?" message="Todos os agendamentos pendentes serão removidos." confirmLabel="Limpar fila" confirmDanger
        onConfirm={() => { clearQueue(); setConfirmModal(null); }} onCancel={() => setConfirmModal(null)} />
      <Modal open={confirmModal?.type === "removeItem"} title="Remover agendamento?" message="Este item será removido da fila." confirmLabel="Remover" confirmDanger
        onConfirm={() => { removeItem(confirmModal.id); setConfirmModal(null); }} onCancel={() => setConfirmModal(null)} />

      <style>{`
        @media (max-width: 900px) { .schedule-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}
