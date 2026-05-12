// filegarden-proxy.mjs — faz upload para filegarden.com e retorna a URL pública
// FilGarden não tem CORS, então precisa de proxy server-side

export const handler = async (event) => {
  const HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: "Método não permitido" }) };

  let parsed;
  try { parsed = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "JSON inválido" }) }; }

  const { fileBase64, fileName, mimeType } = parsed;

  if (!fileBase64 || !fileName || !mimeType)
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: "Campos obrigatórios: fileBase64, fileName, mimeType" }) };

  const ALLOWED_MIME = ["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/quicktime","video/webm"];
  if (!ALLOWED_MIME.includes(mimeType))
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: `Tipo não permitido: ${mimeType}` }) };

  try {
    const fileBuffer = Buffer.from(fileBase64, "base64");
    console.log(`[filegarden] Upload: ${fileName} | ${mimeType} | ${(fileBuffer.length / 1048576).toFixed(2)}MB`);

    // Monta o form-data manualmente
    const boundary = `----FormBoundary${Date.now().toString(16)}`;
    const CRLF     = "\r\n";

    const header = Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}` +
      `Content-Type: ${mimeType}${CRLF}${CRLF}`
    );
    const footer = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
    const body   = Buffer.concat([header, fileBuffer, footer]);

    const res = await fetch("https://filegarden.com/upload", {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length.toString(),
        "User-Agent": "Mozilla/5.0 (compatible; InstaManager/1.0)",
        "Accept": "application/json, text/html, */*",
        "Origin": "https://filegarden.com",
        "Referer": "https://filegarden.com/",
      },
      body,
    });

    const text = await res.text();
    console.log(`[filegarden] Response ${res.status}:`, text.slice(0, 300));

    // FilGarden retorna JSON com "url" ou HTML com a URL
    let url = null;
    try {
      const json = JSON.parse(text);
      url = json.url || json.link || json.file_url || json.data?.url;
    } catch {
      // Tenta extrair URL do HTML
      const match = text.match(/https:\/\/filegarden\.com\/[^\s"'<>]+/);
      if (match) url = match[0];
    }

    if (!url) {
      console.error("[filegarden] URL não encontrada na resposta:", text.slice(0, 500));
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: "FilGarden não retornou URL válida" }) };
    }

    console.log("[filegarden] URL:", url);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ url }) };

  } catch (err) {
    console.error("[filegarden] Erro:", err.message);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
