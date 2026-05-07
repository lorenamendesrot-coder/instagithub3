// netlify/functions/add-account-via-page.mjs
// Adiciona conta Instagram via Page ID + Page Access Token (sem OAuth completo)
const GRAPH = "https://graph.facebook.com/v21.0";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Método não permitido" }) };
  }

  const APP_ID     = process.env.META_APP_ID;
  const APP_SECRET = process.env.META_APP_SECRET;

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido no corpo da requisição" }) };
  }

  const { page_id, page_access_token } = body;

  if (!page_id?.trim() || !page_access_token?.trim()) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "page_id e page_access_token são obrigatórios" }),
    };
  }

  try {
    // 1. Validar o token — busca metadados do token
    const debugRes = await fetch(
      `${GRAPH}/debug_token?input_token=${page_access_token}&access_token=${APP_ID}|${APP_SECRET}`
    );
    const debugData = await debugRes.json();

    if (debugData.error) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Token inválido: " + debugData.error.message }),
      };
    }

    const tokenInfo = debugData.data || {};
    if (!tokenInfo.is_valid) {
      const reason = tokenInfo.error?.message || "Token expirado ou revogado";
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "Token inválido: " + reason }),
      };
    }

    // 2. Verificar se o token pertence à página informada
    const pageIdFromToken = tokenInfo.profile_id || "";
    if (pageIdFromToken && pageIdFromToken !== page_id.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: `Este token pertence à página ${pageIdFromToken}, não à ${page_id}. Verifique o Page ID.`,
        }),
      };
    }

    // 3. Buscar conta Instagram Business vinculada à página
    const igRes  = await fetch(
      `${GRAPH}/${page_id}?fields=instagram_business_account,name&access_token=${page_access_token}`
    );
    const igData = await igRes.json();

    if (igData.error) {
      const msg = igData.error.message || "";
      if (igData.error.code === 190) {
        return { statusCode: 401, body: JSON.stringify({ error: "Token expirado ou sem permissão para esta página." }) };
      }
      if (igData.error.code === 100) {
        return { statusCode: 404, body: JSON.stringify({ error: "Página não encontrada. Verifique o Page ID." }) };
      }
      return { statusCode: 400, body: JSON.stringify({ error: "Erro ao acessar a página: " + msg }) };
    }

    const igAccount = igData.instagram_business_account;
    if (!igAccount?.id) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error:
            "Nenhuma conta Instagram Business/Creator vinculada a esta página. " +
            "Acesse Configurações da Página → Instagram e vincule uma conta.",
        }),
      };
    }

    const igId = igAccount.id;

    // 4. Buscar detalhes da conta Instagram
    const detailRes = await fetch(
      `${GRAPH}/${igId}?fields=username,name,profile_picture_url,account_type,biography,website,followers_count,follows_count,media_count&access_token=${page_access_token}`
    );
    const detail = await detailRes.json();

    if (detail.error) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Erro ao buscar detalhes da conta IG: " + detail.error.message }),
      };
    }

    // 5. Trocar por token long-lived (60 dias), se possível
    let finalToken = page_access_token;
    try {
      const longRes = await fetch(
        `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${page_access_token}`
      );
      const longData = await longRes.json();
      if (longData.access_token) {
        finalToken = longData.access_token;
      }
    } catch {
      // Mantém o token original se a troca falhar — não é bloqueante
    }

    // 6. Montar objeto da conta no mesmo formato do auth-callback.mjs
    const account = {
      id:              igId,
      username:        detail.username        || "",
      name:            detail.name            || detail.username || igData.name || "",
      profile_picture: detail.profile_picture_url || "",
      account_type:    detail.account_type    || "BUSINESS",
      biography:       detail.biography       || "",
      website:         detail.website         || "",
      followers_count: detail.followers_count ?? null,
      follows_count:   detail.follows_count   ?? null,
      media_count:     detail.media_count     ?? null,
      access_token:    finalToken,
      page_id:         page_id.trim(),
      connected_at:    new Date().toISOString(),
      added_via:       "page_id",  // identificador para uso futuro
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, account }),
    };

  } catch (err) {
    console.error("add-account-via-page error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Erro interno: " + err.message }),
    };
  }
};
