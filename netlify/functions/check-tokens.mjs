// check-tokens.mjs — diagnóstico de tokens das contas
// GET /api/check-tokens → verifica validade, tipo e expiração de cada token salvo

import { getStore } from "@netlify/blobs";

const GRAPH      = "https://graph.facebook.com/v21.0";
const GRAPH_IG   = "https://graph.instagram.com";

function isIGToken(token) { return token?.startsWith('IGAA'); }
const STORE_NAME = "insta-accounts";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function getAccountsStore() {
  return getStore({
    name: STORE_NAME,
    siteID: process.env.NETLIFY_SITE_ID,
    token:  process.env.NETLIFY_TOKEN,
    consistency: "strong",
  });
}

async function debugToken(token) {
  const APP_ID     = process.env.META_APP_ID;
  const APP_SECRET = process.env.META_APP_SECRET;
  try {
    // Tokens do Instagram Login (IGAA) são validados pelo graph.instagram.com
    if (isIGToken(token)) {
      const res  = await fetch(`${GRAPH_IG}/me?fields=id&access_token=${token}`);
      const data = await res.json();
      if (data.error) return { is_valid: false, error_code: data.error.code, error_message: data.error.message };
      return { is_valid: true, type: "INSTAGRAM", expires_at: 0, scopes: [] };
    }
    // Tokens do Facebook Login usam debug_token
    const res  = await fetch(
      `${GRAPH}/debug_token?input_token=${token}&access_token=${APP_ID}|${APP_SECRET}`
    );
    const data = await res.json();
    return data.data || data;
  } catch (e) {
    return { error: e.message };
  }
}

async function tryRefresh(token) {
  const APP_ID     = process.env.META_APP_ID;
  const APP_SECRET = process.env.META_APP_SECRET;
  try {
    // Tokens do Instagram Login renovam via graph.instagram.com
    if (isIGToken(token)) {
      const res  = await fetch(
        `${GRAPH_IG}/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`
      );
      const data = await res.json();
      return data;
    }
    // Tokens do Facebook Login
    const res  = await fetch(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${token}`
    );
    const data = await res.json();
    return data;
  } catch (e) {
    return { error: e.message };
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: "Método não permitido" }) };

  try {
    const store         = getAccountsStore();
    const { blobs }     = await store.list();
    const accounts      = (
      await Promise.all(blobs.map(async ({ key }) => {
        try { return await store.get(key, { type: "json" }); } catch { return null; }
      }))
    ).filter(Boolean);

    const results = await Promise.all(accounts.map(async (acc) => {
      const token = acc.access_token;
      if (!token) return { id: acc.id, username: acc.username, error: "sem token salvo" };

      const debug = await debugToken(token);

      const isValid    = debug.is_valid === true;
      const expiresAt  = debug.expires_at  // unix timestamp, 0 = nunca expira
        ? (debug.expires_at === 0 ? null : new Date(debug.expires_at * 1000).toISOString())
        : null;
      const daysLeft   = debug.expires_at && debug.expires_at > 0
        ? Math.round((debug.expires_at * 1000 - Date.now()) / 86400000)
        : null;
      const tokenType  = debug.type || "desconhecido";
      const scopes     = debug.scopes || [];

      let refreshResult = null;
      // Tenta renovar se válido e com menos de 30 dias ou expirado
      if (isValid && (daysLeft === null || daysLeft < 30)) {
        const refreshed = await tryRefresh(token);
        if (refreshed.access_token && refreshed.access_token !== token) {
          // Salva o token renovado no Blobs
          await store.setJSON(`account-${acc.id}`, {
            ...acc,
            access_token: refreshed.access_token,
            token_refreshed_at: new Date().toISOString(),
            token_status: "valid",
            updated_at: new Date().toISOString(),
          });
          refreshResult = {
            renewed: true,
            new_expires_in: refreshed.expires_in,
          };
        } else {
          refreshResult = { renewed: false, reason: refreshed.error || "token já é o mais longo possível" };
        }
      }

      // Marca como expirado no Blobs se inválido
      if (!isValid) {
        await store.setJSON(`account-${acc.id}`, {
          ...acc,
          token_status: "expired",
          updated_at: new Date().toISOString(),
        });
      } else if (!refreshResult) {
        // Válido e com bastante tempo — marca como válido
        await store.setJSON(`account-${acc.id}`, {
          ...acc,
          token_status: "valid",
          updated_at: new Date().toISOString(),
        });
      }

      return {
        id:           acc.id,
        username:     acc.username || acc.id,
        is_valid:     isValid,
        token_type:   tokenType,
        expires_at:   expiresAt,
        days_left:    daysLeft,
        never_expires: debug.expires_at === 0,
        scopes,
        error:        debug.error_code ? `[${debug.error_code}] ${debug.error_subcode || ""} ${debug.error_message || ""}`.trim() : null,
        refresh:      refreshResult,
      };
    }));

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ results, checked_at: new Date().toISOString() }),
    };
  } catch (err) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
