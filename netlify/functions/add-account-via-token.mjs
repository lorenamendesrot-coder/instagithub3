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

  const { access_token, instagram_account_id } = body;
  if (!access_token?.trim())
    return { statusCode: 400, headers, body: JSON.stringify({ error: "access_token é obrigatório" }) };

  const token = access_token.trim();
  const igId  = instagram_account_id?.trim() || null;
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

    // ── 3. ESTRATÉGIA DIRETA: System User token — sem necessidade de Página ───
    // System User tokens não funcionam com graph.instagram.com/me.
    // O caminho correto é /me/instagram_accounts no FB Graph API,
    // que lista contas IG atribuídas diretamente ao System User.

    // 3a. Tenta /me/instagram_accounts (conta IG atribuída diretamente ao System User)
    const sysuserIGR = await fetch(
      `${GRAPH_FB}/me/instagram_accounts?fields=${igFields}&limit=10&access_token=${token}`
    );
    const sysuserIGD = await sysuserIGR.json();
    diag.sysuser_ig_accounts = sysuserIGD.error
      ? { error: sysuserIGD.error.message }
      : { count: sysuserIGD.data?.length, accounts: sysuserIGD.data?.map(a => a.username) };

    if (!sysuserIGD.error && sysuserIGD.data?.length) {
      // Se o usuário informou um ID específico, tenta encontrar aquela conta; senão pega a primeira
      const match = igId
        ? sysuserIGD.data.find(a => a.id === igId)
        : sysuserIGD.data[0];
      if (match) return buildOk({ headers, meData: match, token, tokenType: "system_user", APP_SECRET });
    }

    // 3b. Se informou o ID, tenta acessar diretamente via FB Graph (requer ativo atribuído no Business)
    if (igId) {
      const directFBR = await fetch(`${GRAPH_FB}/${igId}?fields=${igFields}&access_token=${token}`);
      const directFBD = await directFBR.json();
      diag.direct_fb_by_id = directFBD.error ? { error: directFBD.error.message } : { id: directFBD.id, username: directFBD.username };
      if (!directFBD.error && directFBD.id) return buildOk({ headers, meData: directFBD, token, tokenType: "system_user", APP_SECRET });

      // 3c. Tenta via Instagram Graph API com o ID
      const directIGR = await fetch(`${GRAPH_IG}/${igId}?fields=${igFields}&access_token=${token}`);
      const directIGD = await directIGR.json();
      diag.direct_ig_by_id = directIGD.error ? { error: directIGD.error.message } : { id: directIGD.id, username: directIGD.username };
      if (!directIGD.error && directIGD.id) return buildOk({ headers, meData: directIGD, token, tokenType: "system_user", APP_SECRET });
    }

    // ── 4. FB /me — identifica o usuário/system user ──────────────────────────
    const fbMeR = await fetch(`${GRAPH_FB}/me?fields=id,name&access_token=${token}`);
    const fbMe  = await fbMeR.json();
    diag.fb_me  = fbMe.error ? { error: fbMe.error.message } : { id: fbMe.id, name: fbMe.name };
    if (fbMe.error)
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Token inválido: " + fbMe.error.message, diag }) };

    const uid = fbMe.id;
    let foundAccount = null;

    // ── 5. Páginas do usuário → instagram_business_account ───────────────────
    const acR = await fetch(`${GRAPH_FB}/${uid}/accounts?fields=id,name,instagram_business_account{${igFields}}&limit=100&access_token=${token}`);
    const acD = await acR.json();
    diag.user_accounts = acD.error ? { error: acD.error.message } : { count: acD.data?.length };
    if (!acD.error) for (const p of acD.data || []) if (p.instagram_business_account) { foundAccount = p.instagram_business_account; break; }

    // ── 6. assigned_pages ─────────────────────────────────────────────────────
    if (!foundAccount) {
      const apR = await fetch(`${GRAPH_FB}/${uid}/assigned_pages?fields=id,name,instagram_business_account{${igFields}}&limit=100&access_token=${token}`);
      const apD = await apR.json();
      diag.assigned_pages = apD.error ? { error: apD.error.message } : { count: apD.data?.length };
      if (!apD.error) for (const p of apD.data || []) if (p.instagram_business_account) { foundAccount = p.instagram_business_account; break; }
    }

    // ── 7. Negócios via token do usuário ──────────────────────────────────────
    if (!foundAccount) {
      const bizIds = new Set();
      if (BUSINESS_ID) bizIds.add(BUSINESS_ID);
      const bizR = await fetch(`${GRAPH_FB}/me/businesses?fields=id&access_token=${token}`);
      const bizD = await bizR.json();
      diag.businesses = bizD.error ? { error: bizD.error.message } : { count: bizD.data?.length };
      if (!bizD.error) bizD.data?.forEach(b => bizIds.add(b.id));

      for (const bizId of bizIds) {
        if (foundAccount) break;
        const oR = await fetch(`${GRAPH_FB}/${bizId}/instagram_accounts?fields=${igFields}&limit=100&access_token=${token}`);
        const oD = await oR.json();
        diag[`biz_${bizId}_ig`] = oD.error ? { error: oD.error.message } : { count: oD.data?.length, accounts: oD.data?.map(a => a.username) };
        if (!oD.error && oD.data?.[0]) { foundAccount = oD.data[0]; break; }
      }
    }

    if (!foundAccount) {
      const hint = `\n\nPara token de Usuário do Sistema, a conta IG precisa estar atribuída como ativo:\n` +
        `Business Suite → Configurações → Usuários do Sistema → Atribuir ativos → Contas do Instagram.\n` +
        `Depois gere um novo token.`;
      console.error("[add-account-via-token] DIAG:", JSON.stringify(diag, null, 2));
      return { statusCode: 400, headers, body: JSON.stringify({
        error: "Não foi possível encontrar a conta Instagram vinculada a este token." + hint,
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
