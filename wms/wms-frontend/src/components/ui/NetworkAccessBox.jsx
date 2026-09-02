import { useState } from "react";

export default function NetworkAccessBox({ urls = [], compact = false }) {
  const [copied, setCopied] = useState(null);
  const [open, setOpen] = useState(!compact);

  if (!urls.length) return null;

  const copy = (url) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <div className="network-access-box" style={{
      marginTop     : compact ? 16 : 20,
      padding       : compact ? "12px 14px" : "14px 16px",
      background    : "rgba(59,130,246,.08)",
      border        : "1px solid rgba(59,130,246,.25)",
      borderRadius  : "var(--radius-md)",
      fontSize      : ".82rem",
      color         : "var(--text-secondary)",
      lineHeight    : 1.65,
    }}>
      <style>{`
        @media (max-width: 1100px) {
          .network-access-box {
            font-size: .78rem !important;
            text-align: center !important;
            max-width: 100% !important;
          }
          .network-access-box .network-url-row {
            justify-content: center !important;
          }
          .network-access-box code {
            flex-basis: 100% !important;
            text-align: center !important;
          }
        }
      `}</style>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          background: "none",
          border: "none",
          padding: 0,
          color: "var(--text-primary)",
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "var(--font-main)",
          fontSize: compact ? ".86rem" : ".9rem",
          textAlign: "right",
        }}
      >
        <span>📡 الدخول من جهاز آخر (نفس الواي فاي)</span>
        <span style={{ color: "var(--accent)", fontSize: ".8rem" }}>{open ? "إخفاء" : "عرض"}</span>
      </button>

      {open && <>
      <div style={{ height: 8 }} />
      <div style={{ fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
        روابط الاتصال
      </div>
      <p style={{ margin: "0 0 10px" }}>
        البرنامج يعمل على هذا الجهاز. من الموبايل أو كمبيوتر آخر افتح:
      </p>
      {urls.map((url) => (
        <div
          key={url}
          className="network-url-row"
          style={{
            display      : "flex",
            alignItems   : "center",
            gap          : 8,
            marginBottom : 6,
            flexWrap     : "wrap",
          }}
        >
          <code style={{
            flex         : 1,
            minWidth     : 0,
            wordBreak    : "break-all",
            fontFamily   : "var(--font-mono)",
            color        : "var(--accent)",
            fontSize     : ".9rem",
          }}>
            {url}
          </code>
          <button
            type="button"
            onClick={() => copy(url)}
            style={{
              background  : "var(--bg-hover)",
              border      : "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding     : "4px 10px",
              cursor      : "pointer",
              fontSize    : ".75rem",
              color       : copied === url ? "var(--success)" : "var(--text-secondary)",
            }}
          >
            {copied === url ? "تم النسخ" : "نسخ"}
          </button>
        </div>
      ))}
      <p style={{ margin: "10px 0 0", fontSize: ".76rem", color: "var(--text-muted)" }}>
        إذا لم يفتح: شغّل <strong>allow-network.bat</strong> من مجلد التثبيت (موافقة UAC)، وتأكد أن الشبكة «خاصة» وليست «عامة».
      </p>
      </>}
    </div>
  );
}
