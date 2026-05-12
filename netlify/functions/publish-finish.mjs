// publish-finish.mjs
// Finaliza containers de vídeo que ficaram pendentes no publish principal.
// Estratégia: checa status UMA vez por chamada — se FINISHED publica imediatamente,
// se IN_PROGRESS retorna not_ready para o SW reagendar (sem desperdiçar 20s de poll).

import { getStore } from "@netlify/blobs";

const GRAPH_FB       = "https://graph.facebook.com/v21.0";
const GRAPH_IG       = "https://graph.instagram.com";
function isIGToken(t) { return t?.startsWith('IGAA'); }
function graph(t)    { return isIGToken(t) ? GRAPH_IG : GRAPH_FB; }
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";
const sleep          = (ms) => new Promise((r) => setTimeout(r, ms));

async function getFreshToken(accountId) {
  try {
    const store = getStore({
      name: "insta-accounts",
      siteID: process.env.NETLIFY_SITE_ID,
      token:  process.env.NETLIFY_TOKEN,
      consistency: "strong",
    });
    const acc = await store.get(`account-${accountId}`, { type: "json" });
    return acc?.access_token || null;
  } catch {
    return null;
  }
}

// Checa status do container com até 3 polls rápidos de 3s.
// Retorna imediatamente se FINISHED ou ERROR — não fica bloqueado em IN_PROGRESS.
async function checkContainer(creationId, token) {
  for (let i = 0; i < 3; i++) {
    if (i > 0) await sleep(3000);
    try {
      const r = await fetch(`${graph(token)}/${creationId}?fields=status_code&access_token=${token}`);
      const d = await r.json();
      if (d.error) return { ready: false, expired: true, error: d.error.message };
      if (d.status_code === "FINISHED") return { ready: true };
      if (d.status_code === "ERROR")    return { ready: false, error: "Instagram: erro no processamento do vídeo" };
      console.log(`[publish-finish] ${creationId} IN_PROGRESS (check ${i + 1}/3)`);
    } catch (e) {
      console.warn(`[publish-finish] erro ao checar ${creationId}:`, e.message);
    }
  }
  return { ready: false, not_ready: true };
}

// Tenta publicar. Se der "Media ID not available" tenta até 3x com 4s de intervalo.
async function tryPublish(accountId, creationId, token, username) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(4000);
    try {
      const pRes  = await fetch(`${graph(token)}/${accountId}/media_publish`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ creation_id: creationId, access_token: token }),
      });
      const pData = await pRes.json();
      if (!pData.error) {
        return { account_id: accountId, username, success: true, media_id: pData.id, published_at: new Date().toISOString() };
      }
      if (pData.error.code === 9007 || pData.error.message?.includes("Media ID")) {
        console.warn(`[publish-finish] Media ID not available — tentativa ${attempt + 1}/3`);
        continue;
      }
      return { account_id: accountId, username, success: false, error: pData.error.message, errorCode: pData.error.code };
    } catch (err) {
      if (attempt < 2) continue;
      return { account_id: accountId, username, success: false, error: err.message };
    }
  }
  return { account_id: accountId, username, success: false, error: "Media ID not available após 3 tentativas" };
}

export const handler = async (event) => {
  const reqOrigin  = event.headers?.origin || "";
  const corsOrigin = ALLOWED_ORIGIN && reqOrigin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN || "*";
  const headers    = {
    "Access-Control-Allow-Origin":  corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type":                 "application/json",
    ...(corsOrigin !== "*" && { "Vary": "Origin" }),
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const { pending = [], accounts = [] } = body;
  if (!pending.length) return { statusCode: 400, headers, body: JSON.stringify({ error: "Nenhum item pendente" }) };

  const results = [];

  for (const item of pending) {
    const { account_id, creation_id } = item;
    const account = accounts.find((a) => a.id === account_id);

    const freshToken = await getFreshToken(account_id);
    const token      = freshToken || account?.access_token;

    if (!token || !creation_id) {
      results.push({ account_id, username: item.username || account?.username, success: false, error: "Token ou creation_id ausente" });
      continue;
    }

    const check = await checkContainer(creation_id, token);

    if (check.not_ready) {
      console.log(`[publish-finish] @${item.username} IN_PROGRESS — reagendando`);
      continue; // SW interpreta results=[] como "ainda não pronto"
    }

    if (check.expired || (!check.ready && check.error)) {
      results.push({ account_id, username: item.username || account?.username, success: false, error: check.error });
      continue;
    }

    if (check.ready) {
      const result = await tryPublish(account_id, creation_id, token, item.username || account?.username);
      results.push(result);
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ results }) };
};
