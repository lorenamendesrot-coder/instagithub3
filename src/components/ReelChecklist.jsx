// ReelChecklist.jsx — Análise e checklist visual de Reels para aquecimento
// Valida duração, resolução, áudio, tamanho e calcula Score de Risco

import { useState, useEffect } from "react";

// ─── Utilitários ──────────────────────────────────────────────────────────────
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

// Analisa o arquivo de vídeo via HTMLVideoElement
async function analyzeVideo(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;

    const cleanup = () => URL.revokeObjectURL(url);

    video.onloadedmetadata = () => {
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        size: file.size,
        hasAudio: null, // não detectável sem AudioContext + fetch
      });
      cleanup();
    };

    video.onerror = () => {
      resolve({ duration: null, width: null, height: null, size: file.size, hasAudio: null });
      cleanup();
    };

    video.src = url;
  });
}

// Calcula Score de Risco com base nas métricas
function calcRisk(meta) {
  if (!meta) return null;
  let score = 0;
  const issues = [];

  // Duração
  if (meta.duration !== null) {
    if (meta.duration < 8)   { score += 3; issues.push("Duração muito curta (< 8s)"); }
    else if (meta.duration < 15) { score += 1; issues.push("Duração curta (< 15s)"); }
    else if (meta.duration > 90) { score += 1; issues.push("Duração longa (> 90s)"); }
  }

  // Resolução
  if (meta.width && meta.height) {
    const minDim = Math.min(meta.width, meta.height);
    if (minDim < 720)  { score += 2; issues.push("Resolução abaixo de 720p"); }
    if (minDim >= 1080) score -= 1; // bônus resolução alta
  }

  // Tamanho
  const mb = meta.size / 1048576;
  if (mb > 100) { score += 2; issues.push("Arquivo muito grande (> 100MB)"); }
  if (mb < 0.5) { score += 1; issues.push("Arquivo muito pequeno (suspeito)"); }

  const level = score >= 4 ? "high" : score >= 2 ? "medium" : "low";
  return { score: Math.max(0, score), level, issues };
}

// ─── Componente individual de reel ───────────────────────────────────────────
function ReelCard({ reel, sanitized }) {
  const [meta, setMeta] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (!reel.file) return;
    setAnalyzing(true);
    analyzeVideo(reel.file).then((m) => {
      setMeta(m);
      setAnalyzing(false);
    });
  }, [reel.file]);

  const risk = calcRisk(meta);

  const checks = meta ? [
    {
      ok: meta.duration !== null && meta.duration >= 8,
      warn: meta.duration !== null && meta.duration > 0 && meta.duration < 8,
      label: meta.duration !== null
        ? `Duração: ${fmtDuration(meta.duration)}`
        : "Duração: não detectada",
      critical: meta.duration !== null && meta.duration < 8,
    },
    {
      ok: meta.width >= 1080 || meta.height >= 1080,
      warn: meta.width > 0 && meta.width < 1080 && meta.height < 1080,
      label: meta.width
        ? `Resolução: ${meta.width}×${meta.height}`
        : "Resolução: não detectada",
    },
    {
      ok: meta.size < 100 * 1048576,
      warn: meta.size >= 50 * 1048576 && meta.size < 100 * 1048576,
      label: `Tamanho: ${fmtSize(meta.size)}`,
    },
    {
      ok: sanitized,
      warn: !sanitized,
      label: sanitized ? "Sanitizado ✓" : "Aguardando sanitização",
    },
  ] : [];

  const riskColors = {
    low:    { bg: "rgba(34,197,94,0.07)",   border: "rgba(34,197,94,0.2)",   text: "var(--success)", label: "Baixo" },
    medium: { bg: "rgba(245,158,11,0.07)",  border: "rgba(245,158,11,0.2)",  text: "var(--warning)", label: "Médio" },
    high:   { bg: "rgba(239,68,68,0.07)",   border: "rgba(239,68,68,0.2)",   text: "var(--danger)",  label: "Alto"  },
  };

  return (
    <div style={{
      borderRadius: 10,
      border: `1px solid ${risk ? riskColors[risk.level].border : "var(--border)"}`,
      background: risk ? riskColors[risk.level].bg : "var(--bg2)",
      padding: "12px 14px",
      transition: "all 0.2s",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>🎬</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 600,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {reel.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{fmtSize(reel.size)}</div>
        </div>

        {analyzing && (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Analisando...</span>
        )}

        {risk && !analyzing && (
          <div style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
            background: riskColors[risk.level].bg,
            color: riskColors[risk.level].text,
            border: `1px solid ${riskColors[risk.level].border}`,
            flexShrink: 0,
          }}>
            Risco {riskColors[risk.level].label}
          </div>
        )}
      </div>

      {/* Alerta crítico duração < 8s */}
      {meta?.duration !== null && meta?.duration < 8 && (
        <div style={{
          padding: "8px 12px", borderRadius: 8, marginBottom: 10,
          background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)",
          fontSize: 12, fontWeight: 600, color: "var(--danger)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          ⚠️ ATENÇÃO: Duração {fmtDuration(meta.duration)} — Instagram rejeita Reels com menos de 3s.
          Recomendamos mínimo de 8s para melhor alcance.
        </div>
      )}

      {/* Checklist */}
      {!analyzing && checks.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {checks.map((c, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 5,
              fontSize: 11, padding: "3px 9px", borderRadius: 20,
              background: c.critical
                ? "rgba(239,68,68,0.1)"
                : c.ok
                  ? "rgba(34,197,94,0.08)"
                  : "rgba(245,158,11,0.08)",
              border: `1px solid ${c.critical
                ? "rgba(239,68,68,0.25)"
                : c.ok
                  ? "rgba(34,197,94,0.2)"
                  : "rgba(245,158,11,0.2)"}`,
              color: c.critical ? "var(--danger)" : c.ok ? "var(--success)" : "var(--warning)",
            }}>
              {c.critical ? "⚠" : c.ok ? "✓" : "⚠"}
              {c.label}
            </div>
          ))}
        </div>
      )}

      {/* Problemas de risco */}
      {risk?.issues?.length > 0 && !analyzing && (
        <div style={{ marginTop: 8 }}>
          {risk.issues.map((issue, i) => (
            <div key={i} style={{ fontSize: 11, color: "var(--warning)", marginTop: 2 }}>
              ↳ {issue}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ReelChecklist({ reels, sanitizedIds = [] }) {
  if (!reels.length) return null;

  return (
    <div style={{
      background: "var(--bg2)", border: "1px solid var(--border)",
      borderRadius: 12, overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 16px",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 16 }}>🔍</span>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Análise de Reels</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
            {reels.length} arquivo(s) · verificação de qualidade e segurança
          </div>
        </div>
      </div>

      {/* Cards */}
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        {reels.map((r) => (
          <ReelCard
            key={r.id}
            reel={r}
            sanitized={sanitizedIds.includes(r.id)}
          />
        ))}
      </div>

      {/* Legenda */}
      <div style={{
        padding: "10px 16px", borderTop: "1px solid var(--border)",
        display: "flex", gap: 16, flexWrap: "wrap",
        background: "rgba(0,0,0,0.2)",
      }}>
        {[
          { color: "var(--success)", icon: "✓", label: "Aprovado" },
          { color: "var(--warning)", icon: "⚠", label: "Atenção" },
          { color: "var(--danger)",  icon: "⚠", label: "Crítico — revisar" },
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
