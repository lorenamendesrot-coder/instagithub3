// netlify/functions/accounts.mjs
// CRUD de contas no Netlify Blobs — persiste entre dispositivos/PCs
// GET  /.netlify/functions/accounts        → lista todas as contas
// POST /.netlify/functions/accounts        → salva/atualiza uma ou mais contas
// DELETE /.netlify/functions/accounts?id=X → remove uma conta

import { getStore } from "@netlify/blobs";

const STORE_NAME = "insta-accounts";

function getAccountsStore(context) {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

export const handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const store = getAccountsStore(context);

    // ── GET: listar todas as contas ─────────────────────────────────────────
    if (event.httpMethod === "GET") {
      const { blobs } = await store.list();
      const accounts = await Promise.all(
        blobs.map(async ({ key }) => {
          const data = await store.get(key, { type: "json" });
          return data;
        })
      );
      const valid = accounts.filter(Boolean);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ accounts: valid }),
      };
    }

    // ── POST: salvar/atualizar conta(s) ────────────────────────────────────
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      // Aceita array ou objeto único
      const accs = Array.isArray(body) ? body : body.accounts || [body];

      for (const acc of accs) {
        if (!acc.id) continue;
        await store.setJSON(`account-${acc.id}`, {
          ...acc,
          updated_at: new Date().toISOString(),
        });
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, saved: accs.length }),
      };
    }

    // ── DELETE: remover conta por id ───────────────────────────────────────
    if (event.httpMethod === "DELETE") {
      const id = event.queryStringParameters?.id;
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "id obrigatório" }) };
      }
      await store.delete(`account-${id}`);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  } catch (err) {
    console.error("accounts.mjs error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
