// publish.mjs
const GRAPH_FB       = "https://graph.facebook.com/v21.0";
const GRAPH_IG       = "https://graph.instagram.com";
function isIGToken(t) { return t?.startsWith('IGAA'); }
function graph(t)    { return isIGToken(t) ? GRAPH_IG : GRAPH_FB; }
const sleep          = (ms) => new Promise((r) => setTimeout(r, ms));
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";

// ─── Rate limit em memória ────────────────────────────────────────────────────
const warmupState = new Map();

function getState(id) {
  if (!warmupState.has(id)) warmupState.set(id, { postsToday: 0, postsHour: 0, lastPostAt: null, dateKey: "", hourKey: "" });
  const s = warmupState.get(id), now = new Date();
  const dk = now.toISOString().slice(0, 10), hk = `${dk}-${now.getUTCHours()}`;
  if (s.dateKey !== dk) { s.postsToday = 0; s.dateKey = dk; }
  if (s.hourKey !== hk) { s.postsHour  = 0; s.hourKey = hk; }
  return s;
}

const MAX_DAY  = parseInt(process.env.MAX_POSTS_PER_DAY  || "50");
const MAX_HOUR = parseInt(process.env.MAX_POSTS_PER_HOUR || "4");
const MIN_GAP  = parseInt(process.env.MIN_GAP_MINUTES    || "10");
const W_START  = parseInt(process.env.POST_WINDOW_START  || "7");
const W_END    = parseInt(process.env.POST_WINDOW_END    || "23");

function fmtWait(ms) {
  if (ms <= 0) return "agora";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function canPublish(id) {
  const s = getState(id), now = Date.now(), h = new Date(now).getUTCHours();

  if (h < W_START || h >= W_END) {
    const n = new Date(now);
    if (h >= W_END) n.setUTCDate(n.getUTCDate() + 1);
    n.setUTCHours(W_START, 0, 0, 0);
    const w = n - now;
    return { ok: false, reason: `Fora da janela (${W_START}h–${W_END}h UTC). Aguardar ${fmtWait(w)}.`, waitMs: w };
  }
  if (s.postsToday >= MAX_DAY) {
    const n = new Date(now);
    n.setUTCDate(n.getUTCDate() + 1); n.setUTCHours(W_START, 0, 0, 0);
    const w = n - now;
    return { ok: false, reason: `Limite diário (${s.postsToday}/${MAX_DAY}). Aguardar ${fmtWait(w)}.`, waitMs: w };
  }
  if (s.postsHour >= MAX_HOUR) {
    const n = new Date(now); n.setUTCMinutes(60, 0, 0);
    const w = n - now;
    return { ok: false, reason: `Limite/hora (${s.postsHour}/${MAX_HOUR}). Aguardar ${fmtWait(w)}.`, waitMs: w };
  }
  if (s.lastPostAt) {
    const el = now - s.lastPostAt, mg = MIN_GAP * 60000;
    if (el < mg) {
      const w = mg - el;
      return { ok: false, reason: `Intervalo mínimo ${MIN_GAP}min. Aguardar ${fmtWait(w)}.`, waitMs: w };
    }
  }
  return { ok: true };
}

function recordPost(id, ok) {
  const s = getState(id);
  if (ok) { s.postsToday++; s.postsHour++; s.lastPostAt = Date.now(); }
}

// ─── Polling do container de vídeo ───────────────────────────────────────────
async function waitForContainer(id, token) {
  for (let i = 0; i < 8; i++) {
    await sleep(5000);
    try {
      const r = await fetch(`${graph(token)}/${id}?fields=status_code,status&access_token=${token}`);
      const d = await r.json();
      if (d.status_code === "FINISHED") return { ready: true };
      if (d.status_code === "ERROR") {
        const reason = d.status || "Erro no processamento";
        return { ready: false, error: `Instagram: ${reason}` };
      }
      // IN_PROGRESS ou PUBLISHED — continua aguardando
    } catch (_) {}
  }
  // Ainda processando após 40s — retorna pending para o publish-finish continuar
  return { ready: false, pending: true, creation_id: id };
}

// ─── Publicação por conta ─────────────────────────────────────────────────────
async function publishOne({ account, media_url, media_type, post_type, caption }) {
  const token = account.access_token;
  if (!token) return { success: false, error: "Token não encontrado. Reconecte a conta." };

  // Verifica se a URL está acessível (Instagram precisa baixar o vídeo)
  try {
    const check = await fetch(media_url, { method: "HEAD" });
    if (!check.ok) return { success: false, error: `URL inacessível (HTTP ${check.status}). Verifique se o arquivo está público.` };
  } catch {
    return { success: false, error: "URL inacessível. Verifique a conexão ou se o arquivo está público." };
  }

  const isVideo = media_type === "VIDEO";
  let payload = { access_token: token };

  if (post_type === "REEL") {
    if (!isVideo) return { success: false, error: "Reels só aceita vídeo." };
    payload = { ...payload, video_url: media_url, media_type: "REELS", caption, share_to_feed: true };
  } else if (post_type === "FEED") {
    payload = isVideo
      ? { ...payload, video_url: media_url, media_type: "REELS", caption }
      : { ...payload, image_url: media_url, caption };
  } else if (post_type === "STORY") {
    payload = isVideo
      ? { ...payload, video_url: media_url, media_type: "VIDEO" }
      : { ...payload, image_url: media_url };
  }

  try {
    const cRes  = await fetch(`${graph(token)}/${account.id}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const cData = await cRes.json();
    if (cData.error) return { success: false, error: cData.error.message, errorCode: cData.error.code };

    if (isVideo || post_type === "REEL") {
      const result = await waitForContainer(cData.id, token);
      if (result.pending) return { success: false, pending: true, creation_id: cData.id, error: "Vídeo processando. Será publicado automaticamente em breve." };
      if (!result.ready)  return { success: false, error: result.error };
    }

    const pRes  = await fetch(`${graph(token)}/${account.id}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: cData.id, access_token: token }),
    });
    const pData = await pRes.json();
    if (pData.error) return { success: false, error: pData.error.message, errorCode: pData.error.code };

    return { success: true, media_id: pData.id, published_at: new Date().toISOString() };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export const handler = async (event) => {
  const origin     = event.headers?.origin || "";
  const corsOrigin = ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN || "*";
  const headers    = {
    "Access-Control-Allow-Origin":  corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type":                 "application/json",
    ...(corsOrigin !== "*" && { Vary: "Origin" }),
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const { accounts, media_url, media_type, post_type, captions, default_caption, delay_seconds, skip_rate_limit } = body;

  if (!accounts?.length || !media_url || !media_type || !post_type)
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Campos obrigatórios ausentes" }) };

  const delayMs = (parseInt(String(delay_seconds)) || 0) * 1000;
  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    const account = accounts[i];

    if (!skip_rate_limit) {
      const check = canPublish(account.id);
      if (!check.ok) {
        results.push({ account_id: account.id, username: account.username, success: false, rate_limited: true, error: check.reason, wait_ms: check.waitMs, wait_human: fmtWait(check.waitMs) });
        continue;
      }
    }

    const caption = captions?.[account.id] ?? default_caption ?? "";
    const result  = await publishOne({ account, media_url, media_type, post_type, caption });
    recordPost(account.id, result.success);
    results.push({ account_id: account.id, username: account.username, ...result });
  }

  return { statusCode: 200, headers, body: JSON.stringify({ results }) };
};
