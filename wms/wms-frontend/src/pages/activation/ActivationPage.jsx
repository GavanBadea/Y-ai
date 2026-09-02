// ============================================================
//  src/pages/activation/ActivationPage.jsx
//  صفحة تفعيل الترخيص — تظهر قبل أي استخدام للبرنامج
// ============================================================
import { useState, useEffect } from "react";
import { useNavigate }      from "react-router-dom";
import { licenseService }   from "@/services/api";
import NetworkAccessBox     from "@/components/ui/NetworkAccessBox";

const CopyIcon = () => (
  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <rect x="9" y="9" width="13" height="13" rx="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

export default function ActivationPage() {
  const navigate = useNavigate();
  const [hash,       setHash      ] = useState("...");
  const [key,        setKey       ] = useState("");
  const [loading,    setLoading   ] = useState(false);
  const [error,      setError     ] = useState("");
  const [success,    setSuccess   ] = useState(false);
  const [copied,     setCopied    ] = useState(false);
  const [networkUrls,setNetworkUrls] = useState([]);

  // جلب هاش الجهاز عند التحميل (مع إعادة محاولة — لا تعليق)
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const loadStatus = async () => {
      while (!cancelled && attempts < 20) {
        attempts += 1;
        try {
          const res = await licenseService.getStatus();
          if (cancelled) return;
          if (res.activated) {
            window.dispatchEvent(new Event("wms:license-activated"));
            navigate("/dashboard", { replace: true });
            return;
          }
          setHash(res.hash || "غير متاح");
          setNetworkUrls(res.networkUrls || []);
          return;
        } catch {
          if (attempts >= 20) {
            setHash("خطأ — تأكد من تشغيل الخادم ثم حدّث الصفحة");
            return;
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    };

    loadStatus();
    return () => { cancelled = true; };
  }, [navigate]);

  const handleCopy = () => {
    navigator.clipboard.writeText(hash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const goToDashboard = () => {
    // أخبر التطبيق أن التفعيل اكتمل قبل التنقّل — يمنع الشاشة السوداء
    window.dispatchEvent(new Event("wms:license-activated"));
    navigate("/dashboard", { replace: true });
  };

  const handleActivate = async (e) => {
    e.preventDefault();
    setError("");
    if (!key.trim()) { setError("يرجى إدخال مفتاح التفعيل"); return; }
    setLoading(true);
    try {
      await licenseService.activate(key.trim());
      setSuccess(true);

      // انتظر حتى يؤكد الخادم التفعيل ثم انتقل
      let activated = false;
      for (let i = 0; i < 12; i++) {
        try {
          const res = await licenseService.getStatus();
          if (res?.activated) { activated = true; break; }
        } catch { /* إعادة المحاولة */ }
        await new Promise((r) => setTimeout(r, 250));
      }

      if (!activated) {
        setError("تم الحفظ لكن التفعيل لم يُؤكَّد بعد — أعد تشغيل البرنامج");
        setSuccess(false);
        return;
      }

      setTimeout(goToDashboard, 500);
    } catch (err) {
      setError(err.message || "مفتاح التفعيل غير صحيح");
      setSuccess(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight     : "100vh",
      display       : "flex",
      alignItems    : "center",
      justifyContent: "center",
      background    : "var(--bg-base)",
      padding       : 24,
      direction     : "rtl",
    }}>
      <div style={{ width: "100%", maxWidth: 520 }}>

        {/* شعار */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            display       : "inline-flex",
            alignItems    : "center",
            justifyContent: "center",
            width         : 72,
            height        : 72,
            borderRadius  : "var(--radius-lg)",
            background    : "var(--accent-glow)",
            border        : "1px solid var(--accent)",
            color         : "var(--accent)",
            marginBottom  : 16,
            boxShadow     : "var(--shadow-glow)",
          }}>
            <svg width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.4" viewBox="0 0 24 24">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <h1 style={{ fontSize: "1.7rem", fontWeight: 900, color: "var(--text-primary)" }}>
            <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>Y-ai</span>
            {" "}للمستودعات
          </h1>
          <p style={{ color: "var(--text-secondary)", marginTop: 6, fontSize: ".9rem" }}>
            تفعيل حقوق الملكية
          </p>
        </div>

        {/* البطاقة الرئيسية */}
        <div style={{
          background  : "var(--bg-card)",
          border      : "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding     : "28px 24px",
          boxShadow   : "var(--shadow-md)",
        }}>

          {success ? (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ fontSize: "3.5rem", marginBottom: 12 }}>🎉</div>
              <h3 style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--success)", marginBottom: 8 }}>
                تم التفعيل بنجاح!
              </h3>
              <p style={{ color: "var(--text-secondary)", fontSize: ".9rem", marginBottom: 20 }}>
                جارٍ فتح البرنامج…
              </p>
              <button
                type="button"
                onClick={goToDashboard}
                style={{
                  width       : "100%",
                  padding     : "13px",
                  background  : "var(--accent)",
                  color       : "#fff",
                  border      : "none",
                  borderRadius: "var(--radius-md)",
                  fontFamily  : "var(--font-main)",
                  fontSize    : "1rem",
                  fontWeight  : 700,
                  cursor      : "pointer",
                }}
              >
                متابعة إلى لوحة القيادة →
              </button>
            </div>
          ) : (
            <>
              {/* رسالة توضيحية */}
              <div style={{
                display     : "flex",
                gap         : 12,
                padding     : "14px 16px",
                background  : "rgba(251,191,36,.08)",
                border      : "1px solid rgba(251,191,36,.3)",
                borderRadius: "var(--radius-md)",
                marginBottom: 24,
              }}>
                <span style={{ fontSize: "1.3rem" }}>🔐</span>
                <div style={{ fontSize: ".85rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                  يحتاج البرنامج إلى تفعيل حقوق الملكية.
                  <br />
                  أرسل <strong style={{ color: "var(--accent)" }}>رمز الجهاز</strong> أدناه إلى المبرمج للحصول على مفتاح التفعيل.
                </div>
              </div>

              {/* رمز الجهاز */}
              <div style={{ marginBottom: 24 }}>
                <label style={{ fontSize: ".82rem", color: "var(--text-muted)", display: "block", marginBottom: 8 }}>
                  رمز الجهاز (أرسله إلى المبرمج)
                </label>
                <div style={{
                  display     : "flex",
                  alignItems  : "center",
                  gap         : 10,
                  background  : "var(--bg-surface)",
                  border      : "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding     : "12px 16px",
                }}>
                  <span style={{
                    flex       : 1,
                    fontFamily : "var(--font-mono)",
                    fontSize   : "1.4rem",
                    letterSpacing: "0.18em",
                    color      : "var(--accent)",
                    fontWeight : 700,
                    userSelect : "all",
                  }}>
                    {hash}
                  </span>
                  <button
                    onClick={handleCopy}
                    title="نسخ الرمز"
                    style={{
                      background  : copied ? "var(--success-bg)" : "var(--bg-hover)",
                      border      : `1px solid ${copied ? "var(--success)" : "var(--border)"}`,
                      borderRadius: "var(--radius-sm)",
                      padding     : "8px",
                      cursor      : "pointer",
                      color       : copied ? "var(--success)" : "var(--text-secondary)",
                      display     : "flex",
                      alignItems  : "center",
                      gap         : 4,
                      fontSize    : ".8rem",
                      transition  : "all .2s",
                    }}
                  >
                    <CopyIcon />
                    {copied ? "تم النسخ" : "نسخ"}
                  </button>
                </div>
              </div>

              {/* معلومات التواصل */}
              <div style={{
                display     : "flex",
                alignItems  : "center",
                gap         : 10,
                padding     : "12px 16px",
                background  : "var(--bg-surface)",
                border      : "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                marginBottom : 24,
              }}>
                <span style={{ fontSize: "1.2rem" }}>📱</span>
                <div style={{ fontSize: ".85rem" }}>
                  <div style={{ color: "var(--text-muted)", marginBottom: 2 }}>تواصل مع المبرمج</div>
                  <div style={{ color: "var(--text-primary)", fontWeight: 700 }}>Gavan — 07504505340</div>
                </div>
              </div>

              {/* خطأ */}
              {error && (
                <div style={{
                  display     : "flex",
                  alignItems  : "center",
                  gap         : 8,
                  padding     : "10px 14px",
                  background  : "var(--danger-bg)",
                  border      : "1px solid var(--danger)",
                  borderRadius: "var(--radius-sm)",
                  marginBottom: 16,
                  fontSize    : ".85rem",
                  color       : "var(--danger)",
                }}>
                  ⚠ {error}
                </div>
              )}

              {/* إدخال مفتاح التفعيل */}
              <form onSubmit={handleActivate}>
                <label style={{ fontSize: ".82rem", color: "var(--text-muted)", display: "block", marginBottom: 8 }}>
                  مفتاح التفعيل (يصلك من المبرمج)
                </label>
                <input
                  value={key}
                  onChange={(e) => { setKey(e.target.value.toUpperCase()); setError(""); }}
                  placeholder="XXXXXXXXXXXXXXXX"
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    width       : "100%",
                    padding     : "12px 16px",
                    background  : "var(--bg-surface)",
                    border      : `1px solid ${error ? "var(--danger)" : "var(--border)"}`,
                    borderRadius: "var(--radius-md)",
                    color       : "var(--text-primary)",
                    fontFamily  : "var(--font-mono)",
                    fontSize    : "1.05rem",
                    letterSpacing: "0.1em",
                    outline     : "none",
                    marginBottom: 16,
                    boxSizing   : "border-box",
                    textAlign   : "center",
                  }}
                />
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width       : "100%",
                    padding     : "13px",
                    background  : loading ? "var(--bg-hover)" : "var(--accent)",
                    color       : loading ? "var(--text-muted)" : "#fff",
                    border      : "none",
                    borderRadius: "var(--radius-md)",
                    fontFamily  : "var(--font-main)",
                    fontSize    : "1rem",
                    fontWeight  : 700,
                    cursor      : loading ? "not-allowed" : "pointer",
                    transition  : "opacity .2s",
                  }}
                >
                  {loading ? "جارٍ التحقق…" : "تفعيل البرنامج →"}
                </button>
              </form>
              <NetworkAccessBox urls={networkUrls} compact />
            </>
          )}
        </div>

        <p style={{ textAlign: "center", fontSize: ".76rem", color: "var(--text-muted)", marginTop: 20 }}>
          Y-ai للمستودعات — v2.5.3 — جميع الحقوق محفوظة
        </p>
      </div>
    </div>
  );
}
