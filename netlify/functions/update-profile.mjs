// update-profile.mjs — Atualiza bio, website e foto de perfil via Meta Graph API
const GRAPH = "https://graph.facebook.com/v21.0";

export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido" }) };

  try {
    const { instagram_id, access_token, biography, website, profile_picture_url } = JSON.parse(event.body || "{}");

    if (!instagram_id || !access_token)
      return { statusCode: 400, headers, body: JSON.stringify({ error: "instagram_id e access_token são obrigatórios" }) };

    const fields = {};
    if (biography   !== undefined) fields.biography = biography;
    if (website     !== undefined) fields.website   = website;
    if (profile_picture_url)       fields.profile_picture_url = profile_picture_url;

    if (Object.keys(fields).length === 0)
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Nenhum campo para atualizar" }) };

    const params = new URLSearchParams({ ...fields, access_token });

    const res  = await fetch(`${GRAPH}/${instagram_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await res.json();
    console.log("update-profile response:", JSON.stringify(data));

    if (data.error) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: data.error.message }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };

  } catch (err) {
    console.error("update-profile error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
