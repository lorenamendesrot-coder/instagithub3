// add-account-via-token.mjs
// Adiciona conta Instagram via Access Token direto (gerado no Meta Developers)
// Fluxo: valida token → troca por long-lived (60 dias) → busca dados da conta

const GRAPH_IG   = "https://graph.instagram.com";
const GRAPH_FB   = "https://graph.facebook.com/v21.0";

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
    // ── 1. Validar o token via debug_token (opcional — falhas não bloqueiam) ──
    try {
      const debugRes  = await fetch(`${GRAPH_FB}/debug_token?input_token=${token}&access_token=${APP_ID}|${APP_SECRET}`);
      const debugData = await debugRes.json();

      if (debugData.data && !debugData.data.is_valid) {
        const reason = debugData.data.error?.message || "Token expirado ou revogado";
        return { statusCode: 401, headers, body: JSON.stringify({ error: "Token inválido: " + reason }) };
      }
      // Se debug_token retornar erro de serviço (#2), ignora e continua
    } catch {
      // Ignora falha no debug_token e tenta validar via /me diretamente
    }

    // ── 2. Buscar dados básicos da conta Instagram ────────────────────────────
    // Tenta graph.instagram.com primeiro (tokens de dashboard/OAuth)
    // Se falhar, tenta via graph.facebook.com (System User tokens)
    let meData = null;
    let tokenType = "ig"; // "ig" ou "system_user"

    const meResIG = await fetch(`${GRAPH_IG}/me?fields=id,username,name,profile_picture_url,account_type,followers_count,media_count&access_token=${token}`);
    const meDataIG = await meResIG.json();

    if (!meDataIG.error) {
      meData = meDataIG;
      tokenType = "ig";
    } else {
      // Tenta via Facebook Graph API — System User Token
      // Precisa buscar contas Instagram vinculadas via /me/accounts ou diretamente
      const meFBRes  = await fetch(`${GRAPH_FB}/me?fields=id,name&access_token=${token}`);
      const meFBData = await meFBRes.json();

      if (meFBData.error)
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Erro ao buscar conta: " + (meDataIG.error.message || meFBData.error.message) }) };

      // Tenta 3 endpoints diferentes para System User tokens
      let foundAccount = null;

      // Tentativa 1: instagram_accounts direto no System User
      const t1Res  = await fetch(`${GRAPH_FB}/${meFBData.id}/instagram_accounts?fields=id,username,name,profile_picture_url,account_type,followers_count,media_count&access_token=${token}`);
      const t1Data = await t1Res.json();
      if (!t1Data.error && t1Data.data?.[0]) foundAccount = t1Data.data[0];

      // Tentativa 2: via páginas vinculadas → instagram_business_account
      if (!foundAccount) {
        const t2Res  = await fetch(`${GRAPH_FB}/${meFBData.id}/accounts?fields=instagram_business_account{id,username,name,profile_picture_url,account_type,followers_count,media_count}&access_token=${token}`);
        const t2Data = await t2Res.json();
        if (!t2Data.error && t2Data.data?.[0]?.instagram_business_account) {
          foundAccount = t2Data.data[0].instagram_business_account;
        }
      }

      // Tentativa 3: owned_instagram_accounts
      if (!foundAccount) {
        const t3Res  = await fetch(`${GRAPH_FB}/${meFBData.id}/owned_instagram_accounts?fields=id,username,name,profile_picture_url,account_type,followers_count,media_count&access_token=${token}`);
        const t3Data = await t3Res.json();
        if (!t3Data.error && t3Data.data?.[0]) foundAccount = t3Data.data[0];
      }

      if (!foundAccount)
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Não foi possível encontrar conta Instagram vinculada a este token. Verifique se a conta Instagram foi adicionada como ativo do usuário do sistema no Business Manager." }) };

      meData = foundAccount;
    }

    if (!meData?.id)
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Não foi possível obter o ID da conta. Verifique as permissões do token." }) };

    // ── 3. Tentar trocar por long-lived token (60 dias) ───────────────────────
    // System User tokens não expiram — não precisa trocar
    // Tokens de dashboard são short-lived (1h) — tentar trocar
    let finalToken    = token;
    let tokenDuration = tokenType === "system_user" ? "never-expires" : "short-lived";
    let expiresAt     = null;

    if (tokenType !== "system_user") {
      try {
        const llRes  = await fetch(
          `${GRAPH_IG}/access_token?grant_type=ig_exchange_token&client_secret=${APP_SECRET}&access_token=${token}`
        );
        const llData = await llRes.json();

        if (llData.access_token && !llData.error) {
          finalToken    = llData.access_token;
          tokenDuration = "long-lived";
          if (llData.expires_in) {
            expiresAt = new Date(Date.now() + llData.expires_in * 1000).toISOString();
          }
        }
      } catch {
        // Mantém token original se troca falhar
      }
    }

    // ── 4. Montar objeto da conta ─────────────────────────────────────────────
    const account = {
      id:              meData.id,
      username:        meData.username,
      name:            meData.name || meData.username,
      profile_picture: meData.profile_picture_url || null,
      account_type:    meData.account_type || "PERSONAL",
      followers_count: meData.followers_count || 0,
      media_count:     meData.media_count || 0,
      access_token:    finalToken,
      token_duration:  tokenDuration,
      token_expires_at:expiresAt,
      token_status:    "active",
      added_via:       "manual_token",
      connected_at:    new Date().toISOString(),
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        account,
        token_duration: tokenDuration,
        // Aviso se ficou como short-lived
        warning: tokenDuration === "short-lived"
          ? "Token de curta duração (1h). Adicione igualmente — o sistema tentará renovar automaticamente."
          : tokenDuration === "never-expires"
          ? null
          : null,
      }),
    };

  } catch (err) {
    console.error("[add-account-via-token]", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Erro interno: " + err.message }) };
  }
};
