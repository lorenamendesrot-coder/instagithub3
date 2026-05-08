// Warmup.jsx — Aba de Aquecimento de contas
import { useState, useRef, useCallback, useEffect } from "react";
import { useAccounts } from "../useAccounts.js";
import { dbPut, dbGetAll } from "../useDB.js";
import BulkCaptions, { pickCaption } from "../components/BulkCaptions.jsx";

// ─── Plano de aquecimento (7 dias) ───────────────────────────────────────────
const PLAN = [
  { day: 1, max: 1, intervalH: 24 },
  { day: 2, max: 2, intervalH: 6  },
  { day: 3, max: 3, intervalH: 5  },
  { day: 4, max: 4, intervalH: 4  },
  { day: 5, max: 5, intervalH: 3  },
  { day: 6, max: 6, intervalH: 2  },
];

function warmupDay(connectedAt) {
  const diff = Math.floor((Date.now() - new Date(connectedAt)) / 86400000);
  return Math.min(diff + 1, 8);
}

function planFor(day) {
  if (day >= 7) return null;
  return PLAN[Math.min(day - 1, PLAN.length - 1)];
}

function fmtSize(b) {
  if (b < 1048576) return `${(b/1024).toFixed(0)} KB`;
  return `${(b/1048576).toFixed(1)} MB`;
}

// Upload via catbox-proxy (com flag cleanMeta — o proxy já processa no R2)
async function uploadReel(file, onProgress) {
  onProgress(5);
  const b64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded/e.total)*45)+5); };
    r.onload  = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Falha ao ler arquivo"));
    r.readAsDataURL(file);
  });
  onProgress(55);
  const res = await fetch("/api/catbox-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileBase64: b64, fileName: file.name, mimeType: file.type || "video/mp4" }),
  });
  onProgress(90);
  const data = await res.json();
  if (!res.ok || !data.url) throw new Error(data.error || `Erro ${res.status}`);
  onProgress(100);
  return data.url;
}

// Gera slots de agendamento distribuindo reels igualmente entre contas
function buildSlots(accounts, reelUrls, startISO) {
  const slots = [];
  const n = accounts.length;
  if (!n || !reelUrls.length) return slots;

  const perAcc  = Math.floor(reelUrls.length / n);
  const extra   = reelUrls.length % n;

  let ri = 0;
  accounts.forEach((acc, i) => {
    const count  = perAcc + (i < extra ? 1 : 0);
    const mine   = reelUrls.slice(ri, ri + count);
    ri += count;

    const day    = warmupDay(acc.connected_at || new Date().toISOString());
    const p      = planFor(day);
    const maxDay = p ? p.max : 50;
    const intH   = p ? p.intervalH : 1;
    const toPost = Math.min(mine.length, maxDay);

    for (let k = 0; k < toPost; k++) {
      const t = new Date(startISO);
      t.setHours(9 + k * intH, 0, 0, 0);
      slots.push({
        id:          `wup-${acc.id}-${Date.now()}-${k}`,
        accountId:   acc.id,
        username:    acc.username,
        mediaUrl:    mine[k],
        scheduledAt: t.toISOString(),
        day, planMax: maxDay, planInt: intH,
      });
    }
  });
  return slots;
}

// ─── Shadowban detector ───────────────────────────────────────────────────────
function shadowScore(insights) {
  if (!insights || insights.length < 3) return null;
  const vs   = insights.map((i) => i.views || i.reach || 0);
  const avg  = vs.reduce((a,b)=>a+b,0) / vs.length;
  const last = vs[vs.length-1];
  const drop = avg > 0 ? Math.round(((avg-last)/avg)*100) : 0;
  return { avg: Math.round(avg), last, drop };
}

