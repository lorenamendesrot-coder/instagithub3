// Toast.jsx — Componente isolado de notificação
export default function Toast({ toast }) {
  if (!toast) return null;

  const isSuccess = toast.type === "success";
  return (
    <div style={{
      position: "fixed", top: 20, right: 20, zIndex: 1000,
      padding: "12px 20px", borderRadius: 12, fontSize: 13, fontWeight: 500,
      background: isSuccess ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
      color: isSuccess ? "var(--success)" : "var(--danger)",
      border: `1px solid ${isSuccess ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
      boxShadow: "var(--shadow)", backdropFilter: "blur(12px)",
      animation: "slideIn 0.2s ease",
      maxWidth: 360,
    }}>
      {isSuccess ? "✅" : "❌"} {toast.msg}
    </div>
  );
}
