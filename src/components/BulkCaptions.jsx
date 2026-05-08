// BulkCaptions.jsx — Componente reutilizável de legendas em massa
// Suporta: round-robin, aleatório, mesma para todos
// Compatível com Schedule.jsx e Warmup.jsx

import { useState, useMemo } from "react";

export const CAPTION_MODES = [
  { value: "same",       icon: "📋", label: "Mesma para todos",   desc: "Todos os posts usam a mesma legenda" },
  { value: "roundrobin", icon: "🔄", label: "Round-robin",        desc: "Cicla entre as legendas em ordem" },
  { value: "random",     icon: "🎲", label: "Aleatório",          desc: "Sorteia uma legenda diferente por post" },
];

const EXAMPLES = [
  "Aqui vai minha legenda 1 🔥 #reels #viral",
  "Segunda legenda com hashtags diferentes 💪 #trending #content",
  "Terceira opção para rotacionar 🎯 #instagram #growth",
  "Quarta legenda variada ✨ #explore #fyp",
];

// Função exportada para ser usada em Schedule/Warmup ao montar a fila
export function pickCaption(bulkCaptions, mode, index) {
  if (!bulkCaptions || bulkCaptions.length === 0) return "";
  if (mode === "same")       return bulkCaptions[0];
  if (mode === "roundrobin") return bulkCaptions[index % bulkCaptions.length];
  if (mode === "random")     return bulkCaptions[Math.floor(Math.random() * bulkCaptions.length)];
  return bulkCaptions[0];
}

