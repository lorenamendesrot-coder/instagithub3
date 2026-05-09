// publish-finish.mjs
// Finaliza containers de vídeo que ficaram pendentes no publish principal.
// Chamada pelo SW quando publish retorna { pending: true, creation_id }.
// Só faz: poll curto → media_publish. Sem download, sem R2, sem sanitização.

import { getStore } from "@netlify/blobs";

const GRAPH         = "https://graph.facebook.com/v21.0";
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

// Poll até FINISHED — máximo 4×5s = 20s (dentro do timeout de 26s do Netlify)
// Se não FINISHED: retorna not_ready — o SW vai chamar de novo no próximo tick
async function pollUntilReady(creationId, token) {
  for (let i = 0; i < 4; i++) {
    await sleep(5000);
    try {
      const r = await fetch(`${GRAPH}/${creationId}?fields=status_code&access_token=${token}`);
      const d = await r.json();
      if (d.status_code === "FINISHED") return { ready: true, forced: false };
      if (d.status_code === "ERROR")    return { ready: false, error: "Instagram reportou erro no processamento do vídeo" };
      // IN_PROGRESS — continua o loop
      console.log(`[publish-finish] ${creationId} ainda IN_PROGRESS (tentativa ${i+1}/4)`);
    } catch { /* ignora erros de rede */ }
  }
  // Não confirmou FINISHED dentro de 20s — retorna not_ready
  // O SW vai reagendar para o próximo tick (não faz publish optimistic — reduz erros "Media ID not available")
  return { ready: false, not_ready: true };
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
      results.push({ account_id, success: false, error: "Token ou creation_id ausente" });
      continue;
    }

    // Poll — 4×5s = 20s máximo
    const poll = await pollUntilReady(creation_id, token);

    if (poll.not_ready) {
      // Vídeo ainda processando — retorna sem resultado para o SW reagendar
      // O SW detecta results=[] e incrementa attempts até maxAttempts
      console.log(`[${account?.username}] Vídeo ainda não pronto — SW vai tentar novamente`);
      continue; // não adiciona em results — SW interpreta como "sem resultado ainda"
    }

    if (!poll.ready) {
      results.push({ account_id, username: account?.username, success: false, error: poll.error });
      continue;
    }

    // Publish
    try {
      const pRes  = await fetch(`${GRAPH}/${account_id}/media_publish`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ creation_id, access_token: token }),
      });
      const pData = await pRes.json();
      if (pData.error) {
        results.push({ account_id, username: account?.username, success: false, error: pData.error.message });
      } else {
        results.push({ account_id, username: account?.username, success: true, media_id: pData.id, published_at: new Date().toISOString() });
      }
    } catch (err) {
      results.push({ account_id, username: account?.username, success: false, error: err.message });
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ results }) };
};
