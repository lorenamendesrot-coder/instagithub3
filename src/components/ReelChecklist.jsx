// ReelChecklist.jsx — Análise e checklist visual de Reels
import { useState, useEffect } from "react";

function fmtSize(b) {
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function fmtDuration(s) {
  if (!s || isNaN(s)) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

async function analyzeVideo(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const cleanup = () => URL.revokeObjectURL(url);
    video.onloadedmetadata = () => {
      resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight, size: file.size });
      cleanup();
    };
    video.onerror = () => {
      resolve({ duration: null, width: null, height: null, size: file.size });
      cleanup();
    };
    video.src = url;
  });
}

const MIN_DURATION = 3; // segundos mínimos — bloqueado abaixo disso

function calcRisk(meta) {
  if (!meta) return null;
  let score = 0;
  const issues = [];
  if (meta.duration !== null) {
    if (meta.duration < MIN_DURATION) { score += 5; issues.push(`Duração ${fmtDuration(meta.duration)} — BLOQUEADO (mínimo ${MIN_DURATION}s)`); }
    else if (meta.duration < 8)       { score += 2; issues.push("Duração curta (< 8s) — alcance reduzido"); }
    else if (meta.duration > 90)      { score += 1; issues.push("Duração longa (> 90s)"); }
  }
  if (meta.width && meta.height) {
    const minDim = Math.min(meta.width, meta.height);
    if (minDim < 720)  { score += 2; issues.push("Resolução abaixo de 720p"); }
    if (minDim >= 1080) score -= 1;
  }
  const mb = meta.size / 1048576;
  if (mb > 100) { score += 2; issues.push("Arquivo muito grande (> 100MB)"); }
  if (mb < 0.5) { score += 1; issues.push("Arquivo muito pequeno"); }

  const blocked = meta.duration !== null && meta.duration < MIN_DURATION;
  const level   = blocked ? "blocked" : score >= 4 ? "high" : score >= 2 ? "medium" : "low";
  return { score: Math.max(0, score), level, issues, blocked };
}

const RISK_STYLE = {
  blocked: { bg: "rgba(239,68,68,0.1)",   border: "rgba(239,68,68,0.35)",  text: "var(--danger)",  label: "Bloqueado" },
  high:    { bg: "rgba(239,68,68,0.07)",   border: "rgba(239,68,68,0.2)",   text: "var(--danger)",  label: "Risco Alto" },
  medium:  { bg: "rgba(245,158,11,0.07)",  border: "rgba(245,158,11,0.2)",  text: "var(--warning)", label: "Risco Médio" },
  low:     { bg: "rgba(34,197,94,0.07)",   border: "rgba(34,197,94,0.2)",   text: "var(--success)", label: "Risco Baixo" },
};

