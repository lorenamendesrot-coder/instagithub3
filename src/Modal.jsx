// Modal.jsx — Modal de confirmação reutilizável (substitui confirm() nativo)
import { useEffect } from "react";

export default function Modal({ open, title, message, confirmLabel = "Confirmar", confirmDanger = false, onConfirm, onCancel }) {
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "fadeIn 0.15s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg2)", border: "1px solid var(--border2)",
          borderRadius: 16, padding: "28px 28px 24px",
          width: "100%", maxWidth: 420,
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
          animation: "slideUp 0.18s ease",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: "var(--text2)", lineHeight: 1.6, marginBottom: 24 }}>{message}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancelar</button>
          <button
            className={`btn btn-sm ${confirmDanger ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
            style={confirmDanger ? { background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)" } : {}}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>
    </div>
  );
}
