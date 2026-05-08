import { useState } from "react";
import { useAccounts, useHistory } from "../App.jsx";
import MediaPreview from "../MediaPreview.jsx";
import CatboxUploader from "../CatboxUploader.jsx";
import Modal from "../Modal.jsx";

const POST_TYPES = [
  { value: "FEED",  label: "Feed",  desc: "Foto ou vídeo no perfil" },
  { value: "REEL",  label: "Reel",  desc: "Foto ou vídeo curto" },
  { value: "STORY", label: "Story", desc: "Desaparece em 24h" },
];

export default function NewPost() {
  const { accounts } = useAccounts();
  const { addEntry } = useHistory();

  const [postType, setPostType]             = useState("FEED");
  const [mediaUrl, setMediaUrl]             = useState("");
  const [mediaType, setMediaType]           = useState("IMAGE");
  const [mediaValid, setMediaValid]         = useState(false);
  const [defaultCaption, setDefaultCaption] = useState("");
  const [customCaptions, setCustomCaptions] = useState({});
  const [useCustomCaption, setUseCustomCaption] = useState({});
  const [selectedIds, setSelectedIds]       = useState([]);
  const [delaySeconds, setDelaySeconds]     = useState(0);
  const [loading, setLoading]               = useState(false);
  const [progress, setProgress]             = useState(null);
  const [toast, setToast]                   = useState(null);
  const [confirmPublish, setConfirmPublish] = useState(false);

  // ✅ Modo de entrada de mídia: "upload" ou "url"
  const [mediaMode, setMediaMode] = useState("upload");

  const isReel = postType === "REEL";

  const handlePostType = (t) => {
    setPostType(t);
    if (t === "REEL") setMediaType("VIDEO");
  };

  const handleCatboxUrl = (items) => {
    if (items.length > 0) {
      setMediaUrl(items[0].url);
      setMediaType(items[0].type);
    }
    setMediaMode("url"); // volta para URL após upload
  };

  const showCaptions = postType === "FEED" || postType === "REEL";
  const selectedAccounts = accounts.filter((a) => selectedIds.includes(a.id));
  const totalDelay = selectedAccounts.length > 1 ? (selectedAccounts.length - 1) * delaySeconds : 0;

  const toggleAccount = (id) => setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const selectAll = () => setSelectedIds(accounts.map((a) => a.id));
  const clearAll  = () => setSelectedIds([]);

  const setCustom    = (id, val) => setCustomCaptions((p) => ({ ...p, [id]: val }));
  const toggleCustom = (id) => {
    setUseCustomCaption((p) => ({ ...p, [id]: !p[id] }));
    if (!useCustomCaption[id]) setCustomCaptions((p) => ({ ...p, [id]: defaultCaption }));
  };

  const buildCaptions = () => {
    const result = {};
    for (const id of selectedIds)
      result[id] = useCustomCaption[id] ? (customCaptions[id] ?? defaultCaption) : defaultCaption;
    return result;
  };

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const validateAndPublish = () => {
    if (!mediaUrl.trim())        return showToast("error", "Cole a URL da mídia ou faça upload primeiro");
    if (selectedIds.length === 0) return showToast("error", "Selecione ao menos uma conta");
    setConfirmPublish(true);
  };

  const submit = async () => {
    setConfirmPublish(false);
    const selected = accounts.filter((a) => selectedIds.includes(a.id));
    setLoading(true);
    setProgress({ current: 0, total: selected.length, results: [] });

    const res = await fetch("/api/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accounts: selected,
        media_url: mediaUrl,
        media_type: mediaType,
        post_type: postType,
        captions: buildCaptions(),
        default_caption: defaultCaption,
        delay_seconds: delaySeconds,
      }),
    });

    const data = await res.json();
    const results = data.results || [];

    await addEntry({
      id: Date.now(),
      post_type: postType,
      media_url: mediaUrl,
      media_type: mediaType,
      default_caption: defaultCaption,
      delay_seconds: delaySeconds,
      results,
      created_at: new Date().toISOString(),
    });
    setProgress({ current: results.length, total: selected.length, results });
    setLoading(false);
  };

  const reset = () => {
    setProgress(null); setMediaUrl(""); setDefaultCaption("");
    setCustomCaptions({}); setUseCustomCaption({}); setSelectedIds([]);
    setMediaValid(false); setMediaMode("upload");
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Novo post</div>
      </div>

      {toast && (
        <div style={{ marginBottom: 16, padding: "11px 16px", borderRadius: 10, fontSize: 13, background: toast.type === "success" ? "#05422e" : "#3b0d0d", color: toast.type === "success" ? "var(--success)" : "var(--danger)", border: `1px solid ${toast.type === "success" ? "#34d39940" : "#f8717140"}` }}>
          {toast.msg}
        </div>
      )}

      {/* Resultado */}
      {progress && !loading && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontWeight: 500 }}>Resultado da publicação</div>
            <button className="btn btn-ghost btn-sm" onClick={reset}>Novo post</button>
          </div>
          {progress.results.map((r) => (
            <div key={r.account_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ flex: 1, fontSize: 13 }}>@{r.username}</span>
              {r.success
                ? <span className="badge badge-success">✓ Publicado</span>
                : <span className="badge badge-danger" title={r.error}>✗ Falhou</span>}
              {r.error && <span style={{ fontSize: 11, color: "var(--danger)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.error}</span>}
              {r.published_at && <span style={{ fontSize: 11, color: "var(--muted)" }}>{new Date(r.published_at).toLocaleTimeString("pt-BR")}</span>}
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className="card" style={{ marginBottom: 20, textAlign: "center", padding: 32 }}>
          <div className="spinner" style={{ width: 28, height: 28, margin: "0 auto 14px" }} />
          <div style={{ fontWeight: 500, marginBottom: 6 }}>Publicando...</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {delaySeconds > 0 ? `Aguarde — delay de ${delaySeconds}s entre cada conta.` : "Publicando em todas as contas."}
          </div>
        </div>
      )}

      {!progress && (
        <div className="new-post-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Tipo */}
            <div className="card">
              <div style={{ display: "flex", gap: 8 }}>
                {POST_TYPES.map((t) => (
                  <button key={t.value} onClick={() => handlePostType(t.value)} style={{
                    flex: 1, padding: "11px 8px", borderRadius: 8, border: "1px solid",
                    borderColor: postType === t.value ? "var(--accent)" : "var(--border)",
                    background: postType === t.value ? "#7c5cfc18" : "var(--bg3)",
                    color: postType === t.value ? "var(--accent-light)" : "var(--muted)",
                    textAlign: "center", transition: "all 0.12s",
                  }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{t.label}</div>
                    <div style={{ fontSize: 11, marginTop: 2 }}>{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* ✅ Mídia — tabs Upload / URL manual */}
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <label style={{ margin: 0 }}>Mídia</label>
                {/* Tabs de modo */}
                <div style={{ display: "flex", gap: 6 }}>
                  {[{ id: "upload", icon: "☁️", label: "Upload mídia" }, { id: "url", icon: "🔗", label: "URL em massa" }].map(({ id, icon, label }) => (
                    <button key={id} onClick={() => setMediaMode(id)} style={{
                      padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: mediaMode === id ? 700 : 400,
                      border: `1px solid ${mediaMode === id ? "var(--accent)" : "var(--border)"}`,
                      background: mediaMode === id ? "rgba(124,92,252,0.12)" : "var(--bg3)",
                      color: mediaMode === id ? "var(--accent-light)" : "var(--muted)", cursor: "pointer",
                    }}>
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Painel Upload */}
              {mediaMode === "upload" && (
                <div style={{ padding: "14px", background: "var(--bg3)", borderRadius: 10, border: "1px solid var(--border)" }}>
                  <CatboxUploader onUrlsReady={handleCatboxUrl} mediaType={mediaType} />
                  {mediaUrl && (
                    <div style={{ marginTop: 10, fontSize: 12, color: "var(--success)", display: "flex", alignItems: "center", gap: 6 }}>
                      ✅ Mídia enviada —
                      <span style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>
                        {mediaUrl}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Painel URL em massa */}
              {mediaMode === "url" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <textarea
                    placeholder={"Cole as URLs, uma por linha:
https://files.catbox.moe/abc.jpg
https://r2.exemplo.com/video2.mp4
https://cdn.exemplo.com/img3.png"}
                    value={mediaUrl}
                    onChange={(e) => { setMediaUrl(e.target.value); setMediaValid(false); }}
                    style={{ fontSize: 12, minHeight: 100, resize: "vertical", fontFamily: "monospace", borderRadius: 8 }}
                  />
                  <div style={{ fontSize: 10, color: "var(--muted)" }}>
                    {mediaUrl.split(/[\n,]/).filter((u) => u.trim().startsWith("http")).length} URL(s) detectada(s) · Ctrl+Enter para confirmar
                  </div>
                </div>
              )}

              {/* Preview sempre visível se tiver URL */}
              {mediaUrl && (
                <div style={{ marginTop: 14 }}>
                  <MediaPreview
                    url={mediaUrl}
                    mediaType={mediaType}
                    onTypeDetected={(t) => setMediaType(t)}
                    onValidated={(v) => setMediaValid(v)}
                  />
                </div>
              )}

              {/* Tipo de mídia */}
              {!isReel && (
                <div className="form-row" style={{ marginBottom: 0, marginTop: mediaUrl ? 14 : 0 }}>
                  <label>Tipo de mídia</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {["IMAGE", "VIDEO"].map((t) => (
                      <button key={t} onClick={() => setMediaType(t)} style={{
                        flex: 1, padding: "8px", borderRadius: 8, border: "1px solid",
                        borderColor: mediaType === t ? "var(--accent)" : "var(--border)",
                        background: mediaType === t ? "#7c5cfc18" : "var(--bg3)",
                        color: mediaType === t ? "var(--accent-light)" : "var(--muted)",
                        fontSize: 13, fontWeight: mediaType === t ? 500 : 400,
                      }}>
                        {t === "IMAGE" ? "🖼 Imagem" : "🎬 Vídeo"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Legenda padrão */}
            {showCaptions && (
              <div className="card">
                <div className="form-row" style={{ marginBottom: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <label style={{ margin: 0 }}>Legenda padrão</label>
                    <span style={{ fontSize: 11, color: defaultCaption.length > 2100 ? "var(--danger)" : "var(--muted)" }}>
                      {defaultCaption.length}/2200
                    </span>
                  </div>
                  <textarea
                    placeholder="Escreva a legenda... #hashtags"
                    value={defaultCaption}
                    onChange={(e) => setDefaultCaption(e.target.value)}
                    style={{ minHeight: 90 }}
                    maxLength={2200}
                  />
                </div>
              </div>
            )}

            {/* Legendas individuais */}
            {showCaptions && selectedAccounts.length > 0 && (
              <div className="card">
                <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 14 }}>
                  Legenda por conta <span style={{ color: "var(--muted)", fontWeight: 400 }}>— ative para personalizar</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {selectedAccounts.map((acc) => (
                    <div key={acc.id}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                        {acc.profile_picture
                          ? <img src={acc.profile_picture} alt="" style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover" }} />
                          : <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--bg3)" }} />}
                        <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>@{acc.username}</span>
                        <label style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "var(--muted)" }}>
                          <input type="checkbox" checked={!!useCustomCaption[acc.id]} onChange={() => toggleCustom(acc.id)} style={{ width: "auto", cursor: "pointer" }} />
                          Personalizar
                        </label>
                      </div>
                      {useCustomCaption[acc.id] && (
                        <textarea
                          placeholder={`Legenda para @${acc.username}...`}
                          value={customCaptions[acc.id] ?? defaultCaption}
                          onChange={(e) => setCustom(acc.id, e.target.value)}
                          style={{ minHeight: 72, fontSize: 13 }}
                          maxLength={2200}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Delay */}
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <label>Delay entre postagens (segundos)</label>
                  <input
                    type="number" min="0" max="3600"
                    value={delaySeconds}
                    onChange={(e) => setDelaySeconds(Math.max(0, parseInt(e.target.value) || 0))}
                    style={{ maxWidth: 120 }}
                  />
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", paddingTop: 18 }}>
                  {delaySeconds === 0
                    ? "Sem delay — publica tudo ao mesmo tempo"
                    : selectedAccounts.length > 1
                    ? `Tempo total: ~${Math.ceil(totalDelay / 60) > 0 ? `${Math.ceil(totalDelay / 60)} min` : `${totalDelay}s`}`
                    : `${delaySeconds}s entre cada conta`}
                </div>
              </div>
            </div>

            <button
              className="btn btn-primary"
              style={{ alignSelf: "flex-start", padding: "11px 28px", fontSize: 14 }}
              onClick={validateAndPublish}
              disabled={loading || !mediaUrl || selectedIds.length === 0}
            >
              {loading
                ? <><span className="spinner" /> Publicando...</>
                : `Publicar em ${selectedIds.length} conta(s)`}
            </button>
          </div>

          {/* Coluna contas */}
          <div className="card" style={{ position: "sticky", top: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Contas <span style={{ color: "var(--muted)", fontWeight: 400 }}>{selectedIds.length}/{accounts.length}</span></div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-ghost btn-sm" onClick={selectAll}>Todas</button>
                <button className="btn btn-ghost btn-sm" onClick={clearAll}>Limpar</button>
              </div>
            </div>
            {accounts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0", color: "var(--muted)", fontSize: 13 }}>Nenhuma conta conectada</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {accounts.map((acc) => {
                  const sel = selectedIds.includes(acc.id);
                  return (
                    <button key={acc.id} onClick={() => toggleAccount(acc.id)} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 8, border: "1px solid",
                      borderColor: sel ? "var(--accent)" : "var(--border)", background: sel ? "#7c5cfc12" : "var(--bg3)", textAlign: "left", width: "100%", transition: "all 0.12s",
                    }}>
                      {acc.profile_picture
                        ? <img src={acc.profile_picture} alt="" style={{ width: 30, height: 30, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                        : <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--bg2)", flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: sel ? "var(--accent-light)" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{acc.username}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{acc.account_type}</div>
                      </div>
                      <div style={{ width: 17, height: 17, borderRadius: "50%", flexShrink: 0, border: `1.5px solid ${sel ? "var(--accent)" : "var(--border)"}`, background: sel ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {sel && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de confirmação */}
      <Modal
        open={confirmPublish}
        title="Confirmar publicação"
        message={`Publicar ${postType} em ${selectedIds.length} conta(s)${delaySeconds > 0 ? ` com delay de ${delaySeconds}s entre cada uma` : ""}?`}
        confirmLabel="Publicar agora"
        onConfirm={submit}
        onCancel={() => setConfirmPublish(false)}
      />

      <style>{`
        @media (max-width: 768px) {
          .new-post-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