function ReelCard({ reel, sanitized, sanitizeReport, onRemove }) {
  const [meta,       setMeta]       = useState(null);
  const [analyzing,  setAnalyzing]  = useState(false);
  const [unlocked,   setUnlocked]   = useState(false); // desbloquear manualmente

  useEffect(() => {
    if (!reel.file) return;
    setAnalyzing(true);
    analyzeVideo(reel.file).then((m) => { setMeta(m); setAnalyzing(false); });
  }, [reel.file]);

  const risk = calcRisk(meta);
  const isBlocked = risk?.blocked && !unlocked;
  const style = isBlocked ? RISK_STYLE.blocked : risk ? RISK_STYLE[risk.level] : RISK_STYLE.low;

  const checks = meta ? [
    {
      ok:       meta.duration !== null && meta.duration >= MIN_DURATION,
      critical: meta.duration !== null && meta.duration < MIN_DURATION,
      warn:     meta.duration !== null && meta.duration >= MIN_DURATION && meta.duration < 8,
      label:    meta.duration !== null ? `Duração: ${fmtDuration(meta.duration)}` : "Duração: não detectada",
    },
    {
      ok:   meta.width >= 1080 || meta.height >= 1080,
      warn: meta.width > 0 && meta.width < 1080 && meta.height < 1080,
      label: meta.width ? `Resolução: ${meta.width}×${meta.height}` : "Resolução: não detectada",
    },
    {
      ok:   meta.size < 100 * 1048576,
      warn: meta.size >= 50 * 1048576 && meta.size < 100 * 1048576,
      label: `Tamanho: ${fmtSize(meta.size)}`,
    },
    {
      ok:   sanitized && sanitizeReport && !sanitizeReport.error,
      warn: !sanitized || (sanitizeReport && sanitizeReport.error),
      label: sanitized && sanitizeReport && !sanitizeReport.error
        ? `Sanitizado ✓ · ID:${sanitizeReport.uniqueId}`
        : sanitized && sanitizeReport?.error
        ? `Sanitização parcial`
        : "Aguardando sanitização",
      detail: sanitized && sanitizeReport && !sanitizeReport.error
        ? sanitizeReport.removed?.join(", ")
        : null,
    },
  ] : [];

  return (
    <div style={{
      borderRadius: 10, border: `1px solid ${style.border}`,
      background: style.bg, padding: "12px 14px", transition: "all 0.2s",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>🎬</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {reel.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{fmtSize(reel.size)}</div>
        </div>

        {analyzing && <span style={{ fontSize: 11, color: "var(--muted)" }}>Analisando...</span>}

        {risk && !analyzing && (
          <div style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
            background: style.bg, color: style.text, border: `1px solid ${style.border}`, flexShrink: 0,
          }}>
            {style.label}
          </div>
        )}

        {/* Botão remover */}
        <button
          onClick={() => onRemove(reel.id)}
          title="Remover este reel"
          style={{
            flexShrink: 0, width: 28, height: 28, borderRadius: 6,
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
            color: "var(--danger)", fontSize: 16, lineHeight: 1,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", transition: "all 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.25)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
        >
          ×
        </button>
      </div>

      {/* Alerta bloqueado */}
      {risk?.blocked && (
        <div style={{
          padding: "8px 12px", borderRadius: 8, marginBottom: 10,
          background: isBlocked ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.1)",
          border: `1px solid ${isBlocked ? "rgba(239,68,68,0.4)" : "rgba(245,158,11,0.3)"}`,
          fontSize: 12, fontWeight: 600,
          color: isBlocked ? "var(--danger)" : "var(--warning)",
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        }}>
          <span style={{ flex: 1 }}>
            {isBlocked ? "🚫" : "⚠️"} Duração {fmtDuration(meta?.duration)} é menor que {MIN_DURATION}s.
            {isBlocked ? " Este reel está bloqueado." : " Postagem forçada — pode ser rejeitada pelo Instagram."}
          </span>
          <button
            onClick={() => setUnlocked(u => !u)}
            style={{
              padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
              background: isBlocked ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)",
              border: `1px solid ${isBlocked ? "rgba(239,68,68,0.4)" : "rgba(245,158,11,0.4)"}`,
              color: isBlocked ? "var(--danger)" : "var(--warning)",
              flexShrink: 0,
            }}
          >
            {isBlocked ? "🔓 Desbloquear" : "🔒 Bloquear"}
          </button>
        </div>
      )}

      {/* Checklist */}
      {!analyzing && checks.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {checks.map((c, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 5,
              fontSize: 11, padding: "3px 9px", borderRadius: 20,
              background: c.critical ? "rgba(239,68,68,0.12)" : c.ok ? "rgba(34,197,94,0.08)" : "rgba(245,158,11,0.08)",
              border: `1px solid ${c.critical ? "rgba(239,68,68,0.3)" : c.ok ? "rgba(34,197,94,0.2)" : "rgba(245,158,11,0.2)"}`,
              color: c.critical ? "var(--danger)" : c.ok ? "var(--success)" : "var(--warning)",
            }}>
              {c.critical ? "🚫" : c.ok ? "✓" : "⚠"} {c.label}
            </div>
          ))}
        </div>
      )}

      {/* Detalhes de sanitização */}
      {sanitized && sanitizeReport && !sanitizeReport.error && (
        <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.15)", fontSize: 11 }}>
          <div style={{ color: "var(--success)", fontWeight: 600, marginBottom: 4 }}>🔒 Metadados limpos</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {(sanitizeReport.removed || []).map((r, i) => (
              <span key={i} style={{ padding: "1px 7px", borderRadius: 4, background: "rgba(34,197,94,0.08)", color: "var(--success)", border: "1px solid rgba(34,197,94,0.15)" }}>{r}</span>
            ))}
          </div>
          <div style={{ color: "var(--muted)", marginTop: 4 }}>
            ID único: <span style={{ fontFamily: "monospace", color: "var(--text)" }}>{sanitizeReport.uniqueId}</span>
            · {sanitizeReport.durationMs}ms
            · {(sanitizeReport.originalSize/1024).toFixed(0)}KB → {(sanitizeReport.sanitizedSize/1024).toFixed(0)}KB
          </div>
        </div>
      )}

      {/* Detalhes de sanitização */}
      {sanitized && sanitizeReport && !sanitizeReport.error && (
        <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.15)", fontSize: 11 }}>
          <div style={{ color: "var(--success)", fontWeight: 600, marginBottom: 4 }}>🔒 Metadados removidos</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
            {(sanitizeReport.removed || []).map((r, i) => (
              <span key={i} style={{ padding: "1px 7px", borderRadius: 4, background: "rgba(34,197,94,0.08)", color: "var(--success)", border: "1px solid rgba(34,197,94,0.15)" }}>{r}</span>
            ))}
          </div>
          <div style={{ color: "var(--muted)" }}>
            ID: <span style={{ fontFamily: "monospace", color: "var(--text)" }}>{sanitizeReport.uniqueId}</span>
            {" · "}{sanitizeReport.durationMs}ms
            {" · "}{(sanitizeReport.originalSize/1024).toFixed(0)}KB → {(sanitizeReport.sanitizedSize/1024).toFixed(0)}KB
          </div>
        </div>
      )}

      {/* Issues */}
      {risk?.issues?.length > 0 && !analyzing && (
        <div style={{ marginTop: 8 }}>
          {risk.issues.map((issue, i) => (
            <div key={i} style={{ fontSize: 11, color: risk.blocked ? "var(--danger)" : "var(--warning)", marginTop: 2, fontWeight: risk.blocked ? 600 : 400 }}>
              ↳ {issue}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ReelChecklist({ reels, sanitizedIds = [], onRemove }) {
  if (!reels.length) return null;

  const blocked = reels.filter(r => r._blocked).length;

  return (
    <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 16 }}>🔍</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Análise de Reels</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
            {reels.length} arquivo(s) · verificação de qualidade e segurança
          </div>
        </div>
        {blocked > 0 && (
          <div style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: "rgba(239,68,68,0.12)", color: "var(--danger)", border: "1px solid rgba(239,68,68,0.25)" }}>
            {blocked} bloqueado(s)
          </div>
        )}
      </div>

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        {reels.map((r) => (
          <ReelCard key={r.id} reel={r} sanitized={sanitizedIds.includes(r.id)} sanitizeReport={r.sanitizationReport} onRemove={onRemove} />
        ))}
      </div>

      <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 16, flexWrap: "wrap", background: "rgba(0,0,0,0.2)" }}>
        {[
          { color: "var(--success)", icon: "✓",  label: "Aprovado" },
          { color: "var(--warning)", icon: "⚠",  label: "Atenção" },
          { color: "var(--danger)",  icon: "🚫", label: `Bloqueado (< ${MIN_DURATION}s)` },
        ].map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted)" }}>
            <span style={{ color: item.color, fontWeight: 700 }}>{item.icon}</span>
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}
