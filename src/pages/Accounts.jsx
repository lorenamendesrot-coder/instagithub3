import { useState, useCallback, useEffect, useRef } from "react";
import { useAccounts } from "../App.jsx";
import { dbPut } from "../useDB.js";
import Modal from "../Modal.jsx";

// ── Formata números grandes: 1400 → 1,4k ─────────────────────────────────────
function fmt(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000)    return (n / 1_000).toFixed(0) + "k";
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toLocaleString("pt-BR");
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ acc, size = 56 }) {
  const initials = (acc.username || "?")[0].toUpperCase();
  const gradients = [
    "linear-gradient(135deg, #7c5cfc, #e040fb)",
    "linear-gradient(135deg, #f59e0b, #ef4444)",
    "linear-gradient(135deg, #22c55e, #38bdf8)",
    "linear-gradient(135deg, #f97316, #ec4899)",
  ];
  const grad = gradients[(acc.username?.charCodeAt(0) || 0) % gradients.length];
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      {acc.profile_picture && (
        <img src={acc.profile_picture} alt={acc.username}
          style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--border2)", display: "block" }}
          onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }} />
      )}
      <div style={{ width: size, height: size, borderRadius: "50%", background: grad, display: acc.profile_picture ? "none" : "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 700, color: "#fff", border: "2px solid var(--border2)" }}>
        {initials}
      </div>
      {/* Indicador de status */}
      <div style={{
        position: "absolute", bottom: 1, right: 1,
        width: 12, height: 12, borderRadius: "50%",
        background: acc.token_status === "expired" ? "var(--danger)"
          : acc.account_status === "limited" ? "var(--danger)"
          : acc.account_status === "warning" ? "var(--warning)"
          : "var(--success)",
        border: "2px solid var(--bg2)",
      }} />
    </div>
  );
}

