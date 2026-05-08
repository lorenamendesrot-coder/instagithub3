import { useState, useCallback, useEffect, useRef } from "react";
import { useAccounts } from "../App.jsx";
import { dbPut } from "../useDB.js";
import Modal from "../Modal.jsx";

// ── Formata números grandes ───────────────────────────────────────────────────
function fmt(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000)    return (n / 1_000).toFixed(0) + "k";
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toLocaleString("pt-BR");
}

// ── Metadados de saúde → cor/label/bg ────────────────────────────────────────
function healthMeta(overall, tokenExpired) {
  if (tokenExpired)        return { color: "var(--danger)",  bg: "rgba(239,68,68,0.10)",  border: "rgba(239,68,68,0.30)",  label: "Token expirado", icon: "🔴" };
  if (overall === "good")  return { color: "var(--success)", bg: "rgba(34,197,94,0.10)",  border: "rgba(34,197,94,0.30)",  label: "Saudável",       icon: "🟢" };
  if (overall === "warning") return { color: "var(--warning)", bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.30)", label: "Atenção",       icon: "🟡" };
  if (overall === "danger")  return { color: "var(--danger)",  bg: "rgba(239,68,68,0.10)",  border: "rgba(239,68,68,0.30)",  label: "Crítico",      icon: "🔴" };
  return { color: "var(--muted)", bg: "var(--bg3)", border: "var(--border)", label: "—", icon: "⚪" };
}

// ── Avatar com bolinha de status ──────────────────────────────────────────────
function Avatar({ acc, ins, size = 56 }) {
  const initials = (acc.username || "?")[0].toUpperCase();
  const gradients = [
    "linear-gradient(135deg, #7c5cfc, #e040fb)",
    "linear-gradient(135deg, #f59e0b, #ef4444)",
    "linear-gradient(135deg, #22c55e, #38bdf8)",
    "linear-gradient(135deg, #f97316, #ec4899)",
  ];
  const grad = gradients[(acc.username?.charCodeAt(0) || 0) % gradients.length];
  const tokenExpired = acc.token_status === "expired";
  const overall      = ins?.health?.overall;
  const dotColor     = tokenExpired ? "var(--danger)"
    : overall === "danger"  ? "var(--danger)"
    : overall === "warning" ? "var(--warning)"
    : overall === "good"    ? "var(--success)"
    : "var(--muted)";

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      {acc.profile_picture && (
        <img
          src={acc.profile_picture} alt={acc.username}
          style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--border2)", display: "block" }}
          onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
        />
      )}
      <div style={{
        width: size, height: size, borderRadius: "50%", background: grad,
        display: acc.profile_picture ? "none" : "flex",
        alignItems: "center", justifyContent: "center",
        fontSize: size * 0.38, fontWeight: 700, color: "#fff", border: "2px solid var(--border2)",
      }}>
        {initials}
      </div>
      <div style={{
        position: "absolute", bottom: 1, right: 1,
        width: 13, height: 13, borderRadius: "50%",
        background: dotColor, border: "2px solid var(--bg2)",
      }} />
    </div>
  );
}

// ── StatBox ───────────────────────────────────────────────────────────────────
function StatBox({ label, value, icon }) {
  return (
    <div style={{ flex: 1, textAlign: "center", padding: "9px 4px", background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 14, marginBottom: 2 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 1 }}>{label}</div>
    </div>
  );
}

// ── Badge de saúde ────────────────────────────────────────────────────────────
function HealthBadge({ overall, tokenExpired, score }) {
  const meta = healthMeta(overall, tokenExpired);
  const s    = tokenExpired ? 0 : score;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", background: meta.bg, border: `1px solid ${meta.border}`,
      borderRadius: 999, fontSize: 10, fontWeight: 700, color: meta.color,
    }}>
      <span style={{ fontSize: 8 }}>●</span>
      <span>{meta.label}</span>
      {s != null && <span style={{ opacity: 0.7 }}>· {s}</span>}
    </div>
  );
}

