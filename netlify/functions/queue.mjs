// netlify/functions/queue.mjs
// CRUD da fila de agendamentos — usa Netlify Blobs
// GET    /api/queue         → lista todos os itens
// POST   /api/queue         → salva array de itens (addBatch)
// PUT    /api/queue         → atualiza um item (updateItem)
// DELETE /api/queue?id=xxx  → remove um item
// DELETE /api/queue         → limpa tudo

import { getStore } from "@netlify/blobs";

const STORE_NAME = "insta-queue";

function getQueueStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_TOKEN;

  if (!siteID || !token) {
    throw new Error("Configure NETLIFY_SITE_ID e NETLIFY_TOKEN no painel do Netlify");
  }

  return getStore({
    name:        STORE_NAME,
    siteID,
    token,
    consistency: "strong",
  });
}

const CORS = {
  "Access-Control-Allow-Origin":  process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type":                 "application/json",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  try {
    const store = getQueueStore();

    // ── GET — listar todos os itens ────────────────────────────────────────
    if (req.method === "GET") {
      const { blobs } = await store.list();
      const items = await Promise.all(
        blobs.map(async ({ key }) => {
          try { return await store.get(key, { type: "json" }); }
          catch { return null; }
        })
      );
      return json(items.filter(Boolean));
    }

    // ── POST — salvar array de itens (addBatch) ────────────────────────────
    if (req.method === "POST") {
      const body = await req.json();
      const items = Array.isArray(body) ? body : [body];

      await Promise.all(
        items.map((item) => {
          if (!item?.id) return;
          // Chave sem caracteres especiais
          const key = String(item.id).replace(/[^a-zA-Z0-9_-]/g, "_");
          return store.setJSON(key, item);
        })
      );

      return json({ saved: items.length });
    }

    // ── PUT — atualizar um item ────────────────────────────────────────────
    if (req.method === "PUT") {
      const item = await req.json();
      if (!item?.id) return json({ error: "id obrigatório" }, 400);

      const key = String(item.id).replace(/[^a-zA-Z0-9_-]/g, "_");
      await store.setJSON(key, item);
      return json(item);
    }

    // ── DELETE — remover item ou limpar tudo ──────────────────────────────
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const id  = url.searchParams.get("id");

      if (id) {
        // Remover item específico
        const key = String(id).replace(/[^a-zA-Z0-9_-]/g, "_");
        await store.delete(key);
        return json({ deleted: id });
      } else {
        // Limpar tudo
        const { blobs } = await store.list();
        await Promise.all(blobs.map(({ key }) => store.delete(key)));
        return json({ cleared: blobs.length });
      }
    }

    return json({ error: "Método não permitido" }, 405);

  } catch (err) {
    console.error("[queue.mjs] Erro:", err.message);
    return json({ error: err.message }, 500);
  }
}
