// ============================================================
//  src/pages/dashboard/DashboardPage.jsx  —  لوحة القيادة
//  ✅ RBAC — بطاقات مفلترة حسب صلاحيات المستخدم
// ============================================================
import { useState, useMemo }                from "react";
import AppLayout                            from "@/components/layout/AppLayout";
import { StatCard }                         from "@/components/ui/Card";
import { useApi }                           from "@/hooks/useApi";
import { reportsService, stockService }     from "@/services/api";
import { expiredService }                    from "@/services/expiredService";
import YAiDailyTip                          from "@/components/ai/YAiDailyTip";
import { usePermissions }                   from "@/hooks/usePermissions";
import Button                               from "@/components/ui/Button";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { useLanguage } from "@/context/LanguageContext";
import { r2, fmt, fmtN, fmtC } from "@/utils/numFormat";


const icons = {
  sales    : <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  purchases: <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  stock    : <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>,
  profit   : <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  debt     : <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  expense  : <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
};

// ══════════════════════════════════════════════════════════
export default function DashboardPage() {
  const { locale } = useNumberLocale();
  const { t, tr } = useLanguage();

  const today = new Date().toISOString().split("T")[0];
  const year  = new Date().getFullYear();
  const [dateRange, setDateRange] = useState({
    startDate: `${year}-01-01`,
    endDate  : today,
  });

  const { data: dash, loading, error, refetch } = useApi(
    () => reportsService.dashboard(dateRange),
    [dateRange.startDate, dateRange.endDate]
  );
  const { data: stockSum }    = useApi(() => stockService.getSummary(), []);
  const { data: expiredSum }  = useApi(() => expiredService.getSummary(), []);

  // ── صلاحيات المستخدم الحالي ────────────────────────────
  const { can } = usePermissions();
  const cards   = dash?.cards;

  // ══════════════════════════════════════════════════════
  //  تعريف البطاقات مع الصلاحية المطلوبة لكل بطاقة
  //  visible: true  → تظهر للمستخدم الحالي
  //  visible: false → مخفية تماماً
  // ══════════════════════════════════════════════════════
  const allCards = useMemo(() => [
    {
      id     : "sales",
      visible: can.addSales,
      label  : t("dashboard.totalSales"),
      value  : loading ? "..." : fmtC(cards?.sales?.value),
      sub    : loading ? "" : `${cards?.sales?.count || 0} ${t("dashboard.invoiceCount")}`,
      variant: "success",
      icon   : icons.sales,
    },
    {
      id     : "purchases",
      visible: can.addPurchase,
      label  : t("dashboard.totalPurchases"),
      value  : loading ? "..." : fmtC(cards?.purchases?.value),
      sub    : loading ? "" : `${cards?.purchases?.count || 0} ${t("dashboard.invoiceCount")}`,
      variant: "info",
      icon   : icons.purchases,
    },
    {
      id     : "profit",
      visible: can.viewReports,
      label  : t("dashboard.grossProfit"),
      value  : loading ? "..." : fmtC(cards?.grossProfit?.value),
      sub    : cards?.grossProfit?.status ? tr(cards.grossProfit.status) : "",
      variant: cards?.grossProfit?.value >= 0 ? "success" : "danger",
      icon   : icons.profit,
    },
    {
      id     : "spending",
      visible: can.manageFinance,
      label  : t("dashboard.expenses"),
      value  : loading ? "..." : fmtC(cards?.spending?.value),
      sub    : t("dashboard.duringPeriod"),
      variant: "warning",
      icon   : icons.expense,
    },
    {
      id     : "stockValue",
      visible: can.editStock,
      label  : t("dashboard.stockValue"),
      value  : loading ? "..." : fmtC(stockSum?.data?.TotalCostValue),
      sub    : `${stockSum?.data?.TotalItems || 0} ${t("dashboard.itemUnit")}`,
      variant: "accent",
      icon   : icons.stock,
    },
    {
      id     : "customerDebts",
      visible: can.manageFinance,
      label  : t("dashboard.customerDebts"),
      value  : loading ? "..." : fmtC(cards?.customers?.value),
      sub    : t("dashboard.totalReceivables"),
      variant: "danger",
      icon   : icons.debt,
    },
    {
      id     : "supplierDebts",
      visible: can.manageFinance,
      label  : t("dashboard.supplierDebts"),
      value  : loading ? "..." : fmtC(cards?.suppliers?.value),
      sub    : t("dashboard.totalPayables"),
      variant: "warning",
      icon   : icons.debt,
    },
    {
      id     : "outOfStock",
      visible: can.editStock,
      label  : t("reports.kpi.outOfStock"),
      value  : loading ? "..." : fmtN(cards?.stock?.outOfStock),
      sub    : `${t("dashboard.fromWord")} ${cards?.stock?.items || 0} ${t("dashboard.itemUnit")}`,
      variant: cards?.stock?.outOfStock > 0 ? "danger" : "success",
      icon   : icons.stock,
    },
  ], [t, tr, loading, cards, stockSum, fmtC, fmtN, can]);

  // ── فقط البطاقات المسموح بها ──────────────────────────
  const visibleCards = allCards.filter((c) => c.visible);

  return (
    <AppLayout
      title={t("dashboard.title")}
      actions={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="date"
            value={dateRange.startDate}
            onChange={(e) => setDateRange((p) => ({ ...p, startDate: e.target.value }))}
            style={inputStyle}
          />
          <span style={{ color: "var(--text-muted)", fontSize: ".85rem" }}>إلى</span>
          <input
            type="date"
            value={dateRange.endDate}
            onChange={(e) => setDateRange((p) => ({ ...p, endDate: e.target.value }))}
            style={inputStyle}
          />
          <Button variant="secondary" size="sm" onClick={refetch}>
            تحديث
          </Button>
        </div>
      }
    >
      {error && (
        <div className="alert alert-error" style={{ marginBottom: 24 }}>
          ⚠ {error}
          {!String(error).includes("تفعيل") && (
            <> — تأكد أن الباك أند يعمل على http://localhost:3000</>
          )}
        </div>
      )}

      {/* ── نصيحة Y-ai اليومية ──────────────────────────── */}
      <YAiDailyTip />

      {/* ── البطاقات المفلترة بالصلاحيات ─────────────────── */}
      {visibleCards.length > 0 ? (
        <div style={{
          display            : "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap                : 16,
          marginBottom       : 28,
        }}>
          {visibleCards.map((card) => (
            <StatCard
              key={card.id}
              label={card.label}
              value={card.value}
              sub={card.sub}
              variant={card.variant}
              icon={card.icon}
            />
          ))}
        </div>
      ) : (
        // رسالة عندما لا توجد أي بطاقة مرئية (صلاحيات محدودة جداً)
        !loading && (
          <div style={{
            padding     : 40,
            textAlign   : "center",
            color       : "var(--text-muted)",
            background  : "var(--bg-card)",
            borderRadius: "var(--radius-md)",
            border      : "1px solid var(--border)",
            marginBottom: 28,
          }}>
            <div style={{ fontSize: "2rem", marginBottom: 12 }}>🔒</div>
            <p style={{ fontSize: ".95rem" }}>
              لا توجد إحصائيات متاحة لصلاحياتك الحالية
            </p>
          </div>
        )
      )}

      {/* ── تحذير المواد منتهية الصلاحية ──────────────────── */}
      {(() => {
        const pendingCount = expiredSum?.data?.pending?.count || 0;
        if (!pendingCount) return null;
        return (
          <div style={{
            display:"flex", alignItems:"center", justifyContent:"space-between",
            padding:"14px 20px", marginBottom:20,
            background:"rgba(220,38,38,0.08)",
            border:"2px solid var(--danger,#dc2626)",
            borderRadius:"var(--radius-lg)",
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <span style={{ fontSize:"1.5rem" }}>⚠️</span>
              <div>
                <div style={{ fontWeight:800, color:"var(--danger)", fontSize:".95rem" }}>
                  يوجد {pendingCount} دفعة منتهية الصلاحية لم تُشطب من المخزون
                </div>
                <div style={{ fontSize:".8rem", color:"var(--text-muted)", marginTop:3 }}>
                  خسارة متوقعة: {fmtC(expiredSum?.data?.totals?.totalLoss || 0)} — توجه إلى قسم المواد منتهية الصلاحية
                </div>
              </div>
            </div>
            <a href="/expired-stock" style={{
              padding:"7px 16px", background:"var(--danger)", color:"#fff",
              borderRadius:"var(--radius-md)", textDecoration:"none",
              fontWeight:700, fontSize:".85rem", whiteSpace:"nowrap",
            }}>
              عرض التفاصيل ←
            </a>
          </div>
        );
      })()}

      {loading && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 40, gap: 12,
          color: "var(--text-muted)", fontSize: ".9rem",
        }}>
          <span className="spinner" />
          جاري تحميل بيانات لوحة القيادة...
        </div>
      )}

      {!loading && !error && (
        <div style={{
          padding: "16px 20px", background: "var(--bg-card)",
          border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
          fontSize: ".82rem", color: "var(--text-muted)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span>📅</span>
          الفترة المعروضة: من{" "}
          <strong style={{ color: "var(--text-secondary)" }}>{dateRange.startDate}</strong> إلى{" "}
          <strong style={{ color: "var(--text-secondary)" }}>{dateRange.endDate}</strong>
          {" — "}آخر تحديث: {new Date().toLocaleTimeString("ar-IQ")}
        </div>
      )}
    </AppLayout>
  );
}

const inputStyle = {
  background  : "var(--bg-input)",
  border      : "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  color       : "var(--text-primary)",
  padding     : "6px 10px",
  fontSize    : ".83rem",
  fontFamily  : "var(--font-main)",
  outline     : "none",
  cursor      : "pointer",
};
