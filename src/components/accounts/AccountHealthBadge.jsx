// AccountHealthBadge.jsx — badge compacto de saúde da conta
import { healthMeta } from "./AccountUtils.js";

export default function HealthBadge({ overall, tokenExpired, score }) {
  const m = healthMeta(overall, tokenExpired);
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6,
      background: m.bg, color: m.color, border: `1px solid ${m.border}`,
      display: "inline-flex", alignItems: "center", gap: 4,
    }}>
      {m.icon} {m.label}{score != null && !tokenExpired ? ` (${score})` : ""}
    </span>
  );
}
