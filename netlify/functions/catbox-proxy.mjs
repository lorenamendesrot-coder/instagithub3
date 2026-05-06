// catbox-proxy.mjs — usa Cloudflare R2 como CDN de mídia
import https from "https";
import crypto from "crypto";

// ✅ SEGURANÇA: credenciais carregadas de variáveis de ambiente (nunca em código-fonte)
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET     = process.env.R2_BUCKET     || "insta-midias";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;
const R2_ENDPOINT   = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// ✅ CORS restrito ao domínio próprio (configurado via env var no Netlify)
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || process.env.URL || "";

function hmac(key, data, encoding) {
  return crypto.createHmac("sha256", key).update(data).digest(encoding);
}

function hash(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function getSignatureKey(secretKey, dateStamp, region, service) {
  const kDate    = hmac("AWS4" + secretKey, dateStamp);
  const kRegion  = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  return kSigning;
}

async function uploadToR2(fileBuffer, fileName, mimeType) {
  const now       = new Date();
  const amzDate   = now.toISOString().replace(/[:-]|\\.\\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const region    = "auto";
  const service   = "s3";

  const ext      = fileName.split(".").pop();
  const key      = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const bodyHash = hash(fileBuffer);

  const canonicalHeaders =
    `content-type:${mimeType}\n` +
    `host:${R2_ENDPOINT}\n` +
    `x-amz-content-sha256:${bodyHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    `/${R2_BUCKET}/${key}`,
    "",
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hash(canonicalRequest),
  ].join("\n");

  const signingKey = getSignatureKey(R2_SECRET_KEY, dateStamp, region, service);
  const signature  = hmac(signingKey, stringToSign, "hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: R2_ENDPOINT,
      path: `/${R2_BUCKET}/${key}`,
      method: "PUT",
      timeout: 60000,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": fileBuffer.length,
        "x-amz-date": amzDate,
        "x-amz-content-sha256": bodyHash,
        "Authorization": authorization,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        console.log("R2 status:", res.statusCode, Buffer.concat(chunks).toString().slice(0, 200));
        if (res.statusCode === 200) {
          resolve(`${R2_PUBLIC_URL}/${key}`);
        } else {
          reject(new Error(`R2 erro ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}`));
        }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout R2 (60s)")); });
    req.on("error", (err) => reject(new Error(`Erro de rede: ${err.message}`)));
    req.write(fileBuffer);
    req.end();
  });
}

export const handler = async (event) => {
  // ✅ CORS restrito — só aceita origem autorizada
  const requestOrigin = event.headers?.origin || "";
  const corsOrigin = ALLOWED_ORIGIN && requestOrigin === ALLOWED_ORIGIN
    ? ALLOWED_ORIGIN
    : ALLOWED_ORIGIN || "*";

  const headers = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    ...(corsOrigin !== "*" && { "Vary": "Origin" }),
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  // ✅ Verificar variáveis de ambiente obrigatórias antes de prosseguir
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_PUBLIC_URL) {
    console.error("Variáveis de ambiente R2 não configuradas");
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Configuração do servidor incompleta. Configure R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY e R2_PUBLIC_URL no painel do Netlify." }),
    };
  }

  try {
    const { fileBase64, fileName, mimeType } = JSON.parse(event.body || "{}");

    if (!fileBase64 || !fileName || !mimeType)
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Campos obrigatórios ausentes" }) };

    // ✅ Validar mimeType permitido (whitelist)
    const ALLOWED_MIME = [
      "image/jpeg", "image/png", "image/webp", "image/gif",
      "video/mp4", "video/quicktime", "video/webm",
    ];
    if (!ALLOWED_MIME.includes(mimeType)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Tipo de mídia não permitido: ${mimeType}` }) };
    }

    const fileBuffer = Buffer.from(fileBase64, "base64");
    console.log("Enviando para R2:", fileName, mimeType, fileBuffer.length, "bytes");

    const url = await uploadToR2(fileBuffer, fileName, mimeType);
    console.log("URL gerada:", url);

    return { statusCode: 200, headers, body: JSON.stringify({ url }) };

  } catch (err) {
    console.error("Erro:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
