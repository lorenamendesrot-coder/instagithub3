// add-account-via-token.mjs
const GRAPH_IG = "https://graph.instagram.com";
const GRAPH_FB = "https://graph.facebook.com/v21.0";

const igFields = "id,username,name,profile_picture_url,account_type,followers_count,media_count";

export const handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  const APP_ID     = process.env.META_APP_ID;
  const APP_SECRET = process.env.META_APP_SECRET;

  if (!APP_ID || !APP_SECRET)
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Configuração do app ausente" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const { access_token } = body;
  if (!access_token?.trim())
    return { statusCode: 400, headers, body: JSON.stringify({ error: "access_token é obrigatório" }) };

  const token = access_token.trim();
  const diag  = {}; // objeto de diagnóstico — retornado junto ao erro

  try {
    // ── 1. debug_token ────────────────────────────────────────────────────────
    try {
      const r = await fetch(`${GRAPH_FB}/debug_token?input_token=${token}&access_token=${APP_ID}|${APP_SECRET}`);
      const d = await r.json();
      diag.debug_token = { app_id: d.data?.app_id, type: d.data?.type, is_valid: d.data?.is_valid, scopes: d.data?.scopes, error: d.data?.error?.message };
      if (d.data && !d.data.is_valid)
        return { statusCode: 401, headers, body: JSON.stringify({ error: "Token inválido: " + (d.data.error?.message || "expirado/revogado"), diag }) };
    } catch (e) { diag.debug_token = { exception: e.message }; }

    // ── 2. graph.instagram.com/me ─────────────────────────────────────────────
    const igMeR = await fetch(`${GRAPH_IG}/me?fields=${igFields}&access_token=${token}`);
    const igMe  = await igMeR.json();
    diag.ig_me  = igMe.error ? { error: igMe.error.message, code: igMe.error.code } : { id: igMe.id, username: igMe.username };

    if (!igMe.error)
      return buildOk({ headers, meData: igMe, token, tokenType: "ig", APP_SECRET });

    // ── 3. FB /me ─────────────────────────────────────────────────────────────
    const fbMeR = await fetch(`${GRAPH_FB}/me?fields=id,name&access_token=${token}`);
    const fbMe  = await fbMeR.json();
    diag.fb_me  = fbMe.error ? { error: fbMe.error.message } : { id: fbMe.id, name: fbMe.name };

    if (fbMe.error)
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Token sem acesso à Graph API: " + fbMe.error.message, diag }) };

    const uid = fbMe.id;

    // ── 4. /accounts (páginas do usuário) ─────────────────────────────────────
    const acR = await fetch(`${GRAPH_FB}/${uid}/accounts?fields=id,name,instagram_business_account{${igFields}}&limit=100&access_token=${token}`);
    const acD = await acR.json();
    diag.user_accounts = acD.error ? { error: acD.error.message } : { count: acD.data?.length, pages: acD.data?.map(p => ({ id: p.id, name: p.name, has_ig: !!p.instagram_business_account })) };
    if (!acD.error) for (const p of acD.data || []) if (p.instagram_business_account) return buildOk({ headers, meData: p.instagram_business_account, token, tokenType: "system_user", APP_SECRET });

    // ── 5. /me/businesses ─────────────────────────────────────────────────────
    const bizR = await fetch(`${GRAPH_FB}/me/businesses?fields=id,name&access_token=${token}`);
    const bizD = await bizR.json();
    diag.businesses = bizD.error ? { error: bizD.error.message } : { count: bizD.data?.length, list: bizD.data?.map(b => ({ id: b.id, name: b.name })) };

    if (!bizD.error && bizD.data?.length) {
      for (const biz of bizD.data) {
        // 5a. owned instagram_accounts do negócio
        const oR = await fetch(`${GRAPH_FB}/${biz.id}/instagram_accounts?fields=${igFields}&limit=100&access_token=${token}`);
        const oD = await oR.json();
        diag[`biz_${biz.id}_instagram_accounts`] = oD.error ? { error: oD.error.message } : { count: oD.data?.length, accounts: oD.data?.map(a => a.username) };
        if (!oD.error && oD.data?.[0]) return buildOk({ headers, meData: oD.data[0], token, tokenType: "system_user", APP_SECRET });

        // 5b. client_instagram_accounts
        const cR = await fetch(`${GRAPH_FB}/${biz.id}/client_instagram_accounts?fields=${igFields}&limit=100&access_token=${token}`);
        const cD = await cR.json();
        diag[`biz_${biz.id}_client_ig`] = cD.error ? { error: cD.error.message } : { count: cD.data?.length, accounts: cD.data?.map(a => a.username) };
        if (!cD.error && cD.data?.[0]) return buildOk({ headers, meData: cD.data[0], token, tokenType: "system_user", APP_SECRET });

        // 5c. owned_instagram_accounts do negócio
        const ooR = await fetch(`${GRAPH_FB}/${biz.id}/owned_instagram_accounts?fields=${igFields}&limit=100&access_token=${token}`);
        const ooD = await ooR.json();
        diag[`biz_${biz.id}_owned_ig`] = ooD.error ? { error: ooD.error.message } : { count: ooD.data?.length, accounts: ooD.data?.map(a => a.username) };
        if (!ooD.error && ooD.data?.[0]) return buildOk({ headers, meData: ooD.data[0], token, tokenType: "system_user", APP_SECRET });
      }
    }

    // ── 6. assigned_pages do system user ──────────────────────────────────────
    const apR = await fetch(`${GRAPH_FB}/${uid}/assigned_pages?fields=id,name,instagram_business_account{${igFields}}&limit=100&access_token=${token}`);
    const apD = await apR.json();
    diag.assigned_pages = apD.error ? { error: apD.error.message } : { count: apD.data?.length };
    if (!apD.error) for (const p of apD.data || []) if (p.instagram_business_account) return buildOk({ headers, meData: p.instagram_business_account, token, tokenType: "system_user", APP_SECRET });

    // ── 7. owned_instagram_accounts direto no user ────────────────────────────
    const ouR = await fetch(`${GRAPH_FB}/${uid}/owned_instagram_accounts?fields=${igFields}&limit=100&access_token=${token}`);
    const ouD = await ouR.json();
    diag.owned_ig_user = ouD.error ? { error: ouD.error.message } : { count: ouD.data?.length, accounts: ouD.data?.map(a => a.username) };
    if (!ouD.error && ouD.data?.[0]) return buildOk({ headers, meData: ouD.data[0], token, tokenType: "system_user", APP_SECRET });

    // ── 8. instagram_accounts direto no user ──────────────────────────────────
    const iuR = await fetch(`${GRAPH_FB}/${uid}/instagram_accounts?fields=${igFields}&limit=100&access_token=${token}`);
    const iuD = await iuR.json();
    diag.ig_accounts_user = iuD.error ? { error: iuD.error.message } : { count: iuD.data?.length, accounts: iuD.data?.map(a => a.username) };
    if (!iuD.error && iuD.data?.[0]) return buildOk({ headers, meData: iuD.data[0], token, tokenType: "system_user", APP_SECRET });

    // ── Falhou tudo — retorna diagnóstico completo ────────────────────────────
    console.error("[add-account-via-token] DIAG:", JSON.stringify(diag, null, 2));
    return { statusCode: 400, headers, body: JSON.stringify({
      error: "Não foi possível encontrar a conta Instagram vinculada a este token.",
      diag,
    }) };

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
