// add-account-via-token.mjs
// Adiciona conta Instagram via Access Token direto (gerado no Meta Developers)
// Fluxo: valida token → busca conta IG → troca por long-lived (60 dias)

const GRAPH_IG = "https://graph.instagram.com";
const GRAPH_FB = "https://graph.facebook.com/v21.0";

const igFields = "id,username,name,profile_picture_url,account_type,followers_count,media_count";

// Busca todas as páginas de uma resposta paginada da Graph API
async function fetchAllPages(url) {
  const results = [];
  let next = url;
  while (next) {
    const res  = await fetch(next);
    const data = await res.json();
    if (data.error || !data.data) break;
    results.push(...data.data);
    next = data.paging?.next || null;
  }
  return results;
}

export const handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  const APP_ID     = process.env.META_APP_ID;
  const APP_SECRET = process.env.META_APP_SECRET;

  if (!APP_ID || !APP_SECRET)
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Configuração do app ausente (META_APP_ID / META_APP_SECRET)" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const { access_token } = body;
  if (!access_token?.trim())
    return { statusCode: 400, headers, body: JSON.stringify({ error: "access_token é obrigatório" }) };

  const token = access_token.trim();

  try {
    // ── 1. Validar token via debug_token ──────────────────────────────────────
    let debugInfo = null;
    try {
      const debugRes  = await fetch(`${GRAPH_FB}/debug_token?input_token=${token}&access_token=${APP_ID}|${APP_SECRET}`);
      const debugData = await debugRes.json();
      if (debugData.data) {
        if (!debugData.data.is_valid) {
          const reason = debugData.data.error?.message || "Token expirado ou revogado";
          return { statusCode: 401, headers, body: JSON.stringify({ error: "Token inválido: " + reason }) };
        }
        debugInfo = debugData.data;
      }
    } catch { /* ignora falha no debug_token */ }

    // ── 2. Tentar graph.instagram.com/me (token nativo IG / OAuth) ────────────
    const meResIG  = await fetch(`${GRAPH_IG}/me?fields=${igFields}&access_token=${token}`);
    const meDataIG = await meResIG.json();

    if (!meDataIG.error) {
      // Token IG nativo — trocar por long-lived e retornar
      return await buildResponse({ headers, meData: meDataIG, token, tokenType: "ig", APP_SECRET });
    }

    // ── 3. Identificar o usuário via Facebook Graph API ───────────────────────
    const meFBRes  = await fetch(`${GRAPH_FB}/me?fields=id,name&access_token=${token}`);
    const meFBData = await meFBRes.json();

    if (meFBData.error) {
      return { statusCode: 400, headers, body: JSON.stringify({
        error: "Token inválido ou sem permissões: " + (meDataIG.error?.message || meFBData.error?.message),
      }) };
    }

    const userId = meFBData.id;
    let foundAccount = null;

    // ── 4. ESTRATÉGIA A: token de usuário comum (User Access Token) ───────────
    // Busca páginas do usuário → instagram_business_account em cada página
    {
      const pagesRes  = await fetch(`${GRAPH_FB}/${userId}/accounts?fields=instagram_business_account{${igFields}}&limit=100&access_token=${token}`);
      const pagesData = await pagesRes.json();
      if (!pagesData.error && pagesData.data?.length) {
        for (const page of pagesData.data) {
          if (page.instagram_business_account) {
            foundAccount = page.instagram_business_account;
            break;
          }
        }
      }
    }

    // ── 5. ESTRATÉGIA B: System User Token — busca via Business Manager ───────
    // O system user token precisa buscar o business_id primeiro,
    // depois listar as contas IG do negócio
    if (!foundAccount) {
      // 5a. Descobrir os negócios associados ao token
      const bizRes  = await fetch(`${GRAPH_FB}/me/businesses?fields=id,name&access_token=${token}`);
      const bizData = await bizRes.json();

      if (!bizData.error && bizData.data?.length) {
        for (const biz of bizData.data) {
          if (foundAccount) break;

          // 5b. Listar contas IG pertencentes ao negócio (owned)
          const ownedRes  = await fetch(`${GRAPH_FB}/${biz.id}/instagram_accounts?fields=${igFields}&limit=100&access_token=${token}`);
          const ownedData = await ownedRes.json();
          if (!ownedData.error && ownedData.data?.[0]) {
            foundAccount = ownedData.data[0];
            break;
          }

          // 5c. Contas IG de clientes do negócio (client assets)
          const clientRes  = await fetch(`${GRAPH_FB}/${biz.id}/client_instagram_accounts?fields=${igFields}&limit=100&access_token=${token}`);
          const clientData = await clientRes.json();
          if (!clientData.error && clientData.data?.[0]) {
            foundAccount = clientData.data[0];
            break;
          }
        }
      }
    }

    // ── 6. ESTRATÉGIA C: System User — assigned_pages ─────────────────────────
    // Busca páginas atribuídas ao system user → instagram_business_account
    if (!foundAccount) {
      const assignedRes  = await fetch(`${GRAPH_FB}/${userId}/assigned_pages?fields=instagram_business_account{${igFields}}&limit=100&access_token=${token}`);
      const assignedData = await assignedRes.json();
      if (!assignedData.error && assignedData.data?.length) {
        for (const page of assignedData.data) {
          if (page.instagram_business_account) {
            foundAccount = page.instagram_business_account;
            break;
          }
        }
      }
    }

    // ── 7. ESTRATÉGIA D: owned_instagram_accounts direto no user ─────────────
    if (!foundAccount) {
      const ownedRes  = await fetch(`${GRAPH_FB}/${userId}/owned_instagram_accounts?fields=${igFields}&limit=100&access_token=${token}`);
      const ownedData = await ownedRes.json();
      if (!ownedData.error && ownedData.data?.[0]) foundAccount = ownedData.data[0];
    }

    // ── 8. ESTRATÉGIA E: instagram_accounts direto no user ───────────────────
    if (!foundAccount) {
      const igAccRes  = await fetch(`${GRAPH_FB}/${userId}/instagram_accounts?fields=${igFields}&limit=100&access_token=${token}`);
      const igAccData = await igAccRes.json();
      if (!igAccData.error && igAccData.data?.[0]) foundAccount = igAccData.data[0];
    }

    if (!foundAccount) {
      return { statusCode: 400, headers, body: JSON.stringify({
        error: "Não foi possível encontrar a conta Instagram vinculada a este token.\n\nVerifique:\n• A conta Instagram está adicionada como ativo do usuário do sistema no Business Manager\n• O token tem as permissões: instagram_basic, instagram_content_publish, pages_read_engagement\n• O app está instalado no usuário do sistema (aba 'Apps instalados')",
      }) };
    }

    return await buildResponse({ headers, meData: foundAccount, token, tokenType: "system_user", APP_SECRET });

  } catch (err) {
    console.error("[add-account-via-token]", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Erro interno: " + err.message }) };
  }
};

