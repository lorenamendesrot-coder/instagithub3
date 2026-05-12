// account-insights.mjs — Status de Saúde completo da conta Instagram
// Retorna: perfil + content_publishing_limit + insights 7d + análise de saúde
//
// Mudanças vs versão anterior:
// - Busca insights de account-level (reach, profile_views, etc) últimos 7 dias
// - Busca também os 7 dias anteriores para detectar quedas bruscas
// - analyzeAccountHealth() consolida tudo em score/overall/issues
// - Falhas em insights individuais não derrubam a resposta (degradação graceful)

const GRAPH_FB = "https://graph.facebook.com/v21.0";
const GRAPH_IG = "https://graph.instagram.com";

// Tokens do Instagram Login começam com 'IGAA'
// Tokens do Facebook Login começam com 'EAA'
function isIGToken(token) { return token?.startsWith('IGAA'); }
function graphBase(token) { return isIGToken(token) ? GRAPH_IG + '/' : GRAPH_FB + '/'; }
// Para chamadas que precisam de versão explícita no FB Graph
const GRAPH = GRAPH_FB;

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";

// ─── Helpers de tempo (em segundos UTC, formato Unix) ────────────────────────
function unixDaysAgo(days) {
  return Math.floor((Date.now() - days * 86400_000) / 1000);
}

