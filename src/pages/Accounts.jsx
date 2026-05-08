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

// ── Mapeia overall (good/warning/danger) → cor/label/ícone ───────────────────
function healthMeta(overall, tokenExpired) {
  if (tokenExpired) {
    return { color: "var(--danger)", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.3)", label: "Token expirado", icon: "🔴" };
  }
  switch (overall) {
    case "good":    return { color: "var(--success)", bg: "rgba(34,197,94,0.08)",  border: "rgba(34,197,94,0.3)",  label: "Saudável",  icon: "🟢" };
    case "warning": return { color: "var(--warning)", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.3)", label: "Atenção",   icon: "🟡" };
    case "danger":  return { color: "var(--danger)",  bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.3)",  label: "Crítico",   icon: "🔴" };
    default:        return { color: "var(--muted)",   bg: "var(--bg3)",            border: "var(--border)",         label: "—",         icon: "⚪" };
  }
}

// ── Badge de saúde com score numérico (cards) ────────────────────────────────
function HealthBadge({ health, tokenExpired, size = "sm" }) {
  const meta = healthMeta(health?.overall, tokenExpired);
  const score = tokenExpired ? 0 : (health?.score ?? null);
  const isLg = size === "lg";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: isLg ? 6 : 4,
      padding: isLg ? "4px 10px" : "2px 7px",
      background: meta.bg, border: `1px solid ${meta.border}`,
      borderRadius: 999, fontSize: isLg ? 12 : 10, fontWeight: 700,
      color: meta.color, lineHeight: 1,
    }}>
      <span style={{ fontSize: isLg ? 11 : 9 }}>●</span>
      <span>{meta.label}</span>
      {score != null && (
        <span style={{ opacity: 0.75, fontWeight: 600 }}>· {score}</span>
      )}
    </div>
  );
}