// ─── Componente ───────────────────────────────────────────────────────────────
export default function Warmup() {
  const { accounts } = useAccounts();
  const [reels,     setReels]     = useState([]);   // {id,file,name,size,status,progress,url,error}
  const [slots,     setSlots]     = useState([]);
  const [dragging,  setDragging]  = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [tab,       setTab]       = useState("upload");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setHours(9,0,0,0); return d.toISOString().slice(0,16);
  });
  const inputRef    = useRef();
  const [bulkCaptions, setBulkCaptions] = useState("");
  const [captionMode,  setCaptionMode]  = useState("roundrobin");

  const warmupAccs = accounts.filter(a => warmupDay(a.connected_at||new Date().toISOString()) <= 7);

  // ── Adicionar arquivos ──
  const addFiles = (files) => {
    const vids = Array.from(files).filter(f => f.type.startsWith("video/") || /\.(mp4|mov|webm|avi)$/i.test(f.name));
    setReels(p => [...p, ...vids.map(f => ({
      id: `${Date.now()}-${Math.random()}`, file: f, name: f.name, size: f.size,
      status: "idle", progress: 0, url: "", error: "",
    }))]);
  };

  const onDrop = useCallback((e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }, []);

  // ── Upload ──
  const uploadAll = async () => {
    const pending = reels.filter(r => r.status === "idle" || r.status === "error");
    if (!pending.length) return;
    setUploading(true);
    for (const r of pending) {
      setReels(p => p.map(x => x.id===r.id ? {...x, status:"uploading", progress:0} : x));
      try {
        const url = await uploadReel(r.file, prog => setReels(p => p.map(x => x.id===r.id ? {...x, progress:prog} : x)));
        setReels(p => p.map(x => x.id===r.id ? {...x, status:"done", url, progress:100} : x));
      } catch(err) {
        setReels(p => p.map(x => x.id===r.id ? {...x, status:"error", error:err.message} : x));
      }
    }
    setUploading(false);
  };

  // ── Gerar agendamento ──
  const generate = () => {
    const done = reels.filter(r => r.status==="done").map(r => r.url);
    if (!done.length)   return alert("Faça upload dos reels primeiro.");
    if (!warmupAccs.length) return alert("Nenhuma conta em aquecimento.");
    setSlots(buildSlots(warmupAccs, done, startDate));
    setTab("schedule");
  };

  // ── Confirmar agendamento ──
  const confirmSchedule = async () => {
    if (!slots.length) return;
    setSaving(true);
    const parsedCaptions = bulkCaptions.split("\n").map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      const caption = parsedCaptions.length > 0 ? pickCaption(parsedCaptions, captionMode, i) : "";
      await dbPut("queue", {
        id:           s.id,
        accountId:    s.accountId,
        username:     s.username,
        mediaUrl:     s.mediaUrl,
        mediaUrls:    [s.mediaUrl],
        mediaType:    "VIDEO",
        postType:     "REEL",
        caption,
        bulkCaptions: parsedCaptions,
        captionMode,
        accounts:     [{ id: s.accountId, username: s.username }],
        scheduledAt:  new Date(s.scheduledAt).getTime(),
        status:       "pending",
        warmup:       true,
        warmupDay:    s.day,
        created_at:   new Date().toISOString(),
      });
    }
    setSaving(false);
    window.dispatchEvent(new CustomEvent("sw:queue-update"));
    alert(`✅ ${slots.length} reels agendados!`);
    setSlots([]);
    setReels([]);
    setTab("monitor");
  };

  const doneReels  = reels.filter(r => r.status==="done");
  const errorReels = reels.filter(r => r.status==="error");
  const idleReels  = reels.filter(r => r.status==="idle");

  return (
    <div style={{ padding:"28px 32px", maxWidth:920, margin:"0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:700, margin:0 }}>🔥 Aquecimento de Contas</h1>
        <p style={{ color:"var(--muted)", fontSize:13, marginTop:6 }}>
          Distribui reels automaticamente entre contas novas, respeitando o plano de 7 dias.
        </p>
      </div>

      {/* Cards de status das contas */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))", gap:10, marginBottom:24 }}>
        {accounts.length === 0 && (
          <div style={{ gridColumn:"1/-1", padding:20, textAlign:"center", color:"var(--muted)", fontSize:13,
            background:"var(--bg2)", borderRadius:12, border:"1px solid var(--border)" }}>
            Nenhuma conta conectada
          </div>
        )}
        {accounts.map(acc => {
          const day  = warmupDay(acc.connected_at || new Date().toISOString());
          const done = day > 7;
          const p    = planFor(day);
          return (
            <div key={acc.id} style={{
              padding:"12px 14px", borderRadius:12,
              background: done ? "rgba(34,197,94,0.06)" : "var(--bg2)",
              border:`1px solid ${done ? "rgba(34,197,94,0.25)" : "var(--border)"}`,
            }}>
              <div style={{ fontSize:12, fontWeight:600, marginBottom:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                @{acc.username}
              </div>
              {done ? (
                <div style={{ fontSize:11, color:"var(--success)" }}>✅ Concluído</div>
              ) : (
                <>
                  <div style={{ fontSize:11, color:"var(--muted)", marginBottom:6 }}>Dia {day} de 7</div>
                  <div style={{ height:3, background:"var(--border)", borderRadius:2, overflow:"hidden", marginBottom:4 }}>
                    <div style={{ height:"100%", width:`${(day/7)*100}%`, background:"var(--accent)", borderRadius:2 }} />
                  </div>
                  {p && <div style={{ fontSize:10, color:"var(--muted)" }}>Máx {p.max}/dia · {p.intervalH}h intervalo</div>}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:4, marginBottom:20, background:"var(--bg2)", padding:4, borderRadius:10, width:"fit-content" }}>
        {[["upload","📤 Upload"],["schedule","📅 Agendamento"],["monitor","📊 Monitor"]].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding:"7px 16px", borderRadius:8, fontSize:13, fontWeight:tab===k?600:400,
            background:tab===k?"var(--accent)":"transparent",
            color:tab===k?"#fff":"var(--muted)", border:"none", cursor:"pointer",
          }}>{l}</button>
        ))}
      </div>

      {/* ── Tab Upload ── */}
      {tab === "upload" && (
        <div>
          <div onDrop={onDrop}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onClick={() => !uploading && inputRef.current?.click()}
            style={{
              border:`2px dashed ${dragging ? "var(--accent)" : "var(--border2)"}`,
              borderRadius:14, padding:"36px 20px", textAlign:"center",
              cursor:uploading?"not-allowed":"pointer",
              background:dragging?"rgba(124,92,252,0.06)":"var(--bg2)", transition:"all 0.15s", marginBottom:16,
            }}>
            <div style={{ fontSize:36, marginBottom:10 }}>🎬</div>
            <div style={{ fontWeight:600, fontSize:15, marginBottom:6 }}>
              {dragging ? "Solte os reels aqui" : "Arraste os reels ou clique para selecionar"}
            </div>
            <div style={{ fontSize:12, color:"var(--muted)" }}>MP4, MOV, WEBM · 5–15 segundos recomendado</div>
            <input ref={inputRef} type="file" multiple accept="video/*" style={{ display:"none" }}
              onChange={e => e.target.files.length && addFiles(e.target.files)} />
          </div>

          {reels.length > 0 && (
            <>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <div style={{ fontSize:12, color:"var(--muted)", fontWeight:600 }}>
                  {reels.length} reel(s) · {doneReels.length} prontos
                  {errorReels.length > 0 && <span style={{ color:"var(--danger)", marginLeft:8 }}>{errorReels.length} erro(s)</span>}
                </div>
                <button className="btn btn-ghost btn-xs" onClick={() => setReels([])} disabled={uploading}>Limpar</button>
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:320, overflowY:"auto", marginBottom:16 }}>
                {reels.map(r => (
                  <div key={r.id} style={{
                    display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderRadius:8,
                    background: r.status==="done" ? "rgba(34,197,94,0.06)" : r.status==="error" ? "rgba(239,68,68,0.06)" : "var(--bg3)",
                    border:`1px solid ${r.status==="done"?"rgba(34,197,94,0.2)":r.status==="error"?"rgba(239,68,68,0.2)":"var(--border)"}`,
                  }}>
                    <span style={{ fontSize:18 }}>🎬</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.name}</div>
                      <div style={{ fontSize:11, color:"var(--muted)" }}>{fmtSize(r.size)}</div>
                      {r.status==="uploading" && (
                        <div style={{ marginTop:4 }}>
                          <div style={{ height:3, background:"var(--border)", borderRadius:2, overflow:"hidden" }}>
                            <div style={{ height:"100%", width:`${r.progress}%`, background:"var(--accent)", transition:"width 0.3s" }} />
                          </div>
                          <div style={{ fontSize:10, color:"var(--muted)", marginTop:2 }}>
                            {r.progress < 55 ? "Lendo arquivo..." : `Enviando... ${r.progress}%`}
                          </div>
                        </div>
                      )}
                      {r.status==="done"  && <div style={{ fontSize:11, color:"var(--success)", marginTop:2 }}>✓ Pronto</div>}
                      {r.status==="error" && <div style={{ fontSize:11, color:"var(--danger)",  marginTop:2 }}>✗ {r.error}</div>}
                    </div>
                    <div style={{ flexShrink:0 }}>
                      {r.status==="idle"      && <span className="badge badge-gray">Pendente</span>}
                      {r.status==="uploading" && <span className="spinner" style={{ width:14, height:14 }} />}
                      {r.status==="done"      && <span className="badge badge-success">✓</span>}
                      {r.status==="error"     && <span className="badge badge-danger">Erro</span>}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display:"flex", gap:10 }}>
                <button className="btn btn-primary" style={{ flex:1 }} onClick={uploadAll}
                  disabled={uploading || (idleReels.length===0 && errorReels.length===0)}>
                  {uploading ? <><span className="spinner" /> Enviando...</> : `☁️ Enviar ${idleReels.length+errorReels.length} reel(s)`}
                </button>
                {doneReels.length > 0 && (
                  <button className="btn btn-success" onClick={generate}>📅 Gerar agendamento</button>
                )}
              </div>

              {doneReels.length > 0 && warmupAccs.length > 0 && (
                <div style={{ marginTop:12, padding:"10px 14px", borderRadius:10,
                  background:"rgba(124,92,252,0.06)", border:"1px solid rgba(124,92,252,0.15)", fontSize:12, color:"var(--muted)" }}>
                  ℹ️ {doneReels.length} reels serão distribuídos entre {warmupAccs.length} conta(s)
                  ({Math.floor(doneReels.length/warmupAccs.length)} por conta)
                </div>
              )}

              {/* Legendas em Massa */}
              <div style={{ marginTop:16 }}>
                <BulkCaptions
                  value={bulkCaptions}
                  onChange={setBulkCaptions}
                  mode={captionMode}
                  onModeChange={setCaptionMode}
                  previewCount={Math.min(doneReels.length || 3, 6)}
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tab Agendamento ── */}
      {tab === "schedule" && (
        <div>
          {slots.length === 0 ? (
            <div style={{ textAlign:"center", padding:40, color:"var(--muted)", fontSize:13 }}>
              Nenhum agendamento gerado ainda.<br />Faça o upload dos reels e clique em "Gerar agendamento".
            </div>
          ) : (
            <>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:10 }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{slots.length} postagens prontas para agendar</div>
                <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                  <label style={{ fontSize:12, color:"var(--muted)", display:"flex", alignItems:"center", gap:6 }}>
                    Início:
                    <input type="datetime-local" value={startDate}
                      onChange={e => {
                        setStartDate(e.target.value);
                        setSlots(buildSlots(warmupAccs, doneReels.map(r=>r.url), e.target.value));
                      }}
                      style={{ padding:"4px 8px", borderRadius:6, border:"1px solid var(--border)", background:"var(--bg2)", color:"var(--text)", fontSize:12 }} />
                  </label>
                  <button className="btn btn-primary" onClick={confirmSchedule} disabled={saving}>
                    {saving ? <><span className="spinner" /> Salvando...</> : "✅ Confirmar agendamento"}
                  </button>
                </div>
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:500, overflowY:"auto" }}>
                {slots.map(s => (
                  <div key={s.id} style={{
                    display:"flex", alignItems:"center", gap:12, padding:"10px 14px", borderRadius:10,
                    background:"var(--bg2)", border:"1px solid var(--border)",
                  }}>
                    <span style={{ fontSize:16 }}>🎬</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:600 }}>@{s.username}</div>
                      <div style={{ fontSize:11, color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.mediaUrl.split("/").pop()}</div>
                    </div>
                    <div style={{ fontSize:11, color:"var(--muted)", flexShrink:0 }}>Dia {s.day} · máx {s.planMax}/dia</div>
                    <div style={{ fontSize:11, fontWeight:500, flexShrink:0 }}>
                      {new Date(s.scheduledAt).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tab Monitor ── */}
      {tab === "monitor" && (
        <div>
          <div style={{ marginBottom:16, fontSize:13, color:"var(--muted)" }}>
            Detecta possível shadowban com base nas métricas de views e engajamento.
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {accounts.length === 0 && (
              <div style={{ textAlign:"center", padding:30, color:"var(--muted)", fontSize:13 }}>Nenhuma conta conectada.</div>
            )}
            {accounts.map(acc => {
              const day   = warmupDay(acc.connected_at || new Date().toISOString());
              const score = shadowScore(acc.insights);
              const risk  = score?.drop > 70 ? "high" : score?.drop > 40 ? "medium" : "ok";
              return (
                <div key={acc.id} style={{
                  padding:"14px 16px", borderRadius:12, background:"var(--bg2)",
                  border:`1px solid ${risk==="high"?"rgba(239,68,68,0.35)":risk==="medium"?"rgba(245,158,11,0.3)":"var(--border)"}`,
                }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600 }}>@{acc.username}</div>
                      <div style={{ fontSize:11, color:"var(--muted)" }}>Dia {day} de aquecimento</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      {!score ? (
                        <div style={{ fontSize:11, color:"var(--muted)" }}>Aguardando dados de insights</div>
                      ) : risk==="high" ? (
                        <div>
                          <div style={{ fontSize:12, fontWeight:700, color:"var(--danger)" }}>⚠️ Possível shadowban</div>
                          <div style={{ fontSize:11, color:"var(--muted)" }}>Queda de {score.drop}% nas views</div>
                        </div>
                      ) : risk==="medium" ? (
                        <div>
                          <div style={{ fontSize:12, fontWeight:600, color:"var(--warning)" }}>⚠️ Queda de engajamento</div>
                          <div style={{ fontSize:11, color:"var(--muted)" }}>Queda de {score.drop}% nas views</div>
                        </div>
                      ) : (
                        <div style={{ fontSize:12, color:"var(--success)" }}>✅ Normal</div>
                      )}
                    </div>
                  </div>
                  {score && (
                    <div style={{ marginTop:10, display:"flex", gap:20, flexWrap:"wrap" }}>
                      <div style={{ fontSize:11, color:"var(--muted)" }}>Média: <b style={{ color:"var(--text)" }}>{score.avg}</b> views</div>
                      <div style={{ fontSize:11, color:"var(--muted)" }}>Último: <b style={{ color:"var(--text)" }}>{score.last}</b> views</div>
                      <div style={{ fontSize:11, color:"var(--muted)" }}>
                        Variação: <b style={{ color:score.drop>40?"var(--danger)":"var(--success)" }}>
                          {score.drop>0?`-${score.drop}%`:`+${Math.abs(score.drop)}%`}
                        </b>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop:16, padding:"12px 16px", borderRadius:10,
            background:"rgba(245,158,11,0.06)", border:"1px solid rgba(245,158,11,0.15)", fontSize:12, color:"var(--muted)" }}>
            ℹ️ Contas com queda acima de 70% nas views recentes podem estar sob shadowban.
            Dados coletados automaticamente pelo Instagram Graph API após cada publicação.
          </div>
        </div>
      )}
    </div>
  );
}
