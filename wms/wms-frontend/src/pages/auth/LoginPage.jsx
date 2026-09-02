// ============================================================
//  src/pages/auth/LoginPage.jsx
//  شاشة تسجيل الدخول الكاملة
//
//  المراحل:
//   CHECKING   → جارٍ التحقق من حالة النظام
//   SIGNIN     → نموذج الدخول العادي
//   SETUP      → أول تشغيل — إنشاء حساب المدير الأول
//   DONE       → نجاح الإعداد → العودة للدخول
// ============================================================
import { useState, useEffect }  from "react";
import { useNavigate }          from "react-router-dom";
import { useAuth }              from "@/context/AuthContext";
import { useLanguage }          from "@/context/LanguageContext";
import { authService }          from "@/services/api";
import { licenseService }       from "@/services/api";
import NetworkAccessBox         from "@/components/ui/NetworkAccessBox";
import Button                   from "@/components/ui/Button";
import Input                    from "@/components/ui/Input";
import Modal                    from "@/components/ui/Modal";

const EyeIcon    = () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const EyeOffIcon = () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
const UserIcon   = () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const LockIcon   = () => <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;

function Card({ children, style = {} }) {
  return (
    <div style={{
      background  : "var(--bg-card)",
      border      : "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      padding     : "28px 24px",
      boxShadow   : "var(--shadow-md)",
      ...style,
    }}>
      {children}
    </div>
  );
}

