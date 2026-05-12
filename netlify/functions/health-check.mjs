// health-check.mjs — Health Check diário de todas as contas
// Roda via cron (netlify.toml) ou chamada manual
// Detecta quedas de reach e pausa automaticamente contas em risco
// Salva resultado no Netlify Blobs para o frontend consumir

import { getStore } from "@netlify/blobs";

const GRAPH        = "https://graph.facebook.com/v21.0";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";

// Thresholds de pausa automática
const PAUSE_THRESHOLDS = {
  reach_drop_critical: 70, // pausa automática se queda ≥ 70%
  reach_drop_warn:     50, // alerta (sem pausa) se queda ≥ 50%
  score_danger:        35, // pausa automática se score ≤ 35
};

function unixDaysAgo(days) {
  return Math.floor((Date.now() - days * 86_400_000) / 1000);
}

async function gfetch(url, timeoutMs = 10000) {
  const ctrl  = new AbortController();
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

function sumValues(insightObj) {
  if (!insightObj?.values?.length) return 0;
  return insightObj.values.reduce((s, v) => s + (Number(v.value) || 0), 0);
}

async function fetchReach(igId, token, sinceUnix, untilUnix) {
  const data = await gfetch(
    `${GRAPH}/${igId}/insights?metric=reach&period=day&since=${sinceUnix}&until=${untilUnix}&access_token=${token}`
  );
  if (data.error || !data.data) return null;
  return sumValues(data.data.find((m) => m.name === "reach"));
}

async function checkAccount(acc) {
  const { id: igId, access_token: token, username } = acc;
  const result = {
    id: igId,
    username,
    checked_at: new Date().toISOString(),
    reach_7d:      null,
    reach_prev_7d: null,
    reach_drop_pct: null,
    score:         null,
    status:        "ok",   // ok | warn | paused | error | token_expired
    pause_reason:  null,
    auto_paused:   false,
    issues:        [],
  };

  const now          = Math.floor(Date.now() / 1000);
  const sevenAgo     = unixDaysAgo(7);
  const fourteenAgo  = unixDaysAgo(14);

  try {
    // Verifica token primeiro
    const profile = await gfetch(
      `${GRAPH}/${igId}?fields=id,username,media_count&access_token=${token}`
    );

    if (profile.error?.code === 190) {
      result.status = "token_expired";
      result.issues.push("Token de acesso expirado");
      result.score  = 0;
      return result;
    }
    if (profile.error) {
      result.status = "error";
      result.issues.push(profile.error.message);
      result.score  = null;
      return result;
    }

    // Busca reach das duas janelas em paralelo
    const [reach7d, reachPrev7d] = await Promise.all([
      fetchReach(igId, token, sevenAgo, now),
      fetchReach(igId, token, fourteenAgo, sevenAgo),
    ]);

    result.reach_7d      = reach7d;
    result.reach_prev_7d = reachPrev7d;

    // Calcula queda
    let score = 100;
    if (reachPrev7d !== null && reachPrev7d > 0 && reach7d !== null) {
      const drop = Math.round(((reachPrev7d - reach7d) / reachPrev7d) * 100);
      result.reach_drop_pct = drop;

      if (drop >= PAUSE_THRESHOLDS.reach_drop_critical) {
        score -= 50;
        result.issues.push(`Queda crítica de reach: ${drop}% (${reachPrev7d} → ${reach7d})`);
      } else if (drop >= PAUSE_THRESHOLDS.reach_drop_warn) {
        score -= 30;
        result.issues.push(`Queda forte de reach: ${drop}% (${reachPrev7d} → ${reach7d})`);
      } else if (drop >= 30) {
        score -= 15;
        result.issues.push(`Queda moderada de reach: ${drop}%`);
      }
    }

    // Reach zerado com histórico positivo = sinal de shadowban
    if (reach7d === 0 && reachPrev7d > 0) {
      score -= 35;
      result.issues.push("Reach zerado nos últimos 7 dias — possível shadowban");
    }

    score = Math.max(0, Math.min(100, score));
    result.score = score;

    // Decide status e pausa automática
    if (score <= PAUSE_THRESHOLDS.score_danger ||
        (result.reach_drop_pct !== null && result.reach_drop_pct >= PAUSE_THRESHOLDS.reach_drop_critical)) {
      result.status      = "paused";
      result.auto_paused = true;
      result.pause_reason = result.issues[0] || "Score de saúde crítico";
    } else if (score < 60 || (result.reach_drop_pct !== null && result.reach_drop_pct >= PAUSE_THRESHOLDS.reach_drop_warn)) {
      result.status = "warn";
    } else {
      result.status = "ok";
    }

  } catch (err) {
    result.status = "error";
    result.issues.push(err.message);
  }

  return result;
}

export const handler = async (event) => {
  const requestOrigin = event.headers?.origin || "";
  const corsOrigin    = ALLOWED_ORIGIN && requestOrigin === ALLOWED_ORIGIN
    ? ALLOWED_ORIGIN : ALLOWED_ORIGIN || "*";

  const headers = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    ...(corsOrigin !== "*" && { Vary: "Origin" }),
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  // Aceita GET (cron) e POST (manual com lista de contas)
  const isCron = event.httpMethod === "GET";
  const isPost = event.httpMethod === "POST";
  if (!isCron && !isPost)
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  try {
    let accounts = [];

    if (isPost) {
      const body = JSON.parse(event.body || "{}");
      accounts = body.accounts || [];
    } else {
      // Cron: lê contas do Netlify Blobs
      const store = getStore("accounts");
      const raw   = await store.get("list", { type: "json" }).catch(() => null);
      accounts    = raw?.accounts || [];
    }

    if (!accounts.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: "Nenhuma conta para verificar", results: [] }) };
    }

    // Verifica todas as contas (em paralelo, max 5 por vez para não sobrecarregar)
    const results   = [];
    const chunkSize = 5;
    for (let i = 0; i < accounts.length; i += chunkSize) {
      const chunk  = accounts.slice(i, i + chunkSize);
      const checks = await Promise.all(chunk.map(checkAccount));
      results.push(...checks);
    }

    const paused  = results.filter((r) => r.auto_paused);
    const warned  = results.filter((r) => r.status === "warn");
    const expired = results.filter((r) => r.status === "token_expired");

    // Salva resultado no Netlify Blobs para o frontend ler
    try {
      const store = getStore("health-checks");
      await store.setJSON("latest", {
        checked_at:   new Date().toISOString(),
        total:        results.length,
        paused_count: paused.length,
        warn_count:   warned.length,
        expired_count: expired.length,
        results,
        thresholds:   PAUSE_THRESHOLDS,
      });
    } catch (err) {
      console.warn("Falha ao salvar no Blob:", err.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        checked_at:   new Date().toISOString(),
        total:        results.length,
        paused_count: paused.length,
        warn_count:   warned.length,
        expired_count: expired.length,
        results,
        thresholds:   PAUSE_THRESHOLDS,
      }),
    };

  } catch (err) {
    console.error("health-check error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
