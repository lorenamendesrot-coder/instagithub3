// CatboxUploader.jsx — upload DIRETO do browser para R2 via presigned URL
// com sanitização client-side (remoção EXIF/metadados) antes do envio
import { useState, useRef, useCallback } from "react";
import { sanitizeFile, formatReport } from "./sanitizeClient.js";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isVideo(name) {
  return ["mp4", "mov", "avi", "mkv", "webm"].includes(name.split(".").pop().toLowerCase());
}

// 1. Pede presigned URL para a Netlify Function
// 2. Sanitiza o arquivo no browser (remove EXIF/metadados)
// 3. Faz PUT direto no R2 com o arquivo sanitizado
async function uploadToR2WithSanitize(file, onProgress, onSanitized) {
  onProgress(2);

  // ── Passo 1: obter presigned URL ──
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
  onProgress(8);

  // ── Passo 2: sanitizar no browser ──
  let fileToUpload = file;
  try {
    const { file: sanitized, report } = await sanitizeFile(file);
    fileToUpload = sanitized;
    if (onSanitized) onSanitized(report);
    onProgress(18);
  } catch (err) {
    // Sanitização falhou — continua com o arquivo original (não bloqueia o upload)
    console.warn("Sanitização falhou, usando arquivo original:", err.message);
    if (onSanitized) onSanitized({ error: err.message, supported: false });
  }

  // ── Passo 3: PUT direto no R2 com progresso real ──
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 80) + 18; // 18–98%
        onProgress(pct);
      }
    };

    xhr.onload    = () => xhr.status === 200 ? resolve() : reject(new Error(`R2 recusou o upload (HTTP ${xhr.status})`));
    xhr.onerror   = () => reject(new Error("Erro de rede durante o upload para R2"));
    xhr.ontimeout = () => reject(new Error("Timeout no upload (arquivo muito grande ou conexão lenta)"));
    xhr.timeout   = 5 * 60 * 1000;

    xhr.open("PUT", presignedUrl);
    xhr.setRequestHeader("Content-Type", fileToUpload.type || "video/mp4");
    xhr.send(fileToUpload);
  });

  onProgress(100);
  return publicUrl;
}

// Componente de detalhe da sanitização
function SanitizationBadge({ report }) {
  const [expanded, setExpanded] = useState(false);

  if (!report) return (
    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 6, background: "rgba(245,158,11,0.12)", color: "var(--warning)", border: "1px solid rgba(245,158,11,0.2)" }}>
      ⏳ Aguardando sanitização
    </span>
  );

  if (report.error) return (
    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 6, background: "rgba(239,68,68,0.1)", color: "var(--danger)", border: "1px solid rgba(239,68,68,0.2)" }}
      title={report.error}>
      ⚠️ Sanitização parcial
    </span>
  );

  return (
    <div style={{ display: "inline-block" }}>
      <button
        onClick={() => setExpanded(p => !p)}
        style={{
          fontSize: 10, padding: "2px 7px", borderRadius: 6, border: "none",
          background: "rgba(34,197,94,0.1)", color: "var(--success)",
          border: "1px solid rgba(34,197,94,0.2)", cursor: "pointer",
        }}
        title="Clique para ver detalhes"
      >
        ✅ Sanitizado · ID:{report.uniqueId}
      </button>

      {expanded && (
        <div style={{
          position: "relative", zIndex: 10,
          marginTop: 6, padding: "10px 12px", borderRadius: 8,
          background: "var(--bg2)", border: "1px solid var(--border2)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          fontSize: 11, lineHeight: 1.7,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: "var(--success)" }}>
            🔒 Relatório de Sanitização
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            {[
              ["Formato",    report.format?.toUpperCase() || "—"],
              ["ID único",   report.uniqueId],
              ["Original",   `${(report.originalSize / 1024).toFixed(0)} KB`],
              ["Sanitizado", `${(report.sanitizedSize / 1024).toFixed(0)} KB (${report.sizeDiff >= 0 ? "+" : ""}${report.sizeDiff}B)`],
              ["Tempo",      `${report.durationMs}ms`],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ color: "var(--muted)", paddingRight: 12, whiteSpace: "nowrap" }}>{k}</td>
                <td style={{ color: "var(--text)", fontFamily: "monospace" }}>{v}</td>
              </tr>
            ))}
          </table>

          {report.removed?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ color: "var(--muted)", marginBottom: 4 }}>Removido / injetado:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {report.removed.map((r, i) => (
                  <span key={i} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(34,197,94,0.08)", color: "var(--success)", border: "1px solid rgba(34,197,94,0.15)" }}>
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button onClick={() => setExpanded(false)} style={{ marginTop: 8, fontSize: 10, color: "var(--muted)", background: "none", border: "none", cursor: "pointer" }}>
            Fechar ×
          </button>
        </div>
      )}
    </div>
  );
}

