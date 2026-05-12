// auth-callback-ig.mjs — OAuth via Instagram Login (sem Página do Facebook)
// Lançado em julho/2024 pela Meta como alternativa ao Facebook Login.
// Funciona com contas Business e Creator diretamente — zero dependência de Página.
//
// Fluxo:
//   1. Frontend abre popup → api.instagram.com/oauth/authorize
//   2. Usuário autoriza no Instagram
//   3. Instagram redireciona para esta função com ?code=...&state=popup
//   4. Trocamos o code por token curto  (api.instagram.com/oauth/access_token)
//   5. Trocamos por token longo 60 dias (graph.instagram.com/access_token)
//   6. Buscamos perfil em              (graph.instagram.com/me)
//   7. Retornamos postMessage ao popup pai

const IG_AUTH  = "https://api.instagram.com";
const IG_GRAPH = "https://graph.instagram.com";

const IG_FIELDS = [
  "id",
  "username",
  "name",
  "biography",
  "website",
  "profile_picture_url",
  "followers_count",
  "follows_count",
  "media_count",
  "account_type",
].join(",");

async function apiFetch(url, options = {}) {
  const res  = await fetch(url, options);
  const data = await res.json();
  return data;
}

export const handler = async (event) => {
  const params  = event.queryStringParameters || {};
  const code    = params.code;
  const state   = params.state;
  const isPopup = state === "popup";

  // Erro direto do Instagram (usuário cancelou, etc.)
  if (params.error) {
    const reason = params.error_description || params.error || "Acesso negado";
    return respondWith({ error: reason }, isPopup);
  }

  if (!code) {
    return respondWith({ error: "Código de autorização ausente" }, isPopup);
  }

  const APP_ID      = process.env.META_APP_ID;
  const APP_SECRET  = process.env.META_APP_SECRET;
  const REDIRECT_URI = (process.env.META_REDIRECT_URI_IG || process.env.META_REDIRECT_URI || "")
    .replace("/auth-callback", "/auth-callback-ig");

  if (!APP_ID || !APP_SECRET) {
    return respondWith({ error: "Configuração do app ausente (META_APP_ID / META_APP_SECRET)" }, isPopup);
  }

  try {
    // ── 1. Trocar code por token de curta duração ──────────────────────────
    const shortData = await apiFetch(`${IG_AUTH}/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     APP_ID,
        client_secret: APP_SECRET,
        grant_type:    "authorization_code",
        redirect_uri:  REDIRECT_URI,
        code,
      }),
    });

    if (shortData.error_type || shortData.error_message) {
      throw new Error(`Token curto: ${shortData.error_message || JSON.stringify(shortData)}`);
    }

    const shortToken = shortData.access_token;
    if (!shortToken) throw new Error("Token de curta duração não retornado");

    // ── 2. Trocar por token de LONGA duração (60 dias) ─────────────────────
    const longData = await apiFetch(
      `${IG_GRAPH}/access_token?grant_type=ig_exchange_token&client_secret=${APP_SECRET}&access_token=${shortToken}`
    );

    const longToken   = longData.access_token || shortToken;
    const expiresIn   = longData.expires_in   || null;
    const expiresAt   = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;
    const tokenDuration = longData.access_token ? "long-lived" : "short-lived";

    // ── 3. Buscar perfil da conta ──────────────────────────────────────────
    const profile = await apiFetch(
      `${IG_GRAPH}/me?fields=${IG_FIELDS}&access_token=${longToken}`
    );

    if (profile.error) {
      throw new Error(`Perfil: ${profile.error.message}`);
    }

    const account = {
      id:               profile.id,
      username:         profile.username         || "",
      name:             profile.name             || profile.username || "",
      biography:        profile.biography        || "",
      website:          profile.website          || "",
      profile_picture:  profile.profile_picture_url || "",
      account_type:     profile.account_type     || "BUSINESS",
      followers_count:  profile.followers_count  ?? null,
      follows_count:    profile.follows_count    ?? null,
      media_count:      profile.media_count      ?? null,
      access_token:     longToken,
      token_duration:   tokenDuration,
      token_expires_at: expiresAt,
      token_status:     "active",
      added_via:        "instagram_login",   // ← identifica o fluxo
      page_id:          null,
      page_name:        null,
      connected_at:     new Date().toISOString(),
    };

    return respondWith({ accounts: [account] }, isPopup);

  } catch (err) {
    console.error("[auth-callback-ig] error:", err);
    return respondWith({ error: err.message }, isPopup);
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function respondWith({ accounts, error }, isPopup) {
  if (isPopup) {
    const payload = accounts
      ? JSON.stringify({ type: "OAUTH_ACCOUNTS", accounts })
      : JSON.stringify({ type: "OAUTH_ERROR",    error: error || "Erro desconhecido" });

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Conectando...</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0d0d12; color: #fff;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .box { text-align: center; padding: 32px; }
  .ok   { font-size: 40px; margin-bottom: 12px; }
  h2    { font-size: 16px; margin: 0 0 6px; }
  p     { font-size: 13px; color: rgba(255,255,255,0.5); margin: 0; }
</style>
</head>
<body>
<div class="box">
  ${accounts
    ? `<div class="ok">✅</div>
       <h2>${accounts[0]?.username ? "@" + accounts[0].username : "Conta"} conectada!</h2>
       <p>Fechando automaticamente...</p>`
    : `<div class="ok">❌</div>
       <h2>Erro ao conectar</h2>
       <p>${error || "Tente novamente."}</p>`
  }
</div>
<script>
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(${payload}, window.location.origin);
    }
  } catch(e) {}
  setTimeout(() => window.close(), ${accounts ? 1500 : 3000});
</script>
</body>
</html>`;

    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: html,
    };
  }

  // Fallback redirect (sem popup)
  if (accounts) {
    const encoded = Buffer.from(JSON.stringify(accounts)).toString("base64url");
    return { statusCode: 302, headers: { Location: `/?accounts=${encoded}` } };
  }
  return { statusCode: 302, headers: { Location: `/?error=${encodeURIComponent(error)}` } };
}
