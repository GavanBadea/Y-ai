// src/components/layout/AppLayout.jsx
// الهيكل العام — يحتوي على: Header، Sidebar، Content، Y-ai
import { useState, useCallback } from "react";
import { useServerHeartbeat } from "@/hooks/useServerHeartbeat";
import { useLocation } from "react-router-dom";
import YAiChat             from "@/components/ai/YAiChat";
import PageTransition      from "./PageTransition";
import Sidebar             from "./Sidebar";
import BrandMark           from "./BrandMark";
import StockAlertBar       from "./StockAlertBar";
import ExpiredAlertBanner  from "./ExpiredAlertBanner";
import MobileBottomNav     from "./MobileBottomNav";
import MobileDashboardShortcuts from "./MobileDashboardShortcuts";
import FiscalYearBadge          from "./FiscalYearBadge";
import WorkTabsBar              from "./WorkTabsBar";
import { useTheme }        from "@/context/ThemeContext";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { useLanguage }     from "@/context/LanguageContext";
import { useIsMobile }     from "@/hooks/useIsMobile";
import { useAppUpdateCheck } from "@/hooks/useAppUpdateCheck";
import Modal from "@/components/ui/Modal";

function IconMenu() {
  return (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
      <path d="M3 12h18M3 6h18M3 18h18" />
    </svg>
  );
}

