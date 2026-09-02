// ============================================================
//  src/components/layout/Sidebar.jsx
//  ✅ RBAC — فلترة ديناميكية بناءً على صلاحيات المستخدم
//  ✅ YVG branding
//
//  كل عنصر تنقل يحمل خاصية `permissions`:
//   - null              → يظهر لجميع المستخدمين المسجّلين
//   - ["can_add_sales"] → يظهر فقط إذا امتلك المستخدم أيًّا من هذه الصلاحيات
//
//  المجموعة بأكملها تُخفى إذا لم يكن للمستخدم أي صلاحية فيها
// ============================================================
import { useNavigate, useLocation } from "react-router-dom";
import { useRef, useEffect, useState, useCallback } from "react";
import { isClientProductionApp } from "@/hooks/useAppExit";
import { useAuth }              from "@/context/AuthContext";
import { useLanguage }          from "@/context/LanguageContext";
import { useIsMobile }          from "@/hooks/useIsMobile";
import BrandMark                from "./BrandMark";
import { GROUPS, ADMIN_ITEMS, OWNER_ITEMS, canSeeItem } from "./navConfig";

const SIDEBAR_SCROLL_KEY = "wms-sidebar-scroll";

const SVG = ({ d }) => (
  <svg width="19" height="19" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
    <path d={d} />
  </svg>
);

const ICONS = {
  dashboard  : "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  pos        : "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z",
  invoicesIn : "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z",
  invoicesOut: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  returns    : "M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 0 0 5.64 5.64M3.51 15a9 9 0 0 0 14.85 3.36",
  materials  : "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z",
  stock      : "M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z",
  customers  : "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  suppliers  : "M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 21v-5M8 21v-5M12 3v4",
  documents  : "M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z",
  debts      : "M12 1v22M5 5h10a3 3 0 1 1 0 6H9a3 3 0 1 0 0 6h10",
  reports    : "M18 20V10M12 20V4M6 20v-6",
  users      : "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  company    : "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10",
  logout     : "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  menu       : "M3 12h18M3 6h18M3 18h18",
  lock       : "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  spending   : "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z",
  accounting : "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5zM8 7h8M8 11h8M8 15h4",
  expired    : "M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z",
};

const GROUP_HEADER_FONT = ".84rem";

