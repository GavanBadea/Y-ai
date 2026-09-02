// src/components/layout/BrandMark.jsx
import { useCompany, companyLogoUrl } from "@/context/CompanyContext";
import { useLanguage } from "@/context/LanguageContext";

export default function BrandMark({ collapsed = false, size = "md" }) {
  const { company } = useCompany();
  const { t } = useLanguage();
  const logoSrc = companyLogoUrl(company?.CompanyInformation_Logo);
  const name    = company?.CompanyInformation_Name?.trim();
  const compact = size === "sm";

  if (collapsed) {
    return (
      <div style={{
        width: 34, height: 34, borderRadius: "var(--radius-md)",
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden", flexShrink: 0,
      }}>
        {logoSrc
          ? <img src={logoSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          : <span style={{ fontWeight: 900, color: "var(--accent)", fontSize: ".85rem" }}>Y</span>
        }
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: compact ? 8 : 10, minWidth: 0 }}>
      <div style={{
        width: compact ? 32 : 38, height: compact ? 32 : 38,
        borderRadius: "var(--radius-md)",
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden", flexShrink: 0,
      }}>
        {logoSrc
          ? <img src={logoSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", padding: 2 }} />
          : <span style={{ fontWeight: 900, color: "var(--accent)", fontSize: compact ? ".8rem" : ".9rem" }}>Y</span>
        }
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: compact ? ".88rem" : ".95rem", fontWeight: 900,
          color: "var(--accent)", fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em", lineHeight: 1.2,
        }}>
          Y-ai
        </div>
        {name && (
          <div data-no-i18n style={{
            fontSize: compact ? ".62rem" : ".68rem",
            color: "var(--text-muted)", marginTop: 1,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            maxWidth: compact ? 140 : 160,
          }}>
            {name}
          </div>
        )}
        {!compact && !name && (
          <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginTop: -1 }}>
            {t("login.warehouseSystem")}
          </div>
        )}
      </div>
    </div>
  );
}
