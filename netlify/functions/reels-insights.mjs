// reels-insights.mjs — Busca insights de engajamento dos Reels por conta
// Endpoint: GET /.netlify/functions/reels-insights?ig_id=xxx&token=yyy&date=YYYY-MM-DD
//
// Fluxo:
//   1. Busca os reels do perfil (até 50 mais recentes)
//   2. Filtra pelos postados na data solicitada (ou hoje)
//   3. Para cada reel, busca métricas individuais: plays, reach, likes, comments, shares, saved
//   4. Retorna lista ordenada por engajamento total

const GRAPH = "https://graph.facebook.com/v21.0";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";

async function gfetch(url, timeoutMs = 10000) {
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

// Busca métricas individuais de um reel
async function fetchReelInsights(mediaId, token) {
  const metrics = ["plays", "reach", "likes", "comments", "shares", "saved", "total_interactions", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"];
  const url = `${GRAPH}/${mediaId}/insights?metric=${metrics.join(",")}&access_token=${token}`;
  const data = await gfetch(url);

  if (data.error || !data.data) {
    // Fallback com métricas básicas
    const fallback = await gfetch(
      `${GRAPH}/${mediaId}/insights?metric=plays,reach,likes,comments,shares,saved&access_token=${token}`
    );
    if (fallback.error || !fallback.data) {
      return { error: fallback.error?.message || data.error?.message };
    }
    return parseMetrics(fallback.data);
  }

  return parseMetrics(data.data);
}

function parseMetrics(metricsList) {
  const find = (name) => metricsList.find((m) => m.name === name);
  const val = (name) => {
    const m = find(name);
    if (!m) return null;
    // Pode ser value direto ou values[0].value
    if (m.values && m.values.length > 0) return Number(m.values[0].value) || 0;
    return Number(m.value) || 0;
  };

  const plays    = val("plays");
  const reach    = val("reach");
  const likes    = val("likes");
  const comments = val("comments");
  const shares   = val("shares");
  const saved    = val("saved");
  const total    = val("total_interactions");
  const avgWatch = val("ig_reels_avg_watch_time");
  const totalViewTime = val("ig_reels_video_view_total_time");

  // Engajamento calculado se total_interactions não disponível
  const engagement = total !== null ? total : (
    (likes || 0) + (comments || 0) + (shares || 0) + (saved || 0)
  );

  return { plays, reach, likes, comments, shares, saved, engagement, avgWatch, totalViewTime };
}

// Converte timestamp para data local YYYY-MM-DD
function tsToDate(ts) {
  const d = new Date(ts * 1000);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req) {
  const origin = req.headers.get("origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN || origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url    = new URL(req.url);
  const ig_id  = url.searchParams.get("ig_id");
  const token  = url.searchParams.get("token");
  const date   = url.searchParams.get("date"); // YYYY-MM-DD ou null = hoje
  const limit  = parseInt(url.searchParams.get("limit") || "50", 10);

  if (!ig_id || !token) {
    return new Response(JSON.stringify({ error: "ig_id e token são obrigatórios" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // 1. Busca mídia do perfil (reels)
    const mediaUrl = `${GRAPH}/${ig_id}/media` +
      `?fields=id,media_type,media_product_type,timestamp,thumbnail_url,permalink,caption` +
      `&limit=${limit}` +
      `&access_token=${token}`;

    const mediaData = await gfetch(mediaUrl);

    if (mediaData.error) {
      return new Response(JSON.stringify({ error: mediaData.error.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allMedia = mediaData.data || [];

    // 2. Filtra apenas Reels pela data solicitada
    const targetDate = date || new Date().toISOString().slice(0, 10);

    const reels = allMedia.filter((m) => {
      const isReel = m.media_product_type === "REELS" || m.media_type === "VIDEO";
      if (!isReel) return false;
      const postDate = m.timestamp ? m.timestamp.slice(0, 10) : "";
      return postDate === targetDate;
    });

    if (reels.length === 0) {
      return new Response(JSON.stringify({ reels: [], date: targetDate, total: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Busca insights de cada reel em paralelo
    const reelsWithInsights = await Promise.all(
      reels.map(async (reel) => {
        const insights = await fetchReelInsights(reel.id, token);
        return {
          id: reel.id,
          timestamp: reel.timestamp,
          permalink: reel.permalink,
          thumbnail_url: reel.thumbnail_url || null,
          caption: reel.caption || "",
          insights,
        };
      })
    );

    // 4. Ordena por engajamento decrescente
    reelsWithInsights.sort((a, b) =>
      (b.insights?.engagement || 0) - (a.insights?.engagement || 0)
    );

    return new Response(
      JSON.stringify({ reels: reelsWithInsights, date: targetDate, total: reelsWithInsights.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[reels-insights] Erro:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
