// r2-presign.mjs — gera presigned URL para upload direto do browser ao R2
// O browser faz PUT direto no R2, sem passar pelo body da Netlify Function
import crypto from "crypto";

const R2_ACCOUNT_ID  = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY  = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY  = process.env.R2_SECRET_KEY;
const R2_BUCKET      = process.env.R2_BUCKET || "insta-midias";
const R2_PUBLIC_URL  = process.env.R2_PUBLIC_URL;
const R2_ENDPOINT    = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}
function sha256hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
function getAmzDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").slice(0, 16);
}
function getSigningKey(secretKey, dateStamp, region, service) {
  return hmac(hmac(hmac(hmac("AWS4" + secretKey, dateStamp), region), service), "aws4_request");
}

const ALLOWED_MIME = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/quicktime", "video/webm",
];

export const handler = async (event) => {
  const requestOrigin = event.headers?.origin || "";
  const corsOrigin =
    ALLOWED_ORIGIN && requestOrigin === ALLOWED_ORIGIN
      ? ALLOWED_ORIGIN
      : ALLOWED_ORIGIN || "*";

  const headers = {
    "Access-Control-Allow-Origin":  corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type":                 "application/json",
    ...(corsOrigin !== "*" && { Vary: "Origin" }),
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  const missing = [
    !R2_ACCOUNT_ID && "R2_ACCOUNT_ID",
    !R2_ACCESS_KEY && "R2_ACCESS_KEY",
    !R2_SECRET_KEY && "R2_SECRET_KEY",
    !R2_PUBLIC_URL && "R2_PUBLIC_URL",
  ].filter(Boolean);

  if (missing.length)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: `Variáveis ausentes: ${missing.join(", ")}` }),
    };

  let parsed;
  try { parsed = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const { fileName, mimeType } = parsed;

  if (!fileName || !mimeType)
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Campos obrigatórios: fileName, mimeType" }) };

  if (!ALLOWED_MIME.includes(mimeType))
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Tipo não permitido: ${mimeType}` }) };

  // Gerar chave única para o objeto
  const now       = new Date();
  const amzDate   = getAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const ext       = fileName.split(".").pop().toLowerCase();
  const key       = `${dateStamp}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  // Presigned URL válida por 15 minutos
  const EXPIRES_SECONDS = 900;
  const region   = "auto";
  const service  = "s3";
  const host     = R2_ENDPOINT;

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const credential      = `${R2_ACCESS_KEY}/${credentialScope}`;

  // Query string em ordem lexicográfica (obrigatório AWS4)
  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm":     "AWS4-HMAC-SHA256",
    "X-Amz-Credential":    credential,
    "X-Amz-Date":          amzDate,
    "X-Amz-Expires":       String(EXPIRES_SECONDS),
    "X-Amz-SignedHeaders": "content-type;host",
  });
  // URLSearchParams já ordena — mas AWS4 exige ordem lexicográfica exata
  const sortedQuery = Array.from(queryParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const canonicalHeaders  = `content-type:${mimeType}\nhost:${host}\n`;
  const signedHeaders     = "content-type;host";
  const canonicalRequest  = [
    "PUT",
    `/${R2_BUCKET}/${key}`,
    sortedQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",   // presigned URLs usam UNSIGNED-PAYLOAD
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const signingKey  = getSigningKey(R2_SECRET_KEY, dateStamp, region, service);
  const signature   = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const presignedUrl =
    `https://${host}/${R2_BUCKET}/${key}?${sortedQuery}&X-Amz-Signature=${signature}`;

  const publicUrl = `${R2_PUBLIC_URL}/${key}`;

  console.log(`Presigned URL gerada para: ${key} | ${mimeType}`);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ presignedUrl, publicUrl, key, expiresIn: EXPIRES_SECONDS }),
  };
};
