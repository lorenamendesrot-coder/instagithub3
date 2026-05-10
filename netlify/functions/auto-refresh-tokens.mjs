// netlify/functions/auto-refresh-tokens.mjs
// Roda automaticamente toda segunda-feira às 9h UTC.
// Renova tokens que estão com menos de 30 dias para expirar.
// Não precisa de nenhuma ação manual — o Netlify chama isso sozinho.

import { getStore } from "@netlify/blobs";

const GRAPH      = "https://graph.facebook.com/v21.0";
const STORE_NAME = "insta-accounts";

function getAccountsStore() {
  return getStore({
    name:        STORE_NAME,
    siteID:      process.env.NETLIFY_SITE_ID,
    token:       process.env.NETLIFY_TOKEN,
    consistency: "strong",
  });
}

async function debugToken(token) {
  const APP_ID     = process.env.META_APP_ID;
  const APP_SECRET = process.env.META_APP_SECRET;
  const res  = await fetch(
    `${GRAPH}/debug_token?input_token=${token}&access_token=${APP_ID}|${APP_SECRET}`
  );
  const data = await res.json();
  return data.data || data;
}

async function refreshToken(token) {
  const APP_ID     = process.env.META_APP_ID;
  const APP_SECRET = process.env.META_APP_SECRET;
  const res  = await fetch(
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${token}`
  );
  return res.json();
}

export default async function handler() {
  console.log("[auto-refresh-tokens] Iniciando às", new Date().toISOString());

  const store       = getAccountsStore();
  const { blobs }   = await store.list();
  const results     = [];
  let   renewed     = 0;
  let   alreadyOk   = 0;
  let   expired     = 0;
  let   errors      = 0;

  for (const { key } of blobs) {
    let acc;
    try { acc = await store.get(key, { type: "json" }); } catch { continue; }
    if (!acc?.id || !acc?.access_token) continue;

    try {
      // 1. Verificar estado atual do token
      const debug    = await debugToken(acc.access_token);
      const isValid  = debug.is_valid === true;
      const daysLeft = debug.expires_at && debug.expires_at > 0
        ? Math.round((debug.expires_at * 1000 - Date.now()) / 86_400_000)
        : null; // null = nunca expira (token de página permanente)

      if (!isValid) {
        // Token expirado — marcar no Blob para avisar no dashboard
        await store.setJSON(key, { ...acc, token_status: "expired", updated_at: new Date().toISOString() });
        results.push({ username: acc.username, status: "expired" });
        expired++;
        continue;
      }

      // Tokens que nunca expiram (expires_at === 0) não precisam de renovação
      if (daysLeft === null) {
        await store.setJSON(key, { ...acc, token_status: "valid", updated_at: new Date().toISOString() });
        results.push({ username: acc.username, status: "never_expires" });
        alreadyOk++;
        continue;
      }

      // 2. Renovar se faltar menos de 30 dias (ou proativamente sempre)
      // Meta recomenda renovar sempre que possível — tokens de página podem ser estendidos indefinidamente
      const refreshed = await refreshToken(acc.access_token);

      if (refreshed.access_token) {
        await store.setJSON(key, {
          ...acc,
          access_token:        refreshed.access_token,
          token_status:        "valid",
          token_refreshed_at:  new Date().toISOString(),
          token_expires_in:    refreshed.expires_in,
          updated_at:          new Date().toISOString(),
        });
        results.push({
          username:   acc.username,
          status:     "renewed",
          expires_in: refreshed.expires_in,
          days_left:  daysLeft,
        });
        renewed++;
        console.log(`[auto-refresh-tokens] ✅ @${acc.username} renovado (era ${daysLeft} dias restantes)`);
      } else {
        results.push({ username: acc.username, status: "refresh_failed", error: refreshed.error });
        errors++;
      }

    } catch (err) {
      results.push({ username: acc.username, status: "error", error: err.message });
      errors++;
    }
  }

  const summary = { renewed, already_ok: alreadyOk, expired, errors, total: blobs.length };
  console.log("[auto-refresh-tokens] Concluído:", summary);

  return new Response(JSON.stringify({ summary, results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Roda toda segunda-feira às 9h UTC
// Para mudar: https://crontab.guru
export const config = {
  schedule: "0 9 * * 1",
};
