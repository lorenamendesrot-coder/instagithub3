// r2-debug.mjs — diagnóstico temporário do R2
// REMOVA este arquivo após resolver o problema!
import https from "https";
import crypto from "crypto";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET     = process.env.R2_BUCKET || "insta-midias";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

function hmac(key, data, encoding) {
  return crypto.createHmac("sha256", key).update(data).digest(encoding || "binary");
}
function sha256hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}
function getAmzDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").slice(0, 16);
}

export const handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  // 1. Checar variáveis
  const vars = {
    R2_ACCOUNT_ID: R2_ACCOUNT_ID ? `✅ (${R2_ACCOUNT_ID.length} chars, starts: ${R2_ACCOUNT_ID.slice(0,6)}...)` : "❌ AUSENTE",
    R2_ACCESS_KEY: R2_ACCESS_KEY ? `✅ (${R2_ACCESS_KEY.length} chars)` : "❌ AUSENTE",
    R2_SECRET_KEY: R2_SECRET_KEY ? `✅ (${R2_SECRET_KEY.length} chars)` : "❌ AUSENTE",
    R2_BUCKET:     R2_BUCKET     ? `✅ ${R2_BUCKET}` : "❌ AUSENTE",
    R2_PUBLIC_URL: R2_PUBLIC_URL ? `✅ ${R2_PUBLIC_URL}` : "❌ AUSENTE",
  };

  // 2. Testar DNS do endpoint
  const endpoint = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  let dnsOk = false;
  try {
    await new Promise((res, rej) => {
      const req = https.request({ hostname: endpoint, path: "/", method: "GET", timeout: 5000 }, (r) => {
        res(r.statusCode);
      });
      req.on("error", rej);
      req.on("timeout", () => rej(new Error("timeout")));
      req.end();
    });
    dnsOk = true;
  } catch(e) {
    dnsOk = `❌ ${e.message}`;
  }

  // 3. Testar upload de 1 byte para verificar autenticação
  let uploadTest = "não testado";
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY) {
    try {
      const now = new Date();
      const amzDate   = getAmzDate(now);
      const dateStamp = amzDate.slice(0, 8);
      const testBuffer = Buffer.from("test");
      const bodyHash = sha256hex(testBuffer);
      const key = `_debug-test-${Date.now()}.txt`;

      const canonicalHeaders =
        `content-type:text/plain\n` +
        `host:${endpoint}\n` +
        `x-amz-content-sha256:${bodyHash}\n` +
        `x-amz-date:${amzDate}\n`;
      const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
      const canonicalRequest = ["PUT", `/${R2_BUCKET}/${key}`, "", canonicalHeaders, signedHeaders, bodyHash].join("\n");
      const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
      const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256hex(canonicalRequest)].join("\n");
      const kDate    = hmac("AWS4" + R2_SECRET_KEY, dateStamp);
      const kRegion  = hmac(kDate, "auto");
      const kService = hmac(kRegion, "s3");
      const kSigning = hmac(kService, "aws4_request");
      const signature = hmac(kSigning, stringToSign, "hex");
      const authorization = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: endpoint,
          path: `/${R2_BUCKET}/${key}`,
          method: "PUT",
          timeout: 7000,
          headers: {
            "Content-Type": "text/plain",
            "Content-Length": testBuffer.length,
            "x-amz-date": amzDate,
            "x-amz-content-sha256": bodyHash,
            "Authorization": authorization,
          },
        }, (res) => {
          const chunks = [];
          res.on("data", d => chunks.push(d));
          res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString().slice(0, 500) }));
        });
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout 7s")); });
        req.on("error", reject);
        req.write(testBuffer);
        req.end();
      });

      if (result.status === 200) {
        uploadTest = `✅ Upload OK! URL: ${R2_PUBLIC_URL}/${key}`;
      } else {
        uploadTest = `❌ HTTP ${result.status}: ${result.body}`;
      }
    } catch(e) {
      uploadTest = `❌ Exceção: ${e.message}`;
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ vars, endpoint, dnsOk, uploadTest, amzDateSample: getAmzDate(new Date()) }, null, 2),
  };
};