// ── Comparação de reach 7d × 7d anteriores (modal de detalhes) ────────────────
function ReachComparison({ insights7d, insightsPrev7d, dropPct }) {
  const reach     = insights7d?.reach ?? 0;
  const reachPrev = insightsPrev7d?.reach ?? 0;
  const max       = Math.max(reach, reachPrev, 1);
  const trendUp   = reach > reachPrev;
  const arrow     = reach === reachPrev ? "→" : trendUp ? "↑" : "↓";
  const trendColor = reach === reachPrev ? "var(--muted)"
                    : trendUp            ? "var(--success)"
                                         : (dropPct >= 50 ? "var(--danger)" : "var(--warning)");
  return (
    <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "10px 12px", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Alcance — comparação semanal
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: trendColor }}>
          {arrow} {dropPct != null ? (dropPct > 0 ? `-${dropPct}%` : `+${Math.abs(dropPct)}%`) : "—"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[
          { label: "Últimos 7d",   value: reach,     color: trendColor },
          { label: "7d anteriores", value: reachPrev, color: "var(--muted)" },
        ].map((row) => (
          <div key={row.label}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
              <span style={{ color: "var(--muted)" }}>{row.label}</span>
              <span style={{ color: "var(--text)", fontWeight: 600 }}>{row.value.toLocaleString("pt-BR")}</span>
            </div>
            <div style={{ height: 5, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(row.value / max) * 100}%`, background: row.color, borderRadius: 4, transition: "width 0.4s ease" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Health Overview no topo da página ────────────────────────────────────────
function HealthOverview({ accounts, insights, loadingMap, onRefreshAll, refreshingAll, refreshProgress }) {
  // Conta cada bucket. Token expirado entra em danger.
  let good = 0, warning = 0, danger = 0, scored = 0, scoreSum = 0;
  const criticalAlerts = [];

  for (const acc of accounts) {
    const ins = insights[acc.id];
    const tokenExpired = acc.token_status === "expired";
    const overall = tokenExpired ? "danger" : (ins?.health?.overall || null);

    if (overall === "good")    good++;
    else if (overall === "warning") warning++;
    else if (overall === "danger")  danger++;

    if (!tokenExpired && typeof ins?.health?.score === "number") {
      scoreSum += ins.health.score;
      scored++;
    } else if (tokenExpired) {
      scoreSum += 0;
      scored++;
    }

    // Coleta alertas críticos (até 4)
    if (tokenExpired) {
      criticalAlerts.push({ username: acc.username, msg: "Token expirado — reconecte." });
    } else if (ins?.health?.overall === "danger" && ins.health.issues?.length) {
      criticalAlerts.push({ username: acc.username, msg: ins.health.issues[0] });
    }
  }

  const avgScore = scored > 0 ? Math.round(scoreSum / scored) : null;
  const total = accounts.length;
  const pendingInsights = accounts.filter((a) => !insights[a.id] && !a.token_status).length;

  const cards = [
    { key: "good",    label: "Saudáveis", count: good,    color: "var(--success)", bg: "rgba(34,197,94,0.08)",  border: "rgba(34,197,94,0.25)",  icon: "🟢" },
    { key: "warning", label: "Atenção",   count: warning, color: "var(--warning)", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", icon: "🟡" },
    { key: "danger",  label: "Críticas",  count: danger,  color: "var(--danger)",  bg: "rgba(239,68,68,0.08)",  border: "rgba(239,68,68,0.25)",  icon: "🔴" },
  ];

  const avgColor = avgScore == null ? "var(--muted)"
                  : avgScore >= 75   ? "var(--success)"
                  : avgScore >= 45   ? "var(--warning)"
                                     : "var(--danger)";

  return (
    <div style={{ marginBottom: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header com botão refresh */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Status de Saúde
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            {total} conta(s) monitorada(s)
            {pendingInsights > 0 && ` · ${pendingInsights} aguardando dados`}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onRefreshAll}
          disabled={refreshingAll || total === 0}
        >
          {refreshingAll
            ? `↻ Atualizando ${refreshProgress.done}/${refreshProgress.total}...`
            : "↻ Atualizar tudo"}
        </button>
      </div>

      {/* Grade: 3 cards de status + card de score médio */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 10,
      }}>
        {cards.map((c) => (
          <div key={c.key} style={{
            padding: "14px 16px",
            background: c.bg,
            border: `1px solid ${c.border}`,
            borderRadius: 12,
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{ fontSize: 22 }}>{c.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: c.color, lineHeight: 1 }}>{c.count}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {c.label}
              </div>
            </div>
          </div>
        ))}

        {/* Card do score médio */}
        <div style={{
          padding: "14px 16px",
          background: "var(--bg2)",
          border: `1px solid var(--border2)`,
          borderRadius: 12,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            background: `conic-gradient(${avgColor} ${(avgScore || 0) * 3.6}deg, var(--bg3) 0deg)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            position: "relative",
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: "50%", background: "var(--bg2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 800, color: avgColor,
            }}>
              {avgScore ?? "—"}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: avgColor }}>
              {avgScore == null ? "Carregando" : avgScore >= 75 ? "Bom" : avgScore >= 45 ? "Regular" : "Ruim"}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Score médio
            </div>
          </div>
        </div>
      </div>

      {/* Lista de alertas críticos (até 3) */}
      {criticalAlerts.length > 0 && (
        <div style={{
          background: "rgba(239,68,68,0.06)",
          border: "1px solid rgba(239,68,68,0.25)",
          borderRadius: 10, padding: "10px 14px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--danger)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            ⚠ Alertas críticos ({criticalAlerts.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {criticalAlerts.slice(0, 3).map((a, i) => (
              <div key={i} style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.4 }}>
                <span style={{ color: "var(--danger)", fontWeight: 700 }}>@{a.username}</span>
                <span style={{ color: "var(--muted)" }}> — </span>
                <span>{a.msg}</span>
              </div>
            ))}
            {criticalAlerts.length > 3 && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                + {criticalAlerts.length - 3} alerta(s) adicional(is) — abra cada conta para ver detalhes.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Modal: Renomear conta (apelido local) ─────────────────────────────────────
function RenameModal({ acc, onClose, onSaved }) {
  const [nickname, setNickname] = useState(acc.nickname || acc.name || "");
  const [saving,   setSaving]   = useState(false);

  const save = async () => {
    setSaving(true);
    const updated = { ...acc, nickname: nickname.trim() || acc.username };
    await onSaved(updated);
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
            <div style={{ fontWeight: 700, fontSize: 14 }}>✏️ Editar nome da conta</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>@{acc.username}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", color: "var(--muted)", fontSize: 22, padding: "0 4px" }}>×</button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>
              Apelido / Nome de exibição
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={acc.username}
              maxLength={50}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && save()}
              style={{ width: "100%", boxSizing: "border-box" }}
            />
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              Apenas visível aqui no gerenciador. Não altera nada no Instagram.
            </div>
          </div>
          {nickname.trim() && nickname.trim() !== acc.username && (
            <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(124,92,252,0.08)", border: "1px solid rgba(124,92,252,0.2)", fontSize: 12, color: "var(--muted)" }}>
              Vai aparecer como: <strong style={{ color: "var(--accent-light)" }}>{nickname.trim()}</strong> <span style={{ opacity: 0.6 }}>(@{acc.username})</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={save} disabled={saving}>
              {saving ? "Salvando..." : "Salvar nome"}
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
  const [preview,   setPreview]   = useState(null); // dados validados antes de confirmar

  const validate = async () => {
    setError(null);
    setPreview(null);

    if (!pageId.trim() || !pageToken.trim()) {
      setError("Preencha o Page ID e o Page Access Token.");
      return;
    }

    setLoading(true);
    try {
      const res  = await fetch("/api/add-account-via-page", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ page_id: pageId.trim(), page_access_token: pageToken.trim() }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || "Erro ao validar os dados. Tente novamente.");
      } else {
        setPreview(data.account); // mostra prévia para o usuário confirmar
      }
    } catch (e) {
      setError("Erro de rede: " + e.message);
    }
    setLoading(false);
  };

  const confirm = async () => {
    if (!preview) return;
    await onAdded({ ...preview, nickname: nickname.trim() || undefined });
    onClose();
  };

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed", inset: 0, zIndex: 2500,
        background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div style={{
        background: "var(--bg2)", border: "1px solid var(--border2)",
        borderRadius: 18, width: "100%", maxWidth: 460,
        boxShadow: "0 24px 64px rgba(0,0,0,0.7)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "18px 20px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>🔑 Adicionar via Page ID</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              Use um Page Access Token já existente
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", color: "var(--muted)", fontSize: 22, padding: "0 4px", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Instruções */}
          <div style={{ padding: "10px 14px", background: "rgba(124,92,252,0.08)", borderRadius: 9, border: "1px solid rgba(124,92,252,0.2)", fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
            💡 Obtenha seu <strong style={{ color: "var(--text)" }}>Page Access Token</strong> no{" "}
            <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer"
              style={{ color: "var(--accent-light)" }}>Graph API Explorer</a>{" "}
            ou no Meta Business Suite. O token deve ter permissões{" "}
            <code style={{ fontSize: 11, background: "var(--bg3)", padding: "1px 5px", borderRadius: 4 }}>
              instagram_basic
            </code>{" "}
            e{" "}
            <code style={{ fontSize: 11, background: "var(--bg3)", padding: "1px 5px", borderRadius: 4 }}>
              instagram_content_publish
            </code>.
          </div>

          {/* Campo Page ID */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>
              Page ID <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <input
              type="text"
              value={pageId}
              onChange={(e) => { setPageId(e.target.value); setPreview(null); setError(null); }}
              placeholder="Ex: 123456789012345"
              style={{ width: "100%", boxSizing: "border-box" }}
              disabled={loading}
            />
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              Encontrado em Configurações da Página → Sobre → ID da Página
            </div>
          </div>

          {/* Campo Page Access Token */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>
              Page Access Token <span style={{ color: "var(--danger)" }}>*</span>
            </label>
            <textarea
              value={pageToken}
              onChange={(e) => { setPageToken(e.target.value); setPreview(null); setError(null); }}
              placeholder="EAABs..."
              style={{ width: "100%", minHeight: 80, fontFamily: "monospace", fontSize: 12, resize: "vertical", boxSizing: "border-box" }}
              disabled={loading}
            />
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              Token de longa duração recomendado (60 dias). O token será renovado automaticamente.
            </div>
          </div>

          {/* Campo Apelido (opcional) */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", display: "block", marginBottom: 6 }}>
              Apelido <span style={{ color: "var(--muted)", fontWeight: 400 }}>(opcional)</span>
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Ex: Conta Principal, Loja SP..."
              maxLength={50}
              style={{ width: "100%", boxSizing: "border-box" }}
              disabled={loading}
            />
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              Nome de exibição no gerenciador. Não altera nada no Instagram.
            </div>
          </div>

          {/* Erro */}
          {error && (
            <div style={{
              padding: "10px 14px", borderRadius: 8, fontSize: 13,
              background: "rgba(239,68,68,0.08)", color: "var(--danger)",
              border: "1px solid rgba(239,68,68,0.2)",
              display: "flex", alignItems: "flex-start", gap: 8,
            }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}>✕</span>
              <span>{error}</span>
            </div>
          )}

          {/* Prévia da conta encontrada */}
          {preview && (
            <div style={{
              padding: "14px", borderRadius: 10,
              background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.25)",
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--success)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                ✓ Conta encontrada — confirme os dados
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {preview.profile_picture ? (
                  <img src={preview.profile_picture} alt={preview.username}
                    style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--border2)", flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: "linear-gradient(135deg,#7c5cfc,#e040fb)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 20, color: "#fff", flexShrink: 0 }}>
                    {(preview.username || "?")[0].toUpperCase()}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{preview.name || preview.username}</div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>@{preview.username}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                    <span className="badge badge-purple" style={{ fontSize: 10 }}>{preview.account_type}</span>
                    {preview.followers_count != null && (
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>
                        {fmt(preview.followers_count)} seguidores
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Botões */}
          <div style={{ display: "flex", gap: 10 }}>
            {!preview ? (
              <>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={validate}
                  disabled={loading || !pageId.trim() || !pageToken.trim()}
                >
                  {loading
                    ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Validando...</>
                    : "Validar e buscar conta"}
                </button>
                <button className="btn btn-ghost" onClick={onClose} disabled={loading}>
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={confirm}>
                  ✓ Confirmar e adicionar
                </button>
                <button className="btn btn-ghost" onClick={() => setPreview(null)}>
                  Corrigir
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Modal detalhes da conta ───────────────────────────────────────────────────
function AccountDetailModal({ acc, insights, loadingInsights, onClose, onEdit, onRemove, onRefresh }) {
  const tokenExpired = acc.token_status === "expired";
  const health       = insights?.health;
  const meta         = healthMeta(health?.overall, tokenExpired);
  const status       = { color: meta.color, label: meta.label, icon: meta.icon };

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(0,0,0,0.75)", backdropFilter: "blur(5px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{
        background: "var(--bg2)", border: "1px solid var(--border2)",
        borderRadius: 18, width: "100%", maxWidth: 420,
        maxHeight: "92vh", display: "flex", flexDirection: "column",
        boxShadow: "0 24px 64px rgba(0,0,0,0.7)", overflow: "hidden",
      }}>
        <div style={{ height: 52, background: "linear-gradient(135deg, #7c5cfc22, #9b4dfc44)", position: "relative", borderBottom: "1px solid var(--border)" }}>
          <button onClick={onClose} style={{ position: "absolute", top: 12, right: 14, background: "none", color: "var(--muted)", fontSize: 20, padding: "0 4px", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: "0 16px 0", marginTop: -28 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <Avatar acc={{ ...acc, account_status: insights?.account_status }} size={56} />
            <div style={{ display: "flex", gap: 7, paddingBottom: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={loadingInsights} title="Atualizar status">
                {loadingInsights ? "↻" : "↻ Atualizar"}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={onEdit}>✏️ Editar perfil</button>
              <button className="btn btn-danger btn-sm" onClick={onRemove}>Desconectar</button>
            </div>
          </div>

          <div style={{ marginTop: 10, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{acc.nickname || acc.name || acc.username}</div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>@{acc.username}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <span className="badge badge-purple">{acc.account_type || "BUSINESS"}</span>
              {acc.added_via === "page_id" && (
                <span className="badge" style={{ fontSize: 10, background: "rgba(245,158,11,0.12)", color: "var(--warning)", border: "1px solid rgba(245,158,11,0.3)" }}>
                  🔑 via Page ID
                </span>
              )}
              <span style={{ fontSize: 11, fontWeight: 600, color: status.color, display: "flex", alignItems: "center", gap: 4 }}>
                {status.icon} {status.label}
              </span>
            </div>
          </div>
        </div>

        <div style={{ padding: "0 16px 16px", overflowY: "auto", flex: 1 }}>
          {loadingInsights ? (
            <div style={{ textAlign: "center", padding: "28px 0" }}>
              <div className="spinner" style={{ width: 22, height: 22, margin: "0 auto 10px" }} />
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Buscando dados da conta...</div>
            </div>
          ) : insights ? (
            <>
              <div className="stat-row" style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <StatBox label="Seguidores"  value={fmt(insights.followers_count)} icon="👥" />
                <StatBox label="Seguindo"    value={fmt(insights.follows_count)}   icon="➡️" />
                <StatBox label="Posts"       value={fmt(insights.media_count)}      icon="📸" />
              </div>

              {insights.biography && (
                <div style={{ marginBottom: 12, padding: "10px 12px", background: "var(--bg3)", borderRadius: 8, fontSize: 13, color: "var(--text)", lineHeight: 1.6 }}>
                  {insights.biography}
                </div>
              )}

              {insights.website && (
                <a href={insights.website} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--accent-light)", marginBottom: 12, padding: "8px 12px", background: "var(--bg3)", borderRadius: 8 }}>
                  🔗 {insights.website.replace(/^https?:\/\//, "")}
                </a>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                {[
                  { icon: "🗂", label: "Tipo de conta", value: insights.account_type || acc.account_type || "BUSINESS" },
                  { icon: "🗓", label: "Conectada em", value: new Date(acc.connected_at || Date.now()).toLocaleDateString("pt-BR") },
                  { icon: "🔄", label: "Dados atualizados", value: insights.fetched_at ? new Date(insights.fetched_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—" },
                  { icon: "🆔", label: "Instagram ID", value: acc.id },
                ].map((item) => (
                  <div key={item.label} style={{ padding: "7px 9px", background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>{item.icon} {item.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.value}</div>
                  </div>
                ))}
              </div>

              {/* ── Resumo de saúde ─────────────────────────────────────── */}
              {(health || tokenExpired) && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Saúde da conta
                    </div>
                    <HealthBadge health={health} tokenExpired={tokenExpired} size="lg" />
                  </div>
                  <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "12px 14px", border: "1px solid var(--border)" }}>
                    {/* Barra de score */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>Score</span>
                      <span style={{ fontSize: 18, fontWeight: 800, color: meta.color }}>
                        {tokenExpired ? 0 : (health?.score ?? "—")}
                        <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}> / 100</span>
                      </span>
                    </div>
                    <div style={{ height: 6, background: "var(--bg)", borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
                      <div style={{ height: "100%", width: `${tokenExpired ? 0 : (health?.score ?? 0)}%`, background: meta.color, borderRadius: 4, transition: "width 0.4s ease" }} />
                    </div>

                    {/* Lista de issues */}
                    {(tokenExpired || (health?.issues?.length > 0)) ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {(tokenExpired ? ["Token de acesso expirado — reconecte a conta."] : health.issues).map((issue, i) => (
                          <div key={i} style={{
                            fontSize: 11, color: "var(--text2)", lineHeight: 1.5,
                            padding: "6px 10px", background: meta.bg, borderRadius: 6,
                            borderLeft: `2px solid ${meta.color}`,
                          }}>
                            {issue}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: "var(--success)", textAlign: "center", padding: "4px 0" }}>
                        ✓ Nenhum alerta — conta em boas condições
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Comparação de alcance 7d × 7d anteriores ───────────────── */}
              {insights.insights_7d && (
                <div style={{ marginBottom: 14 }}>
                  <ReachComparison
                    insights7d={insights.insights_7d}
                    insightsPrev7d={insights.insights_prev_7d}
                    dropPct={health?.reach_drop_pct}
                  />
                  {/* Métricas adicionais 7d */}
                  {(insights.insights_7d.profile_views != null || insights.insights_7d.website_clicks != null) && (
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      {insights.insights_7d.profile_views != null && (
                        <StatBox label="Visitas perfil 7d" value={fmt(insights.insights_7d.profile_views)} icon="👁" />
                      )}
                      {insights.insights_7d.website_clicks != null && (
                        <StatBox label="Cliques no site 7d" value={fmt(insights.insights_7d.website_clicks)} icon="🔗" />
                      )}
                    </div>
                  )}
                </div>
              )}

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

  // Refs para acessar estado mais recente sem re-criar o callback
  const insightsRef   = useRef(insights);
  const loadingInsRef = useRef(loadingIns);
  useEffect(() => { insightsRef.current   = insights;   }, [insights]);
  useEffect(() => { loadingInsRef.current = loadingIns; }, [loadingIns]);

  const fetchInsights = useCallback(async (acc, force = false) => {
    if (!force && (loadingInsRef.current[acc.id] || insightsRef.current[acc.id])) return;
    if (!acc.access_token) return;
    setLoadingIns((p) => ({ ...p, [acc.id]: true }));
    try {
      const res = await fetch("/api/account-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagram_id: acc.id, access_token: acc.access_token }),
      });

      const json = await res.json();

      if (res.status === 401 || json.error === "token_expired") {
        await dbPut("sessions", { ...acc, token_status: "expired" });
        reloadAccounts();
        setInsights((p) => ({ ...p, [acc.id]: null }));
        setLoadingIns((p) => ({ ...p, [acc.id]: false }));
        return;
      }

      if (res.ok && !json.error) {
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
        fetch("/api/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([updatedAcc]),
        }).catch(() => {});
        reloadAccounts();
        setInsights((p) => ({ ...p, [acc.id]: json }));
      } else {
        setInsights((p) => ({ ...p, [acc.id]: null }));
      }
    } catch {
      setInsights((p) => ({ ...p, [acc.id]: null }));
    }
    setLoadingIns((p) => ({ ...p, [acc.id]: false }));
  }, [reloadAccounts]); // removido insights/loadingIns das deps — usa refs

  // ── Atualização em massa: fila sequencial com 300ms entre chamadas ─────────
  // Sequencial em vez de paralelo: protege contra rate-limit da Meta Graph API
  // quando há muitas contas. 300ms é o mesmo gap usado no fetch inicial.
  const handleRefreshAll = useCallback(async () => {
    if (refreshingAll || accounts.length === 0) return;
    setRefreshingAll(true);
    setRefreshProgress({ done: 0, total: accounts.length });
    for (let i = 0; i < accounts.length; i++) {
      await fetchInsights(accounts[i], true);
      setRefreshProgress({ done: i + 1, total: accounts.length });
      if (i < accounts.length - 1) await new Promise((r) => setTimeout(r, 300));
    }
    setRefreshingAll(false);
  }, [accounts, refreshingAll, fetchInsights]);

  const fetchedRef = useRef(false);
  useEffect(() => {
    if (loading || accounts.length === 0) return;
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    accounts.forEach((acc, i) => {
      setTimeout(() => fetchInsights(acc), i * 300);
    });
  }, [accounts, loading]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Renomeia conta (apelido local)
  const handleRename = async (updated) => {
    await addAccounts([updated]);
  };

  // Chamado pelo AddViaPageModal após o usuário confirmar a prévia
  const handleAddViaPage = async (account) => {
    await addAccounts([account]);
    // Busca insights imediatamente após adicionar
    setTimeout(() => fetchInsights(account, true), 500);
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {accounts.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmModal({ type: "clear" })}>
              Remover todas
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => setShowPageIdModal(true)}>
            🔑 Adicionar via Page ID
          </button>
          <a href={oauthUrl} className="btn btn-primary">+ Adicionar conta</a>
        </div>
      </div>

      {/* Modal: adicionar via Page ID */}
      {showPageIdModal && (
        <AddViaPageModal
          onClose={() => setShowPageIdModal(false)}
          onAdded={handleAddViaPage}
        />
      )}

      {/* Modal detalhes */}
      {detailAcc && (
        <AccountDetailModal
          acc={detailAcc}
          insights={insights[detailAcc.id]}
          loadingInsights={!!loadingIns[detailAcc.id]}
          onClose={() => setDetailAcc(null)}
          onEdit={() => { setEditingAcc(detailAcc); setDetailAcc(null); }}
          onRemove={() => { setConfirmModal({ type: "remove", id: detailAcc.id, username: detailAcc.username }); setDetailAcc(null); }}
          onRefresh={() => fetchInsights(detailAcc, true)}
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

      {/* Modal renomear */}
      {renamingAcc && (
        <RenameModal
          acc={renamingAcc}
          onClose={() => setRenamingAcc(null)}
          onSaved={handleRename}
        />
      )}

      {accounts.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📱</div>
          <div className="empty-title">Nenhuma conta conectada</div>
          <div style={{ fontSize: 13, marginBottom: 24, color: "var(--muted)" }}>Conecte contas Instagram Business ou Creator.</div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <a href={oauthUrl} className="btn btn-primary">+ Conectar via OAuth</a>
            <button className="btn btn-ghost" onClick={() => setShowPageIdModal(true)}>🔑 Adicionar via Page ID</button>
          </div>
        </div>
      ) : (
        <>
          {/* Health Overview no topo */}
          <HealthOverview
            accounts={accounts}
            insights={insights}
            loadingMap={loadingIns}
            onRefreshAll={handleRefreshAll}
            refreshingAll={refreshingAll}
            refreshProgress={refreshProgress}
          />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {accounts.map((acc) => {
              const ins          = insights[acc.id];
              const isLoading    = !!loadingIns[acc.id];
              const tokenExpired = acc.token_status === "expired";
              const health       = ins?.health;
              const topIssue     = tokenExpired
                ? "Token expirado — reconecte."
                : (health?.issues?.[0] || null);
              const reachDrop    = health?.reach_drop_pct;

              return (
                <div key={acc.id} className="card card-hover"
                  style={{ display: "flex", flexDirection: "column", gap: 12, cursor: "pointer", position: "relative" }}
                  onClick={() => openDetail(acc)}
                >
                  {/* Botão renomear */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setRenamingAcc(acc); }}
                    title="Editar nome"
                    style={{
                      position: "absolute", top: 8, right: 36,
                      background: "var(--bg3)", border: "1px solid var(--border)",
                      borderRadius: 6, padding: "3px 7px", fontSize: 11,
                      color: "var(--muted)", cursor: "pointer", lineHeight: 1,
                    }}
                  >✏️</button>

                  {/* Botão refresh individual no canto superior direito */}
                  <button
                    onClick={(e) => { e.stopPropagation(); fetchInsights(acc, true); }}
                    disabled={isLoading}
                    title="Atualizar status"
                    style={{
                      position: "absolute", top: 8, right: 8,
                      background: "var(--bg3)", border: "1px solid var(--border)",
                      borderRadius: 6, padding: "3px 7px", fontSize: 11,
                      color: "var(--muted)", cursor: isLoading ? "default" : "pointer",
                      opacity: isLoading ? 0.5 : 1, lineHeight: 1,
                    }}
                  >
                    {isLoading ? "↻..." : "↻"}
                  </button>

                  <div style={{ display: "flex", alignItems: "center", gap: 12, paddingRight: 28 }}>
                    <Avatar acc={{ ...acc, account_status: ins?.account_status }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {acc.nickname || ins?.name || acc.name || acc.username || "—"}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        @{ins?.username || acc.username || "—"}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, flexWrap: "wrap" }}>
                        <span className="badge badge-purple" style={{ fontSize: 10 }}>{acc.account_type || "BUSINESS"}</span>
                        {acc.added_via === "page_id" && (
                          <span style={{ fontSize: 10, color: "var(--warning)" }} title="Adicionada via Page ID">🔑</span>
                        )}
                        {(health || tokenExpired) && (
                          <HealthBadge health={health} tokenExpired={tokenExpired} size="sm" />
                        )}
                      </div>
                    </div>
                  </div>

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

                  {/* Reach 7d com indicador de tendência */}
                  {ins?.insights_7d && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                      <span style={{ color: "var(--muted)" }}>📊 Alcance 7d</span>
                      <span style={{ color: "var(--text)", fontWeight: 600 }}>
                        {fmt(ins.insights_7d.reach)}
                        {reachDrop != null && reachDrop !== 0 && (
                          <span style={{
                            marginLeft: 6, fontSize: 10,
                            color: reachDrop > 0
                              ? (reachDrop >= 50 ? "var(--danger)" : "var(--warning)")
                              : "var(--success)",
                          }}>
                            {reachDrop > 0 ? `↓${reachDrop}%` : `↑${Math.abs(reachDrop)}%`}
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Quota de publicação */}
                  {ins?.publishing_limit?.config?.quota_total && (() => {
                    const pct = Math.min(100, Math.round((ins.publishing_limit.quota_usage || 0) / ins.publishing_limit.config.quota_total * 100));
                    const color = pct >= 100 ? "var(--danger)" : pct >= 80 ? "var(--warning)" : "var(--success)";
                    return (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>
                          <span>Posts hoje</span>
                          <span style={{ color }}>{ins.publishing_limit.quota_usage}/{ins.publishing_limit.config.quota_total} ({pct}%)</span>
                        </div>
                        <div style={{ height: 4, background: "var(--bg3)", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4 }} />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Alerta principal (1 linha) */}
                  {topIssue && (
                    <div style={{
                      fontSize: 11, lineHeight: 1.4,
                      padding: "6px 8px",
                      background: tokenExpired || health?.overall === "danger" ? "rgba(239,68,68,0.07)" : "rgba(245,158,11,0.07)",
                      borderLeft: `2px solid ${tokenExpired || health?.overall === "danger" ? "var(--danger)" : "var(--warning)"}`,
                      borderRadius: 4,
                      color: "var(--text2)",
                      overflow: "hidden", textOverflow: "ellipsis",
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                    }}>
                      ⚠ {topIssue}
                    </div>
                  )}

                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: "auto" }}>
                    🗓 Conectada em {new Date(acc.connected_at || Date.now()).toLocaleDateString("pt-BR")}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 20, padding: "12px 16px", background: "var(--bg2)", borderRadius: 10, border: "1px solid var(--border)", fontSize: 12, color: "var(--muted)" }}>
            💡 Clique em qualquer conta para ver score detalhado, comparação de alcance e lista completa de alertas. Use ↻ para forçar atualização individual ou "Atualizar tudo" no topo para refazer todas em sequência.
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
