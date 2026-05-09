// Warmup.jsx
import { uploadFile, warmupDay, isNewAccount, buildWarmupQueue, shadowScore, fmtSize, NEW_ACCOUNT_DAYS } from "../components/warmup/WarmupUtils.js";
import MediaUploadZone from "../components/warmup/WarmupMediaUploadZone.jsx";
import AccountMonitorCard from "../components/warmup/WarmupAccountMonitorCard.jsx";
// Foco: aquecimento rápido em 2 dias, Reels-first, proteção de contas novas
// Tabs: Upload de Mídias | Legendas | Configuração | Preview da Fila | Monitor

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useAccounts } from "../useAccounts.js";
import { dbPut, dbGetAll } from "../useDB.js";
import BulkCaptions, { pickCaption } from "../components/BulkCaptions.jsx";
import ReelChecklist from "../components/ReelChecklist.jsx";

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function Warmup() {
  const { accounts, addAccounts, reloadAccounts } = useAccounts();

  const [files,        setFiles]        = useState({ reels: [], feed: [], stories: [] });
  const [uploading,    setUploading]    = useState(false);
  const [bulkCaptions, setBulkCaptions] = useState("");
  const [captionMode,  setCaptionMode]  = useState("roundrobin");
  const [startDate,    setStartDate]    = useState(() => new Date().toISOString().slice(0, 10));
  const [distribution, setDistribution] = useState("roundrobin");
  const [useNewOnly,   setUseNewOnly]   = useState(true);
  const [selectedAccIds, setSelectedAccIds] = useState(null); // null = todas selecionadas
  const [urlInputs,    setUrlInputs]    = useState({ reels: "", feed: "", stories: "" });
  const [dayConfig,       setDayConfig]       = useState(WARMUP_PRESET_2D.days);
  const [loopEnabled,     setLoopEnabled]     = useState(false);
  const [loopDays,        setLoopDays]        = useState(7); // quantos dias extras em loop
  const [queue,        setQueue]        = useState([]);
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);
  const [dbQueue,      setDbQueue]      = useState([]);
  const [tab,          setTab]          = useState("upload");
  const [syncingNames, setSyncingNames] = useState(false);
  const [syncResult,   setSyncResult]   = useState(null); // { updated: n, total: n }

  // Contas que passam no filtro de dias
  const eligibleAccounts = useMemo(
    () => accounts.filter((a) => !useNewOnly || isNewAccount(a)),
    [accounts, useNewOnly]
  );

  // Contas efetivamente selecionadas para o aquecimento (null = todas elegíveis)
  const selectedAccounts = useMemo(
    () => selectedAccIds === null
      ? eligibleAccounts
      : eligibleAccounts.filter((a) => selectedAccIds.includes(a.id)),
    [eligibleAccounts, selectedAccIds]
  );

  // Helpers de seleção
  const toggleAccount = (id) => {
    setSelectedAccIds((prev) => {
      const base = prev === null ? eligibleAccounts.map((a) => a.id) : [...prev];
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });
  };
  const selectAll  = () => setSelectedAccIds(null);
  const selectNone = () => setSelectedAccIds([]);

  // Sincroniza username/foto de todas as contas elegíveis via account-insights
  // NOTA: definida APÓS eligibleAccounts para evitar referência antes da inicialização
  const syncUsernames = useCallback(async () => {
    if (syncingNames || eligibleAccounts.length === 0) return;
    setSyncingNames(true);
    setSyncResult(null);
    let updated = 0;

    for (const acc of eligibleAccounts) {
      if (!acc.access_token) continue;
      try {
        const res  = await fetch("/api/account-insights", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ instagram_id: acc.id, access_token: acc.access_token }),
        });
        const json = await res.json();
        if (res.ok && !json.error && json.username) {
          const changed = json.username !== acc.username || json.profile_picture !== acc.profile_picture;
          if (changed) {
            await addAccounts([{
              ...acc,
              username:        json.username,
              name:            json.name            || acc.name,
              profile_picture: json.profile_picture || acc.profile_picture,
              followers_count: json.followers_count ?? acc.followers_count,
            }]);
            updated++;
          }
        }
      } catch { /* ignora falhas individuais */ }
    }

    await reloadAccounts();
    setSyncResult({ updated, total: eligibleAccounts.length });
    setSyncingNames(false);
  }, [syncingNames, eligibleAccounts, addAccounts, reloadAccounts]);

  useEffect(() => {
    if (tab === "monitor") {
      dbGetAll("queue").then((q) => setDbQueue(q.filter((x) => x.warmup)));
    }
  }, [tab]);

  const addFiles = useCallback((typeId, newFiles) => {
    const entries = Array.from(newFiles).map((file) => ({
      id: `${typeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file, name: file.name, size: file.size,
      status: "idle", progress: 0, url: "", error: "", typeId, sanitizationReport: null,
    }));
    setFiles((prev) => ({ ...prev, [typeId]: [...(prev[typeId] || []), ...entries] }));
  }, []);

  const removeFile = useCallback((typeId, fileId) => {
    setFiles((prev) => ({ ...prev, [typeId]: prev[typeId].filter((f) => f.id !== fileId) }));
  }, []);

  // Adiciona mídias a partir de URLs externas (já prontas, sem upload)
  const addFilesByUrl = useCallback((typeId, urls) => {
    const entries = urls.map((url) => {
      const name = url.split("/").pop().split("?")[0] || "media";
      return {
        id:       `${typeId}-url-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file:     null,
        name,
        size:     0,
        status:   "done",   // já está pronta — não precisa de upload
        sanitizationReport: null,
        progress: 100,
        url,
        error:    "",
        typeId,
        fromUrl:  true,
      };
    });
    setFiles((prev) => ({ ...prev, [typeId]: [...(prev[typeId] || []), ...entries] }));
  }, []);

  // Atualiza o campo de texto de URL por tipo
  const updateUrlInput = useCallback((typeId, value) => {
    setUrlInputs((prev) => ({ ...prev, [typeId]: value }));
  }, []);

  const uploadAll = useCallback(async (typeId) => {
    const pending = (files[typeId] || []).filter((f) => f.status === "idle" || f.status === "error");
    if (!pending.length) return;
    setUploading(true);

    // Marca todos como "uploading" de uma vez
    setFiles((prev) => ({
      ...prev,
      [typeId]: prev[typeId].map((f) =>
        pending.find((p) => p.id === f.id)
          ? { ...f, status: "uploading", progress: 0, error: "", sanitizationReport: null }
          : f
      ),
    }));

    // Upload paralelo — máximo 50 simultâneos
    const CONCURRENCY = 50;
    const uploadOne = async (entry) => {
      try {
        let sanitizationReport = null;
        const url = await uploadFile(
          entry.file,
          (progress) => {
            setFiles((prev) => ({ ...prev, [typeId]: prev[typeId].map((f) => f.id === entry.id ? { ...f, progress } : f) }));
          },
          (report) => {
            sanitizationReport = report;
            setFiles((prev) => ({ ...prev, [typeId]: prev[typeId].map((f) => f.id === entry.id ? { ...f, sanitizationReport: report } : f) }));
          }
        );
        setFiles((prev) => ({ ...prev, [typeId]: prev[typeId].map((f) => f.id === entry.id ? { ...f, status: "done", url, progress: 100, sanitizationReport } : f) }));
      } catch (err) {
        setFiles((prev) => ({ ...prev, [typeId]: prev[typeId].map((f) => f.id === entry.id ? { ...f, status: "error", error: err.message } : f) }));
      }
    };

    // Processa em lotes de CONCURRENCY
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      await Promise.all(pending.slice(i, i + CONCURRENCY).map(uploadOne));
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
    if (!selectedAccounts.length) { alert("Selecione pelo menos uma conta para o aquecimento."); return; }
    const mediaByType = {
      reels:   (files.reels   || []).filter((f) => f.status === "done").map((f) => ({ url: f.url, name: f.name })),
      feed:    (files.feed    || []).filter((f) => f.status === "done").map((f) => ({ url: f.url, name: f.name })),
      stories: (files.stories || []).filter((f) => f.status === "done").map((f) => ({ url: f.url, name: f.name })),
    };
    const generated = buildWarmupQueue({
      accounts: selectedAccounts, mediaByType,
      captions: parsedCaptions, captionMode,
      preset: { ...WARMUP_PRESET_2D, days: dayConfig },
      startDateStr: startDate, distribution,
      loopEnabled, loopDays,
    });
    setQueue(generated);
    setSaved(false);
    setTab("preview");
  }, [files, selectedAccounts, parsedCaptions, captionMode, dayConfig, startDate, distribution, stats.totalDone, loopEnabled, loopDays]);

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
    // Filtrar reels bloqueados (< 5s) antes de agendar
    const MIN_REEL_DURATION = 5;
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
            { icon: "👥", value: selectedAccounts.length, label: "contas novas",   color: "var(--accent)"  },
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
                  urlInput={urlInputs[typeConfig.id]}
                  onUrlInputChange={updateUrlInput}
                  onAddUrl={addFilesByUrl}
                />
              </div>
            ))}
          </div>

          {reelFiles.length > 0 && <ReelChecklist reels={reelFiles} sanitizedIds={reelFiles.filter(f => f.sanitizationReport && !f.sanitizationReport.error).map(f => f.id)} onRemove={(id) => removeFile("reels", id)} />}

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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>👥 Contas para Aquecimento</div>
              <button
                className="btn btn-ghost btn-xs"
                onClick={syncUsernames}
                disabled={syncingNames || eligibleAccounts.length === 0}
                title="Atualizar usernames e fotos das contas via Meta API"
                style={{ display: "flex", alignItems: "center", gap: 5 }}
              >
                {syncingNames
                  ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Sincronizando...</>
                  : "↻ Sincronizar nomes"}
              </button>
            </div>

            {/* Resultado da sincronização */}
            {syncResult && (
              <div style={{
                marginBottom: 10, padding: "6px 12px", borderRadius: 7, fontSize: 11,
                background: syncResult.updated > 0 ? "rgba(34,197,94,0.08)" : "var(--bg3)",
                border: `1px solid ${syncResult.updated > 0 ? "rgba(34,197,94,0.25)" : "var(--border)"}`,
                color: syncResult.updated > 0 ? "var(--success)" : "var(--muted)",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                {syncResult.updated > 0
                  ? `✓ ${syncResult.updated} conta(s) atualizada(s) de ${syncResult.total}`
                  : `✓ Todos os usernames já estão atualizados (${syncResult.total} conta(s))`}
                <button onClick={() => setSyncResult(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }}>×</button>
              </div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textTransform: "none", letterSpacing: 0, fontSize: 13, color: "var(--text)", marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={useNewOnly}
                onChange={(e) => setUseNewOnly(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
              />
              Usar apenas contas novas ({NEW_ACCOUNT_DAYS} dias ou menos)
            </label>

            {eligibleAccounts.length === 0 ? (
              <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", fontSize: 12, color: "var(--warning)" }}>
                ⚠️ Nenhuma conta elegível. {useNewOnly ? "Desmarque o filtro ou aguarde contas novas." : "Conecte contas primeiro."}
              </div>
            ) : (
              <>
                {/* Botões de seleção rápida */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    {selectedAccounts.length} de {eligibleAccounts.length} selecionada{eligibleAccounts.length !== 1 ? "s" : ""}
                  </span>
                  <button className="btn btn-ghost btn-xs" onClick={selectAll}
                    style={{ color: selectedAccIds === null ? "var(--accent-light)" : undefined }}>
                    ✓ Todas
                  </button>
                  <button className="btn btn-ghost btn-xs" onClick={selectNone}>
                    ✕ Nenhuma
                  </button>
                </div>

                {/* Grid de contas com checkbox */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 8 }}>
                  {eligibleAccounts.map((acc) => {
                    const day = warmupDay(acc.connected_at || new Date().toISOString());
                    const isSelected = selectedAccIds === null || selectedAccIds.includes(acc.id);
                    return (
                      <div
                        key={acc.id}
                        onClick={() => toggleAccount(acc.id)}
                        style={{
                          padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                          background: isSelected ? "rgba(124,92,252,0.08)" : "var(--bg3)",
                          border: `1px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
                          display: "flex", alignItems: "center", gap: 8,
                          transition: "all 0.12s",
                          opacity: isSelected ? 1 : 0.5,
                        }}
                      >
                        {/* Checkbox visual */}
                        <div style={{
                          width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                          border: `2px solid ${isSelected ? "var(--accent)" : "var(--border2)"}`,
                          background: isSelected ? "var(--accent)" : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          transition: "all 0.12s",
                        }}>
                          {isSelected && <span style={{ color: "#fff", fontSize: 10, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                        </div>
                        {/* Avatar com foto ou inicial */}
                        <div style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, overflow: "hidden", border: "1px solid var(--border2)" }}>
                          {acc.profile_picture
                            ? <img src={acc.profile_picture} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => { e.target.style.display = "none"; }} />
                            : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg, var(--accent), #9b4dfc)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff" }}>
                                {(acc.nickname || acc.name || acc.username || "?")[0].toUpperCase()}
                              </div>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {acc.nickname || acc.name || `@${acc.username}`}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--muted)" }}>@{acc.username} · Dia {day}</div>
                        </div>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: isNewAccount(acc) ? "var(--success)" : "var(--muted)", flexShrink: 0 }} />
                      </div>
                    );
                  })}
                </div>
              </>
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

          {/* ── Card de Loop ── */}
          <div className="card" style={{
            borderColor: loopEnabled ? "rgba(124,92,252,0.35)" : "var(--border)",
            background: loopEnabled ? "rgba(124,92,252,0.04)" : "var(--bg2)",
            transition: "all 0.2s",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: loopEnabled ? 16 : 0 }}>
              <span style={{ fontSize: 20 }}>🔁</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Loop de Manutenção</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                  Repete o Dia 3 por quantos dias você quiser após o aquecimento
                </div>
              </div>
              <div
                onClick={() => setLoopEnabled((p) => !p)}
                style={{
                  width: 44, height: 24, borderRadius: 12, cursor: "pointer",
                  background: loopEnabled ? "var(--accent)" : "var(--border2)",
                  position: "relative", transition: "background 0.2s", flexShrink: 0,
                }}
              >
                <div style={{
                  position: "absolute", top: 3, left: loopEnabled ? 22 : 2,
                  width: 18, height: 18, borderRadius: "50%", background: "#fff",
                  transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }} />
              </div>
            </div>

            {loopEnabled && (
              <div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
                  Quantos dias extras de manutenção (além dos 3 do aquecimento)?
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {[3, 5, 7, 10, 14, 21, 30].map((d) => (
                    <button
                      key={d}
                      onClick={() => setLoopDays(d)}
                      className={`btn btn-sm ${loopDays === d ? "btn-primary" : "btn-ghost"}`}
                      style={{ fontSize: 12, padding: "6px 14px" }}
                    >
                      {d}d
                    </button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={loopDays}
                    onChange={(e) => setLoopDays(Math.max(1, Math.min(90, parseInt(e.target.value) || 1)))}
                    style={{ width: 70, padding: "6px 10px", fontSize: 12 }}
                    placeholder="Custom"
                  />
                </div>
                <div style={{
                  padding: "10px 14px", borderRadius: 8,
                  background: "rgba(124,92,252,0.06)", border: "1px solid rgba(124,92,252,0.2)",
                  fontSize: 12, color: "var(--muted)",
                }}>
                  📅 Aquecimento: <b style={{ color: "var(--text)" }}>3 dias</b>
                  {" "}+ Loop: <b style={{ color: "var(--accent-light)" }}>{loopDays} dias</b>
                  {" "}= <b style={{ color: "var(--text)" }}>{3 + loopDays} dias no total</b>
                  <div style={{ marginTop: 4 }}>
                    🔁 O Dia 3 (Manutenção) se repete <b style={{ color: "var(--text)" }}>{loopDays}x</b> com os mesmos posts e horários
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            className="btn btn-primary"
            onClick={generateQueue}
            disabled={!selectedAccounts.length || !stats.totalDone}
            style={{ width: "100%", padding: "14px", fontSize: 14 }}
          >
            {!stats.totalDone
              ? "📤 Faça upload das mídias primeiro"
              : !selectedAccounts.length
                ? "👥 Nenhuma conta elegível"
                : `🚀 Gerar Fila de Aquecimento — ${selectedAccounts.length} conta(s)`}
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

              {/* Por dia — dinâmico para suportar loop */}
              {Array.from(new Set(queue.map((s) => s.scheduledDay))).sort((a, b) => a - b).map((day) => {
                const daySlots = queue.filter((s) => s.scheduledDay === day);
                const isLoop   = day > WARMUP_PRESET_2D.days.length;
                return (
                  <div key={day} style={{ marginBottom: 20 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: isLoop ? "var(--success)" : "var(--accent-light)", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                    {isLoop ? "🔁" : "📅"} Dia {day} — {daySlots.length} post(s)
                    {isLoop && <span className="badge badge-success" style={{ fontSize: 10 }}>Loop</span>}
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
