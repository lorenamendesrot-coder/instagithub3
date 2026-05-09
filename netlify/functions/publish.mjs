// publish.mjs — publica mídias no Instagram via Graph API
import { getStore } from "@netlify/blobs";

const GRAPH          = "https://graph.facebook.com/v21.0";
const sleep          = (ms) => new Promise((r) => setTimeout(r, ms));
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";

// ─── Rate limit em memória ────────────────────────────────────────────────────
const warmupState = new Map();
function getState(id) {
  if (!warmupState.has(id)) warmupState.set(id, { postsToday:0, postsHour:0, lastPostAt:null, dateKey:"", hourKey:"" });
  const s=warmupState.get(id), now=new Date();
  const dk=now.toISOString().slice(0,10), hk=`${dk}-${now.getUTCHours()}`;
  if (s.dateKey!==dk){s.postsToday=0;s.dateKey=dk;}
  if (s.hourKey!==hk){s.postsHour=0;s.hourKey=hk;}
  return s;
}
const MAX_DAY  = parseInt(process.env.MAX_POSTS_PER_DAY  || "50");
const MAX_HOUR = parseInt(process.env.MAX_POSTS_PER_HOUR || "4");
const MIN_GAP  = parseInt(process.env.MIN_GAP_MINUTES    || "10");
const W_START  = parseInt(process.env.POST_WINDOW_START  || "7");
const W_END    = parseInt(process.env.POST_WINDOW_END    || "23");

