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
    // ── 1. Validar o token via debug_token ────────────────────────────────────
    const debugRes  = await fetch(`${GRAPH_FB}/debug_token?input_token=${token}&access_token=${APP_ID}|${APP_SECRET}`);
    const debugData = await debugRes.json();

    if (debugData.error)
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Token inválido: " + debugData.error.message }) };

    const info = debugData.data || {};
    if (!info.is_valid) {
      const reason = info.error?.message || "Token expirado ou revogado";
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Token inválido: " + reason }) };
    }

    // ── 2. Buscar dados básicos da conta Instagram ────────────────────────────
    const meRes  = await fetch(`${GRAPH_IG}/me?fields=id,username,name,profile_picture_url,account_type,followers_count,media_count&access_token=${token}`);
    const meData = await meRes.json();

    if (meData.error)
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Erro ao buscar conta: " + meData.error.message }) };

    if (!meData.id)
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Não foi possível obter o ID da conta. Verifique as permissões do token." }) };

    // ── 3. Tentar trocar por long-lived token (60 dias) ───────────────────────
    // Tokens gerados pelo dashboard do Meta são short-lived (1h).
    // Tentamos trocar — se falhar, usamos o original com aviso.
    let finalToken    = token;
    let tokenDuration = "short-lived";
    let expiresAt     = null;

    try {
      const llRes  = await fetch(
        `${GRAPH_IG}/access_token?grant_type=ig_exchange_token&client_secret=${APP_SECRET}&access_token=${token}`
      );
      const llData = await llRes.json();

      if (llData.access_token && !llData.error) {
        finalToken    = llData.access_token;
        tokenDuration = "long-lived";
        // expires_in vem em segundos
        if (llData.expires_in) {
          expiresAt = new Date(Date.now() + llData.expires_in * 1000).toISOString();
        }
      }
    } catch {
      // Se falhar a troca, continua com o token original
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
          : null,
      }),
    };

  } catch (err) {
    console.error("[add-account-via-token]", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Erro interno: " + err.message }) };
  }
};
