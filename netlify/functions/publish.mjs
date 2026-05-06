// publish.mjs — sem dependência de banco de dados (Prisma removido)
// Rate limit e warm-up em memória (resetam a cada deploy, suficiente para uso normal)

const GRAPH = "https://graph.facebook.com/v21.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";

// ─── Estado em memória por conta ─────────────────────────────────────────────
const warmupState = new Map();

function getState(accountId) {
  if (!warmupState.has(accountId)) {
    warmupState.set(accountId, { postsToday: 0, postsHour: 0, lastPostAt: null, dateKey: "", hourKey: "" });
  }
  const state   = warmupState.get(accountId);
  const now     = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const hourKey = `${dateKey}-${now.getUTCHours()}`;
  if (state.dateKey !== dateKey) { state.postsToday = 0; state.dateKey = dateKey; }
  if (state.hourKey !== hourKey) { state.postsHour  = 0; state.hourKey = hourKey; }
  return state;
}

const MAX_PER_DAY  = parseInt(process.env.MAX_POSTS_PER_DAY  || "50");
const MAX_PER_HOUR = parseInt(process.env.MAX_POSTS_PER_HOUR || "4");
const MIN_GAP_MIN  = parseInt(process.env.MIN_GAP_MINUTES    || "10");
const WINDOW_START = parseInt(process.env.POST_WINDOW_START  || "7");
const WINDOW_END   = parseInt(process.env.POST_WINDOW_END    || "23");

function formatWait(ms) {
  if (ms <= 0) return "agora";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function canPublish(accountId) {
  const state = getState(accountId);
  const now   = Date.now();
  const hour  = new Date(now).getUTCHours();

  if (hour < WINDOW_START || hour >= WINDOW_END) {
    const next = new Date(now);
    if (hour >= WINDOW_END) next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(WINDOW_START, 0, 0, 0);
    const waitMs = next.getTime() - now;
    return { ok: false, reason: `Fora da janela de postagem (${WINDOW_START}h-${WINDOW_END}h UTC). Aguardar ${formatWait(waitMs)}.`, waitMs };
  }
  if (state.postsToday >= MAX_PER_DAY) {
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(WINDOW_START, 0, 0, 0);
    const waitMs = tomorrow.getTime() - now;
    return { ok: false, reason: `Limite diário atingido (${state.postsToday}/${MAX_PER_DAY}). Aguardar ${formatWait(waitMs)}.`, waitMs };
  }
  if (state.postsHour >= MAX_PER_HOUR) {
    const nextHour = new Date(now);
    nextHour.setUTCMinutes(60, 0, 0);
    const waitMs = nextHour.getTime() - now;
    return { ok: false, reason: `Limite por hora atingido (${state.postsHour}/${MAX_PER_HOUR}). Aguardar ${formatWait(waitMs)}.`, waitMs };
  }
  if (state.lastPostAt) {
    const elapsed  = now - state.lastPostAt;
    const minGapMs = MIN_GAP_MIN * 60_000;
    if (elapsed < minGapMs) {
      const waitMs = minGapMs - elapsed;
      return { ok: false, reason: `Intervalo mínimo não atingido. Aguardar ${formatWait(waitMs)}.`, waitMs };
    }
  }
  return { ok: true };
}

function recordPost(accountId, success) {
  const state = getState(accountId);
  if (success) { state.postsToday++; state.postsHour++; state.lastPostAt = Date.now(); }
}

function isValidHttpsUrl(url) {
  try { return new URL(url).protocol === "https:"; } catch { return false; }
}

async function verifyToken(token) {
  try {
    const res  = await fetch(`${GRAPH}/me?fields=id&access_token=${token}`);
    const data = await res.json();
    if (data.error) return { valid: false, expired: data.error.code === 190 };
    return { valid: true, expired: false };
  } catch {
    return { valid: true, expired: false };
  }
}

async function waitForContainer(containerId, token, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(6000);
    const res  = await fetch(`${GRAPH}/${containerId}?fields=status_code&access_token=${token}`);
    const data = await res.json();
    if (data.status_code === "FINISHED") return true;
    if (data.status_code === "ERROR")    return false;
  }
  return false;
}

