// account-insights.mjs — Busca dados detalhados de uma conta Instagram
// Campos retornados: seguidores, seguindo, posts, país, data criação, restrições
const GRAPH = "https://graph.facebook.com/v21.0";

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";

export const handler = async (event) => {
  const requestOrigin = event.headers?.origin || "";
  const corsOrigin = ALLOWED_ORIGIN && requestOrigin === ALLOWED_ORIGIN
    ? ALLOWED_ORIGIN : ALLOWED_ORIGIN || "*";

  const headers = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    ...(corsOrigin !== "*" && { "Vary": "Origin" }),
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const { instagram_id, access_token } = body;
  if (!instagram_id || !access_token)
    return { statusCode: 400, headers, body: JSON.stringify({ error: "instagram_id e access_token são obrigatórios" }) };

  try {
    // ── Campos públicos do perfil ─────────────────────────────────────────────
    // followers_count, media_count, follows_count, biography, website,
    // profile_picture_url, username, name, account_type
    const profileFields = [
      "id", "username", "name", "biography", "website",
      "profile_picture_url", "account_type",
      "followers_count", "follows_count", "media_count",
    ].join(",");

    const profileRes  = await fetch(`${GRAPH}/${instagram_id}?fields=${profileFields}&access_token=${access_token}`);
    const profileData = await profileRes.json();

    if (profileData.error) {
      // Erro 190 = token expirado
      if (profileData.error.code === 190) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: "token_expired", message: "Token expirado. Reconecte a conta." }) };
      }
      return { statusCode: 400, headers, body: JSON.stringify({ error: profileData.error.message }) };
    }

    // ── Content Publishing Limit (restrições de publicação) ───────────────────
    // Retorna quota_usage (% de limite de publicação usada nas últimas 24h)
    // e config (limites por tipo de conta)
    let publishingLimit = null;
    try {
      const limitRes  = await fetch(`${GRAPH}/${instagram_id}/content_publishing_limit?fields=config,quota_usage&access_token=${access_token}`);
      const limitData = await limitRes.json();
      if (!limitData.error && limitData.data?.length > 0) {
        publishingLimit = limitData.data[0];
      }
    } catch { /* silencioso — nem todas as contas expõem este endpoint */ }

    // ── Menções e tags recentes (proxy para verificar se conta está ativa) ────
    // Não há endpoint direto para "restrições", mas podemos verificar
    // o status via tentativa de buscar o container_status mais recente
    // O campo mais próximo disponível é verificar se a conta aceita publicação
    let accountStatus = "active"; // padrão
    let restrictionNote = null;

    if (publishingLimit) {
      const usage = publishingLimit.quota_usage || 0;
      const maxConfig = publishingLimit.config?.quota_total || 50;
      if (usage >= maxConfig) {
        accountStatus = "limited";
        restrictionNote = `Limite de publicação atingido (${usage}/${maxConfig} posts nas últimas 24h)`;
      } else if (usage >= maxConfig * 0.8) {
        accountStatus = "warning";
        restrictionNote = `Próximo do limite de publicação (${usage}/${maxConfig} posts nas últimas 24h)`;
      }
    }

    // ── Montar resposta ───────────────────────────────────────────────────────
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        id:               profileData.id,
        username:         profileData.username,
        name:             profileData.name,
        biography:        profileData.biography || "",
        website:          profileData.website || "",
        profile_picture:  profileData.profile_picture_url || "",
        account_type:     profileData.account_type,
        followers_count:  profileData.followers_count ?? null,
        follows_count:    profileData.follows_count ?? null,
        media_count:      profileData.media_count ?? null,
        publishing_limit: publishingLimit,
        account_status:   accountStatus,
        restriction_note: restrictionNote,
        fetched_at:       new Date().toISOString(),
      }),
    };

  } catch (err) {
    console.error("account-insights error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
