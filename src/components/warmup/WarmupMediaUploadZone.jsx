// WarmupMediaUploadZone.jsx — zona de upload de mídias do aquecimento
import { useState, useRef, useCallback } from "react";

export default function MediaUploadZone({ typeConfig, files, onAddFiles, onRemoveFile, onRemoveAll, onUploadAll, uploading, urlInput, onUrlInputChange, onAddUrl }) {
  const [dragging,    setDragging]    = useState(false);
  const [showBulkUrl, setShowBulkUrl] = useState(false);
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

  const handleAddUrl = () => {
    const urls = (urlInput || "").split(/[\n,]/).map((u) => u.trim()).filter((u) => u.startsWith("http"));
    if (!urls.length) return;
    onAddUrl(typeConfig.id, urls);
    onUrlInputChange(typeConfig.id, "");
    setShowBulkUrl(false);
  };

  const urlCount = (urlInput || "").split(/[\n,]/).filter((u) => u.trim().startsWith("http")).length;

  return (
    <div style={{ marginBottom: 4 }}>
      {/* Header */}
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
        {myFiles.length > 0 && (
          <button
            onClick={() => onRemoveAll(typeConfig.id)}
            title="Limpar todos"
            style={{ background: "none", color: "var(--muted)", fontSize: 12, padding: "2px 6px", borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", flexShrink: 0 }}
          >
            🗑 Limpar
          </button>
        )}
      </div>

      {/* 2 botões fixos */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => inputRef.current?.click()}>
          ☁️ Upload mídias
        </button>
        <button className={`btn btn-sm ${showBulkUrl ? "btn-primary" : "btn-ghost"}`} style={{ flex: 1 }} onClick={() => setShowBulkUrl((p) => !p)}>
          🔗 + URL manual
        </button>
        <input ref={inputRef} type="file" multiple accept={typeConfig.accept} style={{ display: "none" }}
          onChange={(e) => e.target.files.length && onAddFiles(typeConfig.id, e.target.files)} />
      </div>

      {/* Zona de drag & drop (sempre visível) */}
      <div
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--accent)" : "var(--border2)"}`,
          borderRadius: 10, padding: "16px", textAlign: "center", cursor: "pointer",
          background: dragging ? "rgba(124,92,252,0.08)" : "var(--bg3)",
          transition: "all 0.15s", marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 20, marginBottom: 3 }}>{typeConfig.icon}</div>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{dragging ? "Solte aqui" : "Arraste ou clique"}</div>
      </div>

      {/* Painel URL em massa (expande ao clicar no botão) */}
      {showBulkUrl && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
          <textarea
            placeholder={"Cole as URLs, uma por linha:\nhttps://files.catbox.moe/abc.mp4\nhttps://r2.exemplo.com/video2.mp4\nhttps://cdn.exemplo.com/video3.mp4"}
            value={urlInput || ""}
            onChange={(e) => onUrlInputChange(typeConfig.id, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); handleAddUrl(); } }}
            style={{ fontSize: 11, minHeight: 90, resize: "vertical", fontFamily: "monospace", borderRadius: 8 }}
          />
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleAddUrl} disabled={!urlCount}>
              ✓ Adicionar {urlCount > 0 ? `${urlCount} URL${urlCount > 1 ? "s" : ""}` : "URLs"}
            </button>
            <span style={{ fontSize: 10, color: "var(--muted)", flexShrink: 0 }}>Ctrl+Enter</span>
          </div>
        </div>
      )}

      {myFiles.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 220, overflowY: "auto", marginBottom: 6 }}>
          {myFiles.map((f) => {
            const rep = f.sanitizationReport;
            const sanitOk = rep && !rep.error && rep.supported !== false;
            const ATOM_NAMES = { "free": "espaço livre", "udta": "metadados do usuário", "meta": "metadados", "©nam": "título", "©art": "artista", "©day": "data de criação", "©too": "encoder", "©cmt": "comentário", "©alb": "álbum", "©gen": "gênero", "desc": "descrição", "cprt": "copyright", "EXIF/XMP (APP1)": "EXIF/XMP", "IPTC (APP13)": "IPTC", "tEXt": "texto PNG", "iTXt": "texto PNG", "zTXt": "texto PNG", "eXIf": "EXIF PNG", "iCCP": "perfil de cor ICC", "tIME": "data de modificação", "EXIF": "EXIF", "XMP ": "XMP" };
            const friendlyName = (r) => ATOM_NAMES[r] || r;
            const cleaned = sanitOk ? (rep.removed || []).filter((r) => !r.startsWith("injeção")).map(friendlyName) : [];
            return (
              <div key={f.id} style={{
                padding: "7px 10px", borderRadius: 8, fontSize: 11,
                background: f.status === "done" && sanitOk ? "rgba(34,197,94,0.04)"
                          : f.status === "error" ? "rgba(239,68,68,0.04)" : "var(--bg4)",
                border: `1px solid ${f.status === "done" && sanitOk ? "rgba(34,197,94,0.18)"
                       : f.status === "error" ? "rgba(239,68,68,0.18)" : "var(--border)"}`,
                display: "flex", flexDirection: "column", gap: 4,
              }}>
                {/* Linha do nome */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>{f.fromUrl ? "🔗" : typeConfig.icon}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
                    {f.name}
                  </span>
                  {f.status === "idle"      && <span className="badge badge-gray"   style={{ fontSize: 10, flexShrink: 0 }}>Pendente</span>}
                  {f.status === "uploading" && <span className="spinner" style={{ width: 11, height: 11, flexShrink: 0 }} />}
                  {f.status === "done"      && <span className="badge badge-success" style={{ fontSize: 10, flexShrink: 0 }}>✓ OK</span>}
                  {f.status === "error"     && <span className="badge badge-danger"  style={{ fontSize: 10, flexShrink: 0 }}>Erro</span>}
                  {f.status !== "uploading" && (
                    <button onClick={(e) => { e.stopPropagation(); onRemoveFile(typeConfig.id, f.id); }}
                      style={{ background: "none", color: "var(--muted)", fontSize: 14, padding: 0, lineHeight: 1, cursor: "pointer" }}>×</button>
                  )}
                </div>

                {/* Barra de progresso durante upload */}
                {f.status === "uploading" && (
                  <div style={{ height: 2, background: "var(--border)", borderRadius: 1, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${f.progress}%`, background: f.progress < 18 ? "var(--warning)" : "var(--accent)", transition: "width 0.35s" }} />
                  </div>
                )}

                {/* Badges de sanitização — mesmo estilo do Schedule */}
                {(rep || (f.status === "uploading" && !f.fromUrl)) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                    {/* Sanitizando... */}
                    {f.status === "uploading" && !rep && (
                      <>
                        <span className="spinner" style={{ width: 9, height: 9 }} />
                        <span style={{ fontSize: 9, color: "var(--muted)" }}>
                          {f.progress < 18 ? "Sanitizando metadados..." : "Enviando..."}
                        </span>
                      </>
                    )}
                    {/* Sanitizado OK */}
                    {rep && sanitOk && (
                      <>
                        <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "rgba(34,197,94,0.1)", color: "var(--success)", border: "1px solid rgba(34,197,94,0.2)", flexShrink: 0 }}>
                          ✅ Sanitizado · ID:{rep.uniqueId}
                        </span>
                        <span style={{ fontSize: 9, color: "var(--muted)" }}>
                          {(rep.originalSize/1024).toFixed(0)}KB→{(rep.sanitizedSize/1024).toFixed(0)}KB · {rep.durationMs}ms
                        </span>
                        {cleaned.length > 0 && (
                          <span style={{ fontSize: 9, color: "var(--muted)" }}>
                            Removido: {cleaned.slice(0, 2).join(", ")}{cleaned.length > 2 ? ` +${cleaned.length - 2}` : ""}
                          </span>
                        )}
                      </>
                    )}
                    {/* Formato não suportado */}
                    {rep && !sanitOk && (
                      <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "rgba(245,158,11,0.1)", color: "var(--warning)", border: "1px solid rgba(245,158,11,0.2)" }}>
                        ⚠ Formato não suportado
                      </span>
                    )}
                  </div>
                )}

                {f.status === "error" && (
                  <span style={{ fontSize: 10, color: "var(--danger)" }}>✗ {f.error}</span>
                )}
              </div>
            );
          })}
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

