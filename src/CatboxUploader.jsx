// CatboxUploader.jsx — upload direto para R2 via presigned URL
// com sanitização client-side + progresso visual de AMBAS as etapas
import { useState, useRef, useCallback } from "react";
import { sanitizeFile } from "./sanitizeClient.js";

function formatSize(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isVideo(name) {
  return ["mp4", "mov", "avi", "mkv", "webm"].includes(name.split(".").pop().toLowerCase());
}

// ─── Upload com sanitização e progresso ──────────────────────────────────────
// Fases:
//   0–5%   : preparação / presign
//   5–50%  : sanitização (metadados)
//   50–98% : upload para R2
//   100%   : concluído
// Detecta MIME correto — file.type pode estar vazio em drag-and-drop
function detectMime(file) {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const ext = file.name.split(".").pop().toLowerCase();
  const MAP = {
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    webp: "image/webp", gif: "image/gif",
  };
  return MAP[ext] || "video/mp4";
}

async function uploadToR2WithSanitize(file, onProgress, onSanitizeProgress, onSanitized) {
  // Fase 1: Presign (0→5%)
  onProgress({ upload: 0, sanitize: 0, phase: "presign" });

  const mimeType = detectMime(file);
  const presignRes = await fetch("/api/r2-presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, mimeType }),
  });

  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({}));
    throw new Error(err.error || `Erro ao gerar URL (${presignRes.status})`);
  }

  const { presignedUrl, publicUrl } = await presignRes.json();
  onProgress({ upload: 0, sanitize: 0, phase: "sanitizing" });

  // Fase 2: Sanitização (0→100% interno, mapeado para 5%→50% na barra geral)
  let fileToUpload = file;
  let sanitizeReport = null;
  try {
    // Simular progresso de sanitização incremental
    // (sanitizeFile é síncrona internamente — simulamos os passos)
    onSanitizeProgress(10);
    await new Promise((r) => setTimeout(r, 30)); // yield para React renderizar

    onSanitizeProgress(35);
    await new Promise((r) => setTimeout(r, 20));

    const { file: sanitized, report } = await sanitizeFile(file);
    // Garantir MIME correto no arquivo sanitizado
    fileToUpload = sanitized.type
      ? sanitized
      : new File([sanitized], sanitized.name, { type: mimeType, lastModified: sanitized.lastModified });
    sanitizeReport = report;

    onSanitizeProgress(100);
    if (onSanitized) onSanitized(report);
  } catch (err) {
    console.warn("Sanitização falhou, usando arquivo original:", err.message);
    onSanitizeProgress(100);
    sanitizeReport = { error: err.message, supported: false };
    if (onSanitized) onSanitized(sanitizeReport);
  }

  onProgress({ upload: 0, sanitize: 100, phase: "uploading" });

  // Fase 3: Upload para R2 (0→100% interno, mapeado para 50%→98% geral)
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        onProgress({ upload: pct, sanitize: 100, phase: "uploading" });
      }
    };

    xhr.onload    = () => xhr.status === 200 ? resolve() : reject(new Error(`R2 recusou o upload (HTTP ${xhr.status})`));
    xhr.onerror   = () => reject(new Error("Erro de rede durante o upload"));
    xhr.ontimeout = () => reject(new Error("Timeout no upload"));
    xhr.timeout   = 5 * 60 * 1000;

    xhr.open("PUT", presignedUrl);
    xhr.setRequestHeader("Content-Type", mimeType); // usa mimeType detectado, não file.type
    xhr.send(fileToUpload);
  });

  onProgress({ upload: 100, sanitize: 100, phase: "done" });
  return { publicUrl, sanitizeReport };
}

