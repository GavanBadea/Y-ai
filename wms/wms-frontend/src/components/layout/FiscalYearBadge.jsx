import { useEffect, useState } from "react";
import { fiscalSwitchService } from "@/services/api";

export default function FiscalYearBadge() {
  const [label, setLabel] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fiscalSwitchService.getCurrent()
      .then((res) => {
        if (!cancelled) setLabel(res?.fiscal?.label || null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!label) return null;

  return (
    <span
      className="fiscal-year-badge"
      title="السنة المالية النشطة"
      style={{
        display      : "inline-flex",
        alignItems   : "center",
        gap          : 6,
        padding      : "5px 11px",
        background   : "var(--bg-card)",
        border       : "1px solid var(--border)",
        borderRadius : "var(--radius-full)",
        color        : "var(--accent)",
        fontSize     : ".78rem",
        fontWeight   : 700,
        whiteSpace   : "nowrap",
        fontFamily   : "var(--font-main)",
      }}
    >
      <span aria-hidden>📅</span>
      <span>{label}</span>
    </span>
  );
}
