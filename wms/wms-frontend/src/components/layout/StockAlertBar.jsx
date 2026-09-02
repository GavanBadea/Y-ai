import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "@/services/api";

const THRESHOLD_KEY = "wms_stock_alert_threshold";
const DEFAULT_THRESHOLD = 5;

export default function StockAlertBar() {
  const [count, setCount] = useState(0);
  const [threshold, setThreshold] = useState(
    () => Number(localStorage.getItem(THRESHOLD_KEY)) || DEFAULT_THRESHOLD
  );

  const load = useCallback(() => {
    const th = Number(localStorage.getItem(THRESHOLD_KEY)) || DEFAULT_THRESHOLD;
    setThreshold(th);
    api
      .get("/reports/reorder-alert", { params: { threshold: th } })
      .then((r) => setCount(r?.summary?.total ?? r?.items?.length ?? 0))
      .catch(() => setCount(0));
  }, []);

  useEffect(() => {
    load();
    const onStorage = (e) => {
      if (!e.key || e.key === THRESHOLD_KEY) load();
    };
    const onCustom = () => load();
    window.addEventListener("storage", onStorage);
    window.addEventListener("wms-stock-threshold", onCustom);
    const t = setInterval(load, 120000);
    return () => {
      clearInterval(t);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("wms-stock-threshold", onCustom);
    };
  }, [load]);

  if (!count) return null;

  return (
    <Link
      to="/reports"
      state={{ tab: "reorder-alert" }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 14px",
        background: "var(--warning-bg)",
        border: "1px solid var(--warning)",
        borderRadius: "var(--radius-full)",
        color: "var(--warning)",
        fontSize: ".78rem",
        fontWeight: 700,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
      title={`أصناف بمخزون أقل من ${threshold}`}
    >
      <span>🔔</span>
      <span>تنبيه مخزون: {count} صنف (أقل من {threshold})</span>
    </Link>
  );
}
