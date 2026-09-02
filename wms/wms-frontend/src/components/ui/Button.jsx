// src/components/ui/Button.jsx
import { useLanguage } from "@/context/LanguageContext";

const variants = {
  primary  : { bg: "var(--accent)",   color: "var(--text-inverse)", border: "transparent" },
  secondary: { bg: "var(--bg-hover)", color: "var(--text-primary)", border: "var(--border)" },
  danger   : { bg: "var(--danger-bg)", color: "var(--danger)",      border: "var(--danger)" },
  ghost    : { bg: "transparent",     color: "var(--text-secondary)",border: "transparent" },
  warning  : { bg: "rgba(212,160,18,.12)", color: "var(--accent)",        border: "var(--accent)" },
};

const sizes = {
  sm: { padding: "6px 14px", fontSize: ".85rem" },
  md: { padding: "10px 20px", fontSize: ".95rem" },
  lg: { padding: "13px 28px", fontSize: "1rem"   },
};

export default function Button({
  children,
  variant  = "primary",
  size     = "md",
  loading  = false,
  disabled = false,
  fullWidth= false,
  onClick,
  type     = "button",
  style    = {},
}) {
  const { tr } = useLanguage();
  const v = variants[variant] || variants.primary;
  const s = sizes[size]       || sizes.md;
  const isDisabled = disabled || loading;
  const label = typeof children === "string" ? tr(children) : children;

  return (
    <button
      type     ={type}
      onClick  ={onClick}
      disabled ={isDisabled}
      style={{
        display        : "inline-flex",
        alignItems     : "center",
        justifyContent : "center",
        gap            : "8px",
        padding        : s.padding,
        fontSize       : s.fontSize,
        fontFamily     : "var(--font-main)",
        fontWeight     : 600,
        borderRadius   : "var(--radius-md)",
        border         : `1px solid ${v.border}`,
        background     : v.bg,
        color          : v.color,
        cursor         : isDisabled ? "not-allowed" : "pointer",
        opacity        : isDisabled ? 0.55 : 1,
        width          : fullWidth ? "100%" : "auto",
        transition     : "all var(--transition)",
        whiteSpace     : "nowrap",
        userSelect     : "none",
        ...style,
      }}
    >
      {loading && <span className="spinner" style={{ width: 16, height: 16 }} />}
      {label}
    </button>
  );
}
