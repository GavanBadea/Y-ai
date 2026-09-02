import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { expiredService } from "@/services/expiredService";
import { fmtC, fmtN } from "@/utils/numFormat";

export default function ExpiredAlertBanner() {
  const [info, setInfo] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await expiredService.getPending();
      const count = r?.count ?? r?.data?.length ?? 0;
      if (!count) {
        setInfo(null);
        return;
      }
      setInfo({
        count,
        loss: r?.totalPotentialLoss ?? 0,
      });
    } catch {
      setInfo(null);
    }
  }, []);

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener("wms-expired-stock-changed", onChange);
    const t = setInterval(load, 120000);
    return () => {
      clearInterval(t);
      window.removeEventListener("wms-expired-stock-changed", onChange);
    };
  }, [load]);

  if (!info?.count) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        flexWrap: "wrap",
        padding: "10px 22px",
        background: "linear-gradient(90deg, rgba(220,38,38,.12), rgba(234,88,12,.08))",
        borderBottom: "1px solid rgba(220,38,38,.35)",
        boxShadow: "0 2px 12px rgba(220,38,38,.08)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <span
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "rgba(220,38,38,.15)",
            border: "2px solid var(--danger)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.1rem",
            flexShrink: 0,
          }}
        >
          ⏳
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, color: "var(--danger)", fontSize: ".9rem", lineHeight: 1.35 }}>
            {fmtN(info.count)} دفعة منتهية الصلاحية بانتظار الشطب
          </div>
          <div style={{ fontSize: ".78rem", color: "var(--text-secondary)", marginTop: 2 }}>
            خسارة متوقعة: {fmtC(info.loss)} — يُنصح بالشطب قبل البيع
          </div>
        </div>
      </div>
      <Link
        to="/expired-stock"
        style={{
          padding: "7px 16px",
          background: "var(--danger)",
          color: "#fff",
          borderRadius: "var(--radius-md)",
          textDecoration: "none",
          fontWeight: 700,
          fontSize: ".82rem",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        شطب / عرض التفاصيل ←
      </Link>
    </div>
  );
}
