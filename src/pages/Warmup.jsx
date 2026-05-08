// Warmup.jsx — Aquecimento de Contas v3 (reescrita completa)
// Foco: aquecimento rápido em 2 dias, Reels-first, proteção de contas novas
// Tabs: Upload de Mídias | Legendas | Configuração | Preview da Fila | Monitor

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useAccounts } from "../useAccounts.js";
import { dbPut, dbGetAll } from "../useDB.js";
import BulkCaptions, { pickCaption } from "../components/BulkCaptions.jsx";
import ReelChecklist from "../components/ReelChecklist.jsx";

// ─── Constantes ───────────────────────────────────────────────────────────────

const WARMUP_PRESET_2D = {
  id:    "fast2d",
  label: "Aquecimento Rápido 2 Dias 🚀",
  desc:  "Foco em Reels com Feed e Stories complementares. Alta proteção de conta.",
  days: [
    {
      day: 1,
      label: "Dia 1 — Arranque Suave",
      reels:   3,
      feed:    1,
      stories: 2,
      windowStart: "09:00",
      windowEnd:   "21:30",
      intervalMinMin: 90,
      intervalMinMax: 150,
    },
    {
      day: 2,
      label: "Dia 2 — Aceleração",
      reels:   5,
      feed:    2,
      stories: 3,
      windowStart: "09:00",
      windowEnd:   "21:30",
      intervalMinMin: 60,
      intervalMinMax: 120,
    },
  ],
};

const JITTER_MIN_RANGE = [-40, 40];
const JITTER_SEC_RANGE = [0, 59];
const NEW_ACCOUNT_DAYS = 4;

const TABS = [
  { id: "upload",   icon: "📤", label: "Upload"         },
  { id: "captions", icon: "💬", label: "Legendas"       },
  { id: "config",   icon: "⚙️",  label: "Configuração"  },
  { id: "preview",  icon: "📅", label: "Preview da Fila" },
  { id: "monitor",  icon: "📊", label: "Monitor"        },
];

const MEDIA_TYPES = [
  { id: "reels",   icon: "🎬", label: "Reels",   accept: "video/*",         hint: "MP4, MOV · 8–90s recomendado",          postType: "REEL",  mediaType: "VIDEO" },
  { id: "feed",    icon: "🖼",  label: "Feed",    accept: "image/*,video/*", hint: "JPG, PNG, MP4 · fotos e carrosséis",    postType: "FEED",  mediaType: "IMAGE" },
  { id: "stories", icon: "⭕",  label: "Stories", accept: "image/*,video/*", hint: "Vertical 9:16 · até 15s para vídeo",   postType: "STORY", mediaType: "IMAGE" },
];

// ─── Utilitários ──────────────────────────────────────────────────────────────

function fmtSize(b) {
  if (!b) return "—";
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function warmupDay(connectedAt) {
  const diff = Math.floor((Date.now() - new Date(connectedAt)) / 86400000);
  return Math.min(diff + 1, 99);
}

function isNewAccount(acc) {
  return warmupDay(acc.connected_at || new Date().toISOString()) <= NEW_ACCOUNT_DAYS;
}

// Upload direto do browser para R2 via presigned URL — sem limite de tamanho
async function uploadFile(file, onProgress) {
  onProgress(2);

  // Passo 1: obter presigned URL da Netlify Function (só metadados)
  const presignRes = await fetch("/api/r2-presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, mimeType: file.type || "video/mp4" }),
  });
  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({}));
    throw new Error(err.error || `Erro ao gerar URL (${presignRes.status})`);
  }
  const { presignedUrl, publicUrl } = await presignRes.json();
  onProgress(5);

  // Passo 2: PUT direto no R2 com progresso real via XHR
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 93) + 5);
    };
    xhr.onload    = () => xhr.status === 200 ? resolve() : reject(new Error(`R2 HTTP ${xhr.status}`));
    xhr.onerror   = () => reject(new Error("Erro de rede durante o upload"));
    xhr.ontimeout = () => reject(new Error("Timeout no upload"));
    xhr.timeout   = 5 * 60 * 1000;
    xhr.open("PUT", presignedUrl);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.send(file);
  });

  onProgress(100);
  return publicUrl;
}

