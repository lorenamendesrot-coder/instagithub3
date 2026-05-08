// catbox-proxy.mjs — upload para Cloudflare R2 via AWS4 Signature
import https from "https";
import crypto from "crypto";

const R2_ACCOUNT_ID  = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY  = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY  = process.env.R2_SECRET_KEY;
const R2_BUCKET      = process.env.R2_BUCKET || "insta-midias";
const R2_PUBLIC_URL  = process.env.R2_PUBLIC_URL;
const R2_ENDPOINT    = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";

// ─── Assinatura AWS4 ──────────────────────────────────────────────────────────

// CORREÇÃO CRÍTICA: sempre retornar Buffer, nunca string 'binary'
// digest('binary') retorna Latin-1 string — quando usada como key no próximo hmac,
// o Node a interpreta como UTF-8, corrompendo toda a cadeia de assinatura
function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest(); // Buffer
}

function hmacHex(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest("hex");
}

function sha256hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate    = hmac("AWS4" + secretKey, dateStamp); // string → Buffer
  const kRegion  = hmac(kDate, region);                 // Buffer → Buffer
  const kService = hmac(kRegion, service);              // Buffer → Buffer
  const kSigning = hmac(kService, "aws4_request");      // Buffer → Buffer
  return kSigning;
}

function getAmzDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").slice(0, 16);
}

// ─── Upload R2 ────────────────────────────────────────────────────────────────

async function uploadToR2(fileBuffer, fileName, mimeType) {
  const now       = new Date();
  const amzDate   = getAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);

  const ext = fileName.split(".").pop().toLowerCase();
  const key = `${dateStamp}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const bodyHash = sha256hex(fileBuffer);

  // Cabeçalhos em ordem lexicográfica (obrigatório AWS4)
  const canonicalHeaders =
    `content-type:${mimeType}\n` +
    `host:${R2_ENDPOINT}\n` +
    `x-amz-content-sha256:${bodyHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders    = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["PUT", `/${R2_BUCKET}/${key}`, "", canonicalHeaders, signedHeaders, bodyHash].join("\n");
  const credentialScope  = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign     = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256hex(canonicalRequest)].join("\n");

  const signingKey  = getSigningKey(R2_SECRET_KEY, dateStamp, "auto", "s3");
  const signature   = hmacHex(signingKey, stringToSign); // Buffer key → hex string

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const TIMEOUT_MS = 8000;

    const req = https.request(
      {
        hostname: R2_ENDPOINT,
        path: `/${R2_BUCKET}/${key}`,
        method: "PUT",
        timeout: TIMEOUT_MS,
        headers: {
          "Content-Type":         mimeType,
          "Content-Length":       fileBuffer.length,
          "x-amz-date":           amzDate,
          "x-amz-content-sha256": bodyHash,
          "Authorization":        authorization,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          console.log(`R2 response: ${res.statusCode}`, body.slice(0, 300));
          if (res.statusCode === 200) {
            resolve(`${R2_PUBLIC_URL}/${key}`);
          } else {
            const msg  = body.match(/<Message>(.+?)<\/Message>/)?.[1];
            const code = body.match(/<Code>(.+?)<\/Code>/)?.[1];
            reject(new Error(`R2 ${res.statusCode} ${code || ""}: ${msg || body.slice(0, 200)}`));
          }
        });
      }
    );

    req.on("timeout", () => { req.destroy(); reject(new Error(`Timeout: R2 não respondeu em ${TIMEOUT_MS / 1000}s`)); });
    req.on("error",   (err) => reject(new Error(`Erro de rede: ${err.message}`)));
    req.write(fileBuffer);
    req.end();
  });
}

// ─── Handler Netlify ──────────────────────────────────────────────────────────

export const handler = async (event) => {
  const requestOrigin = event.headers?.origin || "";
  const corsOrigin    = ALLOWED_ORIGIN && requestOrigin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN || "*";

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
    return { statusCode: 500, headers, body: JSON.stringify({ error: `Variáveis ausentes: ${missing.join(", ")}` }) };

  let parsed;
  try { parsed = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const { fileBase64, fileName, mimeType } = parsed;

  if (!fileBase64 || !fileName || !mimeType)
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Campos obrigatórios: fileBase64, fileName, mimeType" }) };

  const ALLOWED_MIME = ["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/quicktime","video/webm"];
  if (!ALLOWED_MIME.includes(mimeType))
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Tipo não permitido: ${mimeType}` }) };

  if (fileBase64.length > 8 * 1024 * 1024)
    return { statusCode: 413, headers, body: JSON.stringify({ error: `Arquivo muito grande. Máximo ~6MB.` }) };

  const fileBuffer = Buffer.from(fileBase64, "base64");
  console.log(`Upload: ${fileName} | ${mimeType} | ${(fileBuffer.length / 1048576).toFixed(2)}MB`);

  try {
    const url = await uploadToR2(fileBuffer, fileName, mimeType);
    console.log("Concluído:", url);
    return { statusCode: 200, headers, body: JSON.stringify({ url }) };
  } catch (err) {
    console.error("Erro:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
