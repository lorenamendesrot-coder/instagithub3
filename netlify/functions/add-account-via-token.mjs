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
  const BUSINESS_ID = process.env.META_BUSINESS_ID; // opcional — fallback manual

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
      diag.debug_token = { app_id: d.data?.app_id, type: d.data?.type, is_valid: d.data?.is_valid, scopes: d.data?.scopes };
      if (d.data && !d.data.is_valid)
        return { statusCode: 401, headers, body: JSON.stringify({ error: "Token inválido: " + (d.data.error?.message || "expirado/revogado"), diag }) };
    } catch (e) { diag.debug_token = { exception: e.message }; }

    // ── 2. graph.instagram.com/me (token nativo IG) ───────────────────────────
    const igMeR = await fetch(`${GRAPH_IG}/me?fields=${igFields}&access_token=${token}`);
    const igMe  = await igMeR.json();
    diag.ig_me  = igMe.error ? { error: igMe.error.message, code: igMe.error.code } : { id: igMe.id, username: igMe.username };
    if (!igMe.error) return buildOk({ headers, meData: igMe, token, tokenType: "ig", APP_SECRET });

    // ── 3. FB /me ─────────────────────────────────────────────────────────────
    const fbMeR = await fetch(`${GRAPH_FB}/me?fields=id,name&access_token=${token}`);
    const fbMe  = await fbMeR.json();
    diag.fb_me  = fbMe.error ? { error: fbMe.error.message } : { id: fbMe.id, name: fbMe.name };
    if (fbMe.error)
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Token sem acesso à Graph API: " + fbMe.error.message, diag }) };

    const uid = fbMe.id;
    let foundAccount = null;

    // ── 4. Descobrir business_ids ─────────────────────────────────────────────
    // Estratégia A: token do próprio usuário (funciona se for admin do BM)
    // Estratégia B: App Access Token (APP_ID|APP_SECRET) — descobre negócios
    //               associados ao app, independente do nível do system user
    // Estratégia C: META_BUSINESS_ID fixo como último fallback
    const bizIds = new Set();

    // A: via token do usuário
    const bizUserR = await fetch(`${GRAPH_FB}/me/businesses?fields=id,name&access_token=${token}`);
    const bizUserD = await bizUserR.json();
    diag.businesses_via_user = bizUserD.error ? { error: bizUserD.error.message } : { count: bizUserD.data?.length };
    if (!bizUserD.error) bizUserD.data?.forEach(b => bizIds.add(b.id));

    // B: via App Access Token — busca negócios que têm o app instalado
    if (!bizIds.size) {
      const appToken  = `${APP_ID}|${APP_SECRET}`;
      const bizAppR   = await fetch(`${GRAPH_FB}/${APP_ID}/app_installs?fields=business&access_token=${appToken}`);
      const bizAppD   = await bizAppR.json();
      diag.businesses_via_app = bizAppD.error ? { error: bizAppD.error.message } : { count: bizAppD.data?.length };
      if (!bizAppD.error) bizAppD.data?.forEach(item => { if (item.business?.id) bizIds.add(item.business.id); });
    }

    // B2: via app_subscribed_businesses (endpoint alternativo)
    if (!bizIds.size) {
      const appToken = `${APP_ID}|${APP_SECRET}`;
      const subR     = await fetch(`${GRAPH_FB}/${APP_ID}/subscribed_apps?access_token=${appToken}`);
      const subD     = await subR.json();
      diag.subscribed = subD.error ? { error: subD.error.message } : subD;
    }

    // B3: buscar system users do app via App Token — e o negócio deles
    if (!bizIds.size) {
      const appToken = `${APP_ID}|${APP_SECRET}`;
      // Descobre negócio pelo system user ID usando app token
      const suBizR = await fetch(`${GRAPH_FB}/${uid}?fields=id,name&access_token=${appToken}`);
      const suBizD = await suBizR.json();
      diag.su_via_app_token = suBizD.error ? { error: suBizD.error.message } : suBizD;
    }

    // C: META_BUSINESS_ID fixo
    if (!bizIds.size && BUSINESS_ID) {
      bizIds.add(BUSINESS_ID);
      diag.business_id_source = "META_BUSINESS_ID env (fallback)";
    }

    diag.biz_ids_to_search = [...bizIds];

    // ── 5. Busca contas IG em cada business_id ────────────────────────────────
    for (const bizId of bizIds) {
      if (foundAccount) break;

      // 5a. instagram_accounts do negócio (via token do usuário)
      const oR = await fetch(`${GRAPH_FB}/${bizId}/instagram_accounts?fields=${igFields}&limit=100&access_token=${token}`);
      const oD = await oR.json();
      diag[`biz_${bizId}_ig_accounts`] = oD.error ? { error: oD.error.message } : { count: oD.data?.length, accounts: oD.data?.map(a => a.username) };
      if (!oD.error && oD.data?.[0]) { foundAccount = oD.data[0]; break; }

      // 5b. owned_instagram_accounts
      const ooR = await fetch(`${GRAPH_FB}/${bizId}/owned_instagram_accounts?fields=${igFields}&limit=100&access_token=${token}`);
      const ooD = await ooR.json();
      diag[`biz_${bizId}_owned_ig`] = ooD.error ? { error: ooD.error.message } : { count: ooD.data?.length, accounts: ooD.data?.map(a => a.username) };
      if (!ooD.error && ooD.data?.[0]) { foundAccount = ooD.data[0]; break; }

      // 5c. client_instagram_accounts
      const cR = await fetch(`${GRAPH_FB}/${bizId}/client_instagram_accounts?fields=${igFields}&limit=100&access_token=${token}`);
      const cD = await cR.json();
      diag[`biz_${bizId}_client_ig`] = cD.error ? { error: cD.error.message } : { count: cD.data?.length, accounts: cD.data?.map(a => a.username) };
      if (!cD.error && cD.data?.[0]) { foundAccount = cD.data[0]; break; }
    }

    // ── 6. Páginas do usuário → instagram_business_account ───────────────────
    if (!foundAccount) {
      const acR = await fetch(`${GRAPH_FB}/${uid}/accounts?fields=id,name,instagram_business_account{${igFields}}&limit=100&access_token=${token}`);
      const acD = await acR.json();
      diag.user_accounts = acD.error ? { error: acD.error.message } : { count: acD.data?.length };
      if (!acD.error) for (const p of acD.data || []) if (p.instagram_business_account) { foundAccount = p.instagram_business_account; break; }
    }

    // ── 7. assigned_pages ─────────────────────────────────────────────────────
    if (!foundAccount) {
      const apR = await fetch(`${GRAPH_FB}/${uid}/assigned_pages?fields=id,name,instagram_business_account{${igFields}}&limit=100&access_token=${token}`);
      const apD = await apR.json();
      diag.assigned_pages = apD.error ? { error: apD.error.message } : { count: apD.data?.length };
      if (!apD.error) for (const p of apD.data || []) if (p.instagram_business_account) { foundAccount = p.instagram_business_account; break; }
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