function addJitter(date, minRange, secRange) {
  const jitterMin = Math.floor(Math.random() * (minRange[1] - minRange[0] + 1)) + minRange[0];
  const jitterSec = Math.floor(Math.random() * (secRange[1] - secRange[0] + 1)) + secRange[0];
  const result = new Date(date.getTime());
  result.setMinutes(result.getMinutes() + jitterMin);
  result.setSeconds(jitterSec);
  return result;
}

function timeToMs(dateBase, timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(dateBase);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function generateSlotTimes(dayBase, count, plan) {
  const windowStart = timeToMs(dayBase, plan.windowStart);
  const windowEnd   = timeToMs(dayBase, plan.windowEnd);
  const intervalMs  = plan.intervalMinMin * 60 * 1000;
  const times = [];
  for (let i = 0; i < count; i++) {
    const base = new Date(windowStart + i * intervalMs);
    if (base.getTime() > windowEnd) break;
    const jittered = addJitter(base, JITTER_MIN_RANGE, JITTER_SEC_RANGE);
    const final = new Date(Math.min(Math.max(jittered.getTime(), windowStart), windowEnd));
    times.push(final);
  }
  return times;
}

function buildWarmupQueue({ accounts, mediaByType, captions, captionMode, preset, startDateStr, distribution }) {
  const slots = [];
  if (!accounts.length) return slots;

  const startBase = new Date(startDateStr + "T00:00:00");

  preset.days.forEach((dayPlan) => {
    const dayBase = new Date(startBase);
    dayBase.setDate(dayBase.getDate() + (dayPlan.day - 1));

    const typeConfig = [
      { key: "reels",   count: dayPlan.reels,   ...MEDIA_TYPES[0] },
      { key: "feed",    count: dayPlan.feed,     ...MEDIA_TYPES[1] },
      { key: "stories", count: dayPlan.stories,  ...MEDIA_TYPES[2] },
    ];

    const daySlots = [];

    typeConfig.forEach(({ key, count, postType, mediaType }) => {
      const pool = mediaByType[key] || [];
      if (!pool.length || !count) return;

      accounts.forEach((acc, accIdx) => {
        const times = generateSlotTimes(dayBase, count, dayPlan);
        times.forEach((scheduledDate, k) => {
          const mediaIdx = distribution === "random"
            ? Math.floor(Math.random() * pool.length)
            : (accIdx * count + k) % pool.length;
          const media     = pool[mediaIdx];
          const slotIdx   = slots.length + daySlots.length;
          const caption   = captions.length ? pickCaption(captions, captionMode, slotIdx) : "";

          daySlots.push({
            id:            `wup-${acc.id}-${dayPlan.day}-${key}-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            accountId:     acc.id,
            username:      acc.username,
            mediaUrl:      media.url,
            mediaUrls:     [media.url],
            mediaName:     media.name,
            mediaType,
            postType,
            mediaCategory: key,
            caption,
            bulkCaptions:  captions,
            captionMode,
            accounts:      [{ id: acc.id, username: acc.username }],
            scheduledAt:   scheduledDate.getTime(),
            scheduledDay:  dayPlan.day,
            status:        "pending",
            warmup:        true,
            warmupDay:     dayPlan.day,
            created_at:    new Date().toISOString(),
          });
        });
      });
    });

    daySlots.sort((a, b) => a.scheduledAt - b.scheduledAt);
    slots.push(...daySlots);
  });

  return slots;
}

function shadowScore(insights) {
  if (!insights || insights.length < 3) return null;
  const vs  = insights.map((i) => i.views || i.reach || 0);
  const avg  = vs.reduce((a, b) => a + b, 0) / vs.length;
  const last = vs[vs.length - 1];
  const drop = avg > 0 ? Math.round(((avg - last) / avg) * 100) : 0;
  return { avg: Math.round(avg), last, drop };
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function MediaUploadZone({ typeConfig, files, onAddFiles, onRemoveFile, onUploadAll, uploading }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) onAddFiles(typeConfig.id, e.dataTransfer.files);
  }, [typeConfig.id, onAddFiles]);

  const myFiles = files[typeConfig.id] || [];
  const done    = myFiles.filter((f) => f.status === "done");
  const errors  = myFiles.filter((f) => f.status === "error");
  const idle    = myFiles.filter((f) => f.status === "idle");

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>{typeConfig.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{typeConfig.label}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{typeConfig.hint}</div>
        </div>
        {done.length > 0 && (
          <span className="badge badge-success" style={{ fontSize: 10 }}>
            {done.length} pronto{done.length > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--accent)" : "var(--border2)"}`,
          borderRadius: 10, padding: "16px", textAlign: "center", cursor: "pointer",
          background: dragging ? "rgba(124,92,252,0.08)" : "var(--bg3)",
          transition: "all 0.15s", marginBottom: myFiles.length ? 8 : 0,
        }}
      >
        <div style={{ fontSize: 20, marginBottom: 3 }}>{typeConfig.icon}</div>
        <div style={{ fontSize: 12, fontWeight: 600 }}>
          {dragging ? "Solte aqui" : `Arraste ou clique`}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={typeConfig.accept}
          style={{ display: "none" }}
          onChange={(e) => e.target.files.length && onAddFiles(typeConfig.id, e.target.files)}
        />
      </div>

      {myFiles.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto", marginBottom: 6 }}>
          {myFiles.map((f) => (
            <div key={f.id} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 10px", borderRadius: 7, fontSize: 11,
              background: f.status === "done" ? "rgba(34,197,94,0.06)" : f.status === "error" ? "rgba(239,68,68,0.06)" : "var(--bg4)",
              border: `1px solid ${f.status === "done" ? "rgba(34,197,94,0.2)" : f.status === "error" ? "rgba(239,68,68,0.2)" : "var(--border)"}`,
            }}>
              <span style={{ fontSize: 13 }}>{typeConfig.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{f.name}</div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>{fmtSize(f.size)}</div>
                {f.status === "uploading" && (
                  <div style={{ marginTop: 3, height: 2, background: "var(--border)", borderRadius: 1, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${f.progress}%`, background: "var(--accent)", transition: "width 0.3s" }} />
                  </div>
                )}
                {f.status === "error" && <div style={{ fontSize: 10, color: "var(--danger)", marginTop: 2 }}>✗ {f.error}</div>}
              </div>
              {f.status === "idle"      && <span className="badge badge-gray"    style={{ fontSize: 10 }}>Pendente</span>}
              {f.status === "uploading" && <span className="spinner" style={{ width: 12, height: 12 }} />}
              {f.status === "done"      && <span className="badge badge-success" style={{ fontSize: 10 }}>✓</span>}
              {f.status === "error"     && <span className="badge badge-danger"  style={{ fontSize: 10 }}>Erro</span>}
              {f.status !== "uploading" && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveFile(typeConfig.id, f.id); }}
                  style={{ background: "none", color: "var(--muted)", fontSize: 14, padding: 0, flexShrink: 0 }}
                >×</button>
              )}
            </div>
          ))}
        </div>
      )}

      {(idle.length > 0 || errors.length > 0) && (
        <button
          className="btn btn-primary btn-sm"
          style={{ width: "100%" }}
          onClick={() => onUploadAll(typeConfig.id)}
          disabled={uploading}
        >
          {uploading ? <><span className="spinner" /> Enviando...</> : `☁️ Enviar ${idle.length + errors.length}`}
        </button>
      )}
    </div>
  );
}

function AccountMonitorCard({ acc, queueItems }) {
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
          <div style={{ fontSize: 13, fontWeight: 700 }}>@{acc.username}</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
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

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function Warmup() {
  const { accounts } = useAccounts();

  const [files,        setFiles]        = useState({ reels: [], feed: [], stories: [] });
  const [uploading,    setUploading]    = useState(false);
  const [bulkCaptions, setBulkCaptions] = useState("");
  const [captionMode,  setCaptionMode]  = useState("roundrobin");
  const [startDate,    setStartDate]    = useState(() => new Date().toISOString().slice(0, 10));
  const [distribution, setDistribution] = useState("roundrobin");
  const [useNewOnly,   setUseNewOnly]   = useState(true);
  const [dayConfig,    setDayConfig]    = useState(WARMUP_PRESET_2D.days);
  const [queue,        setQueue]        = useState([]);
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [dbQueue,      setDbQueue]      = useState([]);
  const [tab,          setTab]          = useState("upload");

  const eligibleAccounts = useMemo(
    () => accounts.filter((a) => !useNewOnly || isNewAccount(a)),
    [accounts, useNewOnly]
  );

  useEffect(() => {
    if (tab === "monitor") {
      dbGetAll("queue").then((q) => setDbQueue(q.filter((x) => x.warmup)));
    }
  }, [tab]);

  const addFiles = useCallback((typeId, newFiles) => {
    const entries = Array.from(newFiles).map((file) => ({
      id: `${typeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file, name: file.name, size: file.size,
      status: "idle", progress: 0, url: "", error: "", typeId,
    }));
    setFiles((prev) => ({ ...prev, [typeId]: [...(prev[typeId] || []), ...entries] }));
  }, []);

  const removeFile = useCallback((typeId, fileId) => {
    setFiles((prev) => ({ ...prev, [typeId]: prev[typeId].filter((f) => f.id !== fileId) }));
  }, []);

  const uploadAll = useCallback(async (typeId) => {
    const pending = (files[typeId] || []).filter((f) => f.status === "idle" || f.status === "error");
    if (!pending.length) return;
    setUploading(true);
    for (const entry of pending) {
      setFiles((prev) => ({ ...prev, [typeId]: prev[typeId].map((f) => f.id === entry.id ? { ...f, status: "uploading", progress: 0, error: "" } : f) }));
      try {
        const url = await uploadFile(entry.file, (progress) => {
          setFiles((prev) => ({ ...prev, [typeId]: prev[typeId].map((f) => f.id === entry.id ? { ...f, progress } : f) }));
        });
        setFiles((prev) => ({ ...prev, [typeId]: prev[typeId].map((f) => f.id === entry.id ? { ...f, status: "done", url, progress: 100 } : f) }));
      } catch (err) {
        setFiles((prev) => ({ ...prev, [typeId]: prev[typeId].map((f) => f.id === entry.id ? { ...f, status: "error", error: err.message } : f) }));
      }
    }
    setUploading(false);
  }, [files]);

  const stats = useMemo(() => {
    const count = (t, s) => (files[t] || []).filter((f) => f.status === s).length;
    return {
      reelsDone:    count("reels",   "done"),
      feedDone:     count("feed",    "done"),
      storiesDone:  count("stories", "done"),
      totalDone:    ["reels","feed","stories"].reduce((s, t) => s + count(t, "done"), 0),
      totalPending: ["reels","feed","stories"].reduce((s, t) => s + count(t, "idle") + count(t, "error"), 0),
    };
  }, [files]);

  const reelFiles      = (files.reels || []).filter((f) => f.file);
  const parsedCaptions = useMemo(() => bulkCaptions.split("\n").map((l) => l.trim()).filter(Boolean), [bulkCaptions]);

  const generateQueue = useCallback(() => {
    if (!stats.totalDone) { alert("Faça o upload de pelo menos 1 mídia antes de gerar a fila."); return; }
    if (!eligibleAccounts.length) { alert("Nenhuma conta elegível encontrada."); return; }
    const mediaByType = {
      reels:   (files.reels   || []).filter((f) => f.status === "done").map((f) => ({ url: f.url, name: f.name })),
      feed:    (files.feed    || []).filter((f) => f.status === "done").map((f) => ({ url: f.url, name: f.name })),
      stories: (files.stories || []).filter((f) => f.status === "done").map((f) => ({ url: f.url, name: f.name })),
    };
    const generated = buildWarmupQueue({
      accounts: eligibleAccounts, mediaByType,
      captions: parsedCaptions, captionMode,
      preset: { ...WARMUP_PRESET_2D, days: dayConfig },
      startDateStr: startDate, distribution,
    });
    setQueue(generated);
    setSaved(false);
    setTab("preview");
  }, [files, eligibleAccounts, parsedCaptions, captionMode, dayConfig, startDate, distribution, stats.totalDone]);

  const confirmQueue = useCallback(async () => {
    if (!queue.length) return;
    setSaving(true);
    try {
      for (const item of queue) await dbPut("queue", item);
      window.dispatchEvent(new CustomEvent("sw:queue-update"));
      setSaved(true);
      setTab("monitor");
      const q = await dbGetAll("queue");
      setDbQueue(q.filter((x) => x.warmup));
    } catch (err) {
      alert(`Erro ao salvar: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [queue]);

  const updateDayConfig = (dayIdx, key, value) => {
    setDayConfig((prev) => {
      const next = [...prev];
      next[dayIdx] = { ...next[dayIdx], [key]: value };
      return next;
    });
  };

  const previewStats = useMemo(() => {
    const byAcc  = {};
    const byType = { reels: 0, feed: 0, stories: 0 };
    queue.forEach((s) => {
      byAcc[s.username] = (byAcc[s.username] || 0) + 1;
      if (byType[s.mediaCategory] !== undefined) byType[s.mediaCategory]++;
    });
    return { byAcc, byType, total: queue.length };
  }, [queue]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="page" style={{ maxWidth: 980 }}>

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">🔥 Aquecimento de Contas</h1>
          <p className="page-subtitle">
            Aquece contas novas em 2 dias com Reels, Feed e Stories — proteção máxima e agendamento inteligente.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          {[
            { icon: "👥", value: eligibleAccounts.length, label: "contas novas",   color: "var(--accent)"  },
            { icon: "📁", value: stats.totalDone,          label: "mídias prontas", color: "var(--success)" },
            { icon: "📅", value: queue.length,             label: "na fila",        color: "var(--warning)" },
          ].map(({ icon, value, label, color }) => (
            <div key={label} className="card card-sm" style={{ textAlign: "center", minWidth: 72 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
              <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 1 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 24, background: "var(--bg2)", padding: 4, borderRadius: 12, width: "fit-content", overflowX: "auto" }}>
        {TABS.map(({ id, icon, label }) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: "8px 14px", borderRadius: 9, fontSize: 12, fontWeight: tab === id ? 700 : 400,
            background: tab === id ? "var(--accent)" : "transparent",
            color: tab === id ? "#fff" : "var(--muted)",
            border: "none", cursor: "pointer", whiteSpace: "nowrap",
            display: "flex", alignItems: "center", gap: 5, transition: "all 0.15s",
          }}>
            <span style={{ fontSize: 13 }}>{icon}</span>
            {label}
            {id === "preview" && queue.length > 0 && !saved && (
              <span style={{ fontSize: 10, fontWeight: 800, padding: "1px 6px", background: "rgba(255,255,255,0.25)", borderRadius: 20 }}>
                {queue.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══ TAB: Upload ══════════════════════════════════════════════════════════ */}
      {tab === "upload" && (
        <div>
          <div style={{
            padding: "12px 16px", borderRadius: 10, marginBottom: 20,
            background: "rgba(124,92,252,0.06)", border: "1px solid rgba(124,92,252,0.2)",
            fontSize: 12, color: "var(--muted)", display: "flex", gap: 10,
          }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>💡</span>
            <div>
              <b style={{ color: "var(--text)" }}>Estratégia:</b> priorize Reels (maior alcance orgânico),
              adicione Feeds para credibilidade do perfil e Stories para engajamento diário.
              Cada conta recebe a distribuição proporcional ao plano configurado.
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginBottom: 20 }}>
            {MEDIA_TYPES.map((typeConfig) => (
              <div key={typeConfig.id} className="card">
                <MediaUploadZone
                  typeConfig={typeConfig}
                  files={files}
                  onAddFiles={addFiles}
                  onRemoveFile={removeFile}
                  onUploadAll={uploadAll}
                  uploading={uploading}
                />
              </div>
            ))}
          </div>

          {reelFiles.length > 0 && <ReelChecklist reels={reelFiles} sanitizedIds={[]} />}

          {stats.totalDone > 0 && (
            <div style={{
              marginTop: 20, padding: "14px 18px", borderRadius: 12,
              background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)",
              display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10,
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>✅ {stats.totalDone} mídia{stats.totalDone > 1 ? "s" : ""} prontas</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                  🎬 {stats.reelsDone} Reels · 🖼 {stats.feedDone} Feed · ⭕ {stats.storiesDone} Stories
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setTab("captions")}>💬 Legendas</button>
                <button className="btn btn-primary btn-sm" onClick={() => setTab("config")}>⚙️ Configurar →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ TAB: Legendas ════════════════════════════════════════════════════════ */}
      {tab === "captions" && (
        <div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Exemplos por categoria
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[
                { label: "🔥 Motivacional",
                  lines: ["Cada dia é uma nova oportunidade de ser melhor 💪 #motivação #crescimento","Não desista. O começo é sempre o mais difícil 🚀 #foco #sucesso","Acredite no processo, os resultados vêm ✨ #mindset #evolução"] },
                { label: "💰 Vendas",
                  lines: ["Promoção exclusiva só hoje! Aproveite 🔥 #oferta #desconto","Qualidade que você merece, preço que cabe no bolso 💎 #qualidade","Últimas unidades disponíveis — corre! 🏃 #limitado #exclusivo"] },
                { label: "❤️ Engajamento",
                  lines: ["Me conta nos comentários: qual é o seu plano para hoje? 👇 #comunidade","Salva esse post para não esquecer! ⭐ #dica #conteúdo","Compartilha com quem precisa ver isso agora 🙌 #compartilha"] },
                { label: "🎯 Viral",
                  lines: ["Isso que você não te contaram sobre 👀 #segredo #viral","POV: quando você finalmente descobre o truque 😮 #pov #relatable","Quem mais passou por isso? 😅 #reels #fyp"] },
              ].map(({ label, lines }) => (
                <button key={label} className="btn btn-ghost btn-xs" onClick={() => setBulkCaptions(lines.join("\n"))}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <BulkCaptions
            value={bulkCaptions}
            onChange={setBulkCaptions}
            mode={captionMode}
            onModeChange={setCaptionMode}
            previewCount={Math.min(stats.totalDone || 3, 6)}
          />

          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary btn-sm" onClick={() => setTab("config")}>⚙️ Ir para Configuração →</button>
          </div>
        </div>
      )}

      {/* ══ TAB: Configuração ════════════════════════════════════════════════════ */}
      {tab === "config" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Preset ativo */}
          <div className="card" style={{ borderColor: "rgba(124,92,252,0.3)", background: "rgba(124,92,252,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>🚀</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{WARMUP_PRESET_2D.label}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{WARMUP_PRESET_2D.desc}</div>
              </div>
              <span className="badge badge-purple">Ativo</span>
            </div>
          </div>

          {/* Seleção de contas */}
          <div className="card">
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>👥 Contas para Aquecimento</div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textTransform: "none", letterSpacing: 0, fontSize: 13, color: "var(--text)", marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={useNewOnly}
                onChange={(e) => setUseNewOnly(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
              />
              Usar apenas contas novas (menos de {NEW_ACCOUNT_DAYS} dias)
            </label>

            {eligibleAccounts.length === 0 ? (
              <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", fontSize: 12, color: "var(--warning)" }}>
                ⚠️ Nenhuma conta elegível. {useNewOnly ? "Desmarque o filtro ou aguarde contas novas." : "Conecte contas primeiro."}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 8 }}>
                {eligibleAccounts.map((acc) => {
                  const day = warmupDay(acc.connected_at || new Date().toISOString());
                  return (
                    <div key={acc.id} style={{ padding: "8px 12px", borderRadius: 8, background: "var(--bg3)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: isNewAccount(acc) ? "var(--success)" : "var(--muted)", flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{acc.username}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>Dia {day}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Configurações gerais */}
          <div className="card">
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 14 }}>⚙️ Configurações Gerais</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label>Data de início</label>
                <input
                  type="date"
                  value={startDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label>Distribuição de mídias</label>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  {[{ id: "roundrobin", label: "🔄 Round-robin" }, { id: "random", label: "🎲 Aleatório" }].map(({ id, label }) => (
                    <button key={id} onClick={() => setDistribution(id)} style={{
                      flex: 1, padding: "8px 10px", borderRadius: 8, fontSize: 11,
                      border: `1px solid ${distribution === id ? "var(--accent)" : "var(--border)"}`,
                      background: distribution === id ? "rgba(124,92,252,0.1)" : "var(--bg3)",
                      color: distribution === id ? "var(--accent-light)" : "var(--muted)",
                      fontWeight: distribution === id ? 600 : 400,
                    }}>{label}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Config por dia */}
          {dayConfig.map((dayPlan, dayIdx) => (
            <div key={dayPlan.day} className="card">
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14, color: "var(--accent-light)" }}>
                📅 {dayPlan.label}
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Posts por tipo</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {[
                    { key: "reels",   icon: "🎬", label: "Reels"   },
                    { key: "feed",    icon: "🖼",  label: "Feed"    },
                    { key: "stories", icon: "⭕",  label: "Stories" },
                  ].map(({ key, icon, label }) => (
                    <div key={key}>
                      <label style={{ textTransform: "none", letterSpacing: 0, fontSize: 12, color: "var(--text2)", display: "flex", alignItems: "center", gap: 4 }}>
                        {icon} {label}
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={15}
                        value={dayPlan[key]}
                        onChange={(e) => updateDayConfig(dayIdx, key, parseInt(e.target.value) || 0)}
                        style={{ marginTop: 4 }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                {[
                  { label: "Início da janela",  key: "windowStart",    type: "time"   },
                  { label: "Fim da janela",      key: "windowEnd",      type: "time"   },
                  { label: "Intervalo mín (min)",key: "intervalMinMin", type: "number" },
                  { label: "Intervalo máx (min)",key: "intervalMinMax", type: "number" },
                ].map(({ label, key, type }) => (
                  <div key={key}>
                    <label>{label}</label>
                    <input
                      type={type}
                      value={dayPlan[key]}
                      min={type === "number" ? 30 : undefined}
                      max={type === "number" ? 360 : undefined}
                      onChange={(e) => updateDayConfig(dayIdx, key, type === "number" ? (parseInt(e.target.value) || 60) : e.target.value)}
                    />
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, background: "rgba(124,92,252,0.05)", border: "1px solid rgba(124,92,252,0.15)", fontSize: 11, color: "var(--muted)" }}>
                📊 Total por conta: <b style={{ color: "var(--text)" }}>{dayPlan.reels + dayPlan.feed + dayPlan.stories} posts</b>
                {" "}· Janela: <b style={{ color: "var(--text)" }}>{dayPlan.windowStart} – {dayPlan.windowEnd}</b>
                {" "}· Jitter: <b style={{ color: "var(--text)" }}>±40min + seg aleatórios</b>
              </div>
            </div>
          ))}

          <button
            className="btn btn-primary"
            onClick={generateQueue}
            disabled={!eligibleAccounts.length || !stats.totalDone}
            style={{ width: "100%", padding: "14px", fontSize: 14 }}
          >
            {!stats.totalDone
              ? "📤 Faça upload das mídias primeiro"
              : !eligibleAccounts.length
                ? "👥 Nenhuma conta elegível"
                : `🚀 Gerar Fila de Aquecimento — ${eligibleAccounts.length} conta(s)`}
          </button>

          <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)", fontSize: 11, color: "var(--muted)" }}>
            🛡️ <b style={{ color: "var(--warning)" }}>Proteção ativada:</b> jitter de ±40 minutos e segundos aleatórios em cada slot para evitar padrões detectáveis.
            Sanitização de metadados aplicada automaticamente no momento da publicação via publish.mjs.
          </div>
        </div>
      )}

      {/* ══ TAB: Preview da Fila ═════════════════════════════════════════════════ */}
      {tab === "preview" && (
        <div>
          {queue.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "var(--muted)" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Fila vazia</div>
              <div style={{ fontSize: 12 }}>Vá para Configuração e clique em "Gerar Fila de Aquecimento".</div>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 16 }} onClick={() => setTab("config")}>⚙️ Ir para Configuração</button>
            </div>
          ) : (
            <>
              {/* Resumo */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginBottom: 20 }}>
                {[
                  { icon: "📊", label: "Total",   value: previewStats.total,               color: "var(--accent)"  },
                  { icon: "🎬", label: "Reels",   value: previewStats.byType.reels,         color: "var(--info)"    },
                  { icon: "🖼",  label: "Feed",    value: previewStats.byType.feed,          color: "var(--success)" },
                  { icon: "⭕",  label: "Stories", value: previewStats.byType.stories,       color: "var(--warning)" },
                  { icon: "👥", label: "Contas",  value: Object.keys(previewStats.byAcc).length, color: "var(--text2)" },
                ].map(({ icon, label, value, color }) => (
                  <div key={label} className="card card-sm" style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, marginBottom: 2 }}>{icon}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>{label}</div>
                  </div>
                ))}
              </div>

              {/* Por conta */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Distribuição por conta</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {Object.entries(previewStats.byAcc).map(([username, count]) => (
                    <div key={username} style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, background: "rgba(124,92,252,0.1)", border: "1px solid rgba(124,92,252,0.25)", color: "var(--accent-light)" }}>
                      @{username} · <b>{count}</b>
                    </div>
                  ))}
                </div>
              </div>

              {/* Por dia */}
              {[1, 2].map((day) => {
                const daySlots = queue.filter((s) => s.scheduledDay === day);
                if (!daySlots.length) return null;
                return (
                  <div key={day} style={{ marginBottom: 20 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "var(--accent-light)", marginBottom: 10 }}>
                      📅 Dia {day} — {daySlots.length} post(s)
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 300, overflowY: "auto" }}>
                      {daySlots.map((s) => {
                        const typeIcon = { reels: "🎬", feed: "🖼", stories: "⭕" }[s.mediaCategory] || "📎";
                        return (
                          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, background: "var(--bg2)", border: "1px solid var(--border)" }}>
                            <span style={{ fontSize: 16, flexShrink: 0 }}>{typeIcon}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>@{s.username}</div>
                              <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {s.mediaName || s.mediaUrl.split("/").pop()}
                              </div>
                              {s.caption && (
                                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  💬 {s.caption.slice(0, 60)}{s.caption.length > 60 ? "..." : ""}
                                </div>
                              )}
                            </div>
                            <div style={{ flexShrink: 0, textAlign: "right" }}>
                              <span className={`badge badge-${s.mediaCategory === "reels" ? "info" : s.mediaCategory === "feed" ? "success" : "warning"}`} style={{ fontSize: 10, display: "block", marginBottom: 4 }}>
                                {s.postType}
                              </span>
                              <div style={{ fontSize: 11, fontWeight: 600 }}>
                                {new Date(s.scheduledAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <button className="btn btn-ghost" onClick={() => { setQueue([]); setTab("config"); }}>← Refazer</button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={confirmQueue} disabled={saving || saved}>
                  {saving ? <><span className="spinner" /> Salvando...</> : saved ? "✅ Agendado!" : `🚀 Confirmar ${queue.length} agendamentos`}
                </button>
              </div>

              {saved && (
                <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 10, textAlign: "center", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)", fontSize: 12, color: "var(--success)" }}>
                  ✅ {queue.length} posts agendados! O Service Worker publicará automaticamente nos horários programados.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══ TAB: Monitor ═════════════════════════════════════════════════════════ */}
      {tab === "monitor" && (
        <div>
          {dbQueue.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginBottom: 20 }}>
              {[
                { label: "Total",      value: dbQueue.length,                                       color: "var(--text)"    },
                { label: "Publicados", value: dbQueue.filter((q) => q.status === "done").length,    color: "var(--success)" },
                { label: "Pendentes",  value: dbQueue.filter((q) => q.status === "pending").length, color: "var(--warning)" },
                { label: "Erro",       value: dbQueue.filter((q) => q.status === "error").length,   color: "var(--danger)"  },
              ].map(({ label, value, color }) => (
                <div key={label} className="card card-sm" style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
                </div>
              ))}
            </div>
          )}

          {accounts.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--muted)", fontSize: 13 }}>Nenhuma conta conectada.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {accounts.map((acc) => (
                <AccountMonitorCard key={acc.id} acc={acc} queueItems={dbQueue} />
              ))}
            </div>
          )}

          <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: 10, background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)", fontSize: 11, color: "var(--muted)" }}>
            📡 <b style={{ color: "var(--warning)" }}>Detecção de Shadowban:</b> queda acima de 70% nas views indica possível restrição.
            Dados coletados via Instagram Graph API. Se detectado, pause o aquecimento por 24–48h.
          </div>

          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={async () => {
            const q = await dbGetAll("queue");
            setDbQueue(q.filter((x) => x.warmup));
          }}>
            🔄 Recarregar dados
          </button>
        </div>
      )}
    </div>
  );
}
