// refresh-accounts.mjs
// Atualiza username, nome, foto e estatísticas das contas já salvas no Blobs
// usando os tokens que já estão armazenados — sem precisar reconectar pelo OAuth

import { getStore } from "@netlify/blobs";

const GRAPH      = "https://graph.facebook.com/v21.0";
const STORE_NAME = "insta-accounts";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function getAccountsStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_TOKEN;
  if (!siteID || !token) throw new Error("NETLIFY_SITE_ID e NETLIFY_TOKEN não configurados");
  return getStore({ name: STORE_NAME, siteID, token, consistency: "strong" });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: "Método não permitido" }) };

  try {
    const store = getAccountsStore();
    const { blobs } = await store.list();

    const results = [];

    for (const { key } of blobs) {
      let acc;
      try { acc = await store.get(key, { type: "json" }); } catch { continue; }
      if (!acc?.id || !acc?.access_token) continue;

      const fields = [
        "id", "username", "name", "biography", "website",
        "profile_picture_url", "account_type",
        "followers_count", "follows_count", "media_count",
      ].join(",");

      const res  = await fetch(`${GRAPH}/${acc.id}?fields=${fields}&access_token=${acc.access_token}`);
      const data = await res.json();

      if (data.error) {
        results.push({ id: acc.id, ok: false, error: data.error.message });
        continue;
      }

      const updated = {
        ...acc,
        username:        data.username        || acc.username || "",
        name:            data.name            || data.username || acc.name || "",
        biography:       data.biography       || acc.biography || "",
        website:         data.website         || acc.website || "",
        profile_picture: data.profile_picture_url || acc.profile_picture || "",
        account_type:    data.account_type    || acc.account_type || "BUSINESS",
        followers_count: data.followers_count ?? acc.followers_count ?? null,
        follows_count:   data.follows_count   ?? acc.follows_count ?? null,
        media_count:     data.media_count     ?? acc.media_count ?? null,
        updated_at:      new Date().toISOString(),
      };

      await store.setJSON(key, updated);
      results.push({ id: acc.id, ok: true, username: updated.username });
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ refreshed: results.length, results }),
    };

  } catch (err) {
    console.error("refresh-accounts error:", err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