function fmtWait(ms) {
  if (ms<=0) return "agora";
  const s=Math.ceil(ms/1000);
  if (s<60) return `${s}s`;
  const m=Math.floor(s/60);
  if (m<60) return `${m}m`;
  const h=Math.floor(m/60), r=m%60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function canPublish(id) {
  const s=getState(id), now=Date.now(), h=new Date(now).getUTCHours();
  if (h<W_START||h>=W_END) {
    const n=new Date(now);
    if (h>=W_END) n.setUTCDate(n.getUTCDate()+1);
    n.setUTCHours(W_START,0,0,0);
    const w=n-now;
    return {ok:false,reason:`Fora da janela (${W_START}h-${W_END}h UTC). Aguardar ${fmtWait(w)}.`,waitMs:w};
  }
  if (s.postsToday>=MAX_DAY) {
    const n=new Date(now);
    n.setUTCDate(n.getUTCDate()+1);
    n.setUTCHours(W_START,0,0,0);
    const w=n-now;
    return {ok:false,reason:`Limite diário (${s.postsToday}/${MAX_DAY}). Aguardar ${fmtWait(w)}.`,waitMs:w};
  }
  if (s.postsHour>=MAX_HOUR) {
    const n=new Date(now);
    n.setUTCMinutes(60,0,0);
    const w=n-now;
    return {ok:false,reason:`Limite/hora (${s.postsHour}/${MAX_HOUR}). Aguardar ${fmtWait(w)}.`,waitMs:w};
  }
  if (s.lastPostAt) {
    const el=now-s.lastPostAt, mg=MIN_GAP*60000;
    if (el<mg) {
      const w=mg-el;
      return {ok:false,reason:`Intervalo mínimo. Aguardar ${fmtWait(w)}.`,waitMs:w};
    }
  }
  return {ok:true};
}
function recordPost(id, ok) {
  const s=getState(id);
  if (ok) { s.postsToday++; s.postsHour++; s.lastPostAt=Date.now(); }
}

function isHttps(url) {
  try { return new URL(url).protocol==="https:"; } catch { return false; }
}

// ─── Token fresco do Blobs ────────────────────────────────────────────────────
async function getFreshToken(accountId) {
  try {
    const siteID = process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_TOKEN;
    if (!siteID || !token) return null;
    const store = getStore({ name: "insta-accounts", siteID, token, consistency: "strong" });
    const acc   = await store.get(`account-${accountId}`, { type: "json" });
    return acc?.access_token || null;
  } catch { return null; }
}

// ─── Verificação de token ─────────────────────────────────────────────────────
async function verifyToken(token) {
  try {
    const r=await fetch(`${GRAPH}/me?fields=id&access_token=${token}`), d=await r.json();
    if (d.error) return {valid:false, expired:d.error.code===190};
    return {valid:true, expired:false};
  } catch { return {valid:true, expired:false}; }
}

// ─── Polling do container de vídeo ───────────────────────────────────────────
async function waitForContainer(id, token, max=5) {
  // Netlify timeout 26s — polling máximo 5×4s = 20s
  for (let i=0; i<max; i++) {
    await sleep(4000);
    try {
      const r=await fetch(`${GRAPH}/${id}?fields=status_code&access_token=${token}`);
      const d=await r.json();
      if (d.status_code==="FINISHED") return {ready:true};
      if (d.status_code==="ERROR")    return {ready:false, error:"Instagram reportou erro no processamento"};
    } catch { /* ignora erros de rede no polling */ }
  }
  return {ready:false, pending:true, creation_id:id};
}

// ─── Publicação por conta ─────────────────────────────────────────────────────
async function publishOne({account, media_url, media_type, post_type, caption}) {
  const igId = account.id;

  const freshToken = await getFreshToken(igId);
  const token      = freshToken || account.access_token;

  if (!token) return {success:false, error:"Token não encontrado. Reconecte a conta.", token_expired:true};

  console.log(`[${account.username}] token: ${freshToken ? "Blobs" : "fallback"}`);

  const isVideo = media_type==="VIDEO";
  const tc = await verifyToken(token);
  if (!tc.valid) return {success:false, error:tc.expired ? "Token expirado. Reconecte a conta." : "Token inválido.", token_expired:tc.expired};

  try {
    let payload = {access_token: token};

    if (post_type==="FEED") {
      payload = isVideo
        ? {...payload, video_url:media_url, media_type:"REELS", caption}
        : {...payload, image_url:media_url, caption};
    } else if (post_type==="REEL") {
      if (!isVideo) return {success:false, error:"Reels só aceita vídeo."};
      payload = {...payload, video_url:media_url, media_type:"REELS", caption, share_to_feed:true};
    } else if (post_type==="STORY") {
      payload = isVideo
        ? {...payload, video_url:media_url, media_type:"VIDEO"}
        : {...payload, image_url:media_url};
    }

    const cRes  = await fetch(`${GRAPH}/${igId}/media`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload)});
    const cData = await cRes.json();
    if (cData.error) return {success:false, error:cData.error.message, errorCode:cData.error.code};

    if (isVideo || post_type==="REEL") {
      const result = await waitForContainer(cData.id, token);
      if (result.pending) return {success:false, pending:true, creation_id:cData.id, error:"Vídeo ainda processando. Será tentado novamente automaticamente."};
      if (!result.ready)  return {success:false, error:result.error || "Erro no processamento do vídeo."};
    }

    const pRes  = await fetch(`${GRAPH}/${igId}/media_publish`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({creation_id:cData.id, access_token:token})});
    const pData = await pRes.json();
    if (pData.error) return {success:false, error:pData.error.message, errorCode:pData.error.code};

    return {success:true, media_id:pData.id, published_at:new Date().toISOString()};
  } catch(err) {
    return {success:false, error:err.message};
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export const handler = async (event) => {
  const reqOrigin  = event.headers?.origin || "";
  const corsOrigin = ALLOWED_ORIGIN && reqOrigin===ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN || "*";
  const headers    = {
    "Access-Control-Allow-Origin":  corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type":                 "application/json",
    ...(corsOrigin!=="*" && {"Vary":"Origin"}),
  };

  if (event.httpMethod==="OPTIONS") return {statusCode:204, headers};
  if (event.httpMethod!=="POST")    return {statusCode:405, headers, body:JSON.stringify({error:"Método não permitido"})};

  let body;
  try { body=JSON.parse(event.body||"{}"); }
  catch { return {statusCode:400, headers, body:JSON.stringify({error:"JSON inválido"})}; }

  const {accounts, media_url, media_type, post_type, captions, default_caption, delay_seconds, skip_rate_limit} = body;

  if (!accounts?.length || !media_url || !media_type || !post_type)
    return {statusCode:400, headers, body:JSON.stringify({error:"Campos obrigatórios ausentes"})};
  if (!["IMAGE","VIDEO"].includes(media_type))
    return {statusCode:400, headers, body:JSON.stringify({error:`media_type inválido: ${media_type}`})};
  if (!["FEED","REEL","STORY"].includes(post_type))
    return {statusCode:400, headers, body:JSON.stringify({error:`post_type inválido: ${post_type}`})};
  if (!isHttps(media_url))
    return {statusCode:400, headers, body:JSON.stringify({error:"media_url deve ser HTTPS válida"})};

  const delayMs = (parseInt(String(delay_seconds)) || 0) * 1000;
  const results = [];

  for (let i=0; i<accounts.length; i++) {
    const account = accounts[i];
    if (i>0 && delayMs>0) await sleep(delayMs);

    if (!skip_rate_limit) {
      const check = canPublish(account.id);
      if (!check.ok) {
        results.push({account_id:account.id, username:account.username, success:false, rate_limited:true, error:check.reason, wait_ms:check.waitMs, wait_human:fmtWait(check.waitMs)});
        continue;
      }
    }

    const caption = captions?.[account.id] ?? default_caption ?? "";
    const result  = await publishOne({account, media_url, media_type, post_type, caption});
    if (!skip_rate_limit) recordPost(account.id, result.success);
    results.push({account_id:account.id, username:account.username, ...result});
  }

  return {statusCode:200, headers, body:JSON.stringify({results})};
};
