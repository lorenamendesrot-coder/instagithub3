// publish.mjs — sanitiza metadados por conta antes de publicar
import https from "https";
import http  from "http";
import crypto from "crypto";
import { sanitizeMedia, detectMime } from "./sanitize-media.mjs";

const GRAPH = "https://graph.facebook.com/v21.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";

// ─── R2 config ────────────────────────────────────────────────────────────────
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET     = process.env.R2_BUCKET     || "insta-midias";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;
const R2_ENDPOINT   = R2_ACCOUNT_ID ? `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null;

function hmac(key, data, enc) { return crypto.createHmac("sha256", key).update(data).digest(enc); }
function hash(data)            { return crypto.createHash("sha256").update(data).digest("hex"); }
function getSignKey(secret, date, region, service) {
  return hmac(hmac(hmac(hmac("AWS4"+secret, date), region), service), "aws4_request");
}

// ─── Download de URL ──────────────────────────────────────────────────────────
function downloadUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`Download falhou: ${res.statusCode}`));
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ buf: Buffer.concat(chunks), contentType: res.headers["content-type"] || "" }));
    }).on("error", reject).on("timeout", () => reject(new Error("Timeout no download")));
  });
}

// ─── Upload para R2 ───────────────────────────────────────────────────────────
function uploadToR2(buf, mimeType, ext) {
  return new Promise((resolve, reject) => {
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_PUBLIC_URL)
      return reject(new Error("R2 não configurado"));
    const now       = new Date();
    const amzDate   = now.toISOString().replace(/[:-]|\.\d{3}/g,"").slice(0,15)+"Z";
    const dateStamp = amzDate.slice(0,8);
    const key       = `pub/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
    const bodyHash  = hash(buf);
    const canonHeaders =
      `content-type:${mimeType}\nhost:${R2_ENDPOINT}\n` +
      `x-amz-content-sha256:${bodyHash}\nx-amz-date:${amzDate}\n`;
    const signed = "content-type;host;x-amz-content-sha256;x-amz-date";
    const canon  = ["PUT",`/${R2_BUCKET}/${key}`,"",canonHeaders,signed,bodyHash].join("\n");
    const scope  = `${dateStamp}/auto/s3/aws4_request`;
    const sts    = ["AWS4-HMAC-SHA256",amzDate,scope,hash(canon)].join("\n");
    const sig    = hmac(getSignKey(R2_SECRET_KEY,dateStamp,"auto","s3"), sts, "hex");
    const auth   = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${scope}, SignedHeaders=${signed}, Signature=${sig}`;
    const req = https.request({
      hostname: R2_ENDPOINT, path: `/${R2_BUCKET}/${key}`, method: "PUT", timeout: 60000,
      headers: { "Content-Type": mimeType, "Content-Length": buf.length,
        "x-amz-date": amzDate, "x-amz-content-sha256": bodyHash, "Authorization": auth },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode === 200) resolve(`${R2_PUBLIC_URL}/${key}`);
        else reject(new Error(`R2 upload erro ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0,200)}`));
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout R2")); });
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

// ─── Sanitiza + re-upload por conta ──────────────────────────────────────────
const mediaCache = new Map(); // cache do download original por URL (evita baixar N vezes)

async function getUniqueMediaUrl(originalUrl, mimeTypeHint) {
  // Baixa o original (com cache)
  let original = mediaCache.get(originalUrl);
  if (!original) {
    const { buf, contentType } = await downloadUrl(originalUrl);
    const mime = mimeTypeHint || contentType.split(";")[0].trim() || detectMime(buf) || "application/octet-stream";
    original = { buf, mime };
    mediaCache.set(originalUrl, original);
    // Limpa cache após 5 min para não acumular memória
    setTimeout(() => mediaCache.delete(originalUrl), 5 * 60 * 1000);
  }
  const { buf, mime } = original;
  // Sanitiza — gera versão única (bytes aleatórios diferentes a cada chamada)
  const sanitized = sanitizeMedia(buf, mime);
  // Determina extensão
  const extMap = {
    "image/jpeg":"jpg","image/jpg":"jpg","image/png":"png","image/webp":"webp",
    "video/mp4":"mp4","video/quicktime":"mov","video/webm":"webm",
  };
  const ext = extMap[mime] || mime.split("/")[1] || "bin";
  // Faz upload pro R2
  const url = await uploadToR2(sanitized, mime, ext);
  return url;
}

// ─── Rate limit em memória ───────────────────────────────────────────────────
const warmupState = new Map();
function getState(id) {
  if (!warmupState.has(id)) warmupState.set(id, { postsToday:0, postsHour:0, lastPostAt:null, dateKey:"", hourKey:"" });
  const s=warmupState.get(id), now=new Date();
  const dk=now.toISOString().slice(0,10), hk=`${dk}-${now.getUTCHours()}`;
  if (s.dateKey!==dk){s.postsToday=0;s.dateKey=dk;}
  if (s.hourKey!==hk){s.postsHour=0;s.hourKey=hk;}
  return s;
}
const MAX_DAY =parseInt(process.env.MAX_POSTS_PER_DAY||"50");
const MAX_HOUR=parseInt(process.env.MAX_POSTS_PER_HOUR||"4");
const MIN_GAP =parseInt(process.env.MIN_GAP_MINUTES||"10");
const W_START =parseInt(process.env.POST_WINDOW_START||"7");
const W_END   =parseInt(process.env.POST_WINDOW_END||"23");

function fmtWait(ms){if(ms<=0)return"agora";const s=Math.ceil(ms/1000);if(s<60)return`${s}s`;const m=Math.floor(s/60);if(m<60)return`${m}m`;const h=Math.floor(m/60),r=m%60;return r?`${h}h ${r}m`:`${h}h`;}

function canPublish(id){
  const s=getState(id),now=Date.now(),h=new Date(now).getUTCHours();
  if(h<W_START||h>=W_END){const n=new Date(now);if(h>=W_END)n.setUTCDate(n.getUTCDate()+1);n.setUTCHours(W_START,0,0,0);const w=n-now;return{ok:false,reason:`Fora da janela (${W_START}h-${W_END}h UTC). Aguardar ${fmtWait(w)}.`,waitMs:w};}
  if(s.postsToday>=MAX_DAY){const n=new Date(now);n.setUTCDate(n.getUTCDate()+1);n.setUTCHours(W_START,0,0,0);const w=n-now;return{ok:false,reason:`Limite diário (${s.postsToday}/${MAX_DAY}). Aguardar ${fmtWait(w)}.`,waitMs:w};}
  if(s.postsHour>=MAX_HOUR){const n=new Date(now);n.setUTCMinutes(60,0,0);const w=n-now;return{ok:false,reason:`Limite/hora (${s.postsHour}/${MAX_HOUR}). Aguardar ${fmtWait(w)}.`,waitMs:w};}
  if(s.lastPostAt){const el=now-s.lastPostAt,mg=MIN_GAP*60000;if(el<mg){const w=mg-el;return{ok:false,reason:`Intervalo mínimo. Aguardar ${fmtWait(w)}.`,waitMs:w};}}
  return{ok:true};
}
function recordPost(id,ok){const s=getState(id);if(ok){s.postsToday++;s.postsHour++;s.lastPostAt=Date.now();}}

function isHttps(url){try{return new URL(url).protocol==="https:";}catch{return false;}}

async function verifyToken(token){
  try{const r=await fetch(`${GRAPH}/me?fields=id&access_token=${token}`),d=await r.json();
    if(d.error)return{valid:false,expired:d.error.code===190};return{valid:true,expired:false};}
  catch{return{valid:true,expired:false};}
}

async function waitForContainer(id,token,max=20){
  for(let i=0;i<max;i++){
    await sleep(6000);
    const r=await fetch(`${GRAPH}/${id}?fields=status_code&access_token=${token}`),d=await r.json();
    if(d.status_code==="FINISHED")return true;
    if(d.status_code==="ERROR")return false;
  }
  return false;
}

async function publishOne({account, media_url, media_type, post_type, caption, unique_media_url}){
  const{id:igId,access_token:token}=account;
  const isVideo=media_type==="VIDEO";
  const tc=await verifyToken(token);
  if(!tc.valid)return{success:false,error:tc.expired?"Token expirado. Reconecte a conta.":"Token inválido.",token_expired:tc.expired};
  try{
    // Usa a URL única já gerada para esta conta
    const url = unique_media_url || media_url;
    let payload={access_token:token};
    if(post_type==="FEED"){
      payload=isVideo?{...payload,video_url:url,media_type:"REELS",caption}:{...payload,image_url:url,caption};
    }else if(post_type==="REEL"){
      if(!isVideo)return{success:false,error:"Reels só aceita vídeo."};
      payload={...payload,video_url:url,media_type:"REELS",caption,share_to_feed:true};
    }else if(post_type==="STORY"){
      payload=isVideo?{...payload,video_url:url,media_type:"VIDEO"}:{...payload,image_url:url};
    }
    const cRes=await fetch(`${GRAPH}/${igId}/media`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const cData=await cRes.json();
    if(cData.error)return{success:false,error:cData.error.message,errorCode:cData.error.code};
    if(isVideo||post_type==="REEL"){const ready=await waitForContainer(cData.id,token);if(!ready)return{success:false,error:"Timeout no processamento do vídeo (120s)."};    }
    const pRes=await fetch(`${GRAPH}/${igId}/media_publish`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({creation_id:cData.id,access_token:token})});
    const pData=await pRes.json();
    if(pData.error)return{success:false,error:pData.error.message,errorCode:pData.error.code};
    return{success:true,media_id:pData.id,published_at:new Date().toISOString()};
  }catch(err){return{success:false,error:err.message};}
}

export const handler = async (event) => {
  const reqOrigin=event.headers?.origin||"";
  const corsOrigin=ALLOWED_ORIGIN&&reqOrigin===ALLOWED_ORIGIN?ALLOWED_ORIGIN:ALLOWED_ORIGIN||"*";
  const headers={"Access-Control-Allow-Origin":corsOrigin,"Access-Control-Allow-Headers":"Content-Type","Content-Type":"application/json",...(corsOrigin!=="*"&&{"Vary":"Origin"})};

  if(event.httpMethod==="OPTIONS")return{statusCode:204,headers};
  if(event.httpMethod!=="POST")return{statusCode:405,headers,body:JSON.stringify({error:"Método não permitido"})};

  let body;
  try{body=JSON.parse(event.body||"{}");}catch{return{statusCode:400,headers,body:JSON.stringify({error:"JSON inválido"})};}

  const{accounts,media_url,media_type,post_type,captions,default_caption,delay_seconds,skip_rate_limit}=body;
  if(!accounts?.length||!media_url||!media_type||!post_type)
    return{statusCode:400,headers,body:JSON.stringify({error:"Campos obrigatórios ausentes"})};
  if(!["IMAGE","VIDEO"].includes(media_type))
    return{statusCode:400,headers,body:JSON.stringify({error:`media_type inválido: ${media_type}`})};
  if(!["FEED","REEL","STORY"].includes(post_type))
    return{statusCode:400,headers,body:JSON.stringify({error:`post_type inválido: ${post_type}`})};
  if(!isHttps(media_url))
    return{statusCode:400,headers,body:JSON.stringify({error:"media_url deve ser HTTPS válida"})};

  const delayMs=(parseInt(String(delay_seconds))||0)*1000;
  const results=[];

  // Determina mimeType pelo post_type/media_type
  const mimeHint = media_type==="VIDEO" ? "video/mp4" : "image/jpeg";

  for(let i=0;i<accounts.length;i++){
    const account=accounts[i];
    if(i>0&&delayMs>0)await sleep(delayMs);

    if(!skip_rate_limit){
      const check=canPublish(account.id);
      if(!check.ok){results.push({account_id:account.id,username:account.username,success:false,rate_limited:true,error:check.reason,wait_ms:check.waitMs,wait_human:fmtWait(check.waitMs)});continue;}
    }

    // Gera versão única da mídia para esta conta (sanitiza metadados)
    let unique_media_url = media_url;
    try {
      unique_media_url = await getUniqueMediaUrl(media_url, mimeHint);
      console.log(`[${account.username}] URL única gerada: ${unique_media_url}`);
    } catch(err) {
      console.warn(`[${account.username}] Sanitização falhou, usando original: ${err.message}`);
    }

    const caption=captions?.[account.id]??default_caption??"";
    const result=await publishOne({account,media_url,media_type,post_type,caption,unique_media_url});
    if(!skip_rate_limit)recordPost(account.id,result.success);
    results.push({account_id:account.id,username:account.username,...result});
  }

  return{statusCode:200,headers,body:JSON.stringify({results})};
};
