// netlify/functions/accounts.mjs
// CRUD de contas — usa Netlify Blobs com configuração explícita via env vars
//
// Variáveis necessárias no painel do Netlify (Site settings > Environment variables):
//   NETLIFY_SITE_ID  → Settings > General > Site ID  (ex: abc123-...)
//   NETLIFY_TOKEN    → User settings > Applications > Personal access tokens

import { getStore } from "@netlify/blobs";

const STORE_NAME = "insta-accounts";

function getAccountsStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_TOKEN;

  if (!siteID || !token) {
    throw new Error(
      "Configure as variáveis NETLIFY_SITE_ID e NETLIFY_TOKEN no painel do Netlify " +
      "(Site settings > Environment variables)"
    );
  }

  return getStore({ name: STORE_NAME, siteID, token, consistency: "strong" });
}

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: HEADERS, body: "" };

  try {
    const store = getAccountsStore();

    // GET — listar todas
    if (event.httpMethod === "GET") {
      const { blobs } = await store.list();
      const accounts = (
        await Promise.all(blobs.map(async ({ key }) => {
          try { return await store.get(key, { type: "json" }); }
          catch { return null; }
        }))
      ).filter(Boolean);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ accounts }) };
    }

    // POST — salvar/atualizar
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const accs = Array.isArray(body) ? body : (body.accounts || [body]);
      for (const acc of accs) {
        if (!acc?.id) continue;
        await store.setJSON(`account-${acc.id}`, { ...acc, updated_at: new Date().toISOString() });
      }
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, saved: accs.length }) };
    }

    // DELETE — remover por id
    if (event.httpMethod === "DELETE") {
      const id = event.queryStringParameters?.id;
      if (!id) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "id obrigatório" }) };
      await store.delete(`account-${id}`);
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: "Método não permitido" }) };

  } catch (err) {
    console.error("accounts.mjs error:", err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
