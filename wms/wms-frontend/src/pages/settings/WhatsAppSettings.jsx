// ============================================================
//  src/pages/settings/WhatsAppSettings.jsx
//  ربط النظام بواتساب — للمدير فقط
// ============================================================
import { useState, useEffect, useRef, useCallback } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card }  from "@/components/ui/Card";
import Button    from "@/components/ui/Button";
import Input     from "@/components/ui/Input";
import api       from "@/services/api";

// ══════════════════════════════════════════════════════════
export default function WhatsAppSettings() {
  const [status,    setStatus   ] = useState(null);   // كائن الحالة من API
  const [qr,        setQR       ] = useState(null);   // dataURL
  const [loadingQR, setLoadingQR] = useState(false);
  const [connecting, setConn    ] = useState(false);
  const [loggingOut, setLogout  ] = useState(false);

  // حقل تجربة الإرسال
  const [testPhone, setTestPhone] = useState("");
  const [testMsg,   setTestMsg  ] = useState("مرحباً! هذه رسالة تجريبية من نظام Y-ai.");
  const [sending,   setSending  ] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  const pollRef = useRef(null);

  // ── جلب الحالة ────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.get("/whatsapp/status");
      setStatus(res);
      // إذا ظهر QR جاهزاً → اجلبه
      if (res.hasQR && !qr) fetchQR();
      // إذا اتصل → أوقف الـ polling وامسح QR
      if (res.status === "connected") {
        setQR(null);
        stopPolling();
      }
    } catch {}
  }, [qr]);

  // ── polling كل 3 ثوانٍ أثناء الانتظار ────────────────
  const startPolling = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(fetchStatus, 3000);
  };
  const stopPolling = () => {
    clearInterval(pollRef.current);
    pollRef.current = null;
  };

  useEffect(() => {
    fetchStatus();
    return () => stopPolling();
  }, []);

  // ── جلب QR ────────────────────────────────────────────
  const fetchQR = async () => {
    setLoadingQR(true);
    try {
      const res = await api.get("/whatsapp/qr");
      if (res.qr) {
        setQR(res.qr);
        startPolling();
      } else if (res.status === "connected") {
        setQR(null);
        fetchStatus();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingQR(false);
    }
  };

  // ── بدء الاتصال ───────────────────────────────────────
  const handleConnect = async () => {
    setConn(true);
    try {
      await api.post("/whatsapp/connect");
      setTimeout(fetchQR, 2000);
    } finally {
      setConn(false);
    }
  };

  // ── قطع الاتصال ───────────────────────────────────────
  const handleLogout = async () => {
    if (!confirm("قطع الاتصال بواتساب؟")) return;
    setLogout(true);
    try {
      await api.post("/whatsapp/logout");
      setQR(null);
      stopPolling();
      setTimeout(fetchStatus, 800);
    } finally {
      setLogout(false);
    }
  };

  // ── إرسال تجريبي ──────────────────────────────────────
  const handleTestSend = async (e) => {
    e.preventDefault();
    if (!testPhone.trim()) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await api.post("/whatsapp/send", {
        phone  : testPhone.trim(),
        message: testMsg,
      });
      setSendResult({ ok: true, text: `✅ أُرسلت بنجاح! ID: ${res.messageId || "—"}` });
    } catch (err) {
      setSendResult({ ok: false, text: `❌ فشل: ${err.message || err}` });
    } finally {
      setSending(false);
    }
  };

  const isConnected = status?.status === "connected";
  const isQrReady   = status?.status === "qr_ready";
  const isIdle      = !status || status.status === "idle" || status.status === "disconnected";
  const isError     = status?.status === "error";
  const isInit      = status?.status === "initializing";

  // ── لون ورمز الحالة ────────────────────────────────────
  const STATE_UI = {
    idle         : { color:"var(--text-muted)",  dot:"⚫", label:"غير مشغّل" },
    initializing : { color:"var(--warning)",     dot:"🟡", label:"جاري التشغيل..." },
    qr_ready     : { color:"var(--info)",        dot:"🔵", label:"في انتظار المسح" },
    connected    : { color:"var(--success)",     dot:"🟢", label:"متصل" },
    disconnected : { color:"var(--danger)",      dot:"🔴", label:"منقطع" },
    error        : { color:"var(--danger)",      dot:"❌", label:"خطأ" },
  };
  const ui = STATE_UI[status?.status || "idle"];

  return (
    <AppLayout title="ربط النظام بواتساب">
      <div style={{ maxWidth:640, margin:"0 auto", display:"flex", flexDirection:"column", gap:22 }}>

        {/* ── بطاقة الحالة ──────────────────────────────── */}
        <Card>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
            <div>
              <div style={{ fontSize:".75rem", color:"var(--text-muted)", fontWeight:700, textTransform:"uppercase", marginBottom:6 }}>
                حالة الاتصال
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:"1.6rem" }}>{ui?.dot}</span>
                <div>
                  <div style={{ fontWeight:800, fontSize:"1.05rem", color:ui?.color }}>
                    {ui?.label}
                  </div>
                  <div style={{ fontSize:".8rem", color:"var(--text-secondary)", marginTop:2 }}>
                    {status?.statusMsg || "—"}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display:"flex", gap:10 }}>
              {(isIdle || isError) && (
                <Button onClick={handleConnect} loading={connecting}>
                  📲 بدء الاتصال
                </Button>
              )}
              {(isQrReady || isInit) && (
                <Button variant="secondary" onClick={fetchQR} loading={loadingQR}>
                  ↺ تحديث QR
                </Button>
              )}
              {isConnected && (
                <Button variant="danger" onClick={handleLogout} loading={loggingOut}>
                  قطع الاتصال
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={fetchStatus}>
                ↺
              </Button>
            </div>
          </div>

          {/* تحذير المكتبة */}
          {!status?.isLibReady && (
            <div className="alert alert-warning" style={{ marginTop:16 }}>
              ⚠ مكتبة whatsapp-web.js غير مثبّتة.<br/>
              شغّل في مجلد الباك أند:<br/>
              <code style={{ fontFamily:"var(--font-mono)", fontSize:".82rem", background:"var(--bg-base)", padding:"2px 6px", borderRadius:4 }}>
                npm install whatsapp-web.js qrcode
              </code>
            </div>
          )}
        </Card>

        {/* ── كود QR ────────────────────────────────────── */}
        {(isQrReady || qr) && (
          <Card style={{ textAlign:"center" }}>
            <div style={{ fontSize:".76rem", fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", marginBottom:14 }}>
              امسح الكود بتطبيق واتساب
            </div>

            {loadingQR ? (
              <div style={{ padding:40 }}><span className="spinner" style={{ width:36, height:36 }}/></div>
            ) : qr ? (
              <>
                <div style={{ display:"inline-block", padding:10, background:"#fff", borderRadius:"var(--radius-md)", boxShadow:"var(--shadow-md)" }}>
                  <img src={qr} alt="WhatsApp QR Code"
                    style={{ width:240, height:240, display:"block" }}/>
                </div>
                <div style={{ marginTop:14, fontSize:".82rem", color:"var(--text-secondary)" }}>
                  افتح واتساب ← الأجهزة المرتبطة ← ربط جهاز ← امسح الكود
                </div>
                <div style={{ marginTop:8, fontSize:".75rem", color:"var(--text-muted)" }}>
                  🔄 يتجدد الكود تلقائياً كل 20 ثانية — هذه الصفحة تتابع الاتصال تلقائياً
                </div>
              </>
            ) : (
              <div style={{ padding:40, color:"var(--text-muted)" }}>
                جاري تحميل الكود...
              </div>
            )}
          </Card>
        )}

        {/* ── نجاح الاتصال ─────────────────────────────── */}
        {isConnected && (
          <div className="alert alert-success" style={{ display:"flex", alignItems:"center", gap:12, fontSize:"1rem" }}>
            <span style={{ fontSize:"1.8rem" }}>✅</span>
            <div>
              <strong>واتساب متصل بنجاح!</strong>
              <div style={{ fontSize:".83rem", marginTop:3, opacity:.85 }}>
                النظام جاهز لإرسال التنبيهات والرسائل التلقائية.
              </div>
            </div>
          </div>
        )}

        {/* ── إرسال تجريبي ──────────────────────────────── */}
        <Card>
          <div style={{ fontSize:".76rem", fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", marginBottom:14 }}>
            🧪 إرسال رسالة تجريبية
          </div>

          {!isConnected && (
            <div className="alert alert-warning" style={{ marginBottom:14, fontSize:".83rem" }}>
              يجب الاتصال أولاً لتتمكن من الإرسال
            </div>
          )}

          <form onSubmit={handleTestSend} style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <Input
              label="رقم الهاتف (بالصيغة الدولية)"
              value={testPhone}
              onChange={setTestPhone}
              placeholder="مثال: 9647701234567"
              hint="بدون + وبدون أصفار في البداية — العراق: 964XXXXXXXXXX"
            />
            <div>
              <label style={{ fontSize:".85rem", fontWeight:600, color:"var(--text-secondary)", display:"block", marginBottom:5 }}>
                نص الرسالة
              </label>
              <textarea
                value={testMsg}
                onChange={(e) => setTestMsg(e.target.value)}
                rows={3}
                style={{ width:"100%", padding:"10px 12px", background:"var(--bg-input)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", color:"var(--text-primary)", fontFamily:"var(--font-main)", fontSize:".9rem", outline:"none", resize:"vertical" }}
              />
            </div>

            {sendResult && (
              <div className={`alert alert-${sendResult.ok ? "success" : "error"}`}>
                {sendResult.text}
              </div>
            )}

            <div style={{ display:"flex", justifyContent:"flex-end" }}>
              <Button type="submit" loading={sending} disabled={!isConnected}>
                📤 إرسال
              </Button>
            </div>
          </form>
        </Card>

        {/* ── دليل الاستخدام ───────────────────────────── */}
        <Card style={{ background:"var(--bg-hover)" }}>
          <div style={{ fontSize:".76rem", fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", marginBottom:12 }}>
            📖 كيفية الاستخدام
          </div>
          {[
            { n:"1", t:"تثبيت المكتبة",  d:"npm install whatsapp-web.js qrcode (مرة واحدة فقط)" },
            { n:"2", t:"الاتصال",         d:"اضغط 'بدء الاتصال' وانتظر ظهور كود QR" },
            { n:"3", t:"المسح",           d:"افتح واتساب ← الأجهزة المرتبطة ← امسح الكود" },
            { n:"4", t:"الاستخدام",       d:"يمكنك الآن إرسال رسائل من صفحة المندوبين والفواتير" },
          ].map((s) => (
            <div key={s.n} style={{ display:"flex", gap:12, marginBottom:10 }}>
              <span style={{ fontFamily:"var(--font-mono)", fontWeight:800, color:"var(--accent)", fontSize:".8rem", minWidth:20, flexShrink:0 }}>{s.n}</span>
              <div>
                <div style={{ fontWeight:700, fontSize:".85rem" }}>{s.t}</div>
                <div style={{ fontSize:".8rem", color:"var(--text-secondary)" }}>{s.d}</div>
              </div>
            </div>
          ))}
        </Card>

      </div>
    </AppLayout>
  );
}
