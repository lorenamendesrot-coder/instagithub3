// netlify/functions/queue.mjs
// Salva TODA a fila num único blob "queue-data"
// Suporta 800+ itens sem timeout — 1 write em vez de 800 writes paralelos
//
// GET    /api/queue        → retorna array de itens
// POST   /api/queue        → addBatch: adiciona/substitui itens pelo id
// PUT    /api/queue        → updateItem: atualiza um item pelo id
// DELETE /api/queue?id=xxx → remove item específico
// DELETE /api/queue        → limpa tudo

import { getStore } from "@netlify/blobs";

const STORE_NAME = "insta-queue";
const BLOB_KEY   = "queue-data"; // tudo num único blob

function getQueueStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_TOKEN;
  if (!siteID || !token) throw new Error("Configure NETLIFY_SITE_ID e NETLIFY_TOKEN");
  return getStore({ name: STORE_NAME, siteID, token, consistency: "strong" });
}

const CORS = {
  "Access-Control-Allow-Origin":  process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type":                 "application/json",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

async function readAll(store) {
  try {
    const data = await store.get(BLOB_KEY, { type: "json" });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeAll(store, items) {
  await store.setJSON(BLOB_KEY, items);
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  try {
    const store = getQueueStore();

    // GET — retorna todos os itens
    if (req.method === "GET") {
      const items = await readAll(store);
      return json(items);
    }

    // POST — addBatch: insere ou substitui itens pelo id
    if (req.method === "POST") {
      const body  = await req.json();
      const news  = Array.isArray(body) ? body : [body];
      const queue = await readAll(store);

      for (const item of news) {
        if (!item?.id) continue;
        const idx = queue.findIndex((x) => x.id === item.id);
        if (idx >= 0) queue[idx] = item;
        else queue.push(item);
      }

      await writeAll(store, queue);
      return json({ saved: news.length, total: queue.length });
    }

    // PUT — updateItem: atualiza um item pelo id
    if (req.method === "PUT") {
      const item  = await req.json();
      if (!item?.id) return json({ error: "id obrigatório" }, 400);

      const queue = await readAll(store);
      const idx   = queue.findIndex((x) => x.id === item.id);
      if (idx >= 0) queue[idx] = item;
      else queue.push(item);

      await writeAll(store, queue);
      return json(item);
    }

    // DELETE — remove item ou limpa tudo
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const id  = url.searchParams.get("id");

      if (id) {
        const queue   = await readAll(store);
        const updated = queue.filter((x) => String(x.id) !== String(id));
        await writeAll(store, updated);
        return json({ deleted: id, remaining: updated.length });
      } else {
        await writeAll(store, []);
        return json({ cleared: true });
      }
    }

    return json({ error: "Método não permitido" }, 405);

  } catch (err) {
    console.error("[queue.mjs]", err.message);
    return json({ error: err.message }, 500);
  }
}
