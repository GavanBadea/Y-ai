// ============================================================
//  src/App.jsx  —  Y-ai نظام إدارة المستودعات
//  React Router v6 — نظام المسارات مع RBAC كامل
//
//  أنواع المسارات:
//   PublicRoute      → يقبل غير المسجلين فقط (login)
//   PrivateRoute     → يقبل أي مستخدم مسجّل
//   PermissionRoute  → يقبل فقط من يمتلك الصلاحية المحددة
//   AdminRoute       → يقبل المدير فقط (id_Roles = 1)
// ============================================================
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useEnterFieldNav } from "@/hooks/useEnterFieldNav";
import { useAppExit, confirmLogoutAndShutdown } from "@/hooks/useAppExit";
import { registerSpaNavigate, licenseService } from "@/services/api";
import ExitConfirmModal from "@/components/layout/ExitConfirmModal";
import { WorkTabsProvider } from "@/context/WorkTabsContext";

// ── صفحة التفعيل ──────────────────────────────────────────
import ActivationPage      from "@/pages/activation/ActivationPage";

// ── صفحة تسجيل الدخول ─────────────────────────────────────
import LoginPage           from "@/pages/auth/LoginPage";

// ── الصفحات الرئيسية ──────────────────────────────────────
import DashboardPage       from "@/pages/dashboard/DashboardPage";
import MaterialsPage       from "@/pages/materials/MaterialsPage";
import PartiesPage         from "@/pages/parties/PartiesPage";
import LookupPage          from "@/pages/lookup/LookupPage";
import DebtsPage           from "@/pages/debts/DebtsPage";
import DocumentsPage       from "@/pages/documents/DocumentsPage";
import InventoryDashboard  from "@/pages/inventory/InventoryDashboard";
import ReportsPage         from "@/pages/reports/ReportsPage";

// ── الفواتير ──────────────────────────────────────────────
import PurchaseInvoicePage from "@/pages/invoices/PurchaseInvoicePage";
import SalesInvoicePage    from "@/pages/invoices/SalesInvoicePage";
import PurchaseReturnPage  from "@/pages/invoices/PurchaseReturnPage";
import SalesReturnPage     from "@/pages/invoices/SalesReturnPage";
import POSPage             from "@/pages/pos/POSPage";
import POSDisplayPage      from "@/pages/pos/POSDisplayPage";
import PriceKioskPage      from "@/pages/kiosk/PriceKioskPage";

// ── إدارة النظام (مدير فقط) ──────────────────────────────
import CompanySettings     from "@/pages/settings/CompanySettings";
import UsersManager        from "@/pages/settings/UsersManager";
import WhatsAppSettings    from "@/pages/settings/WhatsAppSettings";
import FiscalYearPage      from "@/pages/settings/FiscalYearPage";
import FiscalYearSwitchPage from "@/pages/settings/FiscalYearSwitchPage";
import FinancialSettings   from "@/pages/settings/FinancialSettings";
import AuditLogPage        from "@/pages/settings/AuditLogPage";
import GuidesPage          from "@/pages/settings/GuidesPage";
import StockTransfersPage  from "@/pages/stock/StockTransfersPage";
import SpendingPage        from "@/pages/spending/SpendingPage";
import ExpiredStockPage    from "@/pages/expiredStock/ExpiredStockPage";

// ── كشوفات الحسابات (وحدة مستقلة) ────────────────────────
import AccountStatementPage from "@/pages/statements/AccountStatementPage";

// ── حزمة المحاسب الضريبية (وحدة مستقلة) ─────────────────
import TaxAccountantPackagePage from "@/pages/accounting/TaxAccountantPackagePage";
import AccountingPage        from "@/pages/accounting/AccountingPage";

// ── التقارير التفصيلية (وحدة مستقلة) ──────────────────────
import AdvancedReportsPage  from "@/pages/advancedReports/AdvancedReportsPage";

