// AccountStatBox.jsx — caixinha de estatística usada no detalhe de conta
export default function StatBox({ label, value, icon }) {
  return (
    <div style={{ flex: 1, textAlign: "center", padding: "9px 4px", background: "var(--bg3)", borderRadius: 8, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 14, marginBottom: 2 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 1 }}>{label}</div>
    </div>
  );
}
