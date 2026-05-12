// AccountAvatar.jsx — Avatar com bolinha de status de saúde
export default function AccountAvatar({ acc, ins, size = 56 }) {
  const initials = (acc.name || acc.username || "?")[0].toUpperCase();
  const gradients = [
    "linear-gradient(135deg, #7c5cfc, #e040fb)",
    "linear-gradient(135deg, #f59e0b, #ef4444)",
    "linear-gradient(135deg, #22c55e, #38bdf8)",
    "linear-gradient(135deg, #f97316, #ec4899)",
  ];
  const grad = gradients[(acc.username?.charCodeAt(0) || 0) % gradients.length];
  const tokenExpired = acc.token_status === "expired";
  const overall      = ins?.health?.overall;
  const dotColor     = tokenExpired ? "var(--danger)"
    : overall === "danger"  ? "var(--danger)"
    : overall === "warning" ? "var(--warning)"
    : overall === "good"    ? "var(--success)"
    : "var(--muted)";

  const photoUrl = ins?.profile_picture || acc.profile_picture || "";

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      {photoUrl && (
        <img
          src={photoUrl} alt={acc.username}
          style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--border2)", display: "block" }}
          onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
        />
      )}
      <div style={{
        width: size, height: size, borderRadius: "50%", background: grad,
        display: photoUrl ? "none" : "flex",
        alignItems: "center", justifyContent: "center",
        fontSize: size * 0.38, fontWeight: 700, color: "#fff", border: "2px solid var(--border2)",
      }}>
        {initials}
      </div>
      <div style={{
        position: "absolute", bottom: 1, right: 1,
        width: 13, height: 13, borderRadius: "50%",
        background: dotColor, border: "2px solid var(--bg2)",
      }} />
    </div>
  );
}
