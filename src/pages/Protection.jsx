// Protection.jsx — Proteção de Contas (v2: configuração em IndexedDB)
import { useState, useEffect } from "react";
import { useAccounts } from "../useAccounts.js";
import { dbGet, dbPut } from "../useDB.js";

const DEFAULTS = { maxPerDay: 50, maxPerHour: 4, minGapMin: 10, windowStart: 7, windowEnd: 23 };
const DB_KEY = "protection_config";

// ── Persistência IndexedDB ────────────────────────────────────────────────────
async function loadCfgFromDB() {
  try {
    const row = await dbGet("protection", DB_KEY);
    if (row?.data) return row.data;
  } catch (_) {}
  // Migração automática do localStorage antigo
  try {
    const raw = localStorage.getItem("insta_protection_v1");
    if (raw) {
      const parsed = JSON.parse(raw);
      await saveCfgToDB(parsed);
      localStorage.removeItem("insta_protection_v1");
      return parsed;
    }
  } catch (_) {}
  return { global: { ...DEFAULTS }, perAccount: {} };
}

async function saveCfgToDB(cfg) {
  await dbPut("protection", { id: DB_KEY, data: cfg, updatedAt: new Date().toISOString() });
}

// ── Slider ────────────────────────────────────────────────────────────────────
function Slider({ label, hint, val, min, max, unit, onChange }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
          {hint && <div style={{ fontSize: 11, color: "var(--muted)" }}>{hint}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="number" value={val} min={min} max={max}
            onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
            style={{ width: 56, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--border)",
              background: "var(--bg3)", color: "var(--text)", fontSize: 13, fontWeight: 600, textAlign: "center" }} />
          <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 28 }}>{unit}</span>
        </div>
      </div>
      <input type="range" min={min} max={max} value={val}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--accent)" }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginTop: 1 }}>
        <span>{min}</span><span>{max}</span>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function Protection() {
  const { accounts } = useAccounts();
  const [cfg, setCfg]       = useState({ global: { ...DEFAULTS }, perAccount: {} });
  const [loading, setLoading] = useState(true);
  const [sel, setSel]       = useState(null);
  const [dirty, setDirty]   = useState(false);
  const [saved, setSaved]   = useState(false);

  useEffect(() => {
    loadCfgFromDB().then(data => { setCfg(data); setLoading(false); });
  }, []);

  const vals     = sel ? (cfg.perAccount[sel] || { ...cfg.global }) : cfg.global;
  const hasCustom = sel && !!cfg.perAccount[sel];

  function setVals(newVals) {
    setDirty(true); setSaved(false);
    if (sel) setCfg(p => ({ ...p, perAccount: { ...p.perAccount, [sel]: newVals } }));
    else     setCfg(p => ({ ...p, global: newVals }));
  }
  function set(key) { return v => setVals({ ...vals, [key]: v }); }

  function resetAccount() {
    setDirty(true);
    setCfg(p => { const pa = { ...p.perAccount }; delete pa[sel]; return { ...p, perAccount: pa }; });
  }

  async function handleSave() {
    await saveCfgToDB(cfg);
    setDirty(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleDiscard() {
    setLoading(true);
    loadCfgFromDB().then(data => { setCfg(data); setDirty(false); setLoading(false); });
  }

  if (loading) return (
    <div style={{ padding: "28px 32px", color: "var(--muted)", fontSize: 13 }}>Carregando configurações…</div>
  );

  return (
    <div style={{ padding: "28px 32px", maxWidth: 860, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>🛡️ Proteção de Contas</h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
          Configure rate limit e janela de postagem para proteger suas contas de banimentos.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "210px 1fr", gap: 20 }}>
        {/* Sidebar */}
        <div>
          <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Configuração</div>
          <button onClick={() => setSel(null)} style={{
            width: "100%", padding: "10px 12px", borderRadius: 10, marginBottom: 6,
            background: !sel ? "rgba(124,92,252,0.12)" : "var(--bg2)",
            border: `1px solid ${!sel ? "rgba(124,92,252,0.35)" : "var(--border)"}`,
            color: !sel ? "var(--accent3)" : "var(--text)", fontWeight: !sel ? 700 : 400,
            fontSize: 13, textAlign: "left", cursor: "pointer",
          }}>
            🌐 Padrão global
            <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 400, marginTop: 2 }}>Aplica a todas as contas</div>
          </button>
          {accounts.length > 0 && (
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", margin: "14px 0 8px" }}>Por conta</div>
          )}
          {accounts.map(acc => {
            const own = !!cfg.perAccount[acc.id]; const active = sel === acc.id;
            return (
              <button key={acc.id} onClick={() => setSel(acc.id)} style={{
                width: "100%", padding: "9px 12px", borderRadius: 10, marginBottom: 6,
                background: active ? "rgba(124,92,252,0.12)" : "var(--bg2)",
                border: `1px solid ${active ? "rgba(124,92,252,0.35)" : "var(--border)"}`,
                color: active ? "var(--accent3)" : "var(--text)", fontWeight: active ? 700 : 400,
                fontSize: 12, textAlign: "left", cursor: "pointer",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>@{acc.username}</span>
                  {own && <span style={{ fontSize: 10, background: "rgba(124,92,252,0.2)", color: "var(--accent)", padding: "1px 6px", borderRadius: 4 }}>custom</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* Painel */}
        <div style={{ background: "var(--bg2)", borderRadius: 14, padding: 24, border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                {sel ? `@${accounts.find(a => a.id === sel)?.username || sel}` : "Configuração Global"}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                {sel ? (hasCustom ? "Configuração personalizada" : "Usando padrão global") : "Padrão para todas as contas sem config própria"}
              </div>
            </div>
            {sel && hasCustom && <button className="btn btn-ghost btn-xs" onClick={resetAccount}>↩ Usar global</button>}
          </div>

          <Slider label="Máximo por dia"   hint="Posts permitidos em 24h"            val={vals.maxPerDay}  min={1} max={100} unit="posts" onChange={set("maxPerDay")} />
          <Slider label="Máximo por hora"  hint="Posts dentro de 1 hora"             val={vals.maxPerHour} min={1} max={20}  unit="posts" onChange={set("maxPerHour")} />
          <Slider label="Intervalo mínimo" hint="Tempo mínimo entre um post e outro" val={vals.minGapMin}  min={1} max={120} unit="min"   onChange={set("minGapMin")} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Início da janela</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="range" min={0} max={22} value={vals.windowStart}
                  onChange={e => { const v = Number(e.target.value); if (v < vals.windowEnd) set("windowStart")(v); }}
                  style={{ flex: 1, accentColor: "var(--accent)" }} />
                <span style={{ fontSize: 14, fontWeight: 700, minWidth: 44 }}>{vals.windowStart}:00</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Fim da janela</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="range" min={1} max={23} value={vals.windowEnd}
                  onChange={e => { const v = Number(e.target.value); if (v > vals.windowStart) set("windowEnd")(v); }}
                  style={{ flex: 1, accentColor: "var(--accent)" }} />
                <span style={{ fontSize: 14, fontWeight: 700, minWidth: 44 }}>{vals.windowEnd}:00</span>
              </div>
            </div>
          </div>

          <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(124,92,252,0.06)",
            border: "1px solid rgba(124,92,252,0.15)", fontSize: 12, color: "var(--muted)", marginBottom: 20 }}>
            ℹ️ Janela: <b style={{ color: "var(--text)" }}>{vals.windowStart}:00–{vals.windowEnd}:00 UTC</b>
            {" · "}<b style={{ color: "var(--text)" }}>{vals.maxPerDay}</b> posts/dia
            {" · "}<b style={{ color: "var(--text)" }}>{vals.maxPerHour}</b> posts/h
            {" · "}<b style={{ color: "var(--text)" }}>{vals.minGapMin}</b> min intervalo
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            {dirty && <button className="btn btn-ghost" onClick={handleDiscard}>Descartar</button>}
            <button className="btn btn-primary" onClick={handleSave} disabled={!dirty}>
              {saved ? "✅ Salvo!" : "💾 Salvar"}
            </button>
          </div>
        </div>
      </div>

      {accounts.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Resumo por conta</div>
          <div style={{ background: "var(--bg2)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg3)" }}>
                  {["Conta","Máx/dia","Máx/hora","Intervalo","Janela","Config"].map(h => (
                    <th key={h} style={{ padding: "9px 14px", textAlign: "left", color: "var(--muted)", fontWeight: 600, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accounts.map((acc, i) => {
                  const c = cfg.perAccount[acc.id] || cfg.global;
                  const own = !!cfg.perAccount[acc.id];
                  return (
                    <tr key={acc.id} style={{ borderBottom: i < accounts.length - 1 ? "1px solid var(--border)" : "none" }}>
                      <td style={{ padding: "9px 14px", fontWeight: 500 }}>@{acc.username}</td>
                      <td style={{ padding: "9px 14px", color: "var(--muted)" }}>{c.maxPerDay}</td>
                      <td style={{ padding: "9px 14px", color: "var(--muted)" }}>{c.maxPerHour}</td>
                      <td style={{ padding: "9px 14px", color: "var(--muted)" }}>{c.minGapMin}min</td>
                      <td style={{ padding: "9px 14px", color: "var(--muted)" }}>{c.windowStart}:00–{c.windowEnd}:00</td>
                      <td style={{ padding: "9px 14px" }}>
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4,
                          background: own ? "rgba(124,92,252,0.15)" : "rgba(100,100,120,0.1)",
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
    </div>
  );
}