// ── Card de stats ─────────────────────────────────────────────────────────────
function StatBox({ label, value, icon }) {
  return (
    <div style={{ flex: 1, textAlign: "center", padding: "10px 6px", background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 16, marginBottom: 3 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>{label}</div>
    </div>
  );
}

// ── Modal detalhes da conta ───────────────────────────────────────────────────
function AccountDetailModal({ acc, insights, loadingInsights, onClose, onEdit, onRemove }) {
  const status = acc.token_status === "expired" ? { color: "var(--danger)", label: "Token expirado", icon: "🔴" }
    : insights?.account_status === "limited"    ? { color: "var(--danger)",  label: "Limite atingido", icon: "🚫" }
    : insights?.account_status === "warning"    ? { color: "var(--warning)", label: "Próximo do limite", icon: "⚠️" }
    : { color: "var(--success)", label: "Ativa", icon: "🟢" };

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{
        background: "var(--bg2)", border: "1px solid var(--border2)",
        borderRadius: 18, width: "100%", maxWidth: 480,
        boxShadow: "0 24px 64px rgba(0,0,0,0.7)", overflow: "hidden",
      }}>
        {/* Header com capa gradiente */}
        <div style={{ height: 72, background: "linear-gradient(135deg, #7c5cfc22, #9b4dfc44)", position: "relative", borderBottom: "1px solid var(--border)" }}>
          <button onClick={onClose} style={{ position: "absolute", top: 12, right: 14, background: "none", color: "var(--muted)", fontSize: 20, padding: "0 4px", lineHeight: 1 }}>×</button>
        </div>

        {/* Avatar sobreposto */}
        <div style={{ padding: "0 20px 0", marginTop: -36 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <Avatar acc={{ ...acc, account_status: insights?.account_status }} size={72} />
            <div style={{ display: "flex", gap: 7, paddingBottom: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={onEdit}>✏️ Editar perfil</button>
              <button className="btn btn-danger btn-sm" onClick={onRemove}>Desconectar</button>
            </div>
          </div>

          {/* Nome e username */}
          <div style={{ marginTop: 10, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{acc.name || acc.username}</div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>@{acc.username}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <span className="badge badge-purple">{acc.account_type || "BUSINESS"}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: status.color, display: "flex", alignItems: "center", gap: 4 }}>
                {status.icon} {status.label}
              </span>
            </div>
          </div>
        </div>

        <div style={{ padding: "0 20px 20px" }}>

          {loadingInsights ? (
            <div style={{ textAlign: "center", padding: "28px 0" }}>
              <div className="spinner" style={{ width: 22, height: 22, margin: "0 auto 10px" }} />
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Buscando dados da conta...</div>
            </div>
          ) : insights ? (
            <>
              {/* Stats */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <StatBox label="Seguidores"  value={fmt(insights.followers_count)} icon="👥" />
                <StatBox label="Seguindo"    value={fmt(insights.follows_count)}   icon="➡️" />
                <StatBox label="Posts"       value={fmt(insights.media_count)}      icon="📸" />
              </div>

              {/* Bio */}
              {insights.biography && (
                <div style={{ marginBottom: 12, padding: "10px 12px", background: "var(--bg3)", borderRadius: 8, fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
                  {insights.biography}
                </div>
              )}

              {/* Link */}
              {insights.website && (
                <a href={insights.website} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--accent-light)", marginBottom: 12, padding: "8px 12px", background: "var(--bg3)", borderRadius: 8 }}>
                  🔗 {insights.website.replace(/^https?:\/\//, "")}
                </a>
              )}

              {/* Detalhes em grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                {[
                  { icon: "🗂", label: "Tipo de conta", value: insights.account_type || acc.account_type || "BUSINESS" },
                  { icon: "🗓", label: "Conectada em", value: new Date(acc.connected_at || Date.now()).toLocaleDateString("pt-BR") },
                  { icon: "🔄", label: "Dados atualizados", value: insights.fetched_at ? new Date(insights.fetched_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—" },
                  { icon: "🆔", label: "Instagram ID", value: acc.id },
                ].map((item) => (
                  <div key={item.label} style={{ padding: "9px 11px", background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>{item.icon} {item.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.value}</div>
                  </div>
                ))}
              </div>

              {/* Limite de publicação */}
              {insights.publishing_limit && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Limite de publicação (24h)
                  </div>
                  <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "10px 12px", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
                      <span style={{ color: "var(--text)" }}>
                        {insights.publishing_limit.quota_usage ?? 0} / {insights.publishing_limit.config?.quota_total ?? "—"} posts
                      </span>
                      <span style={{ color: "var(--muted)" }}>
                        {insights.publishing_limit.config?.quota_duration ? `a cada ${insights.publishing_limit.config.quota_duration / 3600}h` : ""}
                      </span>
                    </div>
                    {/* Barra de progresso */}
                    {insights.publishing_limit.config?.quota_total && (() => {
                      const pct = Math.min(100, Math.round((insights.publishing_limit.quota_usage || 0) / insights.publishing_limit.config.quota_total * 100));
                      const color = pct >= 100 ? "var(--danger)" : pct >= 80 ? "var(--warning)" : "var(--success)";
                      return (
                        <div style={{ height: 6, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width 0.4s ease" }} />
                        </div>
                      );
                    })()}
                  </div>
                  {insights.restriction_note && (
                    <div style={{ marginTop: 8, fontSize: 11, color: insights.account_status === "limited" ? "var(--danger)" : "var(--warning)", padding: "7px 10px", background: insights.account_status === "limited" ? "rgba(239,68,68,0.06)" : "rgba(245,158,11,0.07)", borderRadius: 7, borderLeft: `3px solid ${insights.account_status === "limited" ? "var(--danger)" : "var(--warning)"}` }}>
                      ⚠️ {insights.restriction_note}
                    </div>
                  )}
                </div>
              )}

              {/* Token status */}
              <div style={{ padding: "9px 12px", background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13 }}>🔒</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>Token de acesso</div>
                  <div style={{ fontSize: 10, color: acc.token_status === "expired" ? "var(--danger)" : "var(--success)" }}>
                    {acc.token_status === "expired" ? "Expirado — reconecte a conta" : "Armazenado com segurança no dispositivo"}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "20px 0", color: "var(--muted)", fontSize: 13 }}>
              Não foi possível carregar os detalhes da conta.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Modal de edição de perfil ─────────────────────────────────────────────────
function EditProfileModal({ acc, onClose, onSaved }) {
  const [tab, setTab]           = useState("bio");
  const [bio, setBio]           = useState(acc.biography || "");
  const [website, setWebsite]   = useState(acc.website || "");
  const [photoUrl, setPhotoUrl] = useState("");
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);

  const saveProfile = async () => {
    setLoading(true); setResult(null);
    try {
      const res = await fetch("/api/update-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagram_id: acc.id, access_token: acc.access_token, biography: bio, website }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ type: "success", msg: "Bio e link atualizados!" });
        onSaved({ ...acc, biography: bio, website });
      } else {
        setResult({ type: "error", msg: data.error || "Erro ao atualizar." });
      }
    } catch (e) { setResult({ type: "error", msg: e.message }); }
    setLoading(false);
  };

  const savePhoto = async () => {
    if (!photoUrl.trim()) return;
    setLoading(true); setResult(null);
    try {
      const res = await fetch("/api/update-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagram_id: acc.id, access_token: acc.access_token, profile_picture_url: photoUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ type: "success", msg: "Foto atualizada!" });
        onSaved({ ...acc, profile_picture: photoUrl });
        setPhotoUrl("");
      } else {
        setResult({ type: "error", msg: data.error || "Erro ao atualizar foto." });
      }
    } catch (e) { setResult({ type: "error", msg: e.message }); }
    setLoading(false);
  };

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{
      position: "fixed", inset: 0, zIndex: 3000,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 16, width: "100%", maxWidth: 460, boxShadow: "0 24px 64px rgba(0,0,0,0.7)", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar acc={acc} size={36} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>@{acc.username}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Editar perfil</div>
          </div>
          <button onClick={onClose} style={{ background: "none", color: "var(--muted)", fontSize: 22, padding: "0 4px" }}>×</button>
        </div>

        <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
          {[{ id: "bio", label: "📝 Bio & Link" }, { id: "photo", label: "📷 Foto" }].map((t) => (
            <button key={t.id} onClick={() => { setTab(t.id); setResult(null); }} style={{
              flex: 1, padding: "11px", fontSize: 13,
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? "var(--accent-light)" : "var(--muted)",
              background: "none",
              borderBottom: `2px solid ${tab === t.id ? "var(--accent)" : "transparent"}`,
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{ padding: 20 }}>
          {tab === "bio" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label>Bio</label>
                <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Escreva sua bio..." style={{ minHeight: 88 }} maxLength={150} />
                <div style={{ fontSize: 11, color: bio.length > 130 ? "var(--warning)" : "var(--muted)", textAlign: "right", marginTop: 4 }}>{bio.length}/150</div>
              </div>
              <div>
                <label>Link da bio</label>
                <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://seusite.com.br" />
              </div>
              <div style={{ padding: "9px 12px", background: "rgba(245,158,11,0.07)", borderRadius: 8, fontSize: 12, color: "var(--warning)", borderLeft: "3px solid var(--warning)" }}>
                ⚠️ Requer permissão <strong>instagram_manage_profile</strong> aprovada no App Meta.
              </div>
              {result && (
                <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, background: result.type === "success" ? "var(--success-bg)" : "rgba(239,68,68,0.08)", color: result.type === "success" ? "var(--success)" : "var(--danger)" }}>
                  {result.type === "success" ? "✓ " : "✕ "}{result.msg}
                </div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveProfile} disabled={loading}>
                  {loading ? <><span className="spinner" /> Salvando...</> : "Salvar"}
                </button>
                <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              </div>
            </div>
          )}

          {tab === "photo" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, background: "var(--bg3)", borderRadius: 10 }}>
                <Avatar acc={acc} size={58} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Foto atual</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>@{acc.username}</div>
                </div>
              </div>
              <div>
                <label>URL da nova foto</label>
                <input type="url" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://files.catbox.moe/foto.jpg" />
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>JPG ou PNG público</div>
              </div>
              {photoUrl && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--bg3)", borderRadius: 9, border: "1px solid var(--accent)" }}>
                  <img src={photoUrl} alt="preview" style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--accent)", flexShrink: 0 }} onError={(e) => { e.target.style.opacity = "0.3"; }} />
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Prévia</div>
                </div>
              )}
              <div style={{ padding: "9px 12px", background: "rgba(245,158,11,0.07)", borderRadius: 8, fontSize: 12, color: "var(--warning)", borderLeft: "3px solid var(--warning)" }}>
                ⚠️ Requer permissão <strong>instagram_manage_profile</strong> aprovada no App Meta.
              </div>
              {result && (
                <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, background: result.type === "success" ? "var(--success-bg)" : "rgba(239,68,68,0.08)", color: result.type === "success" ? "var(--success)" : "var(--danger)" }}>
                  {result.type === "success" ? "✓ " : "✕ "}{result.msg}
                </div>
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={savePhoto} disabled={loading || !photoUrl.trim()}>
                  {loading ? <><span className="spinner" /> Atualizando...</> : "Atualizar foto"}
                </button>
                <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Accounts() {
  const { accounts, removeAccount, clearAllAccounts, loading, reloadAccounts } = useAccounts();
  const [confirmModal, setConfirmModal] = useState(null);
  const [editingAcc,   setEditingAcc]   = useState(null);
  const [detailAcc,    setDetailAcc]    = useState(null);
  const [insights,     setInsights]     = useState({});   // { [acc.id]: data }
  const [loadingIns,   setLoadingIns]   = useState({});   // { [acc.id]: bool }

  const APP_ID   = import.meta.env.VITE_META_APP_ID;
  const REDIRECT = encodeURIComponent(window.location.origin + "/api/auth-callback");
  const SCOPE    = "instagram_basic,instagram_content_publish,instagram_manage_insights,pages_read_engagement,pages_show_list,pages_manage_posts,business_management,pages_manage_metadata";
  const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${REDIRECT}&scope=${SCOPE}&response_type=code`;

  // Busca insights — tenta a Netlify Function, com fallback direto à Graph API
  const fetchInsights = useCallback(async (acc, force = false) => {
    if (!force && (loadingIns[acc.id] || insights[acc.id])) return;
    if (!acc.access_token) return; // token ainda não carregou
    setLoadingIns((p) => ({ ...p, [acc.id]: true }));
    try {
      // Tenta via Netlify Function primeiro
      let data = null;
      try {
        const res = await fetch("/api/account-insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instagram_id: acc.id, access_token: acc.access_token }),
        });
        if (res.ok) {
          const json = await res.json();
          if (!json.error) data = json;
        }
        if (res.status === 401) {
          await dbPut("sessions", { ...acc, token_status: "expired" });
          reloadAccounts();
        }
      } catch { /* fallback abaixo */ }

      // Fallback: chama Graph API diretamente do browser
      if (!data) {
        const GRAPH = "https://graph.facebook.com/v21.0";
        const fields = "id,username,name,biography,website,profile_picture_url,account_type,followers_count,follows_count,media_count";
        const res = await fetch(`${GRAPH}/${acc.id}?fields=${fields}&access_token=${acc.access_token}`);
        const json = await res.json();
        if (!json.error) {
          data = {
            id:               json.id,
            username:         json.username,
            name:             json.name,
            biography:        json.biography || "",
            website:          json.website || "",
            profile_picture:  json.profile_picture_url || "",
            account_type:     json.account_type,
            followers_count:  json.followers_count ?? null,
            follows_count:    json.follows_count ?? null,
            media_count:      json.media_count ?? null,
            account_status:   "active",
            restriction_note: null,
            fetched_at:       new Date().toISOString(),
          };
          // Persiste username/name/foto atualizados no IndexedDB
          if (json.username && json.username !== acc.username) {
            await dbPut("sessions", { ...acc, username: json.username, name: json.name, profile_picture: json.profile_picture_url || acc.profile_picture });
            reloadAccounts();
          }
        } else if (json.error?.code === 190) {
          await dbPut("sessions", { ...acc, token_status: "expired" });
          reloadAccounts();
        }
      }

      setInsights((p) => ({ ...p, [acc.id]: data }));
    } catch {
      setInsights((p) => ({ ...p, [acc.id]: null }));
    }
    setLoadingIns((p) => ({ ...p, [acc.id]: false }));
  }, [insights, loadingIns, reloadAccounts]);

  // ✅ Busca insights de todas as contas automaticamente ao carregar
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current || loading || accounts.length === 0) return;
    fetchedRef.current = true;
    // Busca em sequência com pequeno delay para não sobrecarregar a API
    accounts.forEach((acc, i) => {
      setTimeout(() => fetchInsights(acc), i * 300);
    });
  }, [accounts, loading]);

  // Abre modal de detalhes (insights já devem estar carregados)
  const openDetail = (acc) => {
    setDetailAcc(acc);
    // Se por algum motivo não carregou ainda, busca agora
    if (!insights[acc.id] && !loadingIns[acc.id]) fetchInsights(acc);
  };

  const handleConfirm = async () => {
    if (!confirmModal) return;
    if (confirmModal.type === "remove") await removeAccount(confirmModal.id);
    if (confirmModal.type === "clear")  await clearAllAccounts();
    setConfirmModal(null);
    setDetailAcc(null);
  };

  const handleSaved = async (updated) => {
    await dbPut("sessions", updated);
    reloadAccounts();
    setEditingAcc(null);
  };

  if (loading) return (
    <div className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
      <div className="spinner" style={{ width: 28, height: 28 }} />
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Contas conectadas</div>
          <div className="page-subtitle">{accounts.length} conta(s) vinculada(s) via Meta API</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {accounts.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmModal({ type: "clear" })}>
              Remover todas
            </button>
          )}
          <a href={oauthUrl} className="btn btn-primary">+ Adicionar conta</a>
        </div>
      </div>

      {/* Modal detalhes */}
      {detailAcc && (
        <AccountDetailModal
          acc={detailAcc}
          insights={insights[detailAcc.id]}
          loadingInsights={!!loadingIns[detailAcc.id]}
          onClose={() => setDetailAcc(null)}
          onEdit={() => { setEditingAcc(detailAcc); setDetailAcc(null); }}
          onRemove={() => { setConfirmModal({ type: "remove", id: detailAcc.id, username: detailAcc.username }); setDetailAcc(null); }}
        />
      )}

      {/* Modal edição */}
      {editingAcc && (
        <EditProfileModal
          acc={editingAcc}
          onClose={() => setEditingAcc(null)}
          onSaved={handleSaved}
        />
      )}

      {accounts.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📱</div>
          <div className="empty-title">Nenhuma conta conectada</div>
          <div style={{ fontSize: 13, marginBottom: 24, color: "var(--muted)" }}>Conecte contas Instagram Business ou Creator.</div>
          <a href={oauthUrl} className="btn btn-primary">+ Conectar primeira conta</a>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {accounts.map((acc) => {
              const ins = insights[acc.id];
              const isLoading = !!loadingIns[acc.id];
              const statusColor = acc.token_status === "expired" ? "var(--danger)"
                : ins?.account_status === "limited" ? "var(--danger)"
                : ins?.account_status === "warning" ? "var(--warning)"
                : "var(--success)";
              const statusLabel = acc.token_status === "expired" ? "Token expirado"
                : ins?.account_status === "limited" ? "Limitada"
                : ins?.account_status === "warning" ? "Atenção"
                : "Ativa";

              return (
                <div key={acc.id} className="card card-hover"
                  style={{ display: "flex", flexDirection: "column", gap: 12, cursor: "pointer" }}
                  onClick={() => openDetail(acc)}
                >
                  {/* Header do card — dados do IndexedDB, sempre disponíveis */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Avatar acc={{ ...acc, account_status: ins?.account_status }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ins?.name || acc.name || acc.username || "—"}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        @{ins?.username || acc.username || "—"}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4, flexWrap: "wrap" }}>
                        <span className="badge badge-purple" style={{ fontSize: 10 }}>{acc.account_type || "BUSINESS"}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: statusColor }}>● {statusLabel}</span>
                      </div>
                    </div>
                  </div>

                  {/* Stats — skeleton enquanto carrega, dados reais depois */}
                  {isLoading && (
                    <div style={{ display: "flex", gap: 6 }}>
                      {["Seguidores", "Seguindo", "Posts"].map((l) => (
                        <div key={l} style={{ flex: 1, textAlign: "center", padding: "7px 4px", background: "var(--bg3)", borderRadius: 7, border: "1px solid var(--border)" }}>
                          <div style={{ height: 16, width: "60%", background: "var(--border)", borderRadius: 4, margin: "0 auto 4px", animation: "pulse 1.2s ease infinite" }} />
                          <div style={{ fontSize: 9, color: "var(--muted)" }}>{l}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {ins && !isLoading && (
                    <div style={{ display: "flex", gap: 6 }}>
                      {[
                        { v: fmt(ins.followers_count), l: "Seguidores" },
                        { v: fmt(ins.follows_count),   l: "Seguindo" },
                        { v: fmt(ins.media_count),      l: "Posts" },
                      ].map((s) => (
                        <div key={s.l} style={{ flex: 1, textAlign: "center", padding: "7px 4px", background: "var(--bg3)", borderRadius: 7, border: "1px solid var(--border)" }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{s.v}</div>
                          <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 1 }}>{s.l}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!ins && !isLoading && (
                    <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", padding: "2px 0" }}>
                      ↻ Carregando dados...
                    </div>
                  )}

                  {/* Barra de limite de publicação se tiver */}
                  {ins?.publishing_limit?.config?.quota_total && (() => {
                    const pct = Math.min(100, Math.round((ins.publishing_limit.quota_usage || 0) / ins.publishing_limit.config.quota_total * 100));
                    const color = pct >= 100 ? "var(--danger)" : pct >= 80 ? "var(--warning)" : "var(--success)";
                    return (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>
                          <span>Posts hoje</span>
                          <span style={{ color }}>{ins.publishing_limit.quota_usage}/{ins.publishing_limit.config.quota_total}</span>
                        </div>
                        <div style={{ height: 4, background: "var(--bg3)", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4 }} />
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: "auto" }}>
                    🗓 Conectada em {new Date(acc.connected_at || Date.now()).toLocaleDateString("pt-BR")}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 20, padding: "12px 16px", background: "var(--bg2)", borderRadius: 10, border: "1px solid var(--border)", fontSize: 12, color: "var(--muted)" }}>
            💡 Clique em qualquer conta para ver detalhes completos — seguidores, limite de posts, status e mais.
          </div>
        </>
      )}

      <Modal
        open={!!confirmModal}
        title={confirmModal?.type === "clear" ? "Remover todas as contas?" : `Desconectar @${confirmModal?.username}?`}
        message={confirmModal?.type === "clear"
          ? "Todas as contas e tokens serão removidos do dispositivo."
          : "A conta será removida do Insta Manager. Você poderá reconectá-la quando quiser."}
        confirmLabel={confirmModal?.type === "clear" ? "Remover todas" : "Desconectar"}
        confirmDanger
        onConfirm={handleConfirm}
        onCancel={() => setConfirmModal(null)}
      />
    </div>
  );
}
