// src/pages/kiosk/PriceKioskPage.jsx — شاشة فحص الأسعار (سوبرماركت)
import { useState, useRef, useEffect, useCallback } from "react";
import { posService } from "@/services/api";
import { useCompany, companyLogoUrl } from "@/context/CompanyContext";
import { fmtC } from "@/utils/numFormat";

export default function PriceKioskPage() {
  const { company } = useCompany();
  const logoSrc = companyLogoUrl(company?.CompanyInformation_Logo);
  const bcRef   = useRef(null);
  const hideTimer = useRef(null);
  const [val, setVal]       = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy]     = useState(false);
  const [flash, setFlash]   = useState(false);

  const scan = useCallback(async (raw) => {
    const v = (raw || "").trim();
    if (!v || busy) return;
    setVal("");
    setBusy(true);
    setResult(null);
    try {
      const r   = await posService.searchMaterial(v);
      const mat = r?.data;
      if (mat && (r.single || mat.id_Material_NoM)) {
        const price = mat.scanType === "scale_price" && mat.scannedLineTotal > 0
          ? mat.scannedLineTotal
          : (mat.DefaultPrice || mat.LastSellPrice || mat.SellPrice1 || 0);
        const weightNote = mat.scanType === "scale_weight" && mat.scannedQty > 0
          ? ` — ${mat.scannedQty} كغ`
          : (mat.scanNote ? ` — ${mat.scanNote}` : "");
        setResult({
          ok    : true,
          name  : mat.MaterialName,
          band  : mat.Band || mat.Unit || "",
          price,
          weightNote,
        });
        setFlash(true);
        setTimeout(() => setFlash(false), 300);
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setResult(null), 3000);
      } else {
        setResult({ ok: false, msg: `المنتج غير موجود: ${v}` });
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setResult(null), 3000);
      }
    } catch {
      setResult({ ok: false, msg: "تعذّر قراءة المنتج — حاول مجدداً" });
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setResult(null), 3000);
    } finally {
      setBusy(false);
      setTimeout(() => bcRef.current?.focus(), 60);
    }
  }, [busy]);

  useEffect(() => {
    bcRef.current?.focus();
    const iv = setInterval(() => bcRef.current?.focus(), 3000);
    return () => {
      clearInterval(iv);
      clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <div dir="rtl" style={{
      minHeight: "100vh", background: "linear-gradient(165deg,#020817 0%,#0f2744 50%,#020817 100%)",
      color: "#e2e8f0", display: "flex", flexDirection: "column",
      fontFamily: "'Segoe UI', Tahoma, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: "20px 32px", display: "flex", alignItems: "center",
        justifyContent: "space-between", borderBottom: "1px solid #1e293b",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {logoSrc ? (
            <img src={logoSrc} alt="" style={{ height: 48, objectFit: "contain" }} />
          ) : (
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: "#1e3a5f", border: "1px solid #3b82f6",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 900, color: "#93c5fd", fontSize: "1.2rem",
            }}>Y</div>
          )}
          <div>
            <div style={{ fontWeight: 900, fontSize: "1.3rem", color: "#fbbf24" }}>
              {company?.CompanyInformation_Name || "فحص الأسعار"}
            </div>
            <div style={{ color: "#64748b", fontSize: ".85rem" }}>مرّر الباركود لمعرفة السعر</div>
          </div>
        </div>
        <div style={{
          padding: "6px 14px", background: "#166534", borderRadius: 20,
          color: "#4ade80", fontSize: ".78rem", fontWeight: 700,
        }}>
          شاشة خدمة ذاتية
        </div>
      </div>

      {/* Barcode input — hidden visually but focused */}
      <div style={{ padding: "24px 32px 0" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "16px 20px", background: flash ? "#1e3a5f" : "#0f172a",
          border: `2px solid ${flash ? "#3b82f6" : "#1e293b"}`,
          borderRadius: 16, transition: "all .2s",
        }}>
          <span style={{ fontSize: "1.8rem" }}>📷</span>
          <input
            ref={bcRef}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") scan(val); }}
            placeholder="امسح الباركود هنا..."
            autoFocus
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              color: "#93c5fd", fontSize: "1.4rem", fontFamily: "inherit",
            }}
          />
          {busy && <span style={{ color: "#64748b", fontSize: "1.2rem" }}>⏳</span>}
        </div>
      </div>

      {/* Result area */}
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 32,
      }}>
        {!result ? (
          <div style={{ textAlign: "center", color: "#475569" }}>
            <div style={{ fontSize: "5rem", opacity: .5 }}>🏷️</div>
            <p style={{ fontSize: "1.3rem", marginTop: 16, fontWeight: 600 }}>
              في انتظار مسح الباركود...
            </p>
          </div>
        ) : result.ok ? (
          <div style={{ textAlign: "center", width: "100%", maxWidth: 640 }}>
            <div style={{
              fontSize: "clamp(1.4rem, 4vw, 2.2rem)", fontWeight: 800,
              color: "#e2e8f0", marginBottom: 12, lineHeight: 1.4,
            }}>
              {result.name}
            </div>
            {result.band && (
              <div style={{ color: "#64748b", fontSize: "1rem", marginBottom: 24 }}>{result.band}</div>
            )}
            <div style={{
              fontSize: "clamp(3rem, 12vw, 7rem)", fontWeight: 900,
              color: "#4ade80", fontFamily: "monospace",
              textShadow: "0 0 40px rgba(74,222,128,.35)",
              letterSpacing: 2,
            }}>
              {fmtC(result.price)}
            </div>
            <div style={{ color: "#64748b", marginTop: 12, fontSize: "1rem" }}>سعر البيع</div>
            {result.weightNote && (
              <div style={{ color: "#93c5fd", marginTop: 16, fontSize: "1.1rem", fontWeight: 700 }}>
                {result.weightNote}
              </div>
            )}
          </div>
        ) : (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "4rem" }}>⚠️</div>
            <p style={{ color: "#f87171", fontSize: "1.2rem", marginTop: 16, fontWeight: 700 }}>
              {result.msg}
            </p>
          </div>
        )}
      </div>

      <div style={{
        padding: "12px 32px", textAlign: "center", color: "#334155",
        fontSize: ".75rem", borderTop: "1px solid #1e293b",
      }}>
        Y-ai — نظام المستودعات
      </div>
    </div>
  );
}