// ── أيقونات الثيم ──────────────────────────────────────────────
function IconSun() {
  return (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>   <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>   <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}
function IconMoon() {
  return (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}
function IconGlass() {
  return (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="3" strokeDasharray="3 2"/>
      <circle cx="12" cy="12" r="4" strokeDasharray="3 2"/>
    </svg>
  );
}

const THEMES = [
  { id:"dark",  labelKey:"layout.themeDark",  Icon:IconMoon  },
  { id:"light", labelKey:"layout.themeLight", Icon:IconSun   },
  { id:"glass", labelKey:"layout.themeGlass", Icon:IconGlass },
];

export default function AppLayout({ children, title, actions }) {
  const [collapsed, setCollapsed]        = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const isMobile = useIsMobile();
  const location = useLocation();
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const { isOnline, ping } = useServerHeartbeat();
  const openMobileNav  = useCallback(() => setMobileNavOpen(true), []);
  const { theme, setTheme }              = useTheme();
  const { isArabic, toggle: toggleNums } = useNumberLocale();
  const { t, translateTitle } = useLanguage();
  const updateState = useAppUpdateCheck();
  const displayTitle = title ? translateTitle(title) : "";
  const latestNotes = updateState.latest?.notes || [];

  return (
    <div className="app-shell" style={{ display:"flex", minHeight:"100vh", background:"var(--bg-base)" }}>
      <div
        className={`mobile-nav-overlay${mobileNavOpen ? " mobile-nav-overlay--visible" : ""}`}
        onClick={closeMobileNav}
        aria-hidden={!mobileNavOpen}
      />
      <Sidebar
        collapsed={isMobile ? false : collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        mobileOpen={mobileNavOpen}
        onMobileClose={closeMobileNav}
      />

      <div className="app-main-col" style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0 }}>

        {/* ── شريط انقطاع الاتصال ────────────────────────────── */}
        {!isOnline && (
          <div style={{
            background  : "var(--danger, #ef4444)",
            color       : "#fff",
            padding     : "8px 20px",
            fontSize    : ".85rem",
            fontWeight  : 600,
            display     : "flex",
            alignItems  : "center",
            justifyContent: "center",
            gap         : 10,
            zIndex      : 100,
          }}>
            <span>⚠</span>
            <span>انقطع الاتصال بالخادم — يتم إعادة المحاولة تلقائياً</span>
            <button
              onClick={ping}
              style={{
                background: "rgba(255,255,255,.2)", border: "1px solid rgba(255,255,255,.4)",
                color: "#fff", borderRadius: 6, padding: "3px 10px", cursor: "pointer",
                fontSize: ".8rem", fontFamily: "inherit",
              }}
            >
              إعادة الاتصال
            </button>
          </div>
        )}

        {/* ── Header ──────────────────────────────────────────── */}
        <header className="app-header" style={{
          padding       : "0 22px",
          height        : 56,
          borderBottom  : "1px solid var(--border-subtle)",
          display       : "flex",
          alignItems    : "center",
          justifyContent: "space-between",
          background    : "var(--bg-surface)",
          position      : "sticky",
          top           : 0,
          zIndex        : 10,
          flexShrink    : 0,
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}>
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={openMobileNav}
            aria-label="فتح القائمة"
          >
            <IconMenu />
          </button>
          <div className="app-header-title-wrap" style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <span className="app-header-brand"><BrandMark size="sm" /></span>
            {displayTitle && (
              <>
                <span className="app-header-divider" style={{ color: "var(--border)", fontSize: "1.1rem", fontWeight: 300 }}>|</span>
                <h1 style={{
                  fontSize  : "1.05rem",
                  fontWeight: 800,
                  color     : "var(--text-primary)",
                  margin    : 0,
                  textShadow: "var(--glass-text-shadow,none)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {displayTitle}
                </h1>
              </>
            )}
          </div>

          <div className="app-header-end">
            {actions && (
              <div className="app-header-page-actions">{actions}</div>
            )}
            <div className="app-header-tools" style={{ display:"flex", alignItems:"center", gap:10 }}>
            <FiscalYearBadge />
            <StockAlertBar />

            {/* ── تبديل الأرقام ──────────────────────────── */}
            <button
              onClick={toggleNums}
              title={isArabic ? t("layout.toggleNumsToEn") : t("layout.toggleNumsToAr")}
              style={{
                display    : "flex", alignItems:"center", gap:5,
                padding    : "5px 11px",
                background : "var(--bg-card)", border:"1px solid var(--border)",
                borderRadius:"var(--radius-full)", color:"var(--accent)",
                cursor     : "pointer", fontSize:".8rem",
                fontFamily : "var(--font-main)", fontWeight:700,
                transition : "all var(--transition)",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor="var(--accent)"; e.currentTarget.style.background="var(--accent-glow)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor="var(--border)";  e.currentTarget.style.background="var(--bg-card)"; }}
            >
              <span style={{ fontFamily:"monospace", fontSize:".88rem" }}>
                {isArabic ? "١٢٣" : "123"}
              </span>
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" viewBox="0 0 24 24">
                <path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4"/>
              </svg>
            </button>

            {updateState.available && (
              <button
                type="button"
                onClick={() => setUpdateOpen(true)}
                title={`يوجد تحديث جديد ${updateState.latest?.version || ""}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 11px",
                  background: "var(--danger-bg, rgba(239,68,68,.12))",
                  border: "1px solid var(--danger, #ef4444)",
                  borderRadius: "var(--radius-full)",
                  color: "var(--danger, #ef4444)",
                  cursor: "pointer",
                  fontSize: ".8rem",
                  fontFamily: "var(--font-main)",
                  fontWeight: 800,
                  transition: "all var(--transition)",
                  boxShadow: "0 0 0 1px rgba(239,68,68,.08)",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
                <span>تحديث</span>
              </button>
            )}

            {/* ── مبدّل الثيم الثلاثي ─────────────────────── */}
            <div className="theme-switcher">
              {THEMES.map(({ id, labelKey, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={`theme-btn${theme === id ? " active" : ""}`}
                  onClick={() => setTheme(id)}
                  title={t(labelKey)}
                >
                  <Icon />
                  <span>{t(labelKey)}</span>
                </button>
              ))}
            </div>
            </div>
          </div>
        </header>

        <ExpiredAlertBanner />
        <WorkTabsBar />

        {/* ── المحتوى الرئيسي ─────────────────────────────── */}
        <main className="app-main" style={{ flex:1, padding:"24px 26px", overflowY:"auto" }}>
          <div className="app-mobile-surface">
            {isMobile && location.pathname === "/dashboard" && (
              <MobileDashboardShortcuts onOpenMenu={openMobileNav} />
            )}
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </div>

      <MobileBottomNav onOpenMenu={openMobileNav} />

      {/* ── Y-ai فقاعة الدردشة ──────────────────────────── */}
      <YAiChat />

      {updateOpen && (
        <Modal
          title="تحديث البرنامج"
          onClose={() => setUpdateOpen(false)}
          width="min(560px, 94vw)"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--bg-surface)" }}>
                <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginBottom: 4 }}>الإصدار الحالي</div>
                <div style={{ fontFamily: "var(--font-mono)", fontWeight: 900, color: "var(--text-primary)" }}>{updateState.current?.version || "—"}</div>
              </div>
              <div style={{ padding: "10px 12px", border: "1px solid var(--danger, #ef4444)", borderRadius: "var(--radius-md)", background: "var(--danger-bg, rgba(239,68,68,.08))" }}>
                <div style={{ fontSize: ".72rem", color: "var(--text-muted)", marginBottom: 4 }}>الإصدار الجديد</div>
                <div style={{ fontFamily: "var(--font-mono)", fontWeight: 900, color: "var(--danger, #ef4444)" }}>{updateState.latest?.version || "—"}</div>
              </div>
            </div>

            {updateState.latest?.releaseDate && (
              <div style={{ fontSize: ".84rem", color: "var(--text-secondary)" }}>
                تاريخ الإصدار: <strong>{updateState.latest.releaseDate}</strong>
              </div>
            )}

            {updateState.latest?.mandatory && (
              <div style={{ padding: "10px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--warning)", background: "var(--warning-bg)", color: "var(--warning)", fontWeight: 700, fontSize: ".84rem" }}>
                هذا التحديث معلَّم كتحديث مهم.
              </div>
            )}

            <div>
              <div style={{ fontWeight: 800, marginBottom: 8, color: "var(--text-primary)" }}>ملاحظات التحديث</div>
              {latestNotes.length ? (
                <ul style={{ margin: 0, paddingRight: 18, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                  {latestNotes.map((note, idx) => <li key={idx}>{note}</li>)}
                </ul>
              ) : (
                <div style={{ color: "var(--text-muted)", fontSize: ".84rem" }}>لا توجد ملاحظات مرفقة لهذا الإصدار.</div>
              )}
            </div>

            {updateState.error && (
              <div style={{ padding: "10px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--warning)", background: "var(--warning-bg)", color: "var(--warning)", fontSize: ".84rem" }}>
                {updateState.error}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => updateState.refresh(true)}
                style={{
                  padding: "9px 14px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  background: "var(--bg-card)",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontFamily: "var(--font-main)",
                  fontWeight: 700,
                }}
              >
                {updateState.checking ? "جاري الفحص..." : "تحقق مجدداً"}
              </button>
              {!!updateState.latest?.installerUrl && (
                <button
                  type="button"
                  onClick={() => window.open(updateState.latest.installerUrl, "_blank", "noopener,noreferrer")}
                  style={{
                    padding: "9px 14px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--accent)",
                    background: "var(--accent)",
                    color: "#fff",
                    cursor: "pointer",
                    fontFamily: "var(--font-main)",
                    fontWeight: 800,
                  }}
                >
                  تنزيل التحديث
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
