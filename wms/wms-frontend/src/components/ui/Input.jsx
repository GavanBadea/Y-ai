// src/components/ui/Input.jsx
import { useLanguage } from "@/context/LanguageContext";

export default function Input({
  label,
  value,
  onChange,
  type        = "text",
  placeholder = "",
  error       = "",
  hint        = "",
  name        = "",
  autoFocus   = false,
  disabled    = false,
  prefix      = null,   // أيقونة قبل الحقل
  suffix      = null,   // أيقونة بعد الحقل
  style       = {},
}) {
  const { tr } = useLanguage();
  const lbl = label ? tr(label) : null;
  const ph  = placeholder ? tr(placeholder) : "";
  const hintT = hint ? tr(hint) : "";
  const errT  = error ? tr(error) : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, ...style }}>
      {lbl && (
        <label style={{
          fontSize   : ".88rem",
          fontWeight : 600,
          color      : errT ? "var(--danger)" : "var(--text-secondary)",
          transition : "color var(--transition)",
        }}>
          {lbl}
        </label>
      )}

      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        {prefix && (
          <span style={{
            position: "absolute", right: 12,
            color: "var(--text-muted)", display: "flex", alignItems: "center",
            pointerEvents: "none",
          }}>
            {prefix}
          </span>
        )}

        <input
          type       ={type}
          name       ={name}
          value      ={value}
          onChange   ={(e) => onChange?.(e.target.value, e)}
          placeholder={ph}
          autoFocus  ={autoFocus}
          disabled   ={disabled}
          style={{
            width           : "100%",
            padding         : prefix ? "10px 40px 10px 14px" : "10px 14px",
            paddingLeft     : suffix ? 40 : 14,
            background      : "var(--bg-input)",
            border          : `1px solid ${error ? "var(--danger)" : "var(--border)"}`,
            borderRadius    : "var(--radius-md)",
            color           : "var(--text-primary)",
            fontSize        : ".95rem",
            fontFamily      : "var(--font-main)",
            outline         : "none",
            transition      : "border-color var(--transition), box-shadow var(--transition)",
            opacity         : disabled ? 0.6 : 1,
            cursor          : disabled ? "not-allowed" : "text",
          }}
          onFocus={(e) => {
            e.target.style.borderColor = error ? "var(--danger)" : "var(--border-focus)";
            e.target.style.boxShadow   = error
              ? "0 0 0 3px var(--danger-bg)"
              : "0 0 0 3px var(--accent-glow)";
          }}
          onBlur={(e) => {
            e.target.style.borderColor = error ? "var(--danger)" : "var(--border)";
            e.target.style.boxShadow   = "none";
          }}
        />

        {suffix && (
          <span style={{
            position: "absolute", left: 12,
            color: "var(--text-muted)", display: "flex", alignItems: "center",
          }}>
            {suffix}
          </span>
        )}
      </div>

      {(error || hint) && (
        <span style={{
          fontSize: ".82rem",
          color   : error ? "var(--danger)" : "var(--text-muted)",
        }}>
          {errT || hintT}
        </span>
      )}
    </div>
  );
}
