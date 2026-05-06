// Protection.jsx — Aba de Proteção de Contas
// Configura rate limit, janela de postagem e warm-up por conta
import { useState, useEffect } from "react";
import { useAccounts } from "../useAccounts.js";
import { dbGet, dbPut } from "../useDB.js";

// ─── Defaults globais (espelham os defaults do publish.mjs) ──────────────────
const GLOBAL_DEFAULTS = {
  maxPerDay:   50,
  maxPerHour:  4,
  minGapMin:   10,
  windowStart: 7,
  windowEnd:   23,
};

// ─── Hook para carregar/salvar config de proteção no IndexedDB ────────────────
function useProtectionConfig() {
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    dbGet("sessions", "__protection_config__").then((res) => {
      setConfig(res?.value || { global: { ...GLOBAL_DEFAULTS }, perAccount: {} });
    }).catch(() => {
      setConfig({ global: { ...GLOBAL_DEFAULTS }, perAccount: {} });
    });
  }, []);

  const save = async (newConfig) => {
    setSaving(true);
    await dbPut("sessions", { id: "__protection_config__", value: newConfig });
    setConfig(newConfig);
    setSaving(false);
  };

  return { config, save, saving };
}

// ─── Componente de slider/input ───────────────────────────────────────────────
function ConfigRow({ label, description, value, min, max, unit, onChange }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
          {description && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{description}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <input
            type="number" value={value} min={min} max={max}
            onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || min)))}
            style={{
              width: 60, padding: "4px 8px", borderRadius: 6, textAlign: "center",
              border: "1px solid var(--border)", background: "var(--bg3)",
              color: "var(--text)", fontSize: 13, fontWeight: 600,
            }}
          />
          <span style={{ fontSize: 12, color: "var(--muted)", minWidth: 24 }}>{unit}</span>
        </div>
      </div>
      <input type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        style={{ width: "100%", accentColor: "var(--accent)" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
        <span>{min}</span><span>{max}</span>
      </div>
    </div>
  );
}