// ─── Fetch helper com timeout ────────────────────────────────────────────────
async function gfetch(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return await res.json();
  } catch (err) {
    return { error: { message: err.name === "AbortError" ? "timeout" : err.message } };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Soma os valores diários retornados por um insight ───────────────────────
function sumInsightValues(insightObj) {
  if (!insightObj?.values?.length) return 0;
  return insightObj.values.reduce((acc, v) => acc + (Number(v.value) || 0), 0);
}

// ─── Busca insights da conta para uma janela de 7 dias ───────────────────────
// metric=reach&period=day retorna 1 ponto por dia.
// Tentamos vários nomes de métricas porque a Meta deprecou algumas em 2024
// para certos tipos de conta. Falhas individuais não interrompem o fluxo.
async function fetchInsightsWindow(igId, token, sinceUnix, untilUnix) {
  const metrics = ["reach", "profile_views", "website_clicks", "follower_count"];
  const url =
    `${graphBase(token)}${igId}/insights` +
    `?metric=${metrics.join(",")}` +
    `&period=day` +
    `&since=${sinceUnix}&until=${untilUnix}` +
    `&access_token=${token}`;

  const data = await gfetch(url);

  // Se a chamada inteira falhou, tentamos uma chamada conservadora só com `reach`
  if (data.error || !data.data) {
    const fallback = await gfetch(
      `${graphBase(token)}${igId}/insights?metric=reach&period=day&since=${sinceUnix}&until=${untilUnix}&access_token=${token}`
    );
    if (fallback.error || !fallback.data) {
      return { available: false, error: fallback.error?.message || data.error?.message };
    }
    return {
      available: true,
      reach: sumInsightValues(fallback.data.find((m) => m.name === "reach")),
      profile_views: null,
      website_clicks: null,
      follower_count: null,
      partial: true,
    };
  }

  const findMetric = (name) => data.data.find((m) => m.name === name);

  return {
    available: true,
    reach:           sumInsightValues(findMetric("reach")),
    profile_views:   sumInsightValues(findMetric("profile_views")),
    website_clicks:  sumInsightValues(findMetric("website_clicks")),
    // follower_count não é cumulativo — pegamos o último valor da janela
    follower_count:  (() => {
      const m = findMetric("follower_count");
      if (!m?.values?.length) return null;
      return Number(m.values[m.values.length - 1].value) || null;
    })(),
    partial: false,
  };
}

// ─── Análise de saúde da conta ───────────────────────────────────────────────
// Retorna { overall, score, issues, quota_pct, reach_drop_pct, ... }
//
// Score parte de 100 e desconta por problema. Faixas:
//   ≥ 75  → good
//   45-74 → warning
//   < 45  → danger
function analyzeAccountHealth({ profile, publishingLimit, insights7d, insightsPrev7d, tokenExpired }) {
  const issues = [];
  let score = 100;

  // ── Token ────────────────────────────────────────────────────────────────
  if (tokenExpired) {
    return {
      overall: "danger",
      score: 0,
      issues: ["Token de acesso expirado — reconecte a conta para continuar publicando."],
      quota_pct: null,
      reach_drop_pct: null,
      reach_7d: null,
      reach_prev_7d: null,
      profile_views_7d: null,
      website_clicks_7d: null,
      insights_available: false,
    };
  }

  // ── Quota de publicação (24h) ────────────────────────────────────────────
  let quotaPct = null;
  if (publishingLimit?.config?.quota_total) {
    const used  = Number(publishingLimit.quota_usage || 0);
    const total = Number(publishingLimit.config.quota_total);
    quotaPct = Math.round((used / total) * 100);

    if (quotaPct >= 100) {
      score -= 40;
      issues.push(`Limite de publicação esgotado (${used}/${total} nas últimas 24h). Aguarde a janela renovar.`);
    } else if (quotaPct >= 80) {
      score -= 20;
      issues.push(`Próximo do limite de publicação (${used}/${total} = ${quotaPct}%). Reduza o ritmo.`);
    } else if (quotaPct >= 60) {
      score -= 10;
    }
  }

  // ── Insights / queda de alcance ──────────────────────────────────────────
  const insightsAvailable = !!insights7d?.available;
  let reachDropPct = null;

  if (insightsAvailable) {
    const reach     = insights7d.reach || 0;
    const reachPrev = insightsPrev7d?.reach || 0;

    // Queda só faz sentido se havia alcance prévio
    if (reachPrev > 0) {
      reachDropPct = Math.round(((reachPrev - reach) / reachPrev) * 100);
      if (reachDropPct >= 75) {
        score -= 35;
        issues.push(`Queda crítica de alcance: ${reachDropPct}% vs semana anterior (${reachPrev} → ${reach}). Possível shadowban ou penalização algorítmica.`);
      } else if (reachDropPct >= 50) {
        score -= 25;
        issues.push(`Queda forte de alcance: ${reachDropPct}% vs semana anterior (${reachPrev} → ${reach}).`);
      } else if (reachDropPct >= 30) {
        score -= 10;
        issues.push(`Alcance em queda: ${reachDropPct}% vs semana anterior.`);
      }
    }

    // Conta com posts mas alcance zero nos últimos 7 dias é um sinal forte
    if (profile?.media_count > 0 && reach === 0 && reachPrev > 0) {
      score -= 30;
      issues.push("Alcance zerado nos últimos 7 dias após semana com tráfego — verifique restrições da conta.");
    }
  } else if (insights7d?.error) {
    // Não derruba o score muito — pode ser conta nova ou permissão faltando
    score -= 5;
    issues.push(`Insights indisponíveis: ${insights7d.error}. Verifique se a conta tem permissão instagram_manage_insights.`);
  }

  // ── Perfil incompleto ────────────────────────────────────────────────────
  if (profile && !profile.profile_picture_url) {
    score -= 5;
    issues.push("Foto de perfil ausente — perfis incompletos têm alcance reduzido.");
  }
  if (profile && !profile.biography) {
    score -= 3;
    issues.push("Biografia vazia — adicionar uma bio melhora a credibilidade da conta.");
  }

  // ── Conta nova com pouca atividade ───────────────────────────────────────
  if (profile && profile.media_count === 0) {
    score -= 5;
    issues.push("Nenhum post ainda — contas sem posts são tratadas como inativas pelo algoritmo.");
  }

  score = Math.max(0, Math.min(100, score));

  const overall = score >= 75 ? "good" : score >= 45 ? "warning" : "danger";

  return {
    overall,
    score,
    issues,
    quota_pct: quotaPct,
    reach_drop_pct: reachDropPct,
    reach_7d: insights7d?.reach ?? null,
    reach_prev_7d: insightsPrev7d?.reach ?? null,
    profile_views_7d: insights7d?.profile_views ?? null,
    website_clicks_7d: insights7d?.website_clicks ?? null,
    insights_available: insightsAvailable,
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────
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
    // ── 1. Perfil ──────────────────────────────────────────────────────────
    // Campos variam por tipo de token:
    // - Instagram Login (IGAA): usa graph.instagram.com/me (retorna conta autenticada)
    // - Facebook Login (EAA): usa graph.facebook.com/v21.0/{id}
    const igToken = isIGToken(access_token);

    const profileFields = igToken
      ? ["id", "username", "name", "biography", "website",
         "profile_picture_url", "followers_count", "following_count", "media_count"].join(",")
      : ["id", "username", "name", "biography", "website",
         "profile_picture_url", "followers_count", "follows_count", "media_count"].join(",");

    const graphUrl = igToken
      ? `${GRAPH_IG}/me?fields=${profileFields}&access_token=${access_token}`
      : `${GRAPH_FB}/${instagram_id}?fields=${profileFields}&access_token=${access_token}`;
    const profileData = await gfetch(graphUrl);

    if (profileData.error) {
      if (profileData.error.code === 190) {
        const health = analyzeAccountHealth({ tokenExpired: true });
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({
            error: "token_expired",
            message: "Token expirado. Reconecte a conta.",
            health,
          }),
        };
      }
      return { statusCode: 400, headers, body: JSON.stringify({ error: profileData.error.message }) };
    }

    // Para tokens IG, o ID real vem do /me — usa ele nas chamadas seguintes
    const resolvedId = profileData.id || instagram_id;

    // ── 2. Limit + insights em paralelo ────────────────────────────────────
    const now             = Math.floor(Date.now() / 1000);
    const sevenDaysAgo    = unixDaysAgo(7);
    const fourteenDaysAgo = unixDaysAgo(14);

    const [limitData, insights7d, insightsPrev7d] = await Promise.all([
      gfetch(`${graphBase(access_token)}${resolvedId}/content_publishing_limit?fields=config,quota_usage&access_token=${access_token}`),
      fetchInsightsWindow(resolvedId, access_token, sevenDaysAgo, now),
      fetchInsightsWindow(resolvedId, access_token, fourteenDaysAgo, sevenDaysAgo),
    ]);

    let publishingLimit = null;
    if (!limitData.error && limitData.data?.length > 0) {
      publishingLimit = limitData.data[0];
    }

    // ── 3. Análise de saúde ────────────────────────────────────────────────
    const health = analyzeAccountHealth({
      profile: profileData,
      publishingLimit,
      insights7d,
      insightsPrev7d,
      tokenExpired: false,
    });

    // ── 4. Compat com frontend antigo (Avatar e cards usam account_status) ─
    const accountStatus =
        health.overall === "danger"  ? (health.quota_pct >= 100 ? "limited" : "danger")
      : health.overall === "warning" ? "warning"
      : "active";
    const restrictionNote = health.issues[0] || null;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        // Perfil
        id:               profileData.id,
        username:         profileData.username,
        name:             profileData.name,
        biography:        profileData.biography || "",
        website:          profileData.website || "",
        profile_picture:  profileData.profile_picture_url || "",
        account_type:     profileData.account_type || "BUSINESS",
        followers_count:  profileData.followers_count ?? null,
        follows_count:    profileData.following_count ?? profileData.follows_count ?? null,
        media_count:      profileData.media_count ?? null,

        // Quota
        publishing_limit: publishingLimit,

        // Insights
        insights_7d: insights7d.available ? {
          reach:          insights7d.reach,
          profile_views:  insights7d.profile_views,
          website_clicks: insights7d.website_clicks,
          partial:        insights7d.partial,
        } : null,
        insights_prev_7d: insightsPrev7d.available ? {
          reach:         insightsPrev7d.reach,
          profile_views: insightsPrev7d.profile_views,
        } : null,

        // Saúde consolidada
        health,

        // Compat
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
