// src/components/ui/Card.jsx
import { useLanguage } from "@/context/LanguageContext";

export function Card({ children, style = {}, padding = "20px 22px" }) {
  return (
    <div style={{
      background            : "var(--bg-card)",
      border                : "1px solid var(--border)",
      borderRadius          : "var(--radius-lg)",
      padding,
      boxShadow             : "var(--shadow-sm)",
      backdropFilter        : "var(--glass-blur,none)",
      WebkitBackdropFilter  : "var(--glass-blur,none)",
      ...style,
    }}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// src/components/ui/Table.jsx
export function Table({ columns, rows, loading, emptyText = "لا توجد بيانات" }) {
  const { tr } = useLanguage();
  const empty = tr(emptyText);
  const cols = columns.map((c) => ({
    ...c,
    label: typeof c.label === "string" ? tr(c.label) : c.label,
  }));
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".88rem" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {cols.map((col) => (
              <th key={col.key} style={{
                padding   : "10px 14px",
                textAlign : col.align || "right",
                color     : "var(--text-secondary)",
                fontWeight: 700,
                fontSize  : ".78rem",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                whiteSpace: "nowrap",
                width     : col.width,
              }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: 40, textAlign: "center" }}>
                <span className="spinner" />
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={cols.length} style={{
                padding  : 40,
                textAlign: "center",
                color    : "var(--text-muted)",
                fontSize : ".88rem",
              }}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={i}
                style={{
                  borderBottom: "1px solid var(--border-subtle)",
                  transition  : "background var(--transition)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
              >
                {cols.map((col) => (
                  <td key={col.key} style={{
                    padding  : "11px 14px",
                    textAlign: col.align || "right",
                    color    : "var(--text-primary)",
                    whiteSpace: col.nowrap ? "nowrap" : "normal",
                  }}>
                    {col.render ? col.render(row[col.key], row) : (row[col.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// src/components/ui/Badge.jsx
export function Badge({ label, variant = "default" }) {
  const { tr } = useLanguage();
  const styles = {
    default : { bg: "var(--bg-hover)",    color: "var(--text-secondary)", border: "var(--border)"  },
    success : { bg: "var(--success-bg)",  color: "var(--success)",        border: "var(--success)" },
    danger  : { bg: "var(--danger-bg)",   color: "var(--danger)",         border: "var(--danger)"  },
    warning : { bg: "var(--warning-bg)",  color: "var(--warning)",        border: "var(--warning)" },
    info    : { bg: "var(--info-bg)",     color: "var(--info)",           border: "var(--info)"    },
    accent  : { bg: "var(--accent-glow)", color: "var(--accent)",         border: "var(--accent)"  },
  };
  const s = styles[variant] || styles.default;
  return (
    <span style={{
      display     : "inline-block",
      padding     : "2px 10px",
      borderRadius: "var(--radius-full)",
      fontSize    : ".75rem",
      fontWeight  : 700,
      background  : s.bg,
      color       : s.color,
      border      : `1px solid ${s.border}`,
      whiteSpace  : "nowrap",
    }}>
      {tr(label)}
    </span>
  );
}

// ─────────────────────────────────────────────────────────
// src/components/ui/StatCard.jsx
export function StatCard({ label, value, sub, variant = "default", icon }) {
  const { tr } = useLanguage();
  const colors = {
    default : "var(--text-primary)",
    success : "var(--success)",
    danger  : "var(--danger)",
    warning : "var(--warning)",
    accent  : "var(--accent)",
    info    : "var(--info)",
  };
  return (
    <div style={{
      background  : "var(--bg-card)",
      border      : "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      padding     : "20px 22px",
      display     : "flex",
      flexDirection:"column",
      gap         : 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: ".82rem", color: "var(--text-secondary)", fontWeight: 600 }}>
          {tr(label)}
        </span>
        {icon && <span style={{ color: colors[variant], opacity: .7 }}>{icon}</span>}
      </div>
      <div style={{
        fontSize  : "1.8rem",
        fontWeight: 900,
        color     : colors[variant],
        fontFamily: "var(--font-mono)",
        lineHeight: 1.1,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: ".78rem", color: "var(--text-muted)" }}>{tr(sub)}</div>
      )}
    </div>
  );
}