// ── Health Overview no topo ───────────────────────────────────────────────────
function HealthOverview({ accounts, insights, onRefreshAll, refreshingAll, refreshProgress }) {
  let good = 0, warning = 0, danger = 0, scoreSum = 0, scored = 0;
  const alerts = [];

  for (const acc of accounts) {
    const ins          = insights[acc.id];
    const tokenExpired = acc.token_status === "expired";

    // overall vem de ins.health.overall (objeto retornado pelo backend)
    const overall = tokenExpired ? "danger" : (ins?.health?.overall ?? null);

    if (overall === "good")    good++;
    else if (overall === "warning") warning++;
    else if (overall === "danger")  danger++;

    const sc = tokenExpired ? 0 : (ins?.health?.score ?? null);
    if (sc != null) { scoreSum += sc; scored++; }

    if (tokenExpired) {
      alerts.push({ username: acc.username, msg: "Token expirado — reconecte." });
    } else if (overall === "danger" && ins?.health?.issues?.length) {
      alerts.push({ username: acc.username, msg: ins.health.issues[0] });
    }
  }

  const avgScore = scored > 0 ? Math.round(scoreSum / scored) : null;
  const pending  = accounts.filter((a) => !insights[a.id] && a.token_status !== "expired").length;

  const cards = [
    { label: "SAUDÁVEIS", count: good,    color: "var(--success)", bg: "rgba(34,197,94,0.08)",  border: "rgba(34,197,94,0.25)",  icon: "🟢" },
    { label: "ATENÇÃO",   count: warning, color: "var(--warning)", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", icon: "🟡" },
    { label: "CRÍTICAS",  count: danger,  color: "var(--danger)",  bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.25)",  icon: "🔴" },
  ];

  const avgColor = avgScore == null ? "var(--muted)"
    : avgScore >= 75 ? "var(--success)"
    : avgScore >= 45 ? "var(--warning)"
    : "var(--danger)";

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Status de Saúde
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            {accounts.length} conta(s) monitorada(s){pending > 0 && ` · ${pending} aguardando dados`}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onRefreshAll}
          disabled={refreshingAll || accounts.length === 0}
        >
          {refreshingAll
            ? `↻ Atualizando ${refreshProgress.done}/${refreshProgress.total}...`
            : "↻ Atualizar tudo"}
        </button>
      </div>

      {/* Grade de cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }} className="health-grid">
        {cards.map((c) => (
          <div key={c.label} style={{
            padding: "12px 10px",
            background: c.bg, border: `1px solid ${c.border}`,
            borderRadius: 10,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 4, textAlign: "center",
          }}>
            <div style={{ fontSize: 20 }}>{c.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.color, lineHeight: 1 }}>{c.count}</div>
            <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{c.label}</div>
          </div>
        ))}

        {/* Score médio */}
        <div style={{
          padding: "12px 10px",
          background: "var(--bg2)", border: "1px solid var(--border2)",
          borderRadius: 10,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 4, textAlign: "center",
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: "50%",
            background: `conic-gradient(${avgColor} ${(avgScore || 0) * 3.6}deg, var(--bg3) 0deg)`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%", background: "var(--bg2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 800, color: avgColor,
            }}>
              {avgScore ?? "—"}
            </div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: avgColor }}>
            {avgScore == null ? "Carregando" : avgScore >= 75 ? "Bom" : avgScore >= 45 ? "Regular" : "Ruim"}
          </div>
          <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Score médio</div>
        </div>
      </div>

      {/* Alertas críticos */}
      {alerts.length > 0 && (
        <div style={{
          marginTop: 10, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.22)",
          borderRadius: 9, padding: "10px 13px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--danger)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            ⚠ Alertas críticos ({alerts.length})
          </div>
          {alerts.slice(0, 3).map((a, i) => (
            <div key={i} style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5, marginBottom: 3 }}>
              <span style={{ color: "var(--danger)", fontWeight: 700 }}>@{a.username}</span>
              <span style={{ color: "var(--muted)" }}> — </span>
              {a.msg}
            </div>
          ))}
          {alerts.length > 3 && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              + {alerts.length - 3} alerta(s) adicional(is)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Modal: Renomear conta ─────────────────────────────────────────────────────
function RenameModal({ acc, onClose, onSaved }) {
  const [nickname, setNickname] = useState(acc.nickname || acc.name || "");
  const [saving,   setSaving]   = useState(false);
  const save = async () => {
    setSaving(true);
    await onSaved({ ...acc, nickname: nickname.trim() || acc.username });
    onClose();
    setSaving(false);
  };
  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{
      position: "fixed", inset: 0, zIndex: 4000,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 16, width: "100%", maxWidth: 400, boxShadow: "0 24px 64px rgba(0,0,0,0.7)", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar acc={acc} size={36} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>✏️ Editar nome</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>@{acc.username}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", color: "var(--muted)", fontSize: 22, padding: "0 4px" }}>×</button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <input
            type="text" value={nickname} onChange={(e) => setNickname(e.target.value)}
            placeholder={acc.username} maxLength={50} autoFocus
            onKeyDown={(e) => e.key === "Enter" && save()}
            style={{ width: "100%", boxSizing: "border-box" }}
          />
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            Apenas visível no gerenciador. Não altera nada no Instagram.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </button>
            <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Adicionar via Page ID ──────────────────────────────────────────────
function AddViaPageModal({ onClose, onAdded }) {
  const [pageId,    setPageId]    = useState("");
  const [pageToken, setPageToken] = useState("");
  const [nickname,  setNickname]  = useState("");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [preview,   setPreview]   = useState(null);

  const validate = async () => {
    setError(null); setPreview(null);
    if (!pageId.trim() || !pageToken.trim()) { setError("Preencha o Page ID e o Page Access Token."); return; }
    setLoading(true);
    try {
      const res  = await fetch("/api/add-account-via-page", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page_id: pageId.trim(), page_access_token: pageToken.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) setError(data.error || "Erro ao validar. Tente novamente.");
      else setPreview(data.account);
    } catch (e) { setError("Erro de rede: " + e.message); }
    setLoading(false);
  };

  const confirm = async () => {
    if (!preview) return;
    await onAdded({ ...preview, nickname: nickname.trim() || undefined });
    onClose();
  };

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{
      position: "fixed", inset: 0, zIndex: 2500,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 18, width: "100%", maxWidth: 460, boxShadow: "0 24px 64px rgba(0,0,0,0.7)", overflow: "hidden" }}>
        <div style={{ padding: "18px 20px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>🔑 Adicionar via Page ID</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>Use um Page Access Token já existente</div>
          </div>
          <button onClick={onClose} style={{ background: "none", color: "var(--muted)", fontSize: 22, padding: "0 4px", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ padding: "10px 14px", background: "rgba(124,92,252,0.08)", borderRadius: 9, border: "1px solid rgba(124,92,252,0.2)", fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
            💡 Obtenha seu <strong style={{ color: "var(--text)" }}>Page Access Token</strong> no{" "}
            <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" style={{ color: "var(--accent-light)" }}>Graph API Explorer</a> ou no Meta Business Suite.
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>Page ID <span style={{ color: "var(--danger)" }}>*</span></label>
            <input type="text" value={pageId} onChange={(e) => { setPageId(e.target.value); setPreview(null); setError(null); }} placeholder="Ex: 123456789012345" style={{ width: "100%", boxSizing: "border-box" }} disabled={loading} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>Page Access Token <span style={{ color: "var(--danger)" }}>*</span></label>
            <textarea value={pageToken} onChange={(e) => { setPageToken(e.target.value); setPreview(null); setError(null); }} placeholder="EAABs..." style={{ width: "100%", minHeight: 70, fontFamily: "monospace", fontSize: 12, resize: "vertical", boxSizing: "border-box" }} disabled={loading} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>Apelido <span style={{ color: "var(--muted)", fontWeight: 400 }}>(opcional)</span></label>
            <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Ex: Conta Principal..." maxLength={50} style={{ width: "100%", boxSizing: "border-box" }} disabled={loading} />
          </div>
          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, background: "rgba(239,68,68,0.08)", color: "var(--danger)", border: "1px solid rgba(239,68,68,0.2)" }}>
              ✕ {error}
            </div>
          )}
          {preview && (
            <div style={{ padding: 14, borderRadius: 10, background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.25)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--success)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>✓ Conta encontrada</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {preview.profile_picture
                  ? <img src={preview.profile_picture} alt="" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--border2)", flexShrink: 0 }} />
                  : <div style={{ width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(135deg,#7c5cfc,#e040fb)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, color: "#fff", flexShrink: 0 }}>{(preview.username || "?")[0].toUpperCase()}</div>}
                <div>
                  <div style={{ fontWeight: 700 }}>{preview.name || preview.username}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>@{preview.username}</div>
                  <span className="badge badge-purple" style={{ fontSize: 10, marginTop: 4 }}>{preview.account_type}</span>
                </div>
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            {!preview ? (
              <>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={validate} disabled={loading || !pageId.trim() || !pageToken.trim()}>
                  {loading ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Validando...</> : "Validar e buscar conta"}
                </button>
                <button className="btn btn-ghost" onClick={onClose} disabled={loading}>Cancelar</button>
              </>
            ) : (
              <>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={confirm}>✓ Confirmar e adicionar</button>
                <button className="btn btn-ghost" onClick={() => setPreview(null)}>Corrigir</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Modal de detalhes da conta ────────────────────────────────────────────────
function AccountDetailModal({ acc, ins, loadingInsights, onClose, onEdit, onRemove, onRefresh }) {
  const tokenExpired = acc.token_status === "expired";
  const health       = ins?.health;
  const meta         = healthMeta(health?.overall, tokenExpired);

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: "var(--bg2)", border: "1px solid var(--border2)",
        borderRadius: 18, width: "100%", maxWidth: 420,
        maxHeight: "90vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,0.7)", overflow: "hidden",
      }}>
        {/* Header colorido */}
        <div style={{ height: 48, background: `linear-gradient(135deg, ${meta.bg}, ${meta.border}20)`, position: "relative", borderBottom: "1px solid var(--border)" }}>
          <button onClick={onClose} style={{ position: "absolute", top: 10, right: 12, background: "none", color: "var(--muted)", fontSize: 20, padding: "0 4px", lineHeight: 1 }}>×</button>
        </div>

        {/* Avatar + ações */}
        <div style={{ padding: "0 16px", marginTop: -24, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <Avatar acc={acc} ins={ins} size={52} />
          <div style={{ display: "flex", gap: 6, paddingBottom: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={loadingInsights}>
              {loadingInsights ? <span className="spinner" style={{ width: 12, height: 12 }} /> : "↻"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onEdit}>✏️</button>
            <button className="btn btn-danger btn-sm" onClick={onRemove}>Desconectar</button>
          </div>
        </div>

        {/* Nome + badges */}
        <div style={{ padding: "8px 16px 12px" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{acc.nickname || acc.name || acc.username}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>@{acc.username}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className="badge badge-purple">{acc.account_type || "BUSINESS"}</span>
            {acc.added_via === "page_id" && <span className="badge" style={{ fontSize: 10, background: "rgba(245,158,11,0.12)", color: "var(--warning)", border: "1px solid rgba(245,158,11,0.3)" }}>🔑 via Page ID</span>}
            {(health || tokenExpired) && (
              <HealthBadge overall={health?.overall} tokenExpired={tokenExpired} score={health?.score} />
            )}
          </div>
        </div>

        {/* Corpo scrollável */}
        <div style={{ padding: "0 16px 16px", overflowY: "auto", flex: 1 }}>
          {loadingInsights ? (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <div className="spinner" style={{ width: 24, height: 24, margin: "0 auto 10px" }} />
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Buscando dados...</div>
            </div>
          ) : ins ? (
            <>
              {/* Stats */}
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                <StatBox label="Seguidores" value={fmt(ins.followers_count)} icon="👥" />
                <StatBox label="Seguindo"   value={fmt(ins.follows_count)}   icon="➡️" />
                <StatBox label="Posts"      value={fmt(ins.media_count)}      icon="📸" />
              </div>

              {ins.biography && (
                <div style={{ marginBottom: 10, padding: "9px 12px", background: "var(--bg3)", borderRadius: 8, fontSize: 12, color: "var(--text)", lineHeight: 1.6 }}>
                  {ins.biography}
                </div>
              )}

              {ins.website && (
                <a href={ins.website} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--accent-light)", marginBottom: 10, padding: "7px 11px", background: "var(--bg3)", borderRadius: 8 }}>
                  🔗 {ins.website.replace(/^https?:\/\//, "")}
                </a>
              )}

              {/* Infos da conta */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
                {[
                  { icon: "🗂", label: "Tipo",          value: ins.account_type || acc.account_type || "BUSINESS" },
                  { icon: "🗓", label: "Conectada em",  value: new Date(acc.connected_at || Date.now()).toLocaleDateString("pt-BR") },
                  { icon: "🔄", label: "Atualizado",    value: ins.fetched_at ? new Date(ins.fetched_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—" },
                  { icon: "🆔", label: "ID",            value: acc.id },
                ].map((item) => (
                  <div key={item.label} style={{ padding: "7px 9px", background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>{item.icon} {item.label}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.value}</div>
                  </div>
                ))}
              </div>

              {/* Saúde detalhada */}
              {(health || tokenExpired) && (
                <div style={{ marginBottom: 12, background: "var(--bg3)", borderRadius: 10, padding: "12px 13px", border: `1px solid ${meta.border}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Saúde</span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: meta.color }}>
                      {tokenExpired ? 0 : (health?.score ?? "—")}
                      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>/100</span>
                    </span>
                  </div>
                  {/* Barra de score */}
                  <div style={{ height: 5, background: "var(--bg)", borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
                    <div style={{ height: "100%", width: `${tokenExpired ? 0 : (health?.score ?? 0)}%`, background: meta.color, borderRadius: 4, transition: "width 0.5s ease" }} />
                  </div>
                  {/* Issues */}
                  {(tokenExpired || health?.issues?.length > 0) ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {(tokenExpired ? ["Token de acesso expirado — reconecte a conta."] : health.issues).map((issue, i) => (
                        <div key={i} style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.5, padding: "6px 10px", background: meta.bg, borderRadius: 6, borderLeft: `2px solid ${meta.color}` }}>
                          {issue}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: "var(--success)", textAlign: "center" }}>✓ Nenhum alerta — conta em boas condições</div>
                  )}
                </div>
              )}

              {/* Alcance 7d vs semana anterior */}
              {ins.insights_7d && (
                <div style={{ marginBottom: 12, background: "var(--bg3)", borderRadius: 8, padding: "10px 12px", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                    Alcance — últimos 7 dias
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1, textAlign: "center", padding: "8px", background: "var(--bg)", borderRadius: 7 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>{fmt(ins.insights_7d.reach)}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>Alcance total</div>
                    </div>
                    {ins.insights_prev_7d && (
                      <div style={{ flex: 1, textAlign: "center", padding: "8px", background: "var(--bg)", borderRadius: 7 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--muted)" }}>{fmt(ins.insights_prev_7d.reach)}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>7d anteriores</div>
                      </div>
                    )}
                    {health?.reach_drop_pct != null && (
                      <div style={{ flex: 1, textAlign: "center", padding: "8px", background: "var(--bg)", borderRadius: 7 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: health.reach_drop_pct > 30 ? "var(--danger)" : health.reach_drop_pct > 0 ? "var(--warning)" : "var(--success)" }}>
                          {health.reach_drop_pct > 0 ? `↓${health.reach_drop_pct}%` : `↑${Math.abs(health.reach_drop_pct)}%`}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>Variação</div>
                      </div>
                    )}
                  </div>
                  {ins.insights_7d.profile_views != null && (
                    <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                      👁 {fmt(ins.insights_7d.profile_views)} visitas ao perfil
                    </div>
                  )}
                </div>
              )}

              {/* Quota de publicação */}
              {ins.publishing_limit?.config?.quota_total && (() => {
                const used  = ins.publishing_limit.quota_usage || 0;
                const total = ins.publishing_limit.config.quota_total;
                const pct   = Math.min(100, Math.round((used / total) * 100));
                const color = pct >= 100 ? "var(--danger)" : pct >= 80 ? "var(--warning)" : "var(--success)";
                return (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                      Limite de publicação (24h)
                    </div>
                    <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "10px 12px", border: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 12 }}>
                        <span>{used}/{total} posts</span>
                        <span style={{ color, fontWeight: 700 }}>{pct}%</span>
                      </div>
                      <div style={{ height: 6, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width 0.4s ease" }} />
                      </div>
                    </div>
                    {ins.restriction_note && (
                      <div style={{ marginTop: 6, fontSize: 11, color: ins.account_status === "limited" ? "var(--danger)" : "var(--warning)", padding: "6px 10px", background: ins.account_status === "limited" ? "rgba(239,68,68,0.06)" : "rgba(245,158,11,0.07)", borderRadius: 7, borderLeft: `3px solid ${ins.account_status === "limited" ? "var(--danger)" : "var(--warning)"}` }}>
                        ⚠️ {ins.restriction_note}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Token */}
              <div style={{ padding: "8px 11px", background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
                <span>🔒</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>Token de acesso</div>
                  <div style={{ fontSize: 10, color: tokenExpired ? "var(--danger)" : "var(--success)" }}>
                    {tokenExpired ? "Expirado — reconecte a conta" : "Armazenado com segurança"}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "20px 0", color: "var(--muted)", fontSize: 13 }}>
              Não foi possível carregar os dados da conta.
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
      const res  = await fetch("/api/update-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instagram_id: acc.id, access_token: acc.access_token, biography: bio, website }) });
      const data = await res.json();
      if (data.success) { setResult({ type: "success", msg: "Bio e link atualizados!" }); onSaved({ ...acc, biography: bio, website }); }
      else setResult({ type: "error", msg: data.error || "Erro ao atualizar." });
    } catch (e) { setResult({ type: "error", msg: e.message }); }
    setLoading(false);
  };

  const savePhoto = async () => {
    if (!photoUrl.trim()) return;
    setLoading(true); setResult(null);
    try {
      const res  = await fetch("/api/update-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instagram_id: acc.id, access_token: acc.access_token, profile_picture_url: photoUrl }) });
      const data = await res.json();
      if (data.success) { setResult({ type: "success", msg: "Foto atualizada!" }); onSaved({ ...acc, profile_picture: photoUrl }); setPhotoUrl(""); }
      else setResult({ type: "error", msg: data.error || "Erro ao atualizar foto." });
    } catch (e) { setResult({ type: "error", msg: e.message }); }
    setLoading(false);
  };

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
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
            <button key={t.id} onClick={() => { setTab(t.id); setResult(null); }} style={{ flex: 1, padding: 11, fontSize: 13, fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? "var(--accent-light)" : "var(--muted)", background: "none", borderBottom: `2px solid ${tab === t.id ? "var(--accent)" : "transparent"}` }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ padding: 20 }}>
          {tab === "bio" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label>Bio</label>
                <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Escreva sua bio..." style={{ minHeight: 80 }} maxLength={150} />
                <div style={{ fontSize: 11, color: bio.length > 130 ? "var(--warning)" : "var(--muted)", textAlign: "right", marginTop: 3 }}>{bio.length}/150</div>
              </div>
              <div>
                <label>Link da bio</label>
                <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://seusite.com.br" />
              </div>
              <div style={{ padding: "8px 11px", background: "rgba(245,158,11,0.07)", borderRadius: 8, fontSize: 11, color: "var(--warning)", borderLeft: "3px solid var(--warning)" }}>
                ⚠️ Requer permissão <strong>instagram_manage_profile</strong> aprovada.
              </div>
              {result && <div style={{ padding: "9px 13px", borderRadius: 8, fontSize: 12, background: result.type === "success" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)", color: result.type === "success" ? "var(--success)" : "var(--danger)" }}>{result.type === "success" ? "✓ " : "✕ "}{result.msg}</div>}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveProfile} disabled={loading}>{loading ? <><span className="spinner" /> Salvando...</> : "Salvar"}</button>
                <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              </div>
            </div>
          )}
          {tab === "photo" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, background: "var(--bg3)", borderRadius: 10 }}>
                <Avatar acc={acc} size={50} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Foto atual</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>@{acc.username}</div>
                </div>
              </div>
              <div>
                <label>URL da nova foto</label>
                <input type="url" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://files.catbox.moe/foto.jpg" />
              </div>
              {photoUrl && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 13px", background: "var(--bg3)", borderRadius: 9, border: "1px solid var(--accent)" }}>
                  <img src={photoUrl} alt="preview" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--accent)", flexShrink: 0 }} onError={(e) => { e.target.style.opacity = "0.3"; }} />
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>Prévia</div>
                </div>
              )}
              <div style={{ padding: "8px 11px", background: "rgba(245,158,11,0.07)", borderRadius: 8, fontSize: 11, color: "var(--warning)", borderLeft: "3px solid var(--warning)" }}>
                ⚠️ Requer permissão <strong>instagram_manage_profile</strong> aprovada.
              </div>
              {result && <div style={{ padding: "9px 13px", borderRadius: 8, fontSize: 12, background: result.type === "success" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)", color: result.type === "success" ? "var(--success)" : "var(--danger)" }}>{result.type === "success" ? "✓ " : "✕ "}{result.msg}</div>}
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={savePhoto} disabled={loading || !photoUrl.trim()}>{loading ? <><span className="spinner" /> Atualizando...</> : "Atualizar foto"}</button>
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
  const { accounts, removeAccount, clearAllAccounts, loading, reloadAccounts, addAccounts } = useAccounts();
  const [confirmModal,    setConfirmModal]    = useState(null);
  const [editingAcc,      setEditingAcc]      = useState(null);
  const [detailAcc,       setDetailAcc]       = useState(null);
  const [insights,        setInsights]        = useState({});
  const [loadingIns,      setLoadingIns]      = useState({});
  const [showPageIdModal, setShowPageIdModal] = useState(false);
  const [renamingAcc,     setRenamingAcc]     = useState(null);
  const [refreshingAll,   setRefreshingAll]   = useState(false);
  const [refreshProgress, setRefreshProgress] = useState({ done: 0, total: 0 });

  const APP_ID   = import.meta.env.VITE_META_APP_ID;
  const REDIRECT = encodeURIComponent(window.location.origin + "/api/auth-callback");
  const SCOPE    = "instagram_basic,instagram_content_publish,instagram_manage_insights,pages_read_engagement,pages_show_list,pages_manage_posts,business_management,pages_manage_metadata";
  const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${REDIRECT}&scope=${SCOPE}&response_type=code`;

  // Refs para evitar closures velhas nos callbacks
  const insightsRef   = useRef(insights);
  const loadingInsRef = useRef(loadingIns);
  useEffect(() => { insightsRef.current   = insights;   }, [insights]);
  useEffect(() => { loadingInsRef.current = loadingIns; }, [loadingIns]);

  // ── fetchInsights ────────────────────────────────────────────────────────────
  // Chama /api/account-insights e salva o resultado em insights[acc.id].
  // O objeto retornado pelo backend já tem { health, insights_7d, insights_prev_7d, ... }
  // Não transformamos nada — usamos direto como veio do servidor.
  const fetchInsights = useCallback(async (acc, force = false) => {
    if (!force && (loadingInsRef.current[acc.id] || insightsRef.current[acc.id])) return;
    if (!acc.access_token) return;

    setLoadingIns((p) => ({ ...p, [acc.id]: true }));

    try {
      const res  = await fetch("/api/account-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagram_id: acc.id, access_token: acc.access_token }),
      });
      const json = await res.json();

      // Token expirado
      if (res.status === 401 || json.error === "token_expired") {
        await dbPut("sessions", { ...acc, token_status: "expired" });
        reloadAccounts();
        setInsights((p) => ({ ...p, [acc.id]: null }));
        setLoadingIns((p) => ({ ...p, [acc.id]: false }));
        return;
      }

      if (res.ok && !json.error) {
        // Persistir dados atualizados no IndexedDB
        const updatedAcc = {
          ...acc,
          username:        json.username        || acc.username,
          name:            json.name            || acc.name,
          profile_picture: json.profile_picture || acc.profile_picture,
          followers_count: json.followers_count ?? acc.followers_count,
          follows_count:   json.follows_count   ?? acc.follows_count,
          media_count:     json.media_count     ?? acc.media_count,
          biography:       json.biography       || acc.biography || "",
          website:         json.website         || acc.website   || "",
        };
        await dbPut("sessions", updatedAcc);
        reloadAccounts();

        // Salvar objeto completo — health, insights_7d, etc. vêm do servidor intactos
        setInsights((p) => ({ ...p, [acc.id]: json }));
      } else {
        setInsights((p) => ({ ...p, [acc.id]: null }));
      }
    } catch {
      setInsights((p) => ({ ...p, [acc.id]: null }));
    }

    setLoadingIns((p) => ({ ...p, [acc.id]: false }));
  }, [reloadAccounts]);

  // ── Atualizar em lotes de 10 em paralelo ───────────────────────────────────
  const handleRefreshAll = useCallback(async () => {
    if (refreshingAll || accounts.length === 0) return;
    setRefreshingAll(true);
    setRefreshProgress({ done: 0, total: accounts.length });
    const BATCH = 10;
    for (let i = 0; i < accounts.length; i += BATCH) {
      const batch = accounts.slice(i, i + BATCH);
      await Promise.all(batch.map((acc) => fetchInsights(acc, true)));
      setRefreshProgress({ done: Math.min(i + BATCH, accounts.length), total: accounts.length });
    }
    setRefreshingAll(false);
  }, [accounts, refreshingAll, fetchInsights]);

  // ── Auto-atualização a cada 30 minutos em segundo plano ─────────────────
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (accounts.length === 0) return;
    const INTERVAL_MS = 30 * 60 * 1000;
    const BATCH = 10;
    const runSilent = async () => {
      for (let i = 0; i < accounts.length; i += BATCH) {
        const batch = accounts.slice(i, i + BATCH);
        await Promise.all(batch.map((acc) => fetchInsights(acc, true)));
      }
    };
    const timer = setInterval(runSilent, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [accounts, fetchInsights]);

  const openDetail = (acc) => {
    setDetailAcc(acc);
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

  const handleAddViaPage = async (account) => {
    await addAccounts([account]);
    setTimeout(() => fetchInsights(account, true), 600);
  };

  if (loading) return (
    <div className="page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
      <div className="spinner" style={{ width: 28, height: 28 }} />
    </div>
  );

  return (
    <div className="page">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div className="page-title">Contas conectadas</div>
          <div className="page-subtitle">{accounts.length} conta(s) vinculada(s) via Meta API</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {accounts.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmModal({ type: "clear" })}>
              Remover todas
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowPageIdModal(true)}>
            🔑 Adicionar via Page ID
          </button>
          <a href={oauthUrl} className="btn btn-primary">+ Conta</a>
        </div>
      </div>

      {/* ── Modais ─────────────────────────────────────────────────────────── */}
      {showPageIdModal && <AddViaPageModal onClose={() => setShowPageIdModal(false)} onAdded={handleAddViaPage} />}

      {detailAcc && (
        <AccountDetailModal
          acc={detailAcc}
          ins={insights[detailAcc.id]}
          loadingInsights={!!loadingIns[detailAcc.id]}
          onClose={() => setDetailAcc(null)}
          onEdit={() => { setEditingAcc(detailAcc); setDetailAcc(null); }}
          onRemove={() => { setConfirmModal({ type: "remove", id: detailAcc.id, username: detailAcc.username }); setDetailAcc(null); }}
          onRefresh={() => fetchInsights(detailAcc, true)}
        />
      )}

      {editingAcc && <EditProfileModal acc={editingAcc} onClose={() => setEditingAcc(null)} onSaved={handleSaved} />}

      {renamingAcc && (
        <RenameModal
          acc={renamingAcc}
          onClose={() => setRenamingAcc(null)}
          onSaved={async (updated) => { await addAccounts([updated]); }}
        />
      )}

      {/* ── Vazio ──────────────────────────────────────────────────────────── */}
      {accounts.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📱</div>
          <div className="empty-title">Nenhuma conta conectada</div>
          <div style={{ fontSize: 13, marginBottom: 20, color: "var(--muted)" }}>Conecte contas Instagram Business ou Creator.</div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <a href={oauthUrl} className="btn btn-primary">+ Conectar via OAuth</a>
            <button className="btn btn-ghost" onClick={() => setShowPageIdModal(true)}>🔑 Adicionar via Page ID</button>
          </div>
        </div>
      ) : (
        <>
          {/* ── Health Overview ─────────────────────────────────────────────── */}
          <HealthOverview
            accounts={accounts}
            insights={insights}
            onRefreshAll={handleRefreshAll}
            refreshingAll={refreshingAll}
            refreshProgress={refreshProgress}
          />

          {/* ── Grid de cards ──────────────────────────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
            {accounts.map((acc) => {
              const ins          = insights[acc.id];
              const isLoading    = !!loadingIns[acc.id];
              const tokenExpired = acc.token_status === "expired";
              const health       = ins?.health;
              const topIssue     = tokenExpired ? "Token expirado — reconecte."
                : (health?.issues?.[0] || null);

              // Quota
              const quotaUsed  = ins?.publishing_limit?.quota_usage || 0;
              const quotaTotal = ins?.publishing_limit?.config?.quota_total;
              const quotaPct   = quotaTotal ? Math.min(100, Math.round((quotaUsed / quotaTotal) * 100)) : null;
              const quotaColor = quotaPct == null ? "var(--muted)"
                : quotaPct >= 100 ? "var(--danger)"
                : quotaPct >= 80  ? "var(--warning)"
                : "var(--success)";

              return (
                <div
                  key={acc.id}
                  className="card card-hover"
                  style={{ display: "flex", flexDirection: "column", gap: 10, cursor: "pointer", position: "relative" }}
                  onClick={() => openDetail(acc)}
                >
                  {/* Botões de ação rápida no canto */}
                  <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setRenamingAcc(acc)}
                      title="Renomear"
                      style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 7px", fontSize: 10, color: "var(--muted)", cursor: "pointer", lineHeight: 1 }}
                    >✏️</button>
                    <button
                      onClick={() => fetchInsights(acc, true)}
                      disabled={isLoading}
                      title="Atualizar"
                      style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 7px", fontSize: 10, color: "var(--muted)", cursor: isLoading ? "default" : "pointer", opacity: isLoading ? 0.5 : 1, lineHeight: 1 }}
                    >↻</button>
                  </div>

                  {/* Topo: avatar + nome */}
                  <div style={{ display: "flex", alignItems: "center", gap: 11, paddingRight: 52 }}>
                    <Avatar acc={acc} ins={ins} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {acc.nickname || ins?.name || acc.name || acc.username || "—"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        @{ins?.username || acc.username || "—"}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                        <span className="badge badge-purple" style={{ fontSize: 9 }}>{acc.account_type || "BUSINESS"}</span>
                        {acc.added_via === "page_id" && <span style={{ fontSize: 10, color: "var(--warning)" }} title="via Page ID">🔑</span>}
                        {/* Badge de saúde — mostra assim que health.overall estiver disponível */}
                        {(health?.overall || tokenExpired) && (
                          <HealthBadge
                            overall={health?.overall}
                            tokenExpired={tokenExpired}
                            score={health?.score}
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Stats: seguidores / seguindo / posts */}
                  {isLoading ? (
                    <div style={{ display: "flex", gap: 5 }}>
                      {["Seguidores", "Seguindo", "Posts"].map((l) => (
                        <div key={l} style={{ flex: 1, textAlign: "center", padding: "7px 4px", background: "var(--bg3)", borderRadius: 7, border: "1px solid var(--border)" }}>
                          <div style={{ height: 14, width: "55%", background: "var(--border)", borderRadius: 4, margin: "0 auto 4px", animation: "pulse 1.2s ease infinite" }} />
                          <div style={{ fontSize: 9, color: "var(--muted)" }}>{l}</div>
                        </div>
                      ))}
                    </div>
                  ) : ins ? (
                    <div style={{ display: "flex", gap: 5 }}>
                      {[
                        { v: fmt(ins.followers_count), l: "Seguidores" },
                        { v: fmt(ins.follows_count),   l: "Seguindo" },
                        { v: fmt(ins.media_count),     l: "Posts" },
                      ].map((s) => (
                        <div key={s.l} style={{ flex: 1, textAlign: "center", padding: "7px 4px", background: "var(--bg3)", borderRadius: 7, border: "1px solid var(--border)" }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{s.v}</div>
                          <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 1 }}>{s.l}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", padding: "4px 0" }}>
                      <span className="pulse">↻</span> Carregando...
                    </div>
                  )}

                  {/* Alcance 7d */}
                  {ins?.insights_7d?.reach != null && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                      <span style={{ color: "var(--muted)" }}>📊 Alcance 7d</span>
                      <span style={{ color: "var(--text)", fontWeight: 600 }}>
                        {fmt(ins.insights_7d.reach)}
                        {health?.reach_drop_pct != null && health.reach_drop_pct !== 0 && (
                          <span style={{
                            marginLeft: 6, fontSize: 10,
                            color: health.reach_drop_pct > 50 ? "var(--danger)"
                              : health.reach_drop_pct > 0 ? "var(--warning)"
                              : "var(--success)",
                          }}>
                            {health.reach_drop_pct > 0 ? `↓${health.reach_drop_pct}%` : `↑${Math.abs(health.reach_drop_pct)}%`}
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Barra de quota */}
                  {quotaPct != null && (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>
                        <span>Posts hoje</span>
                        <span style={{ color: quotaColor, fontWeight: 600 }}>{quotaUsed}/{quotaTotal} ({quotaPct}%)</span>
                      </div>
                      <div style={{ height: 4, background: "var(--bg3)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${quotaPct}%`, background: quotaColor, borderRadius: 4 }} />
                      </div>
                    </div>
                  )}

                  {/* Alerta principal */}
                  {topIssue && (
                    <div style={{
                      fontSize: 10, lineHeight: 1.45, padding: "6px 8px",
                      background: tokenExpired || health?.overall === "danger" ? "rgba(239,68,68,0.07)" : "rgba(245,158,11,0.07)",
                      borderLeft: `2px solid ${tokenExpired || health?.overall === "danger" ? "var(--danger)" : "var(--warning)"}`,
                      borderRadius: 4, color: "var(--text2)",
                      overflow: "hidden", display: "-webkit-box",
                      WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                    }}>
                      ⚠ {topIssue}
                    </div>
                  )}

                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: "auto" }}>
                    🗓 Conectada em {new Date(acc.connected_at || Date.now()).toLocaleDateString("pt-BR")}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 16, padding: "10px 14px", background: "var(--bg2)", borderRadius: 9, border: "1px solid var(--border)", fontSize: 11, color: "var(--muted)" }}>
            💡 Clique em qualquer conta para ver detalhes completos. Use ↻ para atualizar individualmente ou "Atualizar tudo" no topo.
          </div>
        </>
      )}

      {/* ── Confirm Modal ──────────────────────────────────────────────────── */}
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

      {/* ── Responsividade mobile ───────────────────────────────────────────── */}
      <style>{`
        @media (max-width: 600px) {
          .health-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
      `}</style>
    </div>
  );
}
