// src/pages/pos/POSDisplayPage.jsx — شاشة الزبون (ثانية)
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { fmtC, fmtN, r2 } from "@/utils/numFormat";

const CHANNEL = "wms-pos-customer-display";
const LS_KEY  = "wms-pos-display";

function readState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function DigitalTotal({ value }) {
  const txt = fmtC(value || 0).replace(/[^\d.,]/g, "");
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100vh", background: "#000",
      fontFamily: "'Courier New', monospace", gap: 16,
    }}>
      <div style={{ color: "#475569", fontSize: "1.2rem", letterSpacing: 4 }}>الإجمالي</div>
      <div style={{
        fontSize: "clamp(3rem, 14vw, 9rem)", fontWeight: 900,
        color: "#22c55e", textShadow: "0 0 30px rgba(34,197,94,.5)",
        letterSpacing: 6, direction: "ltr",
      }}>
        {txt}
      </div>
      <div style={{ color: "#64748b", fontSize: ".9rem" }}>د.ع</div>
    </div>
  );
}

function FullDisplay({ state }) {
  const cart     = state?.cart || [];
  const total    = state?.total ?? 0;
  const paid     = state?.paid ?? 0;
  const change   = state?.change ?? 0;
  const customer = state?.customer?.ZabonName || "زبون عام";
  const receipt  = state?.receipt;

  if (receipt) {
    return (
      <div dir="rtl" style={{
        minHeight: "100vh", background: "linear-gradient(160deg,#020817,#0f2744)",
        color: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}>
        <div style={{ textAlign: "center", maxWidth: 520 }}>
          <div style={{ fontSize: "4rem" }}>✅</div>
          <h1 style={{ color: "#4ade80", fontSize: "2rem", margin: "12px 0" }}>شكراً لزيارتكم</h1>
          <p style={{ color: "#94a3b8" }}>فاتورة #{receipt.invoiceId}</p>
          <div style={{ fontSize: "2.5rem", fontWeight: 900, color: "#fbbf24", marginTop: 16 }}>{fmtC(receipt.total)}</div>
          {receipt.change > 0 && (
            <p style={{ color: "#4ade80", marginTop: 12, fontSize: "1.2rem" }}>
              الباقي: {fmtC(receipt.change)}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" style={{
      minHeight: "100vh", background: "linear-gradient(160deg,#020817,#0a1628)",
      color: "#e2e8f0", display: "flex", flexDirection: "column",
    }}>
      <div style={{
        padding: "20px 28px", borderBottom: "1px solid #1e293b",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: "1.4rem", fontWeight: 900, color: "#fbbf24" }}>شاشة الزبون</div>
          <div style={{ color: "#64748b", marginTop: 4 }}>{customer}</div>
        </div>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: ".8rem", color: "#64748b" }}>الإجمالي</div>
          <div style={{ fontSize: "2rem", fontWeight: 900, color: "#4ade80", fontFamily: "monospace" }}>
            {fmtC(total)}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 28px" }}>
        {cart.length === 0 ? (
          <div style={{ textAlign: "center", padding: 80, color: "#475569" }}>
            <div style={{ fontSize: "3rem" }}>🛒</div>
            <p style={{ marginTop: 12, fontSize: "1.1rem" }}>في انتظار إضافة المواد...</p>
          </div>
        ) : (
          cart.map((l) => (
            <div key={l._lid || l.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "14px 0", borderBottom: "1px solid #1e293b",
            }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>{l.name}</div>
                <div style={{ color: "#64748b", marginTop: 4 }}>
                  {fmtN(l.qty)} × {fmtC(l.price)}
                </div>
              </div>
              <div style={{ fontFamily: "monospace", fontWeight: 900, fontSize: "1.1rem", color: "#fbbf24" }}>
                {fmtC(r2(l.qty * l.price))}
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{
        padding: "20px 28px", borderTop: "2px solid #1d4ed8",
        background: "#0f172a", display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr", gap: 16, textAlign: "center",
      }}>
        <div>
          <div style={{ color: "#64748b", fontSize: ".75rem" }}>المجموع</div>
          <div style={{ fontWeight: 800, fontSize: "1.1rem" }}>{fmtC(state?.subtotal || 0)}</div>
        </div>
        <div>
          <div style={{ color: "#64748b", fontSize: ".75rem" }}>المدفوع</div>
          <div style={{ fontWeight: 800, fontSize: "1.1rem", color: "#4ade80" }}>{fmtC(paid)}</div>
        </div>
        <div>
          <div style={{ color: "#64748b", fontSize: ".75rem" }}>الباقي</div>
          <div style={{ fontWeight: 800, fontSize: "1.1rem", color: change > 0 ? "#fbbf24" : "#94a3b8" }}>
            {fmtC(Math.max(0, change))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function POSDisplayPage() {
  const [params] = useSearchParams();
  const mode     = params.get("mode") === "digital" ? "digital" : "full";
  const [state, setState] = useState(readState);

  useEffect(() => {
    let ch;
    try {
      ch = new BroadcastChannel(CHANNEL);
      ch.onmessage = (ev) => {
        if (ev.data?.type === "state") setState(ev.data.state);
      };
    } catch { /* ignore */ }

    const onStorage = (e) => {
      if (e.key === LS_KEY) setState(readState());
    };
    window.addEventListener("storage", onStorage);

    const iv = setInterval(() => setState(readState()), 800);

    return () => {
      if (ch) ch.close();
      window.removeEventListener("storage", onStorage);
      clearInterval(iv);
    };
  }, []);

  if (mode === "digital") return <DigitalTotal value={state?.total || 0} />;
  return <FullDisplay state={state} />;
}
