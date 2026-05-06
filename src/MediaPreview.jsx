import { useEffect, useState, useRef } from "react";

// Detecta tipo de mídia e valida URL antes de publicar
export default function MediaPreview({ url, mediaType, onTypeDetected, onValidated }) {
  const [status, setStatus] = useState("idle"); // idle | loading | valid | error
  const [errorMsg, setErrorMsg] = useState("");
  const [naturalSize, setNaturalSize] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!url) { setStatus("idle"); setErrorMsg(""); setNaturalSize(null); return; }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setStatus("loading");
      setErrorMsg("");

      // Detectar tipo pela extensão da URL
      const ext = url.split("?")[0].split(".").pop().toLowerCase();
      const videoExts = ["mp4", "mov", "avi", "mkv", "webm"];
      const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "heic"];

      if (videoExts.includes(ext)) {
        onTypeDetected?.("VIDEO");
        // Tentar carregar vídeo para validar
        const vid = document.createElement("video");
        vid.onloadedmetadata = () => {
          setStatus("valid");
          setNaturalSize({ w: vid.videoWidth, h: vid.videoHeight });
          onValidated?.(true);
        };
        vid.onerror = () => {
          setStatus("error");
          setErrorMsg("Não foi possível carregar o vídeo. Verifique se a URL é pública e acessível.");
          onValidated?.(false);
        };
        vid.src = url;
      } else {
        if (imageExts.includes(ext)) onTypeDetected?.("IMAGE");
        // Tentar carregar imagem
        const img = new Image();
        img.onload = () => {
          setStatus("valid");
          setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
          onTypeDetected?.("IMAGE");
          onValidated?.(true);
        };
        img.onerror = () => {
          setStatus("error");
          setErrorMsg("Não foi possível carregar a imagem. Verifique se a URL é pública e acessível.");
          onValidated?.(false);
        };
        img.src = url;
      }
    }, 600);

    return () => clearTimeout(debounceRef.current);
  }, [url]);

  if (!url) return null;

  return (
    <div style={{ marginTop: 12 }}>
      {status === "loading" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)", padding: "8px 0" }}>
          <div className="spinner" style={{ width: 14, height: 14 }} />
          Verificando URL...
        </div>
      )}

      {status === "error" && (
        <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 12, color: "var(--danger)" }}>
          ⚠️ {errorMsg}
        </div>
      )}

      {status === "valid" && mediaType === "IMAGE" && (
        <div style={{ position: "relative" }}>
          <img
            src={url} alt="Preview"
            style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", display: "block" }}
          />
          {naturalSize && (
            <div style={{
              position: "absolute", bottom: 8, right: 8,
              background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
              borderRadius: 6, padding: "3px 8px", fontSize: 11, color: "#fff",
            }}>
              {naturalSize.w}×{naturalSize.h}
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--success)", display: "flex", alignItems: "center", gap: 5 }}>
            ✓ URL válida e acessível
          </div>
        </div>
      )}

      {status === "valid" && mediaType === "VIDEO" && (
        <div style={{ position: "relative" }}>
          <video
            src={url} controls
            style={{ width: "100%", maxHeight: 200, borderRadius: 8, border: "1px solid var(--border)", display: "block", background: "#000" }}
          />
          {naturalSize && (
            <div style={{
              position: "absolute", top: 8, right: 8,
              background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
              borderRadius: 6, padding: "3px 8px", fontSize: 11, color: "#fff",
            }}>
              {naturalSize.w}×{naturalSize.h}
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--success)", display: "flex", alignItems: "center", gap: 5 }}>
            ✓ Vídeo válido — processamento pode levar até 2 min após publicar
          </div>
        </div>
      )}
    </div>
  );
}