export default function BulkCaptions({ value, onChange, mode, onModeChange, previewCount = 3 }) {
  const [showExamples, setShowExamples] = useState(false);
  const [collapsed,    setCollapsed]    = useState(false);

  // Parseia as linhas não-vazias
  const lines = useMemo(() =>
    (value || "").split("\n").map(l => l.trim()).filter(Boolean),
  [value]);

  const charCount  = (value || "").length;
  const lineCount  = lines.length;
  const isOverflow = lines.some(l => l.length > 2200);

  const loadExamples = () => {
    onChange(EXAMPLES.join("\n"));
    setShowExamples(false);
  };

  // Preview de como serão distribuídas
  const previewItems = useMemo(() => {
    if (!lines.length || previewCount <= 0) return [];
    return Array.from({ length: Math.min(previewCount, 6) }, (_, i) => ({
      index: i,
      caption: pickCaption(lines, mode, i),
    }));
  }, [lines, mode, previewCount]);

  return (
    <div style={{
      background: "var(--bg2)", border: "1px solid var(--border)",
      borderRadius: 12, overflow: "hidden",
    }}>
      {/* Header colapsável */}
      <div
        onClick={() => setCollapsed(p => !p)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 16px", cursor: "pointer", userSelect: "none",
          borderBottom: collapsed ? "none" : "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>💬</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Legendas em Massa</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
              {lineCount === 0
                ? "Nenhuma legenda — posts ficarão sem legenda"
                : `${lineCount} legenda(s) · modo ${CAPTION_MODES.find(m => m.value === mode)?.label}`}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {lineCount > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
              background: "var(--accent-glow)", color: "var(--accent-light)",
              border: "1px solid var(--accent)",
            }}>
              {lineCount}
            </span>
          )}
          <span style={{ fontSize: 12, color: "var(--muted)", transition: "transform 0.2s", display: "inline-block", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▾</span>
        </div>
      </div>

      {!collapsed && (
        <div style={{ padding: "14px 16px" }}>

          {/* Modo de distribuição */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Modo de distribuição
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {CAPTION_MODES.map((m) => (
                <button key={m.value} onClick={() => onModeChange(m.value)} style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8,
                  border: `1px solid ${mode === m.value ? "var(--accent)" : "var(--border)"}`,
                  background: mode === m.value ? "#7c5cfc18" : "var(--bg3)",
                  color: mode === m.value ? "var(--accent-light)" : "var(--muted)",
                  fontSize: 12, fontWeight: mode === m.value ? 600 : 400, transition: "all 0.12s",
                }}>
                  <span>{m.icon}</span>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
              {CAPTION_MODES.find(m => m.value === mode)?.desc}
            </div>
          </div>

          {/* Textarea */}
          <div style={{ position: "relative", marginBottom: 10 }}>
            <textarea
              placeholder={"Cole suas legendas aqui — uma por linha:\n\nLegenda 1 com hashtags 🔥 #reels\nLegenda 2 diferente 💪 #viral\nLegenda 3 variada ✨ #explore"}
              value={value || ""}
              onChange={(e) => onChange(e.target.value)}
              style={{
                width: "100%", minHeight: 140, fontSize: 12, lineHeight: 1.6,
                padding: "10px 12px", borderRadius: 8, resize: "vertical",
                fontFamily: "inherit",
                borderColor: isOverflow ? "var(--danger)" : undefined,
              }}
            />
            {/* Contador */}
            <div style={{
              position: "absolute", bottom: 8, right: 10,
              fontSize: 10, color: "var(--muted)", background: "var(--bg2)",
              padding: "1px 6px", borderRadius: 4, pointerEvents: "none",
            }}>
              {lineCount} linha(s)
            </div>
          </div>

          {/* Aviso de overflow */}
          {isOverflow && (
            <div style={{ fontSize: 11, color: "var(--danger)", marginBottom: 8, padding: "6px 10px", background: "rgba(239,68,68,0.06)", borderRadius: 6 }}>
              ⚠️ Algumas legendas excedem 2200 caracteres (limite do Instagram)
            </div>
          )}

          {/* Ações */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: lineCount > 0 ? 14 : 0 }}>
            <button className="btn btn-ghost btn-xs" onClick={() => setShowExamples(p => !p)}>
              {showExamples ? "Ocultar exemplos" : "Ver exemplos"}
            </button>
            <button className="btn btn-ghost btn-xs" onClick={loadExamples}>Carregar exemplos</button>
            {lineCount > 0 && (
              <button className="btn btn-ghost btn-xs" style={{ color: "var(--danger)" }} onClick={() => onChange("")}>
                Limpar tudo
              </button>
            )}
            {lineCount > 0 && (
              <span style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center", marginLeft: "auto" }}>
                {charCount} chars
              </span>
            )}
          </div>

          {/* Exemplos expandidos */}
          {showExamples && (
            <div style={{ marginBottom: 14, padding: "10px 12px", background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 8 }}>EXEMPLO DE FORMATO</div>
              {EXAMPLES.map((ex, i) => (
                <div key={i} style={{ fontSize: 11, color: "var(--text)", marginBottom: 4, padding: "4px 0", borderBottom: i < EXAMPLES.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span style={{ color: "var(--muted)", marginRight: 6 }}>{i + 1}.</span>{ex}
                </div>
              ))}
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                Cada linha = uma legenda separada. Linhas em branco são ignoradas.
              </div>
            </div>
          )}

          {/* Preview da distribuição */}
          {lineCount > 0 && previewItems.length > 0 && (
            <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "10px 12px", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                PRÉVIA DA DISTRIBUIÇÃO
                <span style={{ fontWeight: 400 }}>— como os primeiros {previewItems.length} posts receberão as legendas</span>
              </div>
              {previewItems.map(({ index, caption }) => (
                <div key={index} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: "var(--accent-light)",
                    background: "var(--accent-glow)", border: "1px solid var(--accent)",
                    borderRadius: 4, padding: "1px 5px", flexShrink: 0, marginTop: 1,
                  }}>
                    #{index + 1}
                  </span>
                  <span style={{
                    fontSize: 11, color: "var(--text)", lineHeight: 1.5,
                    overflow: "hidden", display: "-webkit-box",
                    WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                    flex: 1,
                  }}>
                    {caption || <span style={{ color: "var(--muted)", fontStyle: "italic" }}>sem legenda</span>}
                  </span>
                </div>
              ))}
              {lineCount > 0 && mode !== "same" && (
                <div style={{ marginTop: 6, fontSize: 10, color: "var(--muted)", borderTop: "1px solid var(--border)", paddingTop: 6 }}>
                  {mode === "roundrobin" && `Ciclo completo a cada ${lineCount} post(s)`}
                  {mode === "random" && `Sorteio independente a cada post`}
                </div>
              )}
            </div>
          )}

          {/* Dica quando vazio */}
          {lineCount === 0 && (
            <div style={{ fontSize: 11, color: "var(--muted)", padding: "8px 12px", background: "var(--bg3)", borderRadius: 8, textAlign: "center" }}>
              💡 Cole legendas acima (uma por linha) ou deixe em branco para posts sem legenda
            </div>
          )}
        </div>
      )}
    </div>
  );
}