// ══════════════════════════════════════════════════════════
//  صفحة 403 — وصول مرفوض
// ══════════════════════════════════════════════════════════
function ForbiddenPage() {
  const navigate = useNavigate();
  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 20,
      background: "var(--bg-base)", color: "var(--text-primary)",
      fontFamily: "var(--font-main)",
    }}>
      {/* أيقونة القفل */}
      <div style={{
        width: 80, height: 80, borderRadius: "50%",
        background: "var(--danger-bg, rgba(239,68,68,.12))",
        border: "2px solid var(--danger, #ef4444)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="36" height="36" fill="none" stroke="var(--danger, #ef4444)"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>

      {/* كود الخطأ */}
      <div style={{
        fontSize: "4rem", fontWeight: 900,
        color: "var(--danger, #ef4444)",
        fontFamily: "var(--font-mono)",
        lineHeight: 1,
      }}>
        403
      </div>

      <div style={{ textAlign: "center", maxWidth: 380 }}>
        <h2 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: 8 }}>
          وصول مرفوض
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: ".95rem", lineHeight: 1.6 }}>
          ليس لديك الصلاحية للوصول إلى هذه الصفحة.
          يرجى التواصل مع مدير النظام إذا كنت تعتقد أن هذا خطأ.
        </p>
      </div>

      {/* أزرار التنقل */}
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <button
          onClick={() => navigate("/dashboard")}
          style={{
            padding: "10px 24px", borderRadius: "var(--radius-md)",
            background: "var(--accent)", color: "#fff",
            border: "none", fontWeight: 700, fontSize: ".95rem",
            cursor: "pointer", fontFamily: "var(--font-main)",
          }}
        >
          العودة للرئيسية
        </button>
        <button
          onClick={() => navigate(-1)}
          style={{
            padding: "10px 24px", borderRadius: "var(--radius-md)",
            background: "transparent", color: "var(--text-secondary)",
            border: "1px solid var(--border)", fontWeight: 600,
            fontSize: ".95rem", cursor: "pointer", fontFamily: "var(--font-main)",
          }}
        >
          الصفحة السابقة
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  Placeholder — للصفحات قيد الإنشاء
// ══════════════════════════════════════════════════════════
function Placeholder({ title }) {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", flexDirection: "column", gap: 16,
      background: "var(--bg-base)", color: "var(--text-primary)",
    }}>
      <span style={{
        fontSize: "3rem", fontWeight: 900,
        color: "var(--accent)", fontFamily: "var(--font-mono)",
      }}>Y-ai</span>
      <h2 style={{ fontSize: "1.4rem", fontWeight: 700 }}>{title}</h2>
      <p style={{ color: "var(--text-secondary)", fontSize: ".9rem" }}>
        ستُضاف هذه الصفحة قريباً
      </p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  حراسة المسارات
// ══════════════════════════════════════════════════════════

/** مسار عام — للزوار غير المسجّلين فقط */
function PublicRoute({ children }) {
  const { isLoggedIn, isLoading } = useAuth();
  if (isLoading) return null;
  return isLoggedIn ? <Navigate to="/dashboard" replace /> : children;
}

/** مسار محمي — لأي مستخدم مسجّل */
function PrivateRoute({ children }) {
  const { isLoggedIn, isLoading } = useAuth();
  if (isLoading) return (
    <div style={{
      minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center",
      background: "var(--bg-base)",
    }}>
      <span className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  );
  return isLoggedIn ? children : <Navigate to="/login" replace />;
}

/**
 * مسار مقيّد بصلاحية — PermissionRoute
 *
 * @param {string}   permission  — اسم عمود الصلاحية (مثل "can_add_sales")
 * @param {React.Node} children  — الصفحة المحمية
 *
 * السلوك:
 *  1. إذا لم يكن مسجّلاً          → توجيه لـ /login
 *  2. إذا كان مديراً (id_Roles=1) → يمر دائماً
 *  3. إذا امتلك الصلاحية          → يمر
 *  4. إذا لم يمتلكها              → توجيه لـ /403
 */
function PermissionRoute({ permission, children }) {
  const { isLoggedIn, isAdmin, isLoading, hasPermission } = useAuth();

  if (isLoading) return (
    <div style={{
      minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center",
      background: "var(--bg-base)",
    }}>
      <span className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  );

  if (!isLoggedIn)  return <Navigate to="/login"   replace />;
  if (isAdmin)      return children;                            // المدير يمر دائماً
  if (hasPermission(permission)) return children;               // يمتلك الصلاحية
  return <Navigate to="/403" replace />;                        // مرفوض → 403
}