// ── Helper: monta resposta com troca de token ─────────────────────────────────
async function buildResponse({ headers, meData, token, tokenType, APP_SECRET }) {
  let finalToken    = token;
  let tokenDuration = tokenType === "system_user" ? "never-expires" : "short-lived";
  let expiresAt     = null;

  // Trocar por long-lived apenas para tokens IG (não System User)
  if (tokenType === "ig") {
    try {
      const llRes  = await fetch(`${GRAPH_IG}/access_token?grant_type=ig_exchange_token&client_secret=${APP_SECRET}&access_token=${token}`);
      const llData = await llRes.json();
      if (llData.access_token && !llData.error) {
        finalToken    = llData.access_token;
        tokenDuration = "long-lived";
        if (llData.expires_in) {
          expiresAt = new Date(Date.now() + llData.expires_in * 1000).toISOString();
        }
      }
    } catch { /* mantém token original */ }
  }

  const account = {
    id:               meData.id,
    username:         meData.username,
    name:             meData.name || meData.username,
    profile_picture:  meData.profile_picture_url || null,
    account_type:     meData.account_type || "BUSINESS",
    followers_count:  meData.followers_count || 0,
    media_count:      meData.media_count || 0,
    access_token:     finalToken,
    token_duration:   tokenDuration,
    token_expires_at: expiresAt,
    token_status:     "active",
    added_via:        "manual_token",
    connected_at:     new Date().toISOString(),
  };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      account,
      token_duration: tokenDuration,
      warning: tokenDuration === "short-lived"
        ? "Token de curta duração (1h). Adicione igualmente — o sistema tentará renovar automaticamente."
        : null,
    }),
  };
}
