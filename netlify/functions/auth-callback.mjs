// Atualizado para Graph API v21.0
const GRAPH = "https://graph.facebook.com/v21.0";

export const handler = async (event) => {
  const code = event.queryStringParameters?.code;
  if (!code) {
    return { statusCode: 302, headers: { Location: "/?error=sem_codigo" } };
  }

  const APP_ID      = process.env.META_APP_ID;
  const APP_SECRET  = process.env.META_APP_SECRET;
  const REDIRECT_URI = process.env.META_REDIRECT_URI;

  try {
    // Trocar code por token curto
    const tokenRes = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${APP_ID}&client_secret=${APP_SECRET}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code=${code}`
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error.message);

    // Trocar por token longo (60 dias)
    const longRes = await fetch(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
    );
    const longData = await longRes.json();
    const userToken = longData.access_token || tokenData.access_token;

    // Buscar páginas do Facebook
    const pagesRes = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${userToken}`);
    const pagesData = await pagesRes.json();
    const pages = pagesData.data || [];

    const accounts = [];

    for (const page of pages) {
      const pageToken = page.access_token;
      const pageId    = page.id;

      // Buscar conta Instagram vinculada
      const igRes  = await fetch(`${GRAPH}/${pageId}?fields=instagram_business_account&access_token=${pageToken}`);
      const igData = await igRes.json();
      const igAccount = igData.instagram_business_account;
      if (!igAccount) continue;

      const igId = igAccount.id;

      // Buscar detalhes da conta IG
      const detailRes = await fetch(`${GRAPH}/${igId}?fields=username,profile_picture_url,account_type,name&access_token=${pageToken}`);
      const detail    = await detailRes.json();

      // Trocar token da página por token de longa duração
      const pageTokenLongRes = await fetch(
        `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${pageToken}`
      );
      const pageTokenLong = await pageTokenLongRes.json();
      const finalToken = pageTokenLong.access_token || pageToken;

      accounts.push({
        id:              igId,
        username:        detail.username || "",
        name:            detail.name || detail.username || "",
        profile_picture: detail.profile_picture_url || "",
        account_type:    detail.account_type || "BUSINESS",
        access_token:    finalToken,
        page_id:         pageId,
        connected_at:    new Date().toISOString(),
      });
    }

    if (accounts.length === 0) {
      return {
        statusCode: 302,
        headers: { Location: "/?error=" + encodeURIComponent("Nenhuma conta Instagram Business encontrada. Verifique se as páginas têm contas Instagram vinculadas.") },
      };
    }

    const encoded = Buffer.from(JSON.stringify(accounts)).toString("base64url");
    return { statusCode: 302, headers: { Location: `/?accounts=${encoded}` } };

  } catch (err) {
    console.error("auth-callback error:", err);
    return { statusCode: 302, headers: { Location: `/?error=${encodeURIComponent(err.message)}` } };
  }
};