function StepRow({ number, label, done }) {
  return (
    <div style={{
      display     : "flex",
      alignItems  : "center",
      gap         : 12,
      padding     : "10px 14px",
      background  : done ? "var(--success-bg)" : "var(--bg-hover)",
      border      : `1px solid ${done ? "var(--success)" : "var(--border)"}`,
      borderRadius: "var(--radius-sm)",
    }}>
      <span style={{
        fontFamily: "var(--font-mono)",
        fontSize  : ".75rem",
        color     : done ? "var(--success)" : "var(--text-muted)",
        fontWeight: 700,
        width     : 18,
        textAlign : "center",
      }}>
        {done ? "✓" : number}
      </span>
      <span style={{ fontSize: ".88rem", color: done ? "var(--success)" : "var(--text-primary)" }}>
        {label}
      </span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
export default function LoginPage() {
  const navigate = useNavigate();
  const { login, setupAdmin, checkFirstRun, isLoggedIn, isLoading, error, clearError } = useAuth();
  const { t } = useLanguage();

  const [phase,       setPhase      ] = useState("CHECKING");
  const [userName,    setUserName   ] = useState("");
  const [password,    setPassword   ] = useState("");
  const [showPass,    setShowPass   ] = useState(false);
  const [adminName,   setAdminName  ] = useState("");
  const [adminPass,   setAdminPass  ] = useState("");
  const [adminPass2,  setAdminPass2 ] = useState("");
  const [loading,     setLoading    ] = useState(false);
  const [localError,  setLocalError ] = useState("");
  const [successName, setSuccessName] = useState("");
  const [hintOpen,      setHintOpen     ] = useState(false);
  const [hintPass,      setHintPass     ] = useState("");
  const [hintLoading,   setHintLoading  ] = useState(false);
  const [hintError,     setHintError    ] = useState("");
  const [hintResult,    setHintResult   ] = useState(null);
  const [networkUrls,   setNetworkUrls  ] = useState([]);

  // بعد الدخول: لوحة القيادة إن كان مفعّلاً، وإلا صفحة التفعيل فوراً (بدون تحديث يدوي)
  const redirectAfterAuth = async () => {
    try {
      const res = await licenseService.getStatus();
      navigate(res?.activated ? "/dashboard" : "/activate", { replace: true });
    } catch {
      navigate("/activate", { replace: true });
    }
  };

  // ── كشف أول تشغيل / إعادة توجيه من جلسة محفوظة ──────────
  useEffect(() => {
    if (isLoading) return;

    let cancelled = false;
    const watchdog = setTimeout(() => {
      if (cancelled) return;
      setPhase("SIGNIN");
      setLocalError("استغرق الاتصال وقتاً طويلاً — تحقق من تشغيل الخادم ثم حدّث الصفحة");
    }, 15000);

    (async () => {
      try {
        if (isLoggedIn) {
          await redirectAfterAuth();
          return;
        }
        const first = await checkFirstRun();
        if (!cancelled) setPhase(first ? "SETUP" : "SIGNIN");
      } catch (err) {
        if (!cancelled) {
          setPhase("SIGNIN");
          setLocalError(err?.message || "تعذر الاتصال بالخادم — تحقق من تشغيل البرنامج");
        }
      } finally {
        clearTimeout(watchdog);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
    };
  }, [isLoading, isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    licenseService.getStatus()
      .then((res) => setNetworkUrls(res.networkUrls || []))
      .catch(() => {});
  }, []);

  const openHint = () => {
    setHintOpen(true);
    setHintPass("");
    setHintError("");
    setHintResult(null);
  };

  const closeHint = () => {
    setHintOpen(false);
    setHintPass("");
    setHintError("");
    setHintResult(null);
  };

  const handleHintVerify = async (e) => {
    e.preventDefault();
    setHintError("");
    setHintResult(null);
    if (!hintPass.trim()) {
      setHintError("أدخل كلمة التحقيق");
      return;
    }
    setHintLoading(true);
    try {
      const res = await authService.adminHint(hintPass.trim());
      setHintResult({ userName: res.userName, password: res.password, message: res.message });
    } catch (err) {
      setHintError(err?.message || "اتصل بالمبرمج Gavan 07504505340");
    } finally {
      setHintLoading(false);
    }
  };

  const visibleError = localError || error;
  const clearAll = () => { setLocalError(""); clearError(); };

  // ── تسجيل الدخول ───────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    clearAll();
    if (!userName.trim() || !password.trim()) {
      setLocalError("يرجى إدخال اسم المستخدم وكلمة المرور");
      return;
    }
    setLoading(true);
    try {
      await login(userName.trim(), password);
      await redirectAfterAuth();
    } catch { /* الخطأ في context */ }
    finally { setLoading(false); }
  };

  // ── إنشاء المدير ───────────────────────────────────────
  const handleSetupAdmin = async (e) => {
    e.preventDefault();
    clearAll();
    if (!adminName.trim())        { setLocalError("اسم المدير مطلوب"); return; }
    if (adminPass.length < 6)     { setLocalError("كلمة المرور يجب أن تكون 6 أحرف على الأقل"); return; }
    if (adminPass !== adminPass2) { setLocalError("كلمتا المرور غير متطابقتين"); return; }
    setLoading(true);
    try {
      await setupAdmin(adminName.trim(), adminPass);
      setSuccessName(adminName.trim());
      setPhase("DONE");
    } catch (err) {
      if (err?.status === 409 || String(err?.message || "").includes("مدير")) {
        setPhase("SIGNIN");
        setLocalError("تم إنشاء المدير مسبقاً — سجّل الدخول باسم المستخدم وكلمة المرور");
      }
    }
    finally { setLoading(false); }
  };

  // ── مرحلة التحقق ───────────────────────────────────────
  if (phase === "CHECKING") {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", background: "var(--bg-base)",
        flexDirection: "column", gap: 16,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: "50%",
          border: "3px solid var(--border)",
          borderTopColor: "var(--accent)",
          animation: "spin 1s linear infinite",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ color: "var(--text-muted)", fontSize: ".9rem" }}>جارٍ تهيئة النظام…</p>
      </div>
    );
  }

  return (
    <div className="login-root" style={{ minHeight: "100vh", display: "flex", background: "var(--bg-base)" }}>
      <style>{`
        @media (max-width: 1100px) {
          .login-root {
            min-height: 100svh !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 18px 12px !important;
            box-sizing: border-box !important;
            overflow-x: hidden !important;
          }
          .login-hero {
            display: none !important;
          }
          .login-pane {
            flex: 0 1 100% !important;
            min-height: auto !important;
            padding: 0 !important;
            align-items: center !important;
            justify-content: center !important;
          }
          .login-form-wrap {
            max-width: 420px !important;
            margin: 0 auto !important;
          }
          .login-network-mobile-hide {
            display: none !important;
          }
        }
      `}</style>

      {/* ── الجانب التزييني ──────────────────────────────── */}
      <div className="login-hero" style={{
        display       : "flex",
        flex          : "0 0 420px",
        flexDirection : "column",
        alignItems    : "center",
        justifyContent: "center",
        gap           : 32,
        padding       : 48,
        background    : `
          radial-gradient(ellipse at 30% 40%, rgba(212,160,18,.15) 0%, transparent 55%),
          radial-gradient(ellipse at 75% 70%, rgba(88,166,255,.06) 0%, transparent 50%),
          var(--bg-surface)`,
        borderLeft    : "1px solid var(--border-subtle)",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            display       : "inline-flex",
            alignItems    : "center",
            justifyContent: "center",
            width : 80, height: 80,
            borderRadius  : "var(--radius-lg)",
            background    : "var(--accent-glow)",
            border        : "1px solid var(--accent)",
            color         : "var(--accent)",
            marginBottom  : 20,
            boxShadow     : "var(--shadow-glow)",
          }}>
            <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.4" viewBox="0 0 24 24">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <h1 style={{ fontSize: "1.9rem", fontWeight: 900, color: "var(--text-primary)", lineHeight: 1.3 }}>
            <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}>Y-ai</span>
            <br/>
            نظام إدارة<br/>
            <span style={{ color: "var(--accent)" }}>المستودعات</span>
          </h1>
          <p style={{ color: "var(--text-secondary)", marginTop: 10, fontSize: ".95rem" }}>
            إدارة متكاملة للمخزون والمبيعات
          </p>
        </div>

        {[
          { icon: "📦", title: t("login.featStock"),    desc: t("login.featStockDesc") },
          { icon: "🧾", title: t("login.featInvoices"), desc: t("login.featInvoicesDesc") },
          { icon: "📊", title: t("login.featReports"),  desc: t("login.featReportsDesc") },
        ].map((f) => (
          <div key={f.title} style={{
            display     : "flex",
            alignItems  : "center",
            gap         : 14,
            padding     : "14px 18px",
            background  : "var(--bg-card)",
            border      : "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            width       : "100%",
            maxWidth    : 320,
          }}>
            <span style={{ fontSize: "1.5rem" }}>{f.icon}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: ".9rem", color: "var(--text-primary)" }}>{f.title}</div>
              <div style={{ fontSize: ".8rem", color: "var(--text-muted)", marginTop: 2 }}>{f.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── النموذج ──────────────────────────────────────── */}
      <div className="login-pane" style={{
        flex          : 1,
        display       : "flex",
        alignItems    : "center",
        justifyContent: "center",
        padding       : "32px 20px",
      }}>
        <div className="animate-fade-in login-form-wrap" style={{ width: "100%", maxWidth: 440 }}>

          {/* رأس */}
          <div style={{ marginBottom: 28, textAlign: "center" }}>
            <h2 style={{ fontSize: "1.55rem", fontWeight: 800, color: "var(--text-primary)" }}>
              {phase === "SIGNIN" ? t("login.signInTitle") :
               phase === "SETUP"  ? "إعداد النظام — أول تشغيل" :
               "تم الإعداد بنجاح!"}
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: ".88rem", marginTop: 6 }}>
              {phase === "SIGNIN" ? t("login.subtitle") :
               phase === "SETUP"  ? "أنشئ حساب المدير الأول للبدء" :
               "تم إنشاء حساب المدير. يمكنك الدخول الآن"}
            </p>
          </div>

          {/* خطأ */}
          {visibleError && (
            <div className="alert alert-error animate-fade-in" style={{ marginBottom: 18 }}>
              ⚠ {visibleError}
            </div>
          )}

          {/* ════ SIGNIN ════ */}
          {phase === "SIGNIN" && (
            <form onSubmit={handleLogin}>
              <Card>
                <Input
                  label={t("login.username")}
                  value={userName}
                  onChange={(v) => { setUserName(v); clearAll(); }}
                  placeholder={t("login.usernamePh")}
                  prefix={<UserIcon />}
                  autoFocus
                  style={{ marginBottom: 16 }}
                />
                <Input
                  label={t("login.password")}
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(v) => { setPassword(v); clearAll(); }}
                  placeholder={t("login.passwordPh")}
                  prefix={<LockIcon />}
                  suffix={
                    <span onClick={() => setShowPass(!showPass)}
                      style={{ cursor: "pointer", color: "var(--text-muted)", display: "flex" }}>
                      {showPass ? <EyeOffIcon /> : <EyeIcon />}
                    </span>
                  }
                  style={{ marginBottom: 24 }}
                />
                <Button type="submit" fullWidth size="lg" loading={loading}>
                  {loading ? t("login.signingIn") : `${t("login.signIn")} →`}
                </Button>

                <div style={{ marginTop: 16, textAlign: "center" }}>
                  <button
                    type="button"
                    onClick={openHint}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--accent)",
                      cursor: "pointer",
                      fontSize: ".85rem",
                      fontWeight: 700,
                      textDecoration: "underline",
                      fontFamily: "var(--font-main)",
                    }}
                  >
                    Hint
                  </button>
                </div>
              </Card>
            </form>
          )}

          {/* ════ SETUP — أول تشغيل ════ */}
          {phase === "SETUP" && (
            <form onSubmit={handleSetupAdmin}>
              <Card>
                <div style={{
                  display     : "flex",
                  alignItems  : "flex-start",
                  gap         : 12,
                  padding     : "14px 16px",
                  background  : "var(--warning-bg)",
                  border      : "1px solid var(--warning)",
                  borderRadius: "var(--radius-md)",
                  marginBottom: 18,
                }}>
                  <span style={{ fontSize: "1.4rem", lineHeight: 1 }}>🔑</span>
                  <div>
                    <div style={{ fontWeight: 700, color: "var(--warning)", fontSize: ".93rem" }}>
                      أول تشغيل للنظام
                    </div>
                    <div style={{ fontSize: ".82rem", color: "var(--text-secondary)", marginTop: 4 }}>
                      لم يُعثر على أي مستخدمين. أنشئ حساب المدير الأول الآن.
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                  <StepRow number="01" label="اكتشاف النظام فارغاً"         done={true}  />
                  <StepRow number="02" label="إنشاء حساب مدير البرنامج"     done={false} />
                  <StepRow number="03" label="بدء استخدام النظام الكامل"    done={false} />
                </div>

                <div style={{
                  fontSize    : ".82rem",
                  color       : "var(--info)",
                  background  : "var(--info-bg)",
                  border      : "1px solid var(--info)",
                  borderRadius: "var(--radius-sm)",
                  padding     : "10px 14px",
                  marginBottom: 20,
                }}>
                  🛡 هذا الحساب سيمتلك كامل الصلاحيات — احتفظ بكلمة المرور بأمان
                </div>

                <Input
                  label="اسم مستخدم المدير"
                  value={adminName}
                  onChange={(v) => { setAdminName(v); clearAll(); }}
                  placeholder="مثال: admin"
                  prefix={<UserIcon />}
                  autoFocus
                  style={{ marginBottom: 14 }}
                />
                <Input
                  label="كلمة المرور (6 أحرف على الأقل)"
                  type="password"
                  value={adminPass}
                  onChange={(v) => { setAdminPass(v); clearAll(); }}
                  placeholder="••••••••"
                  prefix={<LockIcon />}
                  style={{ marginBottom: 14 }}
                />
                <Input
                  label="تأكيد كلمة المرور"
                  type="password"
                  value={adminPass2}
                  onChange={(v) => { setAdminPass2(v); clearAll(); }}
                  placeholder="••••••••"
                  prefix={<LockIcon />}
                  error={adminPass2 && adminPass !== adminPass2 ? "كلمتا المرور غير متطابقتين" : ""}
                  style={{ marginBottom: 24 }}
                />

                <Button type="submit" loading={loading} fullWidth size="lg">
                  {loading ? "جارٍ الإنشاء..." : "إنشاء حساب المدير →"}
                </Button>
              </Card>
            </form>
          )}

          {/* ════ DONE ════ */}
          {phase === "DONE" && (
            <Card style={{ textAlign: "center" }}>
              <div style={{ fontSize: "3.5rem", marginBottom: 12 }}>✅</div>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--success)", marginBottom: 10 }}>
                تم إنشاء حساب المدير!
              </h3>
              <p style={{ color: "var(--text-secondary)", fontSize: ".88rem", marginBottom: 24 }}>
                النظام جاهز للاستخدام الكامل.
                <br />
                سجّل الدخول باستخدام الحساب الجديد.
              </p>

              <div style={{
                background  : "var(--bg-hover)",
                borderRadius: "var(--radius-md)",
                padding     : "12px 16px",
                marginBottom: 24,
                textAlign   : "right",
              }}>
                <div style={{ fontSize: ".78rem", color: "var(--text-muted)", marginBottom: 4 }}>اسم المستخدم</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", color: "var(--accent)", fontWeight: 700 }}>
                  {successName}
                </div>
              </div>

              <Button fullWidth size="lg" onClick={() => {
                setPhase("SIGNIN");
                setUserName(successName);
                setAdminName(""); setAdminPass(""); setAdminPass2("");
                clearAll();
              }}>
                تسجيل الدخول الآن
              </Button>
            </Card>
          )}

          <p style={{ textAlign: "center", fontSize: ".76rem", color: "var(--text-muted)", marginTop: 24 }}>
            Y-ai — نظام المستودعات — v2.5.3
          </p>

          <div className="login-network-mobile-hide">
            <NetworkAccessBox urls={networkUrls} compact />
          </div>
        </div>
      </div>

      {hintOpen && (
        <Modal title="Hint — استرجاع بيانات المدير" onClose={closeHint} width={420}>
          {!hintResult ? (
            <form onSubmit={handleHintVerify}>
              <p style={{ color: "var(--text-secondary)", fontSize: ".88rem", marginBottom: 16 }}>
                أدخل كلمة تحقيق المبرمج لعرض بيانات المدير الأول.
              </p>
              {hintError && (
                <div className="alert alert-error" style={{ marginBottom: 14 }}>⚠ {hintError}</div>
              )}
              <Input
                label="كلمة التحقيق"
                type="password"
                value={hintPass}
                onChange={setHintPass}
                prefix={<LockIcon />}
                autoFocus
                style={{ marginBottom: 18 }}
              />
              <Button type="submit" fullWidth loading={hintLoading}>
                تحقق
              </Button>
            </form>
          ) : (
            <div>
              <div className="alert alert-success" style={{ marginBottom: 16 }}>
                ✓ {hintResult.message}
              </div>
              <div style={{
                background: "var(--bg-hover)",
                borderRadius: "var(--radius-md)",
                padding: "14px 16px",
                marginBottom: 12,
              }}>
                <div style={{ fontSize: ".78rem", color: "var(--text-muted)", marginBottom: 4 }}>اسم المستخدم</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", color: "var(--accent)", fontWeight: 700 }}>
                  {hintResult.userName}
                </div>
              </div>
              <div style={{
                background: "var(--bg-hover)",
                borderRadius: "var(--radius-md)",
                padding: "14px 16px",
                marginBottom: 18,
              }}>
                <div style={{ fontSize: ".78rem", color: "var(--text-muted)", marginBottom: 4 }}>كلمة المرور</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", color: "var(--text-primary)", fontWeight: 700 }}>
                  {hintResult.password || (
                    <span style={{ color: "var(--warning)", fontSize: ".88rem", fontWeight: 600 }}>
                      سجّل الدخول مرة كمدير ثم أعد Hint
                    </span>
                  )}
                </div>
              </div>
              <Button fullWidth onClick={closeHint}>إغلاق</Button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