export default function CatboxUploader({ onUrlsReady }) {
  const [files,     setFiles]     = useState([]);
  const [dragging,  setDragging]  = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef();

  const addFiles = (newFiles) => {
    const entries = Array.from(newFiles).map((file) => ({
      id: `${Date.now()}-${Math.random()}`,
      file, name: file.name, size: file.size,
      status: "idle", progress: 0, url: "", error: "",
      type: isVideo(file.name) ? "VIDEO" : "IMAGE",
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
      setFiles((p) => p.map((f) => f.id === entry.id
        ? { ...f, status: "uploading", progress: 0, error: "", sanitizationReport: null } : f));

      try {
        const url = await uploadToR2WithSanitize(
          entry.file,
          (progress) => setFiles((p) => p.map((f) => f.id === entry.id ? { ...f, progress } : f)),
          (report)   => setFiles((p) => p.map((f) => f.id === entry.id ? { ...f, sanitizationReport: report } : f)),
        );
        setFiles((p) => p.map((f) => f.id === entry.id
          ? { ...f, status: "done", url, progress: 100 } : f));
      } catch (err) {
        setFiles((p) => p.map((f) => f.id === entry.id
          ? { ...f, status: "error", error: err.message } : f));
      }
    }

    setUploading(false);
    setFiles((current) => {
      const done = current.filter((f) => f.status === "done");
      if (done.length > 0)
        onUrlsReady(done.map((f) => ({ url: f.url, type: f.type, name: f.name, sanitizationReport: f.sanitizationReport })));
      return current;
    });
  };

  const getProgressLabel = (f) => {
    if (f.progress < 8)  return "Preparando...";
    if (f.progress < 18) return `Sanitizando... ${f.progress}%`;
    if (f.progress < 98) return `Enviando... ${f.progress}%`;
    return "Finalizando...";
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
          borderRadius: 12, padding: "28px 20px", textAlign: "center",
          cursor: uploading ? "not-allowed" : "pointer",
          background: dragging ? "rgba(124,92,252,0.08)" : "var(--bg3)",
          transition: "all 0.15s",
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 8 }}>☁️</div>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
          {dragging ? "Solte para adicionar" : "Arraste arquivos ou clique para selecionar"}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          Imagens (jpg, png, webp) · Vídeos (mp4, mov, webm) · Sem limite de tamanho
        </div>
        <div style={{ fontSize: 11, color: "var(--accent-light)", marginTop: 6 }}>
          🔒 Metadados removidos automaticamente antes do upload
        </div>
        <input ref={inputRef} type="file" multiple accept="image/*,video/*"
          style={{ display: "none" }}
          onChange={(e) => e.target.files.length && addFiles(e.target.files)} />
      </div>

      {files.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
              {files.length} arquivo(s) · {doneFiles.length} enviado(s)
              {errorFiles.length > 0 && <span style={{ color: "var(--danger)", marginLeft: 8 }}>{errorFiles.length} erro(s)</span>}
            </div>
            <button className="btn btn-ghost btn-xs" onClick={clearAll} disabled={uploading}>Limpar</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
            {files.map((f) => (
              <div key={f.id} style={{
                padding: "10px 12px", borderRadius: 8,
                background: f.status === "done" ? "rgba(34,197,94,0.04)" : f.status === "error" ? "rgba(239,68,68,0.06)" : "var(--bg3)",
                border: `1px solid ${f.status === "done" ? "rgba(34,197,94,0.2)" : f.status === "error" ? "rgba(239,68,68,0.2)" : "var(--border)"}`,
              }}>
                {/* Row principal */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: (f.status === "uploading" || f.status === "done") ? 6 : 0 }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{f.type === "VIDEO" ? "🎬" : "🖼"}</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{formatSize(f.size)}</div>
                  </div>

                  <div style={{ flexShrink: 0 }}>
                    {f.status === "idle"      && <span className="badge badge-gray">Pendente</span>}
                    {f.status === "uploading" && <span className="spinner" style={{ width: 14, height: 14 }} />}
                    {f.status === "done"      && <span className="badge badge-success">✓</span>}
                    {f.status === "error"     && <span className="badge badge-danger">Erro</span>}
                  </div>

                  {f.status !== "uploading" && (
                    <button onClick={() => removeFile(f.id)}
                      style={{ background: "none", color: "var(--muted)", fontSize: 16, padding: 0, flexShrink: 0 }}>×</button>
                  )}
                </div>

                {/* Barra de progresso */}
                {f.status === "uploading" && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 2, transition: "width 0.3s",
                        width: `${f.progress}%`,
                        background: f.progress < 18
                          ? "linear-gradient(90deg, var(--warning), #f59e0b)"
                          : "linear-gradient(90deg, var(--accent), #9b4dfc)",
                      }} />
                    </div>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{getProgressLabel(f)}</div>
                  </div>
                )}

                {/* Status de sanitização + URL */}
                {(f.status === "uploading" || f.status === "done") && (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                    <SanitizationBadge report={f.sanitizationReport} />
                    {f.status === "done" && f.url && (
                      <span style={{ fontSize: 10, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>
                        {f.url}
                      </span>
                    )}
                  </div>
                )}

                {f.status === "error" && (
                  <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>✗ {f.error}</div>
                )}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn btn-primary" onClick={uploadAll}
              disabled={uploading || (idleFiles.length === 0 && errorFiles.length === 0)}
              style={{ flex: 1 }}>
              {uploading
                ? <><span className="spinner" /> Sanitizando e enviando...</>
                : `🔒 Sanitizar e enviar ${idleFiles.length + errorFiles.length} arquivo(s)`}
            </button>
            {doneFiles.length > 0 && (
              <button className="btn btn-success"
                onClick={() => onUrlsReady(doneFiles.map((f) => ({ url: f.url, type: f.type, name: f.name, sanitizationReport: f.sanitizationReport })))}
                style={{ flexShrink: 0 }}>
                ✓ Usar {doneFiles.length} URL(s)
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
