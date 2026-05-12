// add-account-via-token.mjs
const GRAPH_IG = "https://graph.instagram.com";
const GRAPH_FB = "https://graph.facebook.com/v21.0";

const igFields = "id,username,name,profile_picture_url,account_type,followers_count,media_count";

export const handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  const APP_ID      = process.env.META_APP_ID;
  const APP_SECRET  = process.env.META_APP_SECRET;
  const BUSINESS_ID = process.env.META_BUSINESS_ID;

  if (!APP_ID || !APP_SECRET)
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Configuração do app ausente (META_APP_ID / META_APP_SECRET)" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const { access_token } = body;
  if (!access_token?.trim())
    return { statusCode: 400, headers, body: JSON.stringify({ error: "access_token é obrigatório" }) };

  const token = access_token.trim();
  const diag  = {};

  try {
    // ── 1. debug_token ────────────────────────────────────────────────────────
    try {
      const r = await fetch(`${GRAPH_FB}/debug_token?input_token=${token}&access_token=${APP_ID}|${APP_SECRET}`);
      const d = await r.json();
      diag.debug_token = { type: d.data?.type, is_valid: d.data?.is_valid, scopes: d.data?.scopes };
      if (d.data && !d.data.is_valid)
        return { statusCode: 401, headers, body: JSON.stringify({ error: "Token inválido: " + (d.data.error?.message || "expirado/revogado"), diag }) };
    } catch (e) { diag.debug_token = { exception: e.message }; }

    // ── 2. graph.instagram.com/me (token nativo IG/OAuth) ────────────────────
    const igMeR = await fetch(`${GRAPH_IG}/me?fields=${igFields}&access_token=${token}`);
    const igMe  = await igMeR.json();
    diag.ig_me  = igMe.error ? { error: igMe.error.message, code: igMe.error.code } : { id: igMe.id, username: igMe.username };
    if (!igMe.error) return buildOk({ headers, meData: igMe, token, tokenType: "ig", APP_SECRET });

    // ── 3. FB /me — identifica o system user ─────────────────────────────────
    const fbMeR = await fetch(`${GRAPH_FB}/me?fields=id,name&access_token=${token}`);
    const fbMe  = await fbMeR.json();
    diag.fb_me  = fbMe.error ? { error: fbMe.error.message } : { id: fbMe.id, name: fbMe.name };
    if (fbMe.error)
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Token inválido: " + fbMe.error.message, diag }) };

    const uid = fbMe.id;
    let foundAccount = null;

    // ── 4. Busca ativos IG atribuídos ao system user via App Token ────────────
    // O App Token (APP_ID|APP_SECRET) tem visibilidade sobre os ativos do BM
    // mesmo quando o system user não é admin
    const appToken = `${APP_ID}|${APP_SECRET}`;

    // 4a. assigned_instagram_accounts do system user (via app token)
    const assignedR = await fetch(`${GRAPH_FB}/${uid}/assigned_instagram_accounts?fields=${igFields}&limit=100&access_token=${appToken}`);
    const assignedD = await assignedR.json();
    diag.assigned_ig_via_app_token = assignedD.error
      ? { error: assignedD.error.message }
      : { count: assignedD.data?.length, accounts: assignedD.data?.map(a => a.username) };
    if (!assignedD.error && assignedD.data?.[0]) foundAccount = assignedD.data[0];

    // 4b. instagram_accounts do system user (via app token)
    if (!foundAccount) {
      const igAccR = await fetch(`${GRAPH_FB}/${uid}/instagram_accounts?fields=${igFields}&limit=100&access_token=${appToken}`);
      const igAccD = await igAccR.json();
      diag.ig_accounts_via_app_token = igAccD.error
        ? { error: igAccD.error.message }
        : { count: igAccD.data?.length, accounts: igAccD.data?.map(a => a.username) };
      if (!igAccD.error && igAccD.data?.[0]) foundAccount = igAccD.data[0];
    }

    // ── 5. Busca via business_id (portfólio) usando App Token ─────────────────
    const bizIds = new Set();
    if (BUSINESS_ID) bizIds.add(BUSINESS_ID);

    // Tenta descobrir negócios via token do usuário
    const bizUserR = await fetch(`${GRAPH_FB}/me/businesses?fields=id&access_token=${token}`);
    const bizUserD = await bizUserR.json();
    if (!bizUserD.error) bizUserD.data?.forEach(b => bizIds.add(b.id));

    for (const bizId of bizIds) {
      if (foundAccount) break;

      // instagram_accounts do portfólio via App Token
      const oR = await fetch(`${GRAPH_FB}/${bizId}/instagram_accounts?fields=${igFields}&limit=100&access_token=${appToken}`);
      const oD = await oR.json();
      diag[`biz_${bizId}_ig_via_app`] = oD.error ? { error: oD.error.message } : { count: oD.data?.length, accounts: oD.data?.map(a => a.username) };
      if (!oD.error && oD.data?.[0]) { foundAccount = oD.data[0]; break; }

      // owned_instagram_accounts via App Token
      const ooR = await fetch(`${GRAPH_FB}/${bizId}/owned_instagram_accounts?fields=${igFields}&limit=100&access_token=${appToken}`);
      const ooD = await ooR.json();
      diag[`biz_${bizId}_owned_ig_via_app`] = ooD.error ? { error: ooD.error.message } : { count: ooD.data?.length, accounts: ooD.data?.map(a => a.username) };
      if (!ooD.error && ooD.data?.[0]) { foundAccount = ooD.data[0]; break; }
    }

    // ── 6. Páginas do usuário → instagram_business_account ───────────────────
    if (!foundAccount) {
      const acR = await fetch(`${GRAPH_FB}/${uid}/accounts?fields=id,name,instagram_business_account{${igFields}}&limit=100&access_token=${token}`);
      const acD = await acR.json();
      diag.user_accounts = acD.error ? { error: acD.error.message } : { count: acD.data?.length };
      if (!acD.error) for (const p of acD.data || []) if (p.instagram_business_account) { foundAccount = p.instagram_business_account; break; }
    }

    // ── 7. assigned_pages do system user ─────────────────────────────────────
    if (!foundAccount) {
      const apR = await fetch(`${GRAPH_FB}/${uid}/assigned_pages?fields=id,name,instagram_business_account{${igFields}}&limit=100&access_token=${token}`);
      const apD = await apR.json();
      diag.assigned_pages = apD.error ? { error: apD.error.message } : { count: apD.data?.length };
      if (!apD.error) for (const p of apD.data || []) if (p.instagram_business_account) { foundAccount = p.instagram_business_account; break; }
    }

    // ── 8. Busca direta pelo ID da conta IG via token do system user ──────────
    // Se o system user tem "Controle total" sobre a conta, o token dele
    // deve conseguir acessar a conta diretamente pelo ID
    if (!foundAccount && BUSINESS_ID) {
      // Busca todas as contas IG do portfólio via token do próprio system user
      const directR = await fetch(`${GRAPH_FB}/${BUSINESS_ID}/instagram_accounts?fields=${igFields}&limit=100&access_token=${token}`);
      const directD = await directR.json();
      diag.direct_biz_ig_via_user_token = directD.error ? { error: directD.error.message } : { count: directD.data?.length, accounts: directD.data?.map(a => a.username) };
      if (!directD.error && directD.data?.[0]) foundAccount = directD.data[0];
    }

    if (!foundAccount) {
      console.error("[add-account-via-token] DIAG:", JSON.stringify(diag, null, 2));
      return { statusCode: 400, headers, body: JSON.stringify({
        error: "Não foi possível encontrar a conta Instagram vinculada a este token.",
        diag,
      }) };
    }

    return buildOk({ headers, meData: foundAccount, token, tokenType: "system_user", APP_SECRET });

  } catch (err) {
    console.error("[add-account-via-token] EXCEPTION:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Erro interno: " + err.message, diag }) };
  }
};

async function buildOk({ headers, meData, token, tokenType, APP_SECRET }) {
  let finalToken    = token;
  let tokenDuration = tokenType === "system_user" ? "never-expires" : "short-lived";
  let expiresAt     = null;

  if (tokenType === "ig") {
    try {
      const ll = await fetch(`${GRAPH_IG}/access_token?grant_type=ig_exchange_token&client_secret=${APP_SECRET}&access_token=${token}`);
      const ld = await ll.json();
      if (ld.access_token && !ld.error) {
        finalToken    = ld.access_token;
        tokenDuration = "long-lived";
        if (ld.expires_in) expiresAt = new Date(Date.now() + ld.expires_in * 1000).toISOString();
      }
    } catch { /* mantém token original */ }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      account: {
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
      },
      token_duration: tokenDuration,
      warning: tokenDuration === "short-lived" ? "Token de curta duração (1h). O sistema tentará renovar automaticamente." : null,
    }),
  };
}
