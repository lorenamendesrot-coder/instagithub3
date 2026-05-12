import { useState, useCallback, useEffect, useRef } from "react";
import { useAccounts } from "../App.jsx";
import { useOAuthPopup } from "../useOAuthPopup.js";
import { dbPut } from "../useDB.js";
import Modal from "../Modal.jsx";
import AccountAvatar from "../components/accounts/AccountAvatar.jsx";
import StatBox from "../components/accounts/AccountStatBox.jsx";
import HealthBadge from "../components/accounts/AccountHealthBadge.jsx";
import HealthOverview from "../components/accounts/AccountHealthOverview.jsx";
import { RenameModal, AddViaPageModal, EditProfileModal } from "../components/accounts/AccountModals.jsx";
import { fmt, healthMeta } from "../components/accounts/AccountUtils.js";

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
        <div style={{ height: 48, background: `linear-gradient(135deg, ${meta.bg}, ${meta.border}20)`, position: "relative", borderBottom: "1px solid var(--border)" }}>
          <button onClick={onClose} style={{ position: "absolute", top: 10, right: 12, background: "none", color: "var(--muted)", fontSize: 20, padding: "0 4px", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: "0 16px", marginTop: -24, display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <AccountAvatar acc={acc} ins={ins} size={52} />
          <div style={{ display: "flex", gap: 6, paddingBottom: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={loadingInsights}>
              {loadingInsights ? <span className="spinner" style={{ width: 12, height: 12 }} /> : "↻"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onEdit}>✏️</button>
            <button className="btn btn-danger btn-sm" onClick={onRemove}>Desconectar</button>
          </div>
        </div>

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

        <div style={{ padding: "0 16px 16px", overflowY: "auto", flex: 1 }}>
          {loadingInsights ? (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <div className="spinner" style={{ width: 24, height: 24, margin: "0 auto 10px" }} />
              <div style={{ fontSize: 12, color: "var(--muted)" }}>Buscando dados...</div>
            </div>
          ) : ins ? (
            <>
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

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
                {[
                  { icon: "🗂", label: "Tipo",         value: ins.account_type || acc.account_type || "BUSINESS" },
                  { icon: "🗓", label: "Conectada em", value: new Date(acc.connected_at || Date.now()).toLocaleDateString("pt-BR") },
                  { icon: "🔄", label: "Atualizado",   value: ins.fetched_at ? new Date(ins.fetched_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—" },
                  { icon: "🆔", label: "ID",           value: acc.id },
                ].map((item) => (
                  <div key={item.label} style={{ padding: "7px 9px", background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>{item.icon} {item.label}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.value}</div>
                  </div>
                ))}
              </div>

              {(health || tokenExpired) && (
                <div style={{ marginBottom: 12, background: "var(--bg3)", borderRadius: 10, padding: "12px 13px", border: `1px solid ${meta.border}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Saúde</span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: meta.color }}>
                      {tokenExpired ? 0 : (health?.score ?? "—")}
                      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>/100</span>
                    </span>
                  </div>
                  <div style={{ height: 5, background: "var(--bg)", borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
                    <div style={{ height: "100%", width: `${tokenExpired ? 0 : (health?.score ?? 0)}%`, background: meta.color, borderRadius: 4, transition: "width 0.5s ease" }} />
                  </div>
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
  const [checkingTokens,  setCheckingTokens]  = useState(false);
  const [tokenResults,    setTokenResults]    = useState(null); // null = não verificado ainda

  const APP_ID   = import.meta.env.VITE_META_APP_ID;
  const REDIRECT = encodeURIComponent(window.location.origin + "/api/auth-callback");
  const SCOPE    = "instagram_basic,instagram_content_publish,instagram_manage_insights,pages_read_engagement,pages_show_list,pages_manage_posts,business_management,pages_manage_metadata";
  const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${REDIRECT}&scope=${SCOPE}&response_type=code&state=popup`;

  const { status: oauthStatus, errorMsg: oauthError, openPopup, reset: resetOauth } = useOAuthPopup({
    onAccounts: async (accs) => {
      try {
        await addAccounts(accs);
        resetOauth();
      } catch (err) {
        alert("Erro ao salvar contas: " + err.message);
        resetOauth();
      }
    },
  });

  // Refs para evitar closures velhas nos callbacks
  const insightsRef   = useRef(insights);
  const loadingInsRef = useRef(loadingIns);
  useEffect(() => { insightsRef.current   = insights;   }, [insights]);
  useEffect(() => { loadingInsRef.current = loadingIns; }, [loadingIns]);

  // ── fetchInsights (única conta) ──────────────────────────────────────────
  const fetchInsights = useCallback(async (acc, force = false) => {
    if (!force && (loadingInsRef.current[acc.id] || insightsRef.current[acc.id])) return;
    if (!acc.access_token) return;
    try {
      const res  = await fetch("/api/account-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagram_id: acc.id, access_token: acc.access_token }),
      });
      const json = await res.json();
      if (res.status === 401 || json.error === "token_expired") {
        await dbPut("sessions", { ...acc, token_status: "expired" });
        reloadAccounts();
        return null;
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
        return { id: acc.id, data: json };
      }
      return { id: acc.id, data: null };
    } catch {
      return { id: acc.id, data: null };
    }
  }, [reloadAccounts]);

  // ── Atualiza lote sem pisca: busca tudo, depois faz 1 setState ──────────
  const runBatch = useCallback(async (accs) => {
    const BATCH = 10;
    const results = {};
    for (let i = 0; i < accs.length; i += BATCH) {
      const batch = accs.slice(i, i + BATCH);
      const res = await Promise.all(batch.map((acc) => fetchInsights(acc, true)));
      res.forEach((r) => { if (r) results[r.id] = r.data; });
      setRefreshProgress({ done: Math.min(i + BATCH, accs.length), total: accs.length });
    }
    // Um único setState para todos — sem pisca-pisca
    setInsights((p) => ({ ...p, ...results }));
    reloadAccounts();
  }, [fetchInsights, reloadAccounts]);

  // ── Verificar tokens ────────────────────────────────────────────────────
  const handleCheckTokens = useCallback(async () => {
    setCheckingTokens(true);
    setTokenResults(null);
    try {
      const res  = await fetch("/api/check-tokens");
      const data = await res.json();
      setTokenResults(data.results || []);
      // Atualiza status local das contas
      await reloadAccounts();
    } catch (err) {
      alert("Erro ao verificar tokens: " + err.message);
    } finally {
      setCheckingTokens(false);
    }
  }, [reloadAccounts]);

  // ── Botão "Atualizar tudo" ───────────────────────────────────────────────
  const handleRefreshAll = useCallback(async () => {
    if (refreshingAll || accounts.length === 0) return;
    setRefreshingAll(true);
    setRefreshProgress({ done: 0, total: accounts.length });
    await runBatch(accounts);
    setRefreshingAll(false);
  }, [accounts, refreshingAll, runBatch]);

  // ── Fetch automático: 1x ao entrar + a cada 30 min em segundo plano ─────
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (loading || accounts.length === 0) return;
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      runBatch(accounts);
    }
    const timer = setInterval(() => runBatch(accounts), 30 * 60 * 1000);
    return () => clearInterval(timer);
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
          <button className="btn btn-ghost btn-sm" onClick={handleCheckTokens} disabled={checkingTokens || accounts.length === 0}>
            {checkingTokens ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Verificando...</> : "🔍 Verificar tokens"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowPageIdModal(true)}>
            🔑 Adicionar via Page ID
          </button>
          <button
              onClick={openPopup}
              disabled={oauthStatus === "waiting" || oauthStatus === "saving"}
              className="btn btn-primary"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              {oauthStatus === "waiting"
                ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Aguardando...</>
                : oauthStatus === "saving"
                  ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Salvando...</>
                  : "📷 + Conta"}
            </button>
        </div>
      </div>

      {/* ── Painel de resultado de tokens ─────────────────────────────────── */}
      {tokenResults && (
        <div style={{ marginBottom: 20, background: "var(--bg2)", borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>🔍 Diagnóstico de Tokens</div>
            <button onClick={() => setTokenResults(null)} style={{ background: "none", color: "var(--muted)", fontSize: 18, padding: "0 4px" }}>×</button>
          </div>
          <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            {tokenResults.map((r) => {
              const ok      = r.is_valid && !r.error;
              const renewed = r.refresh?.renewed;
              const bg      = ok    ? "rgba(34,197,94,0.05)"   : "rgba(239,68,68,0.05)";
              const border  = ok    ? "rgba(34,197,94,0.2)"    : "rgba(239,68,68,0.2)";
              const icon    = ok    ? "✅" : "❌";
              return (
                <div key={r.id} style={{ padding: "10px 14px", borderRadius: 10, background: bg, border: `1px solid ${border}`, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ok ? 4 : 0 }}>
                    <span style={{ fontWeight: 700 }}>{icon} @{r.username}</span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {renewed && <span style={{ fontSize: 10, padding: "1px 8px", borderRadius: 4, background: "rgba(34,197,94,0.15)", color: "var(--success)", border: "1px solid rgba(34,197,94,0.3)" }}>🔄 Renovado</span>}
                      {r.never_expires && <span style={{ fontSize: 10, padding: "1px 8px", borderRadius: 4, background: "rgba(124,92,252,0.1)", color: "var(--accent)", border: "1px solid rgba(124,92,252,0.25)" }}>∞ Sem expiração</span>}
                      {r.days_left !== null && <span style={{ fontSize: 10, color: r.days_left < 7 ? "var(--danger)" : r.days_left < 20 ? "var(--warning)" : "var(--muted)" }}>{r.days_left}d restantes</span>}
                    </div>
                  </div>
                  {r.error && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 3 }}>{r.error}</div>}
                  {r.refresh && !r.refresh.renewed && r.refresh.reason && (
                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>ℹ️ {r.refresh.reason}</div>
                  )}
                  {ok && (
                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                      Tipo: {r.token_type}
                      {r.scopes?.length > 0 && ` · Escopos: ${r.scopes.slice(0, 4).join(", ")}${r.scopes.length > 4 ? ` +${r.scopes.length - 4}` : ""}`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Modais ─────────────────────────────────────────────────────────── */}
      {oauthError && (
        <div style={{
          position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
          padding: "10px 18px", borderRadius: 10, zIndex: 9999,
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
          color: "var(--danger)", fontSize: 13, maxWidth: 420, textAlign: "center",
          backdropFilter: "blur(8px)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        }}>
          ⚠️ {oauthError}
          <button onClick={resetOauth} style={{ marginLeft: 10, background: "none", color: "inherit", fontSize: 12, textDecoration: "underline", padding: 0, cursor: "pointer" }}>
            Fechar
          </button>
        </div>
      )}

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
            <button
                onClick={openPopup}
                disabled={oauthStatus === "waiting" || oauthStatus === "saving"}
                className="btn btn-primary"
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                {oauthStatus === "waiting"
                  ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Aguardando login...</>
                  : oauthStatus === "saving"
                    ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Salvando...</>
                    : "📷 Conectar Instagram"}
              </button>
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
                    <AccountAvatar acc={acc} ins={ins} />
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
