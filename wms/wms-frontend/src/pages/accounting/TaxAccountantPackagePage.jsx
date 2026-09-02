// ============================================================
//  src/pages/accounting/TaxAccountantPackagePage.jsx
//  حزمة المحاسب الضريبية — وحدة مستقلة
// ============================================================
import { useState, useEffect, useCallback, useMemo } from "react";
import AppLayout from "@/components/layout/AppLayout";
import Button from "@/components/ui/Button";
import api from "@/services/api";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { useCompany } from "@/context/CompanyContext";
import { openReportPrint } from "@/utils/invoicePrint";

const escHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error("فشل تحميل مكتبة Excel"));
    document.head.appendChild(s);
  });
}

function yearOptions() {
  const y = new Date().getFullYear();
  return Array.from({ length: 8 }, (_, i) => y - i);
}

const cardSt = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "14px 18px",
};

const thSt = {
  padding: "9px 12px",
  textAlign: "right",
  color: "var(--text-muted)",
  fontWeight: 700,
  fontSize: ".68rem",
  textTransform: "uppercase",
  background: "var(--bg-surface)",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

const tdSt = {
  padding: "9px 12px",
  borderBottom: "1px solid var(--border-subtle)",
};

function Chip({ label, value, accent, warn }) {
  return (
    <div style={{
      ...cardSt,
      flex: "1 1 140px",
      minWidth: 130,
      borderColor: accent ? "var(--accent)" : warn ? "var(--warning)" : "var(--border)",
      background: accent ? "var(--accent-glow)" : warn ? "var(--warning-bg)" : "var(--bg-card)",
    }}>
      <div style={{ fontSize: ".68rem", color: "var(--text-muted)", fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 900, fontSize: "1rem", color: accent ? "var(--accent)" : "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ ...cardSt, marginBottom: 16 }}>
      <div style={{ fontSize: ".72rem", fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border-subtle)" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function DataTable({ heads, rows, emptyMsg }) {
  if (!rows?.length) {
    return <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: ".85rem" }}>{emptyMsg || "لا توجد بيانات"}</div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
        <thead>
          <tr>{heads.map((h, i) => <th key={i} style={thSt}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((cells, ri) => (
            <tr key={ri} style={{ background: ri % 2 ? "var(--bg-hover)" : "transparent" }}>
              {cells.map((c, ci) => <td key={ci} style={{ ...tdSt, fontFamily: ci > 0 ? "var(--font-mono)" : "inherit" }}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildPrintHtml(data, fmtC) {
  const co = data.company || {};
  const inc = data.incomeStatement || {};
  const rows = (items, nameKey) =>
    (items || []).map((r) =>
      `<tr><td>${escHtml(r[nameKey])}</td><td>${fmtC(r.totalDebt)}</td><td>${fmtC(r.totalPaid)}</td><td>${fmtC(r.totalReturns)}</td><td>${fmtC(r.netBalance)}</td></tr>`
    ).join("");

  return `
    <div style="margin-bottom:16px;line-height:1.6">
      <div><b>الشركة:</b> ${escHtml(co.name)}</div>
      <div><b>الرقم الضريبي:</b> ${escHtml(co.taxNo || "—")}</div>
      <div><b>الفترة:</b> ${data.meta?.periodFrom} — ${data.meta?.periodTo}</div>
    </div>
    <h3 style="margin:16px 0 8px">قائمة دخل مبسّطة</h3>
    <table class="items"><tbody>
      <tr><td>صافي المبيعات</td><td>${fmtC(inc.netSales)}</td></tr>
      <tr><td>تكلفة البضاعة المباعة</td><td>${fmtC(inc.costOfGoodsSold)}</td></tr>
      <tr><td>مجمل الربح</td><td>${fmtC(inc.grossProfit)}</td></tr>
      <tr><td>المصاريف التشغيلية</td><td>${fmtC(inc.operatingExpenses)}</td></tr>
      <tr><td>خسائر منتهية الصلاحية</td><td>${fmtC(inc.expiredStockLoss)}</td></tr>
      <tr><td><b>صافي الربح</b></td><td><b>${fmtC(inc.netProfit)}</b></td></tr>
    </tbody></table>
    <h3 style="margin:16px 0 8px">ملخص المبيعات والمشتريات</h3>
    <table class="items"><tbody>
      <tr><td>إجمالي المبيعات</td><td>${fmtC(data.sales?.grossSales)}</td></tr>
      <tr><td>خصومات المبيعات</td><td>${fmtC(data.sales?.discounts)}</td></tr>
      <tr><td>مرتجعات المبيعات</td><td>${fmtC(data.sales?.returns)}</td></tr>
      <tr><td>صافي المبيعات</td><td>${fmtC(data.sales?.netSales)}</td></tr>
      <tr><td>صافي المشتريات</td><td>${fmtC(data.purchases?.netPurchases)}</td></tr>
      <tr><td>قيمة المخزون</td><td>${fmtC(data.inventory?.value)}</td></tr>
    </tbody></table>
    <h3 style="margin:16px 0 8px">أرصدة الزبائن</h3>
    <table class="items"><thead><tr><th>الاسم</th><th>إجمالي</th><th>مدفوع</th><th>مرتجعات</th><th>رصيد</th></tr></thead><tbody>${rows(data.receivables?.items, "name")}</tbody></table>
    <h3 style="margin:16px 0 8px">أرصدة الموردين</h3>
    <table class="items"><thead><tr><th>الاسم</th><th>إجمالي</th><th>مدفوع</th><th>مرتجعات</th><th>رصيد</th></tr></thead><tbody>${rows(data.payables?.items, "name")}</tbody></table>
  `;
}

async function exportTaxExcel(data) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  const co = data.company || {};
  const inc = data.incomeStatement || {};

  const addSheet = (name, aoa) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };

  addSheet("بيانات الشركة", [
    ["حزمة المحاسب الضريبية"],
    ["الشركة", co.name],
    ["الرقم الضريبي", co.taxNo || ""],
    ["الهاتف", co.mobile || ""],
    ["العنوان", co.address || ""],
    ["السنة", data.meta?.year],
    ["من", data.meta?.periodFrom],
    ["إلى", data.meta?.periodTo],
  ]);

  addSheet("قائمة الدخل", [
    ["البند", "المبلغ"],
    ["صافي المبيعات", inc.netSales],
    ["تكلفة البضاعة المباعة", inc.costOfGoodsSold],
    ["مجمل الربح", inc.grossProfit],
    ["المصاريف التشغيلية", inc.operatingExpenses],
    ["خسائر منتهية الصلاحية", inc.expiredStockLoss],
    ["صافي الربح", inc.netProfit],
  ]);

  addSheet("المبيعات شهري", [
    ["الشهر", "المبلغ"],
    ...(data.sales?.monthly || []).map((m) => [m.monthName, m.total]),
    ["المجموع", data.sales?.monthlyTotal],
  ]);

  addSheet("المشتريات شهري", [
    ["الشهر", "المبلغ"],
    ...(data.purchases?.monthly || []).map((m) => [m.monthName, m.total]),
    ["المجموع", data.purchases?.monthlyTotal],
  ]);

  addSheet("ملخص المبيعات", [
    ["البند", "القيمة"],
    ["عدد الفواتير", data.sales?.invoiceCount],
    ["إجمالي المبيعات", data.sales?.grossSales],
    ["الخصومات", data.sales?.discounts],
    ["الإضافات", data.sales?.additions],
    ["مرتجعات المبيعات", data.sales?.returns],
    ["صافي المبيعات", data.sales?.netSales],
  ]);

  addSheet("ملخص المشتريات", [
    ["البند", "القيمة"],
    ["عدد الفواتير", data.purchases?.invoiceCount],
    ["قيمة البضاعة", data.purchases?.grossGoods],
    ["نقل/جمارك/عمال", data.purchases?.transportCustomsPorter],
    ["خصومات المشتريات", data.purchases?.discounts],
    ["مرتجعات المشتريات", data.purchases?.returns],
    ["صافي المشتريات", data.purchases?.netPurchases],
  ]);

  addSheet("المصاريف", [
    ["النوع", "المبلغ"],
    ...(inc.expenseBreakdown || []).map((e) => [e.category, e.amount]),
    ["المجموع", inc.operatingExpenses],
  ]);

  addSheet("حركة النقد", [
    ["البند", "المبلغ"],
    ["سندات القبض", data.cashMovement?.customerReceipts],
    ["مبيعات نقدية", data.cashMovement?.cashSales],
    ["إجمالي المدخلات", data.cashMovement?.totalIn],
    ["سندات الدفع", data.cashMovement?.supplierPayments],
    ["المصاريف", inc.operatingExpenses],
    ["إجمالي المخرجات", data.cashMovement?.totalOut],
  ]);

  addSheet("أرصدة الزبائن", [
    ["الاسم", "إجمالي", "مدفوع", "مرتجعات", "رصيد صافي"],
    ...(data.receivables?.items || []).map((r) => [r.name, r.totalDebt, r.totalPaid, r.totalReturns, r.netBalance]),
    ["المجموع", "", "", "", data.receivables?.total],
  ]);

  addSheet("أرصدة الموردين", [
    ["الاسم", "إجمالي", "مدفوع", "مرتجعات", "رصيد صافي"],
    ...(data.payables?.items || []).map((r) => [r.name, r.totalDebt, r.totalPaid, r.totalReturns, r.netBalance]),
    ["المجموع", "", "", "", data.payables?.total],
  ]);

  addSheet("المخزون", [
    ["قيمة المخزون", data.inventory?.value],
    ["أصناف بمخزون", data.inventory?.itemsWithStock],
    ["ملاحظة", data.inventory?.note || ""],
  ]);

  XLSX.writeFile(wb, `حزمة_المحاسب_الضريبية_${data.meta?.year}.xlsx`);
}

export default function TaxAccountantPackagePage() {
  const { fmtC } = useNumberLocale();
  const { company } = useCompany();
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const years = useMemo(() => yearOptions(), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/tax-package", { params: { year } });
      setData(r);
    } catch (e) {
      alert(`خطأ: ${e.message}`);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const taxNo = data?.company?.taxNo || company?.CompanyInformation_TaxNo || "";
  const missingTax = !taxNo?.trim();

  const handleExport = async () => {
    if (!data) return;
    setExporting(true);
    try { await exportTaxExcel(data); }
    catch (e) { alert(`خطأ في التصدير: ${e.message}`); }
    finally { setExporting(false); }
  };

  const handlePrint = () => {
    if (!data) return;
    openReportPrint({
      title: `حزمة المحاسب الضريبية — ${year}`,
      subtitle: `${data.meta?.periodFrom} — ${data.meta?.periodTo}`,
      company: company || {},
      tableHtml: buildPrintHtml(data, fmtC),
    });
  };

  const inc = data?.incomeStatement;

  return (
    <AppLayout title="حزمة المحاسب الضريبية">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>

        {/* شريط التحكم */}
        <div style={{ ...cardSt, marginBottom: 16, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: ".7rem", color: "var(--text-muted)", fontWeight: 700, marginBottom: 6 }}>السنة المالية</div>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-primary)", fontFamily: "inherit", fontSize: ".88rem" }}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }} />
          <Button size="sm" onClick={load} loading={loading}>🔄 تحديث</Button>
          <Button size="sm" onClick={handlePrint} disabled={!data || loading}>🖨 طباعة PDF</Button>
          <Button size="sm" variant="accent" onClick={handleExport} loading={exporting} disabled={!data || loading}>
            📥 تصدير Excel للمحاسب
          </Button>
        </div>

        {missingTax && (
          <div style={{ padding: "12px 16px", marginBottom: 16, background: "var(--warning-bg)", border: "1px solid var(--warning)", borderRadius: "var(--radius-md)", fontSize: ".84rem", color: "var(--warning)", fontWeight: 600 }}>
            ⚠ الرقم الضريبي غير مُدخل — أضفه من <a href="/company" style={{ color: "inherit", fontWeight: 800 }}>إعدادات الشركة</a> قبل إرسال الحزمة للمحاسب.
          </div>
        )}

        {loading && !data && (
          <div style={{ textAlign: "center", padding: 48 }}><span className="spinner" /></div>
        )}

        {data && (
          <>
            {/* بيانات الشركة */}
            <Section title="بيانات الشركة">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, fontSize: ".86rem" }}>
                <div><span style={{ color: "var(--text-muted)" }}>الشركة: </span><b>{data.company?.name || "—"}</b></div>
                <div><span style={{ color: "var(--text-muted)" }}>الرقم الضريبي: </span><b style={{ fontFamily: "var(--font-mono)", color: taxNo ? "var(--accent)" : "var(--danger)" }}>{taxNo || "—"}</b></div>
                <div><span style={{ color: "var(--text-muted)" }}>الفترة: </span><b>{data.meta?.periodFrom} — {data.meta?.periodTo}</b></div>
              </div>
            </Section>

            {/* بطاقات ملخص */}
            <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
              <Chip label="صافي المبيعات" value={fmtC(data.sales?.netSales)} accent />
              <Chip label="صافي المشتريات" value={fmtC(data.purchases?.netPurchases)} />
              <Chip label="صافي الربح" value={fmtC(inc?.netProfit)} accent />
              <Chip label="مستحقات الزبائن" value={fmtC(data.receivables?.total)} />
              <Chip label="مديونيات الموردين" value={fmtC(data.payables?.total)} />
              <Chip label="قيمة المخزون" value={fmtC(data.inventory?.value)} />
            </div>

            {/* قائمة الدخل */}
            <Section title="قائمة دخل مبسّطة (للمحاسب)">
              <DataTable
                heads={["البند", "المبلغ"]}
                rows={[
                  ["صافي المبيعات", fmtC(inc?.netSales)],
                  ["تكلفة البضاعة المباعة", fmtC(inc?.costOfGoodsSold)],
                  ["مجمل الربح", fmtC(inc?.grossProfit)],
                  ["المصاريف التشغيلية", fmtC(inc?.operatingExpenses)],
                  ["خسائر منتهية الصلاحية", fmtC(inc?.expiredStockLoss)],
                  ["صافي الربح", fmtC(inc?.netProfit)],
                ]}
              />
            </Section>

            {/* مبيعات ومشتريات شهري */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <Section title="المبيعات — شهري">
                <DataTable
                  heads={["الشهر", "المبلغ"]}
                  rows={(data.sales?.monthly || []).map((m) => [m.monthName, fmtC(m.total)])}
                />
              </Section>
              <Section title="المشتريات — شهري">
                <DataTable
                  heads={["الشهر", "المبلغ"]}
                  rows={(data.purchases?.monthly || []).map((m) => [m.monthName, fmtC(m.total)])}
                />
              </Section>
            </div>

            {/* المصاريف */}
            <Section title="تفصيل المصاريف">
              <DataTable
                heads={["نوع المصروف", "المبلغ"]}
                rows={(inc?.expenseBreakdown || []).map((e) => [e.category, fmtC(e.amount)])}
                emptyMsg="لا توجد مصاريف في هذه الفترة"
              />
            </Section>

            {/* حركة النقد */}
            <Section title="ملخص حركة النقد">
              <DataTable
                heads={["البند", "المبلغ"]}
                rows={[
                  ["سندات القبض من الزبائن", fmtC(data.cashMovement?.customerReceipts)],
                  ["مبيعات نقدية", fmtC(data.cashMovement?.cashSales)],
                  ["إجمالي المدخلات", fmtC(data.cashMovement?.totalIn)],
                  ["سندات الدفع للموردين", fmtC(data.cashMovement?.supplierPayments)],
                  ["المصاريف", fmtC(inc?.operatingExpenses)],
                  ["إجمالي المخرجات", fmtC(data.cashMovement?.totalOut)],
                ]}
              />
            </Section>

            {/* أرصدة */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Section title={`أرصدة الزبائن (${data.receivables?.count || 0})`}>
                <DataTable
                  heads={["الاسم", "رصيد صافي"]}
                  rows={(data.receivables?.items || []).map((r) => [r.name, fmtC(r.netBalance)])}
                  emptyMsg="لا توجد أرصدة مستحقة"
                />
              </Section>
              <Section title={`أرصدة الموردين (${data.payables?.count || 0})`}>
                <DataTable
                  heads={["الاسم", "رصيد صافي"]}
                  rows={(data.payables?.items || []).map((r) => [r.name, fmtC(r.netBalance)])}
                  emptyMsg="لا توجد مديونيات"
                />
              </Section>
            </div>

            <div style={{ marginTop: 16, padding: "10px 14px", background: "var(--bg-surface)", borderRadius: 8, fontSize: ".78rem", color: "var(--text-muted)" }}>
              📋 {data.inventory?.note} — اضغط «تصدير Excel للمحاسب» لإرسال كل الأوراق في ملف واحد.
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