function pathInSection(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function useNavActive(to) {
  const { pathname } = useLocation();
  return pathInSection(pathname, to);
}

// ══════════════════════════════════════════════════════════
//  قسم قابل للطي — عنوان رئيسي + علامة +/−
// ══════════════════════════════════════════════════════════
function CollapsibleSection({ label, collapsed, expanded, onToggle, accent, children }) {
  if (collapsed) return <div style={{ marginBottom: 4 }}>{children}</div>;

  return (
    <div style={{ marginBottom: 6 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "8px 10px",
          marginBottom: expanded ? 4 : 0,
          background: "transparent",
          border: "none",
          borderRadius: "var(--radius-md)",
          cursor: "pointer",
          fontFamily: "var(--font-main)",
          fontSize: GROUP_HEADER_FONT,
          fontWeight: 800,
          color: accent || "var(--text-primary)",
          textAlign: "right",
          transition: "background var(--transition)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <span
          style={{
            flexShrink: 0,
            width: 18,
            height: 18,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: ".95rem",
            fontWeight: 900,
            color: "var(--accent)",
            lineHeight: 1,
          }}
          aria-hidden
        >
          {expanded ? "−" : "+"}
        </span>
        <span style={{ flex: 1, letterSpacing: ".02em" }}>{label}</span>
      </button>
      {expanded && <div style={{ paddingRight: 2 }}>{children}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  SectionDirectLink — قسم بفرع واحد: نفس محاذاة وتراص عناوين الأقسام
// ══════════════════════════════════════════════════════════
function SectionDirectLink({ to, label, icon, collapsed }) {
  const navigate = useNavigate();
  const isActive = useNavActive(to);
  const text = label;

  if (collapsed) {
    return (
      <div style={{ marginBottom: 4 }}>
        <button
          type="button"
          onClick={() => navigate(to)}
          title={text}
          aria-current={isActive ? "page" : undefined}
          style={{
            display       : "flex",
            alignItems    : "center",
            justifyContent: "center",
            gap           : 10,
            padding       : "8px 12px",
            borderRadius  : "var(--radius-md)",
            color         : isActive ? "var(--accent)" : "var(--text-secondary)",
            background    : isActive ? "var(--accent-glow)" : "transparent",
            border        : "none",
            marginBottom  : 2,
            cursor        : "pointer",
            fontFamily    : "inherit",
            width         : "100%",
          }}
        >
          <SVG d={ICONS[icon]} />
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 6 }}>
      <button
        type="button"
        onClick={() => navigate(to)}
        aria-current={isActive ? "page" : undefined}
        style={{
          display       : "flex",
          alignItems    : "center",
          gap           : 8,
          width         : "100%",
          padding       : "8px 10px",
          marginBottom  : 0,
          background    : isActive ? "var(--accent-glow)" : "transparent",
          border        : "none",
          borderRadius  : "var(--radius-md)",
          cursor        : "pointer",
          fontFamily    : "var(--font-main)",
          fontSize      : GROUP_HEADER_FONT,
          fontWeight    : 800,
          color         : isActive ? "var(--accent)" : "var(--text-primary)",
          textAlign     : "right",
          letterSpacing : ".02em",
          transition    : "background var(--transition)",
          overflow      : "hidden",
          whiteSpace    : "nowrap",
        }}
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = isActive ? "var(--accent-glow)" : "transparent";
        }}
      >
        <span
          style={{
            flexShrink    : 0,
            width         : 18,
            height        : 18,
            display       : "inline-flex",
            alignItems    : "center",
            justifyContent: "center",
            fontSize      : ".95rem",
            fontWeight    : 900,
            lineHeight    : 1,
            visibility    : "hidden",
          }}
          aria-hidden
        >
          +
        </span>
        <span style={{ flex: 1, letterSpacing: ".02em" }}>{text}</span>
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  NavItem — عنصر تنقل واحد
// ══════════════════════════════════════════════════════════
function NavItem({ to, label, icon, collapsed, hint }) {
  const navigate = useNavigate();
  const isActive = useNavActive(to);
  const text = label;
  const btn = (
    <button
      type="button"
      onClick={() => navigate(to)}
      title={collapsed ? (hint ? `${text}\n${hint}` : text) : undefined}
      aria-current={isActive ? "page" : undefined}
      style={{
        display       : "flex",
        alignItems    : "center",
        justifyContent: collapsed ? "center" : "flex-start",
        gap           : 10,
        width         : "100%",
        padding       : "8px 12px",
        borderRadius  : "var(--radius-md)",
        color         : isActive ? "var(--accent)" : "var(--text-secondary)",
        background    : isActive ? "var(--accent-glow)" : "transparent",
        border        : `1px solid ${isActive ? "var(--accent)" : "transparent"}`,
        fontWeight    : isActive ? 700 : 500,
        fontSize      : ".875rem",
        transition    : "all var(--transition)",
        marginBottom  : hint && !collapsed ? 0 : 2,
        overflow      : "hidden",
        whiteSpace    : "nowrap",
        cursor        : "pointer",
        fontFamily    : "inherit",
        textAlign     : "right",
      }}
    >
      <SVG d={ICONS[icon]} />
      {!collapsed && <span>{text}</span>}
    </button>
  );

  if (!hint || collapsed) return btn;

  return (
    <div style={{ marginBottom: 6 }}>
      {btn}
      <div style={{
        fontSize: ".68rem",
        color: "var(--text-muted)",
        padding: "0 12px 4px",
        lineHeight: 1.45,
        whiteSpace: "normal",
      }}>
        {hint}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  Sidebar — المكوّن الرئيسي
// ══════════════════════════════════════════════════════════
export default function Sidebar({ collapsed, onToggle, mobileOpen = false, onMobileClose }) {
  const { user, logout, isAdmin, isOwner, hasPermission } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const navRef   = useRef(null);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const saved = sessionStorage.getItem(SIDEBAR_SCROLL_KEY);
    if (saved) el.scrollTop = parseInt(saved, 10) || 0;
    const onScroll = () => sessionStorage.setItem(SIDEBAR_SCROLL_KEY, String(el.scrollTop));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // ── بناء قائمة المجموعات المفلترة ───────────────────────
  const authContext = { isAdmin, hasPermission };

  const visibleGroups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canSeeItem(item, authContext)),
  })).filter((group) => group.items.length > 0); // أخفِ المجموعة كلياً إذا كانت فارغة

  const toggleGroup = useCallback((key) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // فتح القسم الذي يحتوي الصفحة الحالية تلقائياً
  useEffect(() => {
    const path = location.pathname;
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      GROUPS.forEach((g) => {
        const items = g.items.filter((item) => canSeeItem(item, authContext));
        if (items.length && items.some((item) => pathInSection(path, item.to))) next.add(g.labelKey);
      });
      if (isAdmin && ADMIN_ITEMS.some((item) => pathInSection(path, item.to))) next.add("__admin__");
      if (isOwner && OWNER_ITEMS.some((item) => pathInSection(path, item.to))) next.add("__owner__");
      return next;
    });
  }, [location.pathname, isAdmin, isOwner, hasPermission]);

  useEffect(() => {
    onMobileClose?.();
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mobileOpen || !isMobile) return;
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      GROUPS.forEach((g) => next.add(g.labelKey));
      if (isAdmin) next.add("__admin__");
      if (isOwner) next.add("__owner__");
      return next;
    });
  }, [mobileOpen, isMobile, isAdmin, isOwner]);

  return (
    <aside
      className={`app-sidebar${mobileOpen ? " app-sidebar--open" : ""}`}
      style={{
      width        : collapsed ? 64 : 240,
      minHeight    : "100vh",
      background   : "var(--bg-surface)",
      borderLeft   : "1px solid var(--border)",
      display      : "flex",
      flexDirection: "column",
      transition   : "width .25s cubic-bezier(.4,0,.2,1)",
      overflow     : "hidden",
      flexShrink   : 0,
      position     : "sticky",
      top          : 0,
      height       : "100vh",
    }}>

      {/* ── شعار Y-ai + الشركة ───────────────────────────── */}
      <div style={{
        display       : "flex",
        alignItems    : "center",
        justifyContent: collapsed ? "center" : "space-between",
        flexDirection : collapsed ? "column" : "row",
        gap           : collapsed ? 8 : 0,
        padding       : "16px 14px",
        borderBottom  : "1px solid var(--border-subtle)",
        flexShrink    : 0,
      }}>
        {!collapsed ? <BrandMark collapsed={false} /> : <BrandMark collapsed />}

        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button
            type="button"
            className="sidebar-close-mobile"
            onClick={onMobileClose}
            aria-label="إغلاق القائمة"
            style={{
              display: "none", alignItems: "center", justifyContent: "center",
              background: "transparent", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", color: "var(--text-muted)",
              width: 28, height: 28, cursor: "pointer",
            }}
          >
            ✕
          </button>
          <button
            type="button"
            className="sidebar-toggle-desktop"
            onClick={onToggle}
            style={{
              background: "transparent", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", color: "var(--text-muted)",
              width: 28, height: 28, display: "flex", alignItems: "center",
              justifyContent: "center", cursor: "pointer", flexShrink: 0,
            }}
          >
            <SVG d={ICONS.menu} />
          </button>
        </div>
      </div>

      {/* ── التنقل المفلتر حسب الصلاحيات ─────────────────── */}
      <nav ref={navRef} style={{ flex: 1, overflowY: "auto", padding: "10px 8px" }}>

        {visibleGroups.map((group) =>
          group.items.length === 1 ? (
            <SectionDirectLink
              key={group.items[0].to}
              to={group.items[0].to}
              label={t(group.labelKey)}
              icon={group.items[0].icon}
              collapsed={collapsed}
            />
          ) : (
            <CollapsibleSection
              key={group.labelKey}
              label={t(group.labelKey)}
              collapsed={collapsed}
              expanded={isMobile ? true : expandedGroups.has(group.labelKey)}
              onToggle={() => toggleGroup(group.labelKey)}
            >
              {group.items.map((item) => (
                <NavItem key={item.to} {...item} label={t(item.labelKey)} collapsed={collapsed} />
              ))}
            </CollapsibleSection>
          )
        )}

        {/* ── إدارة النظام — للمدير فقط ───────────────────── */}
        {isAdmin && (
          <CollapsibleSection
            label={t("nav.groups.admin")}
            collapsed={collapsed}
            expanded={isMobile ? true : expandedGroups.has("__admin__")}
            onToggle={() => toggleGroup("__admin__")}
            accent="var(--accent)"
          >
            {ADMIN_ITEMS.map((item) => (
              <NavItem
                key={item.to}
                {...item}
                label={t(item.labelKey)}
                hint={item.hintKey ? t(item.hintKey) : undefined}
                collapsed={collapsed}
              />
            ))}
          </CollapsibleSection>
        )}

        {/* ── السنة المالية — لـ Yara صاحب البرنامج فقط ────── */}
        {isOwner && OWNER_ITEMS.length === 1 && (
          <SectionDirectLink
            key={OWNER_ITEMS[0].to}
            to={OWNER_ITEMS[0].to}
            label={t("nav.groups.owner")}
            icon={OWNER_ITEMS[0].icon}
            collapsed={collapsed}
          />
        )}
        {isOwner && OWNER_ITEMS.length > 1 && (
          <CollapsibleSection
            label={t("nav.groups.owner")}
            collapsed={collapsed}
            expanded={isMobile ? true : expandedGroups.has("__owner__")}
            onToggle={() => toggleGroup("__owner__")}
            accent="#f59e0b"
          >
            {OWNER_ITEMS.map((item) => (
              <NavItem key={item.to} {...item} label={t(item.labelKey)} collapsed={collapsed} />
            ))}
          </CollapsibleSection>
        )}
      </nav>

      {/* ── معلومات المستخدم الحالي + دور ─────────────────── */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "10px 8px", flexShrink: 0 }}>
        {!collapsed && user && (
          <div style={{
            padding: "10px 12px", background: "var(--bg-card)",
            borderRadius: "var(--radius-md)", marginBottom: 8,
            border: "1px solid var(--border)",
          }}>
            <div style={{ fontSize: ".83rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 3 }}>
              {user.UserName}
            </div>
            <span style={{
              fontSize: ".72rem", color: "var(--accent)",
              background: "var(--accent-glow)", border: "1px solid var(--accent)",
              borderRadius: "var(--radius-full)", padding: "1px 8px",
            }}>
              {user.TypeRoles || t("common.userRole")}
            </span>
          </div>
        )}

        <button
          onClick={() => {
            if (isClientProductionApp()) {
              window.dispatchEvent(new CustomEvent("wms:request-exit"));
            } else {
              logout();
              navigate("/login");
            }
          }}
          style={{
            display: "flex", alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            gap: 10, width: "100%", padding: "9px 12px",
            background: "none", border: "none", borderRadius: "var(--radius-md)",
            color: "var(--danger)", cursor: "pointer",
            fontSize: ".875rem", fontFamily: "var(--font-main)", fontWeight: 600,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--danger-bg)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
          title={t("layout.logout")}
        >
          <SVG d={ICONS.logout} />
          {!collapsed && t("layout.logout")}
        </button>
      </div>
    </aside>
  );
}