// ─── Barra de progresso dupla (sanitização + upload) ─────────────────────────
function DualProgress({ sanitize, upload, phase }) {
  const isUploading  = phase === "uploading" || phase === "done";
  const isSanitizing = phase === "sanitizing" || phase === "presign";

  const sanitizeLabel = sanitize >= 100 ? "✓ Concluída" : `${sanitize}%`;
  const uploadLabel   = upload  >= 100 ? "✓ Enviado"   : upload > 0 ? `${upload}%` : "Aguardando...";

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
      {/* Sanitização */}
      <div style={{ flex: 1, minWidth: 120 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
          <span style={{ fontSize: 10, color: sanitize >= 100 ? "var(--success)" : "var(--warning)", fontWeight: 600 }}>
            🔒 Sanitização
          </span>
          <span style={{ fontSize: 10, color: sanitize >= 100 ? "var(--success)" : "var(--warning)", fontWeight: 700 }}>
            {sanitizeLabel}
          </span>
        </div>
        <div style={{ height: 4, background: "var(--bg)", borderRadius: 3, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 3,
            width: `${sanitize}%`,
            background: sanitize >= 100
              ? "linear-gradient(90deg, var(--success), #22c55e)"
              : "linear-gradient(90deg, var(--warning), #f59e0b)",
            transition: "width 0.3s ease",
          }} />
        </div>
      </div>

      {/* Upload */}
      <div style={{ flex: 1, minWidth: 120 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
          <span style={{ fontSize: 10, color: upload >= 100 ? "var(--success)" : isUploading ? "var(--accent-light)" : "var(--muted)", fontWeight: 600 }}>
            ☁️ Upload R2
          </span>
          <span style={{ fontSize: 10, color: upload >= 100 ? "var(--success)" : isUploading ? "var(--accent-light)" : "var(--muted)", fontWeight: 700 }}>
            {uploadLabel}
          </span>
        </div>
        <div style={{ height: 4, background: "var(--bg)", borderRadius: 3, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 3,
            width: `${upload}%`,
            background: upload >= 100
              ? "linear-gradient(90deg, var(--success), #22c55e)"
              : "linear-gradient(90deg, var(--accent), #9b4dfc)",
            transition: "width 0.3s ease",
            opacity: isUploading || upload > 0 ? 1 : 0.3,
          }} />
        </div>
      </div>
    </div>
  );
}

// ─── Painel de metadados ──────────────────────────────────────────────────────
function MetadataPanel({ report, sanitizeProgress }) {
  const [open, setOpen] = useState(false);

  // Ainda sanitizando
  if (sanitizeProgress < 100) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--warning)" }}>
        <span className="spinner" style={{ width: 10, height: 10 }} />
        Lendo metadados... {sanitizeProgress}%
      </div>
    );
  }

  // Sanitização falhou ou formato não suportado
  if (!report || report.error) {
    return (
      <span style={{
        fontSize: 10, padding: "2px 8px", borderRadius: 5,
        background: "rgba(245,158,11,0.12)", color: "var(--warning)",
        border: "1px solid rgba(245,158,11,0.25)",
      }}>
        ⚠ Metadados: {report?.error || "não disponível"}
      </span>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((p) => !p)}
        style={{
          fontSize: 10, padding: "2px 8px", borderRadius: 5, cursor: "pointer",
          background: "rgba(56,189,248,0.1)", color: "var(--info)",
          border: "1px solid rgba(56,189,248,0.25)",
        }}
      >
        📋 Metadados {open ? "▲" : "▼"}
      </button>

      {open && (
        <div style={{
          position: "absolute", left: 0, top: "calc(100% + 4px)", zIndex: 20,
          background: "var(--bg2)", border: "1px solid var(--border2)",
          borderRadius: 8, padding: "10px 12px", minWidth: 220,
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)", fontSize: 11, lineHeight: 1.7,
        }}>
          <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 6, fontSize: 12 }}>
            📋 Metadados detectados
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            {[
              ["Formato",    (report.format || "—").toUpperCase()],
              ["Tamanho",   `${(report.originalSize / 1024).toFixed(0)} KB → ${(report.sanitizedSize / 1024).toFixed(0)} KB`],
              ["Diferença", `${report.sizeDiff >= 0 ? "+" : ""}${report.sizeDiff} bytes`],
              ["Tempo",     `${report.durationMs}ms`],
              ["ID único",  report.uniqueId],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ color: "var(--muted)", paddingRight: 10, whiteSpace: "nowrap", verticalAlign: "top" }}>{k}</td>
                <td style={{ color: "var(--text)", fontFamily: "monospace", wordBreak: "break-all" }}>{v}</td>
              </tr>
            ))}
          </table>
          {report.removed?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ color: "var(--muted)", marginBottom: 4 }}>Removido / injetado:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {report.removed.map((r, i) => (
                  <span key={i} style={{
                    fontSize: 10, padding: "1px 6px", borderRadius: 4,
                    background: "rgba(34,197,94,0.08)", color: "var(--success)",
                    border: "1px solid rgba(34,197,94,0.15)",
                  }}>{r}</span>
                ))}
              </div>
            </div>
          )}
          <button onClick={() => setOpen(false)} style={{ marginTop: 8, fontSize: 10, color: "var(--muted)", background: "none", border: "none", cursor: "pointer" }}>
            Fechar ×
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Badge de sanitização ─────────────────────────────────────────────────────
function SanitizeBadge({ report, progress }) {
  if (progress < 100) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--warning)" }}>
        <span className="spinner" style={{ width: 10, height: 10 }} />
        Sanitizando... {progress}%
      </div>
    );
  }
  if (!report || report.error) {
    return (
      <span style={{
        fontSize: 10, padding: "2px 8px", borderRadius: 5,
        background: "rgba(239,68,68,0.1)", color: "var(--danger)",
        border: "1px solid rgba(239,68,68,0.2)",
      }}>
        ⚠️ Sanitização parcial
      </span>
    );
  }
  return (
    <span style={{
      fontSize: 10, padding: "2px 8px", borderRadius: 5,
      background: "rgba(34,197,94,0.1)", color: "var(--success)",
      border: "1px solid rgba(34,197,94,0.2)",
    }}>
      ✅ Sanitizado · ID:{report.uniqueId}
    </span>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function CatboxUploader({ onUrlsReady }) {
  const [files,     setFiles]     = useState([]);
  const [dragging,  setDragging]  = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef();

  const addFiles = (newFiles) => {
    const entries = Array.from(newFiles).map((file) => ({
      id:                `${Date.now()}-${Math.random()}`,
      file,
      name:              file.name,
      size:              file.size,
      status:            "idle",
      // Progresso separado por fase
      sanitizeProgress:  0,   // 0–100
      uploadProgress:    { upload: 0, sanitize: 0, phase: "idle" },
      url:               "",
      error:             "",
      type:              isVideo(file.name) ? "VIDEO" : "IMAGE",
      sanitizationReport: null,
    }));
    setFiles((p) => [...p, ...entries]);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }, []);

  const onDragOver  = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const removeFile  = (id) => setFiles((p) => p.filter((f) => f.id !== id));
  const clearAll    = () => setFiles([]);

  const uploadAll = async () => {
    const pending = files.filter((f) => f.status === "idle" || f.status === "error");
    if (!pending.length) return;
    setUploading(true);

    for (const entry of pending) {
      // Resetar estado para uploading
      setFiles((p) => p.map((f) => f.id === entry.id
        ? { ...f, status: "uploading", sanitizeProgress: 0, uploadProgress: { upload: 0, sanitize: 0, phase: "presign" }, error: "", sanitizationReport: null }
        : f
      ));

      try {
        const { publicUrl, sanitizeReport } = await uploadToR2WithSanitize(
          entry.file,
          // onProgress — atualiza progresso de upload
          (prog) => setFiles((p) => p.map((f) => f.id === entry.id
            ? { ...f, uploadProgress: prog }
            : f
          )),
          // onSanitizeProgress — atualiza barra de sanitização separada
          (pct) => setFiles((p) => p.map((f) => f.id === entry.id
            ? { ...f, sanitizeProgress: pct }
            : f
          )),
          // onSanitized — salva o relatório
          (report) => setFiles((p) => p.map((f) => f.id === entry.id
            ? { ...f, sanitizationReport: report }
            : f
          )),
        );

        setFiles((p) => p.map((f) => f.id === entry.id
          ? { ...f, status: "done", url: publicUrl, sanitizeProgress: 100, uploadProgress: { upload: 100, sanitize: 100, phase: "done" } }
          : f
        ));
      } catch (err) {
        setFiles((p) => p.map((f) => f.id === entry.id
          ? { ...f, status: "error", error: err.message }
          : f
        ));
      }
    }

    setUploading(false);

    // Notificar arquivos concluídos
    setFiles((current) => {
      const done = current.filter((f) => f.status === "done");
      if (done.length > 0) {
        onUrlsReady(done.map((f) => ({
          url:                f.url,
          type:               f.type,
          name:               f.name,
          sanitizationReport: f.sanitizationReport,
        })));
      }
      return current;
    });
  };

  const doneFiles  = files.filter((f) => f.status === "done");
  const errorFiles = files.filter((f) => f.status === "error");
  const idleFiles  = files.filter((f) => f.status === "idle");

  return (
    <div>
      {/* Drop zone */}
      <div
        onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
        onClick={() => !uploading && inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--accent)" : "var(--border2)"}`,
          borderRadius: 12, padding: "24px 20px", textAlign: "center",
          cursor: uploading ? "not-allowed" : "pointer",
          background: dragging ? "rgba(124,92,252,0.08)" : "var(--bg3)",
          transition: "all 0.15s",
        }}
      >
        <div style={{ fontSize: 26, marginBottom: 8 }}>☁️</div>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
          {dragging ? "Solte para adicionar" : "Arraste ou clique"}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          Imagens (jpg, png, webp) · Vídeos (mp4, mov, webm)
        </div>
        <div style={{ fontSize: 10, color: "var(--accent-light)", marginTop: 5 }}>
          🔒 Metadados removidos automaticamente antes do upload
        </div>
        <input
          ref={inputRef} type="file" multiple accept="image/*,video/*"
          style={{ display: "none" }}
          onChange={(e) => e.target.files.length && addFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {/* Resumo */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
              {files.length} arquivo(s) · {doneFiles.length} enviado(s)
              {errorFiles.length > 0 && <span style={{ color: "var(--danger)", marginLeft: 8 }}>{errorFiles.length} erro(s)</span>}
            </div>
            <button className="btn btn-ghost btn-xs" onClick={clearAll} disabled={uploading}>Limpar</button>
          </div>

          {/* Lista de arquivos */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 400, overflowY: "auto" }}>
            {files.map((f) => (
              <div key={f.id} style={{
                padding: "10px 12px", borderRadius: 9,
                background: f.status === "done"  ? "rgba(34,197,94,0.04)"
                  : f.status === "error" ? "rgba(239,68,68,0.06)"
                  : "var(--bg3)",
                border: `1px solid ${f.status === "done" ? "rgba(34,197,94,0.2)" : f.status === "error" ? "rgba(239,68,68,0.2)" : "var(--border)"}`,
              }}>
                {/* Linha principal: ícone + nome + status */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 15, flexShrink: 0 }}>{f.type === "VIDEO" ? "🎬" : "🖼"}</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.name}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>{formatSize(f.size)}</div>
                  </div>

                  {/* Status badge */}
                  <div style={{ flexShrink: 0 }}>
                    {f.status === "idle"      && <span className="badge badge-gray" style={{ fontSize: 10 }}>Pendente</span>}
                    {f.status === "uploading" && <span className="spinner" style={{ width: 14, height: 14 }} />}
                    {f.status === "done"      && <span className="badge badge-success" style={{ fontSize: 10 }}>✓ OK</span>}
                    {f.status === "error"     && <span className="badge badge-danger"  style={{ fontSize: 10 }}>Erro</span>}
                  </div>

                  {f.status !== "uploading" && (
                    <button
                      onClick={() => removeFile(f.id)}
                      style={{ background: "none", color: "var(--muted)", fontSize: 16, padding: 0, flexShrink: 0, lineHeight: 1 }}
                    >×</button>
                  )}
                </div>

                {/* Progresso duplo (sanitização + upload) — só durante upload */}
                {f.status === "uploading" && (
                  <DualProgress
                    sanitize={f.sanitizeProgress}
                    upload={f.uploadProgress.upload}
                    phase={f.uploadProgress.phase}
                  />
                )}

                {/* Linha inferior: sanitização + metadados lado a lado */}
                {(f.status === "uploading" || f.status === "done") && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    {/* Badge de sanitização */}
                    <SanitizeBadge
                      report={f.sanitizationReport}
                      progress={f.sanitizeProgress}
                    />

                    {/* Painel de metadados — só aparece após sanitização concluída */}
                    {f.sanitizeProgress >= 100 && (
                      <MetadataPanel
                        report={f.sanitizationReport}
                        sanitizeProgress={f.sanitizeProgress}
                      />
                    )}

                    {/* URL após concluído */}
                    {f.status === "done" && f.url && (
                      <span style={{
                        fontSize: 10, color: "var(--muted)",
                        overflow: "hidden", textOverflow: "ellipsis",
                        whiteSpace: "nowrap", maxWidth: 200,
                        flex: 1,
                      }}>
                        {f.url}
                      </span>
                    )}
                  </div>
                )}

                {/* Erro */}
                {f.status === "error" && (
                  <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 6 }}>✗ {f.error}</div>
                )}
              </div>
            ))}
          </div>

          {/* Botões de ação */}
          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="btn btn-primary"
              onClick={uploadAll}
              disabled={uploading || (idleFiles.length === 0 && errorFiles.length === 0)}
              style={{ flex: 1 }}
            >
              {uploading
                ? <><span className="spinner" /> Processando...</>
                : `🔒 Sanitizar e enviar ${idleFiles.length + errorFiles.length} arquivo(s)`}
            </button>

            {doneFiles.length > 0 && !uploading && (
              <button
                className="btn btn-success"
                onClick={() => onUrlsReady(doneFiles.map((f) => ({
                  url: f.url, type: f.type, name: f.name,
                  sanitizationReport: f.sanitizationReport,
                })))}
                style={{ flexShrink: 0 }}
              >
                ✓ Usar {doneFiles.length} URL(s)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
