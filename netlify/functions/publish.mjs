// publish.mjs
const GRAPH          = "https://graph.facebook.com/v21.0";
const sleep          = (ms) => new Promise((r) => setTimeout(r, ms));
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";

async function waitForContainer(id, token) {
  for (let i = 0; i < 5; i++) {
    await sleep(4000);
    try {
      const r = await fetch(`${GRAPH}/${id}?fields=status_code&access_token=${token}`);
      const d = await r.json();
      if (d.status_code === "FINISHED") return { ready: true };
      if (d.status_code === "ERROR")    return { ready: false, error: "Instagram: erro no processamento do vídeo" };
    } catch (_) {}
  }
  return { ready: false, pending: true, creation_id: id };
}

async function publishOne({ account, media_url, media_type, post_type, caption }) {
  const token = account.access_token;
  if (!token) return { success: false, error: "Token não encontrado. Reconecte a conta." };

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
    // Criar container
    const cRes  = await fetch(`${GRAPH}/${account.id}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const cData = await cRes.json();
    if (cData.error) return { success: false, error: cData.error.message, errorCode: cData.error.code };

    // Para vídeos: aguardar processamento
    if (isVideo || post_type === "REEL") {
      const result = await waitForContainer(cData.id, token);
      if (result.pending) return { success: false, pending: true, creation_id: cData.id, error: "Vídeo processando. Será publicado automaticamente em breve." };
      if (!result.ready)  return { success: false, error: result.error };
    }

    // Publicar
    const pRes  = await fetch(`${GRAPH}/${account.id}/media_publish`, {
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

  const { accounts, media_url, media_type, post_type, captions, default_caption, delay_seconds } = body;

  if (!accounts?.length || !media_url || !media_type || !post_type)
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Campos obrigatórios ausentes" }) };

  const delayMs = (parseInt(String(delay_seconds)) || 0) * 1000;
  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    const account = accounts[i];
    const caption = captions?.[account.id] ?? default_caption ?? "";
    const result  = await publishOne({ account, media_url, media_type, post_type, caption });
    results.push({ account_id: account.id, username: account.username, ...result });
  }

  return { statusCode: 200, headers, body: JSON.stringify({ results }) };
};
