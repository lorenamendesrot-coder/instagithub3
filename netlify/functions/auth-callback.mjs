// auth-callback.mjs — OAuth Meta Graph API v21.0
// FIX: token longo da página é obtido ANTES de buscar detalhes da conta IG
// Isso garante que profile_picture_url, username, name etc chegam corretamente

const GRAPH = "https://graph.facebook.com/v21.0";

async function apiFetch(url) {
  const res  = await fetch(url);
  const data = await res.json();
  return data;
}

export const handler = async (event) => {
  const code = event.queryStringParameters?.code;
  if (!code) return { statusCode: 302, headers: { Location: "/?error=sem_codigo" } };

  const APP_ID       = process.env.META_APP_ID;
  const APP_SECRET   = process.env.META_APP_SECRET;
  const REDIRECT_URI = process.env.META_REDIRECT_URI;

  try {
    // ── 1. Trocar code por token de curta duração ──────────────────────────
    const tokenData = await apiFetch(
      `${GRAPH}/oauth/access_token?client_id=${APP_ID}&client_secret=${APP_SECRET}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code=${code}`
    );
    if (tokenData.error) throw new Error(`Token curto: ${tokenData.error.message}`);

    // ── 2. Trocar por token de LONGA duração do usuário (60 dias) ──────────
    const longData  = await apiFetch(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
    );
    const userToken = longData.access_token || tokenData.access_token;

    // ── 3. Buscar páginas do Facebook ──────────────────────────────────────
    const pagesData = await apiFetch(
      `${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${userToken}`
    );
    if (pagesData.error) throw new Error(`Páginas: ${pagesData.error.message}`);
    const pages = pagesData.data || [];

    const accounts = [];

    for (const page of pages) {
      const pageId = page.id;

      // ── 4. Trocar token da página por token longo PRIMEIRO ────────────────
      // FIX CRÍTICO: sempre usar token longo antes de qualquer chamada ao IG
      const pageLongData = await apiFetch(
        `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${page.access_token}`
      );
      const pageToken = pageLongData.access_token || page.access_token;

      // ── 5. Buscar conta Instagram vinculada à página ───────────────────────
      const igData    = await apiFetch(
        `${GRAPH}/${pageId}?fields=instagram_business_account&access_token=${pageToken}`
      );
      const igAccount = igData.instagram_business_account;
      if (!igAccount) continue;

      const igId = igAccount.id;

      // ── 6. Buscar detalhes completos da conta Instagram ────────────────────
      // Usar token longo já trocado — garante que a URL da foto é válida
      const fields = [
        "id",
        "username",
        "name",
        "biography",
        "website",
        "profile_picture_url",
                "followers_count",
        "follows_count",
        "media_count",
      ].join(",");

      const detail = await apiFetch(
        `${GRAPH}/${igId}?fields=${fields}&access_token=${pageToken}`
      );

      if (detail.error) {
        // Logar e continuar — não falhar todo o fluxo por uma conta
        console.warn(`Erro ao buscar detalhes da conta ${igId}:`, detail.error.message);
        // Salvar conta mesmo sem detalhes para não perder o token
        accounts.push({
          id:              igId,
          username:        "",
          name:            "",
          biography:       "",
          website:         "",
          profile_picture: "",
          account_type:    "BUSINESS",
          followers_count: null,
          follows_count:   null,
          media_count:     null,
          access_token:    pageToken,
          page_id:         pageId,
          page_name:       page.name || "",
          connected_at:    new Date().toISOString(),
          detail_error:    detail.error.message,
        });
        continue;
      }

      accounts.push({
        id:              igId,
        username:        detail.username        || "",
        name:            detail.name            || detail.username || "",
        biography:       detail.biography       || "",
        website:         detail.website         || "",
        profile_picture: detail.profile_picture_url || "",
        account_type:    detail.account_type    || "BUSINESS",
        followers_count: detail.followers_count ?? null,
        follows_count:   detail.follows_count   ?? null,
        media_count:     detail.media_count     ?? null,
        access_token:    pageToken,
        page_id:         pageId,
        page_name:       page.name || "",
        connected_at:    new Date().toISOString(),
      });
    }

    if (accounts.length === 0) {
      return {
        statusCode: 302,
        headers: {
          Location: "/?error=" + encodeURIComponent(
            "Nenhuma conta Instagram Business encontrada. Verifique se suas páginas do Facebook têm contas Instagram Business vinculadas."
          ),
        },
      };
    }

    // Enviar contas para o frontend salvar via /api/accounts
    const encoded = Buffer.from(JSON.stringify(accounts)).toString("base64url");
    return { statusCode: 302, headers: { Location: `/?accounts=${encoded}` } };

  } catch (err) {
    console.error("auth-callback error:", err);
    return {
      statusCode: 302,
      headers: { Location: `/?error=${encodeURIComponent(err.message)}` },
    };
  }
};
