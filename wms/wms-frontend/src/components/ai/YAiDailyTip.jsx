// ============================================================
//  src/components/ai/YAiDailyTip.jsx
//  بطاقة "نصيحة Y-ai اليومية" للوحة القيادة
//  مستقلة تماماً — تفشل بصمت إذا كانت الخدمة متوقفة
// ============================================================
import { useState, useEffect } from "react";
import { yaiDailyTip, yaiPredictStockout } from "@/services/yaiService";
import { fmtN } from "@/utils/numFormat";

export default function YAiDailyTip() {
  const [tip,      setTip     ] = useState(null);
  const [alerts,   setAlerts  ] = useState([]);
  const [loading,  setLoading ] = useState(true);
  const [online,   setOnline  ] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [tipRes, stockRes] = await Promise.allSettled([
          yaiDailyTip(),
          yaiPredictStockout(7),
        ]);

        if (cancelled) return;

        if (tipRes.status === "fulfilled") {
          setTip(tipRes.value?.tip || null);
          setOnline(true);
        }
        if (stockRes.status === "fulfilled") {
          setAlerts(stockRes.value?.alerts?.slice(0, 3) || []);
        }
      } catch {
        // Y-ai غير متاح — لا شيء يُعرض
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // لا تُظهر أي شيء إذا كانت الخدمة غير متاحة
  if (!loading && !online) return null;

  if (loading) {
    return (
      <div style={cardStyle}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:"1.2rem" }}>🤖</span>
          <span style={{ fontSize:".82rem", color:"var(--text-muted)" }}>Y-ai يحلل البيانات...</span>
          <span className="spinner" style={{ width:14, height:14, marginRight:"auto" }}/>
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      {/* ── الرأس ─────────────────────────────────────────── */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom: alerts.length > 0 ? 10 : 0 }}>
        <div style={{
          width:32, height:32, borderRadius:"50%",
          background:"transparent",
          display:"flex", alignItems:"center", justifyContent:"center",
          color:"var(--accent)", fontWeight:900, fontSize:"1.05rem", flexShrink:0,
          border:"2px solid var(--accent)",
        }}>Y</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:".7rem", color:"var(--accent)", fontWeight:700, textTransform:"uppercase", letterSpacing:".05em" }}>
            نصيحة Y-ai اليومية
          </div>
          {tip && (
            <div style={{ fontSize:".85rem", color:"var(--text-primary)", marginTop:2, lineHeight:1.5 }}>
              {tip}
            </div>
          )}
        </div>
      </div>

      {/* ── تنبيهات نفاد المخزون ──────────────────────────── */}
      {alerts.length > 0 && (
        <>
          <div
            onClick={() => setExpanded(v => !v)}
            style={{
              display:"flex", alignItems:"center", gap:6, cursor:"pointer",
              padding:"6px 10px", borderRadius:"var(--radius-md)",
              background:"rgba(220,38,38,.08)", border:"1px solid rgba(220,38,38,.2)",
              marginTop:8,
            }}
          >
            <span style={{ fontSize:"1rem" }}>⚠️</span>
            <span style={{ fontSize:".8rem", color:"var(--danger)", fontWeight:700, flex:1 }}>
              {alerts.length} صنف ستنفد خلال 7 أيام
            </span>
            <span style={{ fontSize:".7rem", color:"var(--text-muted)" }}>{expanded ? "▲" : "▼"}</span>
          </div>

          {expanded && (
            <div style={{ marginTop:6, display:"flex", flexDirection:"column", gap:4 }}>
              {alerts.map((a, i) => (
                <div key={i} style={{
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"6px 10px",
                  background: a.urgency === "critical" ? "rgba(220,38,38,.06)" : "rgba(202,138,4,.06)",
                  borderRadius:"var(--radius-sm)",
                  fontSize:".8rem",
                }}>
                  <span style={{ fontWeight:600 }}>
                    {a.urgency === "critical" ? "🔴" : "🟡"} {a.MaterialName}
                  </span>
                  <span style={{ fontFamily:"var(--font-mono)", color:"var(--danger)", fontWeight:700 }}>
                    {fmtN(a.days_left)} يوم
                  </span>
                </div>
              ))}
              <a
                href="/inventory"
                style={{
                  display:"block", textAlign:"center", padding:"5px",
                  fontSize:".75rem", color:"var(--accent)",
                  textDecoration:"none", fontWeight:700,
                }}
              >
                عرض لوحة المخزون ←
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const cardStyle = {
  background  : "var(--bg-card)",
  border      : "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding     : "14px 16px",
  boxShadow   : "var(--shadow-sm)",
};