// ─── Painel de config (global ou por conta) ───────────────────────────────────
function ConfigPanel({ values, onChange, isDefault }) {
  const set = (key) => (val) => onChange({ ...values, [key]: val });

  return (
    <div>
      <ConfigRow
        label="Máximo por dia"
        description="Total de posts que uma conta pode fazer em 24h"
        value={values.maxPerDay} min={1} max={100} unit="posts/dia"
        onChange={set("maxPerDay")}
      />
      <ConfigRow
        label="Máximo por hora"
        description="Posts permitidos dentro de 1 hora"
        value={values.maxPerHour} min={1} max={20} unit="posts/h"
        onChange={set("maxPerHour")}
      />
      <ConfigRow
        label="Intervalo mínimo"
        description="Tempo mínimo entre um post e outro"
        value={values.minGapMin} min={1} max={120} unit="min"
        onChange={set("minGapMin")}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Início da janela</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="range" min={0} max={23} value={values.windowStart}
              onChange={(e) => {
                const v = parseInt(e.target.value);
                if (v < values.windowEnd) set("windowStart")(v);
              }}
              style={{ flex: 1, accentColor: "var(--accent)" }} />
            <span style={{ fontSize: 13, fontWeight: 600, minWidth: 40 }}>{values.windowStart}:00</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Fim da janela</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="range" min={0} max={23} value={values.windowEnd}
              onChange={(e) => {
                const v = parseInt(e.target.value);
                if (v > values.windowStart) set("windowEnd")(v);
              }}
              style={{ flex: 1, accentColor: "var(--accent)" }} />
            <span style={{ fontSize: 13, fontWeight: 600, minWidth: 40 }}>{values.windowEnd}:00</span>
          </div>
        </div>
      </div>
      <div style={{
        padding: "10px 14px", borderRadius: 10,
        background: "rgba(124,92,252,0.06)", border: "1px solid rgba(124,92,252,0.15)",
        fontSize: 12, color: "var(--muted)",
      }}>
        ℹ️ Janela ativa: <b style={{ color: "var(--text)" }}>{values.windowStart}:00 – {values.windowEnd}:00 (UTC)</b>
        {" · "}máx <b style={{ color: "var(--text)" }}>{values.maxPerDay}</b>/dia
        {" · "}máx <b style={{ color: "var(--text)" }}>{values.maxPerHour}</b>/h
        {" · "}intervalo <b style={{ color: "var(--text)" }}>{values.minGapMin}min</b>
        {isDefault && <span style={{ marginLeft: 8, color: "var(--accent)" }}>(padrão global)</span>}
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function Protection() {
  const { accounts } = useAccounts();
  const { config, save, saving } = useProtectionConfig();
  const [selectedAcc, setSelectedAcc] = useState(null); // null = global
  const [dirty, setDirty] = useState(false);
  const [local, setLocal] = useState(null);

  useEffect(() => {
    if (!config) return;
    setLocal(JSON.parse(JSON.stringify(config)));
  }, [config]);

  if (!config || !local) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Carregando...</div>;
  }

  const currentValues = selectedAcc
    ? (local.perAccount[selectedAcc] || { ...local.global })
    : local.global;

  const handleChange = (newValues) => {
    setDirty(true);
    if (selectedAcc) {
      setLocal((p) => ({ ...p, perAccount: { ...p.perAccount, [selectedAcc]: newValues } }));
    } else {
      setLocal((p) => ({ ...p, global: newValues }));
    }
  };

  const handleResetAccount = () => {
    setDirty(true);
    setLocal((p) => {
      const pa = { ...p.perAccount };
      delete pa[selectedAcc];
      return { ...p, perAccount: pa };
    });
  };

  const hasCustom = selectedAcc && local.perAccount[selectedAcc];

  return (
    <div style={{ padding: "28px 32px", maxWidth: 860, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>🛡️ Proteção de Contas</h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
          Configure rate limit, janela de postagem e intervalos para proteger suas contas de banimentos.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20 }}>

        {/* ── Sidebar de contas ── */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.08em",
            textTransform: "uppercase", marginBottom: 10 }}>Configuração</div>

          {/* Global */}
          <button onClick={() => setSelectedAcc(null)} style={{
            width: "100%", padding: "10px 12px", borderRadius: 10, marginBottom: 6,
            background: !selectedAcc ? "rgba(124,92,252,0.12)" : "var(--bg2)",
            border: `1px solid ${!selectedAcc ? "rgba(124,92,252,0.3)" : "var(--border)"}`,
            color: !selectedAcc ? "var(--accent3)" : "var(--text)",
            fontWeight: !selectedAcc ? 600 : 400, fontSize: 13,
            textAlign: "left", cursor: "pointer",
          }}>
            🌐 Padrão global
            <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 400 }}>Aplica a todas as contas</div>
          </button>

          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.08em",
            textTransform: "uppercase", margin: "14px 0 8px" }}>Por conta</div>

          {accounts.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>Nenhuma conta conectada</div>
          )}
          {accounts.map((acc) => {
            const hasOwn = !!local.perAccount[acc.id];
            return (
              <button key={acc.id} onClick={() => setSelectedAcc(acc.id)} style={{
                width: "100%", padding: "9px 12px", borderRadius: 10, marginBottom: 6,
                background: selectedAcc===acc.id ? "rgba(124,92,252,0.12)" : "var(--bg2)",
                border: `1px solid ${selectedAcc===acc.id ? "rgba(124,92,252,0.3)" : "var(--border)"}`,
                color: selectedAcc===acc.id ? "var(--accent3)" : "var(--text)",
                fontWeight: selectedAcc===acc.id ? 600 : 400, fontSize: 12,
                textAlign: "left", cursor: "pointer",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>@{acc.username}</span>
                  {hasOwn && <span style={{ fontSize: 10, background: "rgba(124,92,252,0.2)", color: "var(--accent)", padding: "1px 6px", borderRadius: 4 }}>custom</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Painel de config ── */}
        <div style={{ background: "var(--bg2)", borderRadius: 14, padding: 24, border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                {selectedAcc
                  ? `@${accounts.find(a => a.id===selectedAcc)?.username || selectedAcc}`
                  : "Configuração Global"}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                {selectedAcc
                  ? hasCustom ? "Configuração personalizada" : "Usando padrão global"
                  : "Aplicada a todas as contas sem config própria"}
              </div>
            </div>
            {selectedAcc && hasCustom && (
              <button className="btn btn-ghost btn-xs" onClick={handleResetAccount}>
                ↩ Usar global
              </button>
            )}
          </div>

          <ConfigPanel
            values={currentValues}
            onChange={handleChange}
            isDefault={selectedAcc && !hasCustom}
          />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
            <button className="btn btn-ghost" onClick={() => { setLocal(JSON.parse(JSON.stringify(config))); setDirty(false); }}
              disabled={!dirty}>
              Descartar
            </button>
            <button className="btn btn-primary" disabled={!dirty || saving}
              onClick={async () => { await save(local); setDirty(false); }}>
              {saving ? <><span className="spinner" /> Salvando...</> : "💾 Salvar configuração"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Tabela resumo ── */}
      {accounts.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Resumo por conta</div>
          <div style={{ background: "var(--bg2)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Conta","Máx/dia","Máx/hora","Intervalo","Janela","Config"].map(h => (
                    <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "var(--muted)", fontWeight: 600, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accounts.map((acc, i) => {
                  const cfg = local.perAccount[acc.id] || local.global;
                  const own = !!local.perAccount[acc.id];
                  return (
                    <tr key={acc.id} style={{ borderBottom: i < accounts.length-1 ? "1px solid var(--border)" : "none" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 500 }}>@{acc.username}</td>
                      <td style={{ padding: "10px 14px", color: "var(--muted)" }}>{cfg.maxPerDay}</td>
                      <td style={{ padding: "10px 14px", color: "var(--muted)" }}>{cfg.maxPerHour}</td>
                      <td style={{ padding: "10px 14px", color: "var(--muted)" }}>{cfg.minGapMin}min</td>
                      <td style={{ padding: "10px 14px", color: "var(--muted)" }}>{cfg.windowStart}:00–{cfg.windowEnd}:00</td>
                      <td style={{ padding: "10px 14px" }}>
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4,
                          background: own ? "rgba(124,92,252,0.15)" : "rgba(100,100,100,0.1)",
                          color: own ? "var(--accent)" : "var(--muted)" }}>
                          {own ? "custom" : "global"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginTop: 20, padding: "12px 16px", borderRadius: 10,
        background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)", fontSize: 12, color: "var(--muted)" }}>
        ⚠️ As configurações são aplicadas em tempo real nas próximas publicações.
        O rate limit em memória no servidor reseta a cada deploy do Netlify.
        Para limites permanentes, configure também as variáveis de ambiente no painel do Netlify:
        <code style={{ marginLeft: 6, fontSize: 11 }}>MAX_POSTS_PER_DAY · MAX_POSTS_PER_HOUR · MIN_GAP_MINUTES · POST_WINDOW_START · POST_WINDOW_END</code>
      </div>
    </div>
  );
}