/** مسار خاص بالمدير — id_Roles = 1 */
function AdminRoute({ children }) {
  const { isLoggedIn, isAdmin, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isLoggedIn) return <Navigate to="/login"    replace />;
  if (!isAdmin)   return <Navigate to="/403"       replace />;
  return children;
}

/** مسار خاص بـ Yara صاحب البرنامج فقط */
function OwnerRoute({ children }) {
  const { isLoggedIn, isOwner, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isLoggedIn) return <Navigate to="/login"    replace />;
  if (!isOwner)   return <Navigate to="/403"       replace />;
  return children;
}

// ══════════════════════════════════════════════════════════
//  الشجرة الكاملة للمسارات
// ══════════════════════════════════════════════════════════
function AppRoutes() {
  useEnterFieldNav();

  return (
      <Routes>

        {/* ── تفعيل الترخيص — متاح دائماً ────────────── */}
        <Route path="/activate" element={<ActivationPage />} />

        {/* ── تسجيل الدخول ─────────────────────────────── */}
        <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />

        {/* ── 403 — وصول مرفوض ─────────────────────────── */}
        <Route path="/403" element={<PrivateRoute><ForbiddenPage /></PrivateRoute>} />

        {/* ── لوحة القيادة — لجميع المستخدمين المسجّلين ── */}
        <Route
          path="/dashboard"
          element={<PrivateRoute><DashboardPage /></PrivateRoute>}
        />

        {/* ── نقطة البيع — يتطلب can_add_sales ─────────── */}
        <Route
          path="/pos"
          element={
            <PermissionRoute permission="can_add_sales">
              <POSPage />
            </PermissionRoute>
          }
        />

        {/* ── شاشة الزبون (POS) ──────────────────────────── */}
        <Route path="/pos-display" element={<POSDisplayPage />} />

        {/* ── فحص الأسعار Kiosk ─────────────────────────── */}
        <Route
          path="/price-kiosk"
          element={
            <PermissionRoute permission="can_kiosk_scan">
              <PriceKioskPage />
            </PermissionRoute>
          }
        />

        {/* ── فواتير الشراء — يتطلب can_add_purchase ───── */}
        <Route
          path="/invoices-in"
          element={
            <PermissionRoute permission="can_add_purchase">
              <PurchaseInvoicePage />
            </PermissionRoute>
          }
        />

        {/* ── فواتير المبيعات — يتطلب can_add_sales ─────── */}
        <Route
          path="/invoices-out"
          element={
            <PermissionRoute permission="can_add_sales">
              <SalesInvoicePage />
            </PermissionRoute>
          }
        />

        {/* ── مرتجعات الشراء — يتطلب can_add_purchase ──── */}
        <Route
          path="/purchase-returns"
          element={
            <PermissionRoute permission="can_add_purchase">
              <PurchaseReturnPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/returns"
          element={
            <PermissionRoute permission="can_add_purchase">
              <PurchaseReturnPage />
            </PermissionRoute>
          }
        />

        {/* ── مرتجعات الزبائن — يتطلب can_add_sales ────── */}
        <Route
          path="/sales-returns"
          element={
            <PermissionRoute permission="can_add_sales">
              <SalesReturnPage />
            </PermissionRoute>
          }
        />

        {/* ── المواد — يتطلب can_view_materials ────────── */}
        <Route
          path="/materials"
          element={
            <PermissionRoute permission="can_view_materials">
              <MaterialsPage />
            </PermissionRoute>
          }
        />

        {/* ── لوحة المخزون — يتطلب can_edit_stock ─────── */}
        <Route
          path="/inventory"
          element={
            <PermissionRoute permission="can_edit_stock">
              <InventoryDashboard />
            </PermissionRoute>
          }
        />

        {/* ── الزبائن — يتطلب can_add_sales أو can_manage_finance */}
        {/* نستخدم can_add_sales كصلاحية أساسية للتوجيه         */}
        <Route
          path="/customers"
          element={
            <PermissionRoute permission="can_add_sales">
              <PartiesPage />
            </PermissionRoute>
          }
        />

        {/* ── الموردون — يتطلب can_add_purchase ───────── */}
        <Route
          path="/suppliers"
          element={
            <PermissionRoute permission="can_add_purchase">
              <PartiesPage />
            </PermissionRoute>
          }
        />

        {/* ── الديون — يتطلب can_manage_finance ────────── */}
        <Route
          path="/debts"
          element={
            <PermissionRoute permission="can_manage_finance">
              <DebtsPage />
            </PermissionRoute>
          }
        />

        {/* ── السندات المالية — يتطلب can_manage_finance ─ */}
        <Route
          path="/documents"
          element={
            <PermissionRoute permission="can_manage_finance">
              <DocumentsPage />
            </PermissionRoute>
          }
        />

        {/* ── التقارير — يتطلب can_view_reports ────────── */}
        <Route
          path="/reports"
          element={
            <PermissionRoute permission="can_view_reports">
              <ReportsPage />
            </PermissionRoute>
          }
        />

        {/* ── الجداول المرجعية — لجميع المستخدمين ─────── */}
        <Route
          path="/lookup"
          element={<PrivateRoute><LookupPage /></PrivateRoute>}
        />

        {/* ── المخزون (placeholder) ─────────────────────── */}
        <Route
          path="/stock"
          element={
            <PermissionRoute permission="can_edit_stock">
              <Placeholder title="المخزون" />
            </PermissionRoute>
          }
        />

        {/* ── إدارة السنة المالية — ضمن إدارة النظام ─────── */}
        <Route
          path="/fiscal-year"
          element={<AdminRoute><FiscalYearPage /></AdminRoute>}
        />

        {/* ── إدارة النظام — للمدير فقط ────────────────── */}
        <Route
          path="/company"
          element={<AdminRoute><CompanySettings /></AdminRoute>}
        />
        <Route
          path="/fiscal-year-switch"
          element={<AdminRoute><FiscalYearSwitchPage /></AdminRoute>}
        />
        <Route
          path="/users-manager"
          element={<AdminRoute><UsersManager /></AdminRoute>}
        />
        <Route
          path="/whatsapp"
          element={<AdminRoute><WhatsAppSettings /></AdminRoute>}
        />
        <Route
          path="/financial-settings"
          element={<AdminRoute><FinancialSettings /></AdminRoute>}
        />
        <Route
          path="/audit-log"
          element={<AdminRoute><AuditLogPage /></AdminRoute>}
        />
        <Route
          path="/guides"
          element={<AdminRoute><GuidesPage /></AdminRoute>}
        />

        <Route
          path="/stock-transfers"
          element={
            <PermissionRoute permission="can_edit_stock">
              <StockTransfersPage />
            </PermissionRoute>
          }
        />

        {/* ── المحاسبة — يتطلب can_manage_finance ─────────── */}
        <Route
          path="/accounting"
          element={
            <PermissionRoute permission="can_manage_finance">
              <AccountingPage />
            </PermissionRoute>
          }
        />

        {/* ── المصاريف — يتطلب can_manage_finance ─────────── */}
        <Route
          path="/spending"
          element={
            <PermissionRoute permission="can_manage_finance">
              <SpendingPage />
            </PermissionRoute>
          }
        />

        {/* ── المواد منتهية الصلاحية — يتطلب can_view_materials ── */}
        <Route
          path="/expired-stock"
          element={
            <PermissionRoute permission="can_view_materials">
              <ExpiredStockPage />
            </PermissionRoute>
          }
        />

        {/* ── كشوفات الحسابات — يتطلب can_manage_finance ── */}
        <Route
          path="/customer-statement"
          element={
            <PermissionRoute permission="can_manage_finance">
              <AccountStatementPage type="customer" />
            </PermissionRoute>
          }
        />
        <Route
          path="/supplier-statement"
          element={
            <PermissionRoute permission="can_manage_finance">
              <AccountStatementPage type="supplier" />
            </PermissionRoute>
          }
        />
        <Route
          path="/mandob-statement"
          element={
            <PermissionRoute permission="can_manage_finance">
              <AccountStatementPage type="mandob" />
            </PermissionRoute>
          }
        />

        {/* ── حزمة المحاسب الضريبية — يتطلب can_manage_finance ── */}
        <Route
          path="/tax-accountant-package"
          element={
            <PermissionRoute permission="can_view_reports">
              <TaxAccountantPackagePage />
            </PermissionRoute>
          }
        />

        {/* ── التقارير التفصيلية — يتطلب can_manage_finance ── */}
        <Route
          path="/advanced-reports"
          element={
            <PermissionRoute permission="can_manage_finance">
              <AdvancedReportsPage />
            </PermissionRoute>
          }
        />

        {/* ── التوجيه الافتراضي ─────────────────────────── */}
        <Route path="/"  element={<Navigate to="/dashboard" replace />} />
        <Route path="*"  element={<Navigate to="/dashboard" replace />} />

      </Routes>
  );
}

function FullPageSpinner() {
  return (
    <div style={{
      minHeight: "100vh", display: "flex",
      alignItems: "center", justifyContent: "center",
      background: "var(--bg-base)",
    }}>
      <span className="spinner" style={{ width: 32, height: 32 }} />
    </div>
  );
}

function AppShell() {
  const { isLoggedIn, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [exitOpen, setExitOpen] = useState(false);
  // checking | activated | required — لا تُعرض لوحة القيادة قبل التفعيل أبداً
  const [licenseState, setLicenseState] = useState("checking");

  const openExitModal = useCallback(() => setExitOpen(true), []);

  useAppExit({ isLoggedIn, onExitAttempt: openExitModal });

  useEffect(() => {
    registerSpaNavigate((path, opts) => navigate(path, opts));
    return () => registerSpaNavigate(null);
  }, [navigate]);

  // فحص الترخيص عند كل تنقّل — يمنع الدخول للتطبيق قبل التفعيل
  useEffect(() => {
    let cancelled = false;
    const watchdog = setTimeout(() => {
      if (!cancelled) setLicenseState("required");
    }, 12000);

    (async () => {
      try {
        const res = await licenseService.getStatus();
        if (cancelled) return;
        setLicenseState(res?.activated ? "activated" : "required");
      } catch {
        if (!cancelled) setLicenseState("required");
      } finally {
        clearTimeout(watchdog);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
    };
  }, [location.pathname]);

  // بعد تسجيل الدخول مباشرة → صفحة التفعيل (لا تمر عبر لوحة القيادة ولا تحتاج تحديث)
  useEffect(() => {
    if (licenseState !== "required") return;
    if (location.pathname === "/activate") return;
    if (isLoggedIn) {
      navigate("/activate", { replace: true });
    }
  }, [licenseState, isLoggedIn, location.pathname, navigate]);

  useEffect(() => {
    const onActivated = () => setLicenseState("activated");
    window.addEventListener("wms:license-activated", onActivated);
    return () => window.removeEventListener("wms:license-activated", onActivated);
  }, []);

  useEffect(() => {
    const onRequestExit = () => setExitOpen(true);
    window.addEventListener("wms:request-exit", onRequestExit);
    return () => window.removeEventListener("wms:request-exit", onRequestExit);
  }, []);

  const handleConfirmExit = () => {
    confirmLogoutAndShutdown(logout);
    setExitOpen(false);
    navigate("/login", { replace: true });
  };

  if (licenseState === "checking") {
    return <FullPageSpinner />;
  }

  // غير مفعّل: صفحة التفعيل فقط (+ تسجيل الدخول لإعداد المدير الأول)
  // لا تُحمَّل لوحة القيادة ولا أي صفحة من التطبيق
  if (licenseState === "required") {
    return (
      <Routes>
        <Route path="/activate" element={<ActivationPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/activate" replace />} />
      </Routes>
    );
  }

  return (
    <>
      {exitOpen && (
        <ExitConfirmModal
          onCancel={() => setExitOpen(false)}
          onConfirm={handleConfirmExit}
        />
      )}
      <WorkTabsProvider>
        <AppRoutes />
      </WorkTabsProvider>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