async function publishOne({ account, media_url, media_type, post_type, caption }) {
  const { id: igId, access_token: token } = account;
  const isVideo = media_type === "VIDEO";

  const tokenCheck = await verifyToken(token);
  if (!tokenCheck.valid) {
    return {
      success: false,
      error: tokenCheck.expired
        ? "Token expirado. Reconecte a conta no painel de Contas."
        : "Token inválido. Reconecte a conta no painel de Contas.",
      token_expired: tokenCheck.expired,
    };
  }

  try {
    let payload = { access_token: token };

    if (post_type === "FEED") {
      payload = isVideo
        ? { ...payload, video_url: media_url, media_type: "REELS", caption }
        : { ...payload, image_url: media_url, caption };
    } else if (post_type === "REEL") {
      if (!isVideo) return { success: false, error: "Reels só aceita vídeo. Use uma mídia do tipo VIDEO." };
      payload = { ...payload, video_url: media_url, media_type: "REELS", caption, share_to_feed: true };
    } else if (post_type === "STORY") {
      payload = isVideo
        ? { ...payload, video_url: media_url, media_type: "VIDEO" }
        : { ...payload, image_url: media_url };
    }

    const cRes  = await fetch(`${GRAPH}/${igId}/media`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    const cData = await cRes.json();
    if (cData.error) return { success: false, error: cData.error.message, errorCode: cData.error.code };

    if (isVideo || post_type === "REEL") {
      const ready = await waitForContainer(cData.id, token);
      if (!ready) return { success: false, error: "Timeout no processamento do vídeo (120s). Tente novamente." };
    }

    const pRes  = await fetch(`${GRAPH}/${igId}/media_publish`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ creation_id: cData.id, access_token: token }),
    });
    const pData = await pRes.json();
    if (pData.error) return { success: false, error: pData.error.message, errorCode: pData.error.code };

    return { success: true, media_id: pData.id, published_at: new Date().toISOString() };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

export const handler = async (event) => {
  const requestOrigin = event.headers?.origin || "";
  const corsOrigin    = ALLOWED_ORIGIN && requestOrigin === ALLOWED_ORIGIN
    ? ALLOWED_ORIGIN
    : ALLOWED_ORIGIN || "*";

  const headers = {
    "Access-Control-Allow-Origin":  corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type":                 "application/json",
    ...(corsOrigin !== "*" && { "Vary": "Origin" }),
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) };
  }

  const { accounts, media_url, media_type, post_type, captions, default_caption, delay_seconds, skip_rate_limit } = body;

  if (!accounts?.length || !media_url || !media_type || !post_type)
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Campos obrigatórios ausentes" }) };

  if (!["IMAGE", "VIDEO"].includes(media_type))
    return { statusCode: 400, headers, body: JSON.stringify({ error: `media_type inválido: ${media_type}` }) };

  if (!["FEED", "REEL", "STORY"].includes(post_type))
    return { statusCode: 400, headers, body: JSON.stringify({ error: `post_type inválido: ${post_type}` }) };

  if (!isValidHttpsUrl(media_url))
    return { statusCode: 400, headers, body: JSON.stringify({ error: "media_url deve ser uma URL HTTPS válida" }) };

  const delayMs = (parseInt(String(delay_seconds)) || 0) * 1000;
  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    if (i > 0 && delayMs > 0) await sleep(delayMs);

    if (!skip_rate_limit) {
      const check = canPublish(account.id);
      if (!check.ok) {
        results.push({
          account_id:   account.id,
          username:     account.username,
          success:      false,
          rate_limited: true,
          error:        check.reason,
          wait_ms:      check.waitMs,
          wait_human:   formatWait(check.waitMs),
        });
        continue;
      }
    }

    const caption = captions?.[account.id] ?? default_caption ?? "";
    const result  = await publishOne({ account, media_url, media_type, post_type, caption });

    if (!skip_rate_limit) recordPost(account.id, result.success);

    results.push({ account_id: account.id, username: account.username, ...result });
  }

  return { statusCode: 200, headers, body: JSON.stringify({ results }) };
};
