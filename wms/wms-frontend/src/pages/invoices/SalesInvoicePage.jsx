// ============================================================
//  src/pages/invoices/SalesInvoicePage.jsx
//  فاتورة المبيعات — YVG WMS
//
//  الأعمدة في جدول الأسطر (مطابق للمشتريات):
//   #  |  اختيار المادة  |  الباركود  |  المخزون  |  الكمية  |  السعر  |  مجموع السعر  |  ✕
//
//  المنطق الكامل:
//   ✅ BarcodeScanner — يملأ أول سطر فارغ أو يضيف سطراً جديداً
//   ✅ اختيار المادة بـ Dropdown مع بحث + تغيير بزر ✎
//   ✅ الباركود يُعرَض تلقائياً بعد الاختيار
//   ✅ المخزون الحالي مع تحذير عند الكمية الصفر/السالبة
//   ✅ الكمية بأزرار +/− وحقل رقمي
//   ✅ السعر — آخر سعر بيع تلقائياً (قابل للتعديل يدوياً)
//   ✅ مجموع السعر يتحدث فورياً (Kمية × السعر)
//   ✅ رصيد الزبون السابق فوراً بعد الاختيار
//   ✅ دين آجل يُسجَّل تلقائياً — تحذير مرئي
//   ✅ بيانات التوصيل (سائق + مركبة)
//   ✅ ملاحة (السابق / التالي / أول / آخر)
//   ✅ حذف كامل مع عكس المخزون والديون
//   ✅ طباعة الفاتورة
// ============================================================
import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import AppLayout    from "../../components/layout/AppLayout";
import Button       from "../../components/ui/Button";
import { useApi }   from "../../hooks/useApi";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { r2, fmt, fmtC, fmtDate } from "@/utils/numFormat";
import { useRegisterWorkTab } from "@/hooks/useRegisterWorkTab";
import { numFieldValue } from "@/utils/numInput";
import { useAuth }       from "@/context/AuthContext";
import { useCompany, companyLogoUrl } from "@/context/CompanyContext";
import {
  openInvoicePrint,
  salesPayloadFromForm,
  salesPayloadFromDetail,
} from "@/utils/invoicePrint";
import AdminEditModal    from "@/components/invoices/AdminEditModal";
import FlexibleQtyInput  from "@/components/invoices/FlexibleQtyInput";
import {
  SALES_DRAFT_KEY,
  loadInvoiceDraft,
  saveInvoiceDraft,
  clearInvoiceDraft,
  hasInvoiceDraft,
} from "./invoiceDraft";
import {
  salesService,
  partyService,
  commonService,
  materialsService,
  warehouseService,
} from "../../services/api";

const INVOICE_DELETE_WARN =
  "Y-ai لا ينصح بحذف الفاتورة، لأنه سيغيّر الترتيب الزمني لتسجيل الفواتير والحسابات عامة.\n\nهل تريد ذلك؟";

// ── utils ────────────────────────────────────────────────────
const today = () => new Date().toISOString().split("T")[0];
const isDeferredPay = (name = "") => {
  const n = String(name).trim();
  return n === "آجل" || n === "اجل" || n.toLowerCase() === "deferred" || n.toLowerCase() === "credit";
};

// ── shared style tokens (مطابقة للمشتريات) ──────────────────
const thSt    = { padding: "10px 14px", textAlign: "right", color: "var(--text-secondary)", fontWeight: 700, fontSize: ".7rem", textTransform: "uppercase", whiteSpace: "nowrap" };
const tdSt    = { padding: "10px 14px" };
const selSt   = { width: "100%", padding: "10px 12px", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text-primary)", fontFamily: "var(--font-main)", fontSize: ".88rem", outline: "none", cursor: "pointer" };
const inputSt = { padding: "10px 12px", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text-primary)", fontFamily: "var(--font-main)", fontSize: ".88rem", outline: "none" };
const numSt   = { background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: ".88rem", outline: "none" };
const compactInvoiceSelSt = { ...selSt, padding: "8px 10px", fontSize: ".82rem" };
const compactInvoiceInputSt = { ...inputSt, padding: "8px 10px", fontSize: ".82rem" };

// تخطيط فاتورة جديدة: عمود أسطر واسع + شريط جانبي مضغوط
const SALES_FORM_GRID = "minmax(0, 1fr) minmax(168px, 188px)";
const SALES_PAGE_SCROLL = {
  width: "100%",
  maxWidth: "100%",
  boxSizing: "border-box",
};

// عرض أعمدة جدول الأسطر (11) — # مادة باركود وزن كمية هدية سعر مجموع | مستودع مخزون حذف
const SALES_LINE_COL_WIDTHS = ["2%", "20%", "7%", "7%", "10%", "4%", "11%", "13%", "8%", "5%", "3%"];

// أنماط حقول أسطر الفاتورة
const lineSelSt = {
  width: "100%", padding: "7px 9px", boxSizing: "border-box",
  background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
  color: "var(--text-primary)", fontFamily: "var(--font-main)", fontSize: ".84rem",
  outline: "none", cursor: "pointer",
};
const lineNumSt = {
  background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6,
  color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: ".92rem",
  outline: "none", boxSizing: "border-box",
};
const lineTd = { padding: "7px 5px", verticalAlign: "middle" };

// ── empty-line factory ───────────────────────────────────────
let _lid = 0;
const newEmptyLine = () => ({
  _lid            : ++_lid,
  id_Material_NoM : null,
  MaterialName    : "",
  Barcode         : "",
  Band            : "",
  CatiguaryName   : "",
  QuantityOnHand  : 0,
  AmountOUT       : 1,
  gift_qty        : 0,
  WeightKg        : 0,
  id_Warehouse    : "",
  PriceOUT        : 0,
  // الأسعار الخمسة (تُملأ من API بعد اختيار المادة)
  LastSellPrice   : 0,
  SellPrice1      : 0,
  SellPrice2      : 0,
  SellPrice3      : 0,
  SellPrice4      : 0,
  SellPrice5      : 0,
  priceOptions    : [],   // [{ label, value }] من API
});

// ============================================================
//  Root page
// ============================================================
export default function SalesInvoicePage() {
  const { locale } = useNumberLocale(); // locale متاح للمكوّن الرئيسي
  const location = useLocation();
  const navigate = useNavigate();

  const [tab, setTab] = useState(() => (
    location.state?.openInvoiceForm || hasInvoiceDraft(SALES_DRAFT_KEY) ? "new" : "list"
  ));
  const [pendingOpenId, setPendingOpenId] = useState(null);

  useEffect(() => {
    if (location.state?.openInvoiceForm) setTab("new");
  }, [location.state?.openInvoiceForm]);

  useEffect(() => {
    const id = location.state?.openInvoiceId;
    if (!id) return;
    setTab("list");
    setPendingOpenId(String(id));
    navigate(".", { replace: true, state: {} });
  }, [location.state?.openInvoiceId, navigate]);

  return (
    <>
      {tab === "list" && (
        <InvoiceListScreen
          onNew={() => setTab("new")}
          openInvoiceId={pendingOpenId}
          onOpenInvoiceConsumed={() => setPendingOpenId(null)}
        />
      )}
      {tab === "new"  && (
        <InvoiceFormScreen
          onDone={() => setTab("list")}
          onCloseDraft={() => { clearInvoiceDraft(SALES_DRAFT_KEY); setTab("list"); }}
        />
      )}
    </>
  );
}

// ============================================================
//  Screen 1 — Invoice list
// ============================================================
function InvoiceListScreen({ onNew, openInvoiceId, onOpenInvoiceConsumed }) {
  const [page,       setPage    ] = useState(1);
  const [filter,     setFilter  ] = useState({ from: "", to: "", id_Zabon: "" });
  const [detail,     setDetail  ] = useState(null);
  const [navId,      setNavId   ] = useState(null);
  const [bounds,     setBounds  ] = useState({ first: null, last: null });
  const [navLoading, setNavLoad ] = useState(false);
  const [editId,     setEditId  ] = useState(null);
  const { user, hasPermission } = useAuth();
  const canEdit = Number(user?.id_Roles) === 1 || hasPermission("can_add_sales");

  const { data: invData, loading, refetch } = useApi(
    () => salesService.getAll({ ...filter, page, limit: 20 }), [page, filter]
  );
  const { data: custData } = useApi(() => partyService.getCustomers(), []);
  const invoices   = Array.isArray(invData) ? invData : (invData?.data || []);
  const customers  = Array.isArray(custData) ? custData : (custData?.data || []);

  useEffect(() => {
    salesService.getBounds()
      .then(r => setBounds({ first: r.firstInvoice || null, last: r.lastInvoice || null }))
      .catch(() => {});
  }, [invData]);

  const openDetail = useCallback(async (id) => {
    setNavLoad(true);
    try { const r = await salesService.getOne(id); setDetail(r.data); setNavId(id); }
    finally { setNavLoad(false); }
  }, []);

  useEffect(() => {
    if (!openInvoiceId) return;
    openDetail(openInvoiceId);
    onOpenInvoiceConsumed?.();
  }, [openInvoiceId, openDetail, onOpenInvoiceConsumed]);

  const navigate = useCallback(async (dir) => {
    setNavLoad(true);
    try {
      let r;
      if (dir === "first" && bounds.first)    r = await salesService.getOne(bounds.first);
      else if (dir === "last" && bounds.last) r = await salesService.getOne(bounds.last);
      else                                     r = await salesService.navigate(navId, dir);
      setDetail(r.data); setNavId(r.data.id_NoFOUT);
    } catch (e) { alert(e.message || "لا يوجد سجل في هذا الاتجاه"); }
    finally { setNavLoad(false); }
  }, [navId, bounds]);

  return (
    <AppLayout title="فواتير المبيعات" actions={<Button onClick={onNew}>✚ فاتورة جديدة</Button>}>
      <div style={SALES_PAGE_SCROLL}>

      {/* فلاتر */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "flex-end", padding: "14px 16px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
        <Fld label="من تاريخ"><input type="date" value={filter.from} onChange={e => setFilter(p => ({ ...p, from: e.target.value }))} style={inputSt} /></Fld>
        <Fld label="إلى تاريخ"><input type="date" value={filter.to} onChange={e => setFilter(p => ({ ...p, to: e.target.value }))} style={inputSt} /></Fld>
        <Fld label="الزبون">
          <select value={filter.id_Zabon} onChange={e => setFilter(p => ({ ...p, id_Zabon: e.target.value }))} style={selSt}>
            <option value="">الكل</option>
            {customers.map(c => <option key={c.id_Zabon} value={c.id_Zabon}>{c.ZabonName}</option>)}
          </select>
        </Fld>
        <Button variant="secondary" size="sm" onClick={() => { setPage(1); refetch(); }}>🔍 بحث</Button>
        <Button variant="ghost"     size="sm" onClick={() => { setFilter({ from: "", to: "", id_Zabon: "" }); setPage(1); }}>↺ مسح</Button>
      </div>

      {/* جدول الفواتير */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".875rem" }}>
          <thead>
            <tr style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
              {["رقم","التاريخ","الزبون","المندوب","أصناف","الإجمالي","الدفع",""].map((h,i)=>(
                <th key={i} style={thSt}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></td></tr>
            ) : invoices.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>لا توجد فواتير</td></tr>
            ) : invoices.map(inv => (
              <tr key={inv.id_NoFOUT} onClick={() => openDetail(inv.id_NoFOUT)}
                style={{ borderBottom: "1px solid var(--border-subtle)", cursor: "pointer", background: navId === inv.id_NoFOUT ? "var(--accent-glow)" : "" }}
                onMouseEnter={e => { if (navId !== inv.id_NoFOUT) e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={e => { if (navId !== inv.id_NoFOUT) e.currentTarget.style.background = ""; }}>
                <td style={{ ...tdSt, fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: 800 }}>#{inv.id_NoFOUT}</td>
                <td style={tdSt}>{fmtDate(inv.Date_FOUT)}</td>
                <td style={{ ...tdSt, fontWeight: 700 }}>{inv.ZabonName || "—"}</td>
                <td style={{ ...tdSt, color: "var(--text-secondary)" }}>{inv.MandobName || "—"}</td>
                <td style={{ ...tdSt, textAlign: "center" }}>
                  <span style={{ padding: "2px 10px", background: "var(--info-bg)", color: "var(--info)", borderRadius: 20, fontSize: ".76rem", fontWeight: 700 }}>{inv.ItemCount || 0}</span>
                </td>
                <td style={{ ...tdSt, fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: 900 }}>{fmtC(inv.GrandTotal)}</td>
                <td style={tdSt}>
                  <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: ".74rem", fontWeight: 700, background: isDeferredPay(inv.PayTypeName) ? "var(--warning-bg)" : "var(--success-bg)", color: isDeferredPay(inv.PayTypeName) ? "var(--warning)" : "var(--success)", border: `1px solid ${isDeferredPay(inv.PayTypeName) ? "var(--warning)" : "var(--success)"}` }}>{inv.PayTypeName || "—"}</span>
                </td>
                <td style={{ ...tdSt, color: "var(--text-muted)", fontSize: ".78rem" }}>عرض ←</td>
              </tr>
            ))}
          </tbody>
        </table>
        {invData?.totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: 12, borderTop: "1px solid var(--border-subtle)" }}>
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← السابق</Button>
            <span style={{ fontSize: ".84rem", color: "var(--text-secondary)" }}>صفحة {page} من {invData.totalPages}</span>
            <Button size="sm" variant="secondary" disabled={page >= invData?.totalPages} onClick={() => setPage(p => p + 1)}>التالي →</Button>
          </div>
        )}
      </div>

      {/* لوحة التفاصيل */}
      {navLoading && !detail && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40, gap: 12, color: "var(--text-muted)" }}>
          <span className="spinner" style={{ width: 28, height: 28 }} /> جاري التحميل...
        </div>
      )}
      {detail && (
        <InvoiceDetailPanel
          data={detail} bounds={bounds} navId={navId} navLoading={navLoading}
          onNavigate={navigate}
          onClose={() => { setDetail(null); setNavId(null); }}
          onDeleted={() => { setDetail(null); setNavId(null); refetch(); }}
          isFirst={navId === bounds.first} isLast={navId === bounds.last}
          canEdit={canEdit} onEdit={(id) => setEditId(id)}
        />
      )}
      {editId && (
        <AdminEditModal
          invoiceId={editId} invoiceType="sales"
          onClose={() => setEditId(null)}
          onSaved={(id) => {
            const reloadId = id || editId || detail?.id_NoFOUT;
            setEditId(null);
            if (reloadId) {
              salesService.getOne(reloadId)
                .then((r) => { if (r?.data) setDetail(r.data); })
                .catch(() => {});
            }
            refetch();
          }}
        />
      )}
      </div>
    </AppLayout>
  );
}

// ============================================================
//  Invoice detail panel (read-only)
// ============================================================
function InvoiceDetailPanel({ data, bounds, navId, navLoading, onNavigate, onClose, onDeleted, isFirst, isLast, canEdit, onEdit }) {
  const [deleting, setDeleting] = useState(false);
  const { company } = useCompany();
  const logoUrl = companyLogoUrl(company?.CompanyInformation_Logo);

  const handleDelete = async () => {
    if (!confirm(INVOICE_DELETE_WARN)) return;
    setDeleting(true);
    try { await salesService.remove(data.id_NoFOUT); onDeleted(); }
    catch (e) { alert(`خطأ: ${e.message}`); }
    finally { setDeleting(false); }
  };

  const handlePrint = async () => {
    let inv = data;
    try {
      const r = await salesService.getOne(data.id_NoFOUT);
      if (r?.data) inv = r.data;
    } catch { /* استخدم البيانات المعروضة */ }
    let lines = [...(inv.lines || [])];
    try {
      const mr = await materialsService.getAll();
      const list = Array.isArray(mr?.data) ? mr.data : (Array.isArray(mr) ? mr : []);
      const byId = Object.fromEntries(list.map((m) => [String(m.id_Material_NoM), m]));
      lines = lines.map((l) => {
        const mat = byId[String(l.id_Material_NoM)];
        const fromLine = +(l.WeightKg ?? 0);
        const fromMat = +(mat?.WeightKg ?? 0);
        return { ...l, WeightKg: fromLine > 0 ? fromLine : fromMat };
      });
    } catch { /* وزن الأسطر كما هو */ }
    openInvoicePrint(salesPayloadFromDetail({ ...inv, lines }, company, logoUrl));
  };

  // ✅ [محدَّث] قراءة الأرقام مباشرة من الـ API (لم تعد objects)
  const prevBal      = data.previousBalance ?? 0;
  const isDeferred   = isDeferredPay(data.PayTypeName);
  const paidOnInv    = +(data.paidAmount || 0);
  const thisDbt      = isDeferred ? (data.thisInvoiceDebt ?? data.GrandTotal ?? 0) : 0;
  const finalBal     = isDeferred
    ? r2(data.finalBalance ?? (prevBal + thisDbt - paidOnInv))
    : prevBal;
  const totalQty = (data.lines || []).reduce(
    (s, l) => s + (+l.AmountOUT || 0) + (+l.gift_qty || 0), 0
  );

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
      {/* شريط الأدوات */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "12px 18px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border-subtle)" }}>
        <div style={{ display: "flex", gap: 4, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 3 }}>
          <NavBtn onClick={() => onNavigate("first")} disabled={isFirst||navLoading} title="أول">⏮</NavBtn>
          <NavBtn onClick={() => onNavigate("prev")}  disabled={isFirst||navLoading} title="سابق">◀</NavBtn>
          <NavBtn onClick={() => onNavigate("next")}  disabled={isLast||navLoading}  title="تالي">▶</NavBtn>
          <NavBtn onClick={() => onNavigate("last")}  disabled={isLast||navLoading}  title="آخر">⏭</NavBtn>
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 900, color: "var(--accent)", padding: "5px 14px", background: "var(--accent-glow)", border: "1px solid var(--accent)", borderRadius: "var(--radius-full)" }}>
          {navLoading && <span className="spinner" style={{ width: 12, height: 12, marginLeft: 6 }} />}
          فاتورة مبيعات #{data.id_NoFOUT}
        </span>
        <div style={{ flex: 1 }} />
        {canEdit && (
          <Button size="sm" variant="warning" onClick={() => onEdit(data.id_NoFOUT)}>✏️ تعديل الفاتورة</Button>
        )}
        <Button size="sm" onClick={handlePrint}>🖨 طباعة</Button>
        <Button size="sm" variant="danger" loading={deleting} onClick={handleDelete}>🗑 حذف</Button>
        <Button size="sm" variant="ghost"  onClick={onClose}>✕ إغلاق</Button>
      </div>

      <div style={{ padding: "20px 22px" }}>
        {/* رأس الفاتورة */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 20 }}>
          {[
            { l: "رقم الفاتورة", v: `#${data.id_NoFOUT}`, mono: true, accent: true },
            { l: "التاريخ",      v: fmtDate(data.Date_FOUT) },
            { l: "مجموع الكميات", v: `${fmt(totalQty)} وحدة`, bold: true },
            { l: "طريقة الدفع", v: data.PayTypeName },
            { l: "الزبون",       v: data.ZabonName, bold: true },
            { l: "المنطقة",      v: data.Location_ZabonLocation || "—" },
            { l: "المندوب",      v: data.MandobName || "—" },
          ].map((f, i) => (
            <div key={i}>
              <div style={{ fontSize: ".68rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 5 }}>{f.l}</div>
              <div style={{ fontWeight: f.bold ? 800 : 600, fontFamily: f.mono ? "var(--font-mono)" : "inherit", color: f.accent ? "var(--accent)" : "var(--text-primary)" }}>{f.v}</div>
            </div>
          ))}
        </div>

        {/* بيانات التوصيل */}
        {(data.DriverName || data.VehicleNumber) && (
          <div style={{ display: "flex", gap: 20, padding: "10px 14px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", marginBottom: 16, fontSize: ".84rem" }}>
            {data.DriverName    && <span>🚗 السائق: <strong>{data.DriverName}</strong> {data.DriverMobile ? `(${data.DriverMobile})` : ""}</span>}
            {data.VehicleNumber && <span>🚛 المركبة: <strong>{data.VehicleNumber}</strong></span>}
          </div>
        )}

        {/* أسطر الفاتورة */}
        <div style={{ overflowX: "auto", marginBottom: 20 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".83rem" }}>
            <thead>
              <tr style={{ background: "var(--bg-surface)", borderBottom: "2px solid var(--border)" }}>
                {["#","المادة","الباركود","الكمية","الوحدة","السعر","مجموع السعر"].map((h,i)=>(
                  <th key={i} style={{ padding: "9px 11px", textAlign: i===0||i===3 ? "center" : i>=5 ? "left" : "right", color: "var(--text-secondary)", fontWeight: 700, fontSize: ".67rem", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.lines || []).map((l, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)", background: i%2===0 ? "var(--bg-hover)" : "" }}>
                  <td style={{ padding: "9px 11px", textAlign: "center", color: "var(--text-muted)", fontSize: ".74rem", fontFamily: "var(--font-mono)" }}>{i+1}</td>
                  <td style={{ padding: "9px 11px", fontWeight: 700 }}>{l.MaterialName}</td>
                  <td style={{ padding: "9px 11px", fontFamily: "var(--font-mono)", fontSize: ".74rem", color: l.Barcode ? "var(--accent)" : "var(--text-muted)" }}>{l.Barcode || "—"}</td>
                  <td style={{ padding: "9px 11px", textAlign: "center", fontFamily: "var(--font-mono)", fontWeight: 800 }}>{l.AmountOUT}</td>
                  <td style={{ padding: "9px 11px", color: "var(--text-secondary)" }}>{l.Band || "—"}</td>
                  <td style={{ padding: "9px 11px", textAlign: "left", fontFamily: "var(--font-mono)" }}>{fmtC(l.PriceOUT)}</td>
                  <td style={{ padding: "9px 11px", textAlign: "left", fontFamily: "var(--font-mono)", fontWeight: 800, color: "var(--accent)" }}>{fmtC(l.LineTotal)}</td>
                </tr>
              ))}
              <tr style={{ background: "var(--bg-surface)", borderTop: "1px solid var(--border)" }}>
                <td colSpan={6} style={{ padding: "10px 11px", textAlign: "right", fontWeight: 700, color: "var(--text-secondary)", fontSize: ".82rem" }}>مجموع الكميات</td>
                <td style={{ padding: "10px 11px", textAlign: "center", fontFamily: "var(--font-mono)", fontWeight: 900, color: "var(--text-primary)", fontSize: ".9rem" }}>{fmt(totalQty)}</td>
              </tr>
              <tr style={{ background: "var(--bg-surface)", borderTop: "2px solid var(--border)" }}>
                <td colSpan={6} style={{ padding: "10px 11px", textAlign: "right", fontWeight: 700, color: "var(--text-secondary)", fontSize: ".82rem" }}>إجمالي السطور</td>
                <td style={{ padding: "10px 11px", textAlign: "left", fontFamily: "var(--font-mono)", fontWeight: 900, color: "var(--accent)", fontSize: ".95rem" }}>{fmtC(data.LinesTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* التذييل المالي */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* ملخص الفاتورة */}
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
            <div style={{ fontSize: ".7rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12 }}>ملخص الفاتورة</div>
            {data.Note_FOUT && (
              <div style={{ marginBottom: 10, fontSize: ".84rem", color: "var(--text-secondary)" }}>📝 {data.Note_FOUT}</div>
            )}
            <SumRow l="مجموع السطور" v={data.LinesTotal} />
            {(data.Dis_FOUT || 0) > 0 && <SumRow l="الخصم" v={data.Dis_FOUT} c="var(--danger)" minus />}
            {(data.Add_FOUT || 0) > 0 && <SumRow l="الإضافة" v={data.Add_FOUT} c="var(--success,#22c55e)" />}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", marginTop: 8, background: "var(--accent-glow)", border: "2px solid var(--accent)", borderRadius: "var(--radius-md)" }}>
              <span style={{ fontWeight: 800 }}>الصافي</span>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 900, color: "var(--accent)", fontSize: "1.05rem" }}>{fmtC(data.GrandTotal)}</span>
            </div>
            {isDeferred && (
              <div style={{ marginTop: 8, padding: "6px 10px", background: "var(--warning-bg)", border: "1px solid var(--warning)", borderRadius: "var(--radius-sm)", fontSize: ".78rem", color: "var(--warning)", fontWeight: 600 }}>
                ⚠ تم تسجيل دين آجل بقيمة {fmtC(thisDbt)}
              </div>
            )}
          </div>
          {/* حساب الزبون */}
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
            <div style={{ fontSize: ".7rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12 }}>حساب الزبون — {data.ZabonName}</div>
            <SumRow l="الحساب السابق" v={Math.abs(prevBal)} c={prevBal > 0 ? "var(--warning)" : "var(--success)"} />
            {isDeferred && <SumRow l="+ قيمة الفاتورة الآجلة" v={thisDbt} c="var(--danger)" />}
            {paidOnInv > 0 && <SumRow l="− المدفوع من الفاتورة" v={paidOnInv} c="var(--success)" minus />}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", marginTop: 8, background: "var(--accent-glow)", border: "2px solid var(--accent)", borderRadius: "var(--radius-md)" }}>
              <span style={{ fontWeight: 800 }}>الحساب النهائي</span>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 900, color: "var(--accent)", fontSize: "1.05rem" }}>
                {fmtC(Math.abs(finalBal))}
              </span>
            </div>
          </div>
        </div>

        {/* توقيعات */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginTop: 28 }}>
          {["المستلم", "المحاسب", "المدير"].map(s => (
            <div key={s} style={{ textAlign: "center", borderTop: "1px solid var(--border)", paddingTop: 10, fontSize: ".78rem", color: "var(--text-muted)" }}>{s}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  Screen 2 — New invoice form
// ============================================================
function InvoiceFormScreen({ onDone, onCloseDraft }) {
  const { company } = useCompany();
  const logoUrl = companyLogoUrl(company?.CompanyInformation_Logo);
  const tableRef = useRef(null);
  const restoredDraft = useMemo(() => loadInvoiceDraft(SALES_DRAFT_KEY), []);

  /* ─── header state ─────────────────────────────────────── */
  const [hdr, setHdr] = useState(() => restoredDraft?.hdr || {
    Date_FOUT        : today(),
    id_Zabon         : "",
    id_PayType_FOUT  : "",
    id_Mandob        : "",
    Dis_FOUT         : 0,
    Add_FOUT         : 0,
    Note_FOUT        : "",
    DriverName       : "",
    DriverMobile     : "",
    VehicleNumber    : "",
  });
  const sh = k => v => setHdr(p => ({ ...p, [k]: v }));

  /* ─── lines — start with one empty row ─────────────────── */
  const [lines, setLines] = useState(() => {
    if (restoredDraft?.lines?.length) {
      restoredDraft.lines.forEach((l) => { if (l._lid > _lid) _lid = l._lid; });
      return restoredDraft.lines;
    }
    return [newEmptyLine()];
  });

  const [paidAmount, setPaidAmount] = useState(restoredDraft?.paidAmount ?? "");

  useEffect(() => {
    saveInvoiceDraft(SALES_DRAFT_KEY, { hdr, lines, paidAmount });
  }, [hdr, lines, paidAmount]);

  const addLineAndFocus = useCallback(() => {
    setLines((p) => [...p, newEmptyLine()]);
    setTimeout(() => {
      const inputs = tableRef.current?.querySelectorAll("[data-line-material-input]");
      inputs?.[inputs.length - 1]?.focus();
    }, 30);
  }, []);

  useEffect(() => {
    const handler = () => addLineAndFocus();
    window.addEventListener("wms-invoice-add-line", handler);
    return () => window.removeEventListener("wms-invoice-add-line", handler);
  }, [addLineAndFocus]);

  /* ─── customer balance ──────────────────────────────────── */
  const { data: custBalData, loading: loadingCustBal } = useApi(
    () => hdr.id_Zabon ? salesService.getCustomerInfo(hdr.id_Zabon) : Promise.resolve(null),
    [hdr.id_Zabon]
  );
  const custInfo = custBalData?.data || null;
  const custBal  = custInfo?.previousBalance || null;
  const prevBal  = custBal?.netBalance || 0;

  /* ─── reference data ────────────────────────────────────── */
  const { data: custData } = useApi(() => partyService.getCustomers(), []);
  const { data: payData  } = useApi(() => commonService.getPayTypes(),  []);
  const { data: mandData } = useApi(() => commonService.getMandobs(),   []);
  const { data: matsData, loading: loadingMats } = useApi(() => materialsService.getAll(), []);

  const customers   = Array.isArray(custData) ? custData : (custData?.data || []);
  const payTypes    = payData?.data || [];
  const mandobs     = mandData?.data || [];
  const allMaterials = Array.isArray(matsData)
    ? matsData
    : (Array.isArray(matsData?.data) ? matsData.data : []);

  const { data: whData } = useApi(() => warehouseService.listActive(), []);
  const warehouses = whData?.data || [];

  /* ─── selected pay type ─────────────────────────────────── */
  const selectedPayType = payTypes.find(p => String(p.id_PayType) === String(hdr.id_PayType_FOUT));
  const isDeferred      = isDeferredPay(selectedPayType?.PayTypeName || "");

  /* ─── computed totals ───────────────────────────────────── */
  const validLines  = useMemo(() => lines.filter(l => l.id_Material_NoM), [lines]);

  useRegisterWorkTab({
    id: "sales-invoice-draft",
    title: "فاتورة بيع",
    path: "/invoices-out",
    state: { openInvoiceForm: true },
    active: validLines.length > 0 || !!hdr.id_Zabon || !!paidAmount,
  });
  const linesTotal  = useMemo(() => validLines.reduce((s, l) => s + r2((+l.AmountOUT||0) * (+l.PriceOUT||0)), 0), [validLines]);
  const invoiceWeightKg = useMemo(
    () => validLines.reduce((s, l) => s + r2((+l.WeightKg || 0) * ((+l.AmountOUT || 0) + (+l.gift_qty || 0))), 0),
    [validLines]
  );
  const grandTotal  = useMemo(
    () => r2(linesTotal - (+hdr.Dis_FOUT || 0) + (+hdr.Add_FOUT || 0)),
    [linesTotal, hdr.Dis_FOUT, hdr.Add_FOUT]
  );
  const paidNum     = useMemo(() => Math.max(0, +paidAmount || 0), [paidAmount]);
  const remainDue   = useMemo(() => r2(Math.max(0, grandTotal - paidNum)), [grandTotal, paidNum]);
  const finalBal    = useMemo(() => r2(prevBal + (isDeferred ? remainDue : 0)), [prevBal, isDeferred, remainDue]);
  const belowZero   = validLines.filter(l => {
    const deduct = (+l.AmountOUT || 0) + (+l.gift_qty || 0);
    return (+l.QuantityOnHand || 0) - deduct < 0;
  });

  /* ─── save ──────────────────────────────────────────────── */
  const [saving,      setSaving     ] = useState(false);
  const [saveErr,     setSaveErr    ] = useState("");
  const [savedResult, setSavedResult] = useState(null);

  const handleSave = async () => {
    setSaveErr("");
    if (!hdr.id_Zabon)        return setSaveErr("يرجى اختيار الزبون");
    if (!hdr.id_PayType_FOUT) return setSaveErr("يرجى اختيار طريقة الدفع");
    if (!validLines.length)   return setSaveErr("يرجى إضافة مادة واحدة على الأقل");

    setSaving(true);
    try {
      const res = await salesService.create({
        ...hdr,
        Dis_FOUT  : +hdr.Dis_FOUT || 0,
        Add_FOUT  : +hdr.Add_FOUT || 0,
        id_Mandob : hdr.id_Mandob || null,
        lines     : validLines.map(l => ({
          id_Material_NoM : l.id_Material_NoM,
          AmountOUT       : +l.AmountOUT || 1,
          gift_qty        : +l.gift_qty  || 0,
          PriceOUT        : +l.PriceOUT  || 0,
          id_Warehouse    : l.id_Warehouse ? Number(l.id_Warehouse) : null,
        })),
        PaidAmount: paidNum > 0 ? paidNum : undefined,
      });
      clearInvoiceDraft(SALES_DRAFT_KEY);
      setSavedResult({
        ...res,
        printSnap: {
          company, logoUrl, hdr: { ...hdr }, validLines: validLines.map(l => ({ ...l })),
          customers, payTypes, mandobs, prevBal, linesTotal, grandTotal, paidAmount: paidNum,
        },
      });
    } catch (e) { setSaveErr(e.message || "حدث خطأ أثناء الحفظ"); }
    finally { setSaving(false); }
  };

  const handlePrint = (invoiceNo) => {
    if (!validLines.length) {
      alert("أضف مادة واحدة على الأقل قبل الطباعة");
      return;
    }
    openInvoicePrint(
      salesPayloadFromForm({
        company,
        logoUrl,
        hdr,
        validLines,
        customers,
        payTypes,
        mandobs,
        prevBal,
        linesTotal,
        grandTotal,
        invoiceNo,
        paidAmount: paidNum,
        totalWeightKg: invoiceWeightKg,
      })
    );
  };

  /* ─── success screen ────────────────────────────────────── */
  if (savedResult) {
    const savedId = savedResult?.invoiceId;
    const printSaved = async () => {
      const snap = savedResult.printSnap;
      if (snap) {
        const snapWeight = r2(
          (snap.validLines || []).reduce(
            (s, l) => s + (+l.WeightKg || 0) * ((+l.AmountOUT || 0) + (+l.gift_qty || 0)),
            0
          )
        );
        openInvoicePrint(
          salesPayloadFromForm({
            ...snap,
            invoiceNo: savedId,
            totalWeightKg: snapWeight,
          })
        );
        return;
      }
      if (!savedId) return;
      try {
        const r = await salesService.getOne(savedId);
        openInvoicePrint(salesPayloadFromDetail(r.data, company, logoUrl));
      } catch (e) {
        alert(e?.message || "تعذّر تحميل الفاتورة للطباعة");
      }
    };
    return (
      <AppLayout title="فاتورة مبيعات جديدة" actions={<Button variant="ghost" onClick={onDone}>← رجوع</Button>}>
        <div style={SALES_PAGE_SCROLL}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, padding: "60px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 52 }}>✅</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>تم حفظ الفاتورة بنجاح!</div>
          <div style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", fontSize: "1.1rem" }}>فاتورة #{savedId}</div>
          {savedResult?.belowZeroWarnings?.length > 0 && (
            <div style={{ padding: "12px 16px", background: "var(--warning-bg)", border: "1px solid var(--warning)", borderRadius: "var(--radius-md)", color: "var(--warning)", textAlign: "right", maxWidth: 420 }}>
              <strong>⚠ تحذير مخزون سالب:</strong>
              <ul style={{ marginTop: 6, paddingRight: 16 }}>
                {savedResult.belowZeroWarnings.map((w, i) => <li key={i} style={{ fontSize: ".84rem", marginTop: 4 }}>{w}</li>)}
              </ul>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <Button onClick={printSaved}>🖨 طباعة الفاتورة</Button>
            <Button variant="ghost" onClick={onDone}>← العودة للقائمة</Button>
          </div>
        </div>
        </div>
      </AppLayout>
    );
  }

  /* ─── render ────────────────────────────────────────────── */
  return (
    <AppLayout
      title="فاتورة مبيعات جديدة"
      actions={
        <>
          <Button variant="ghost" onClick={onDone} title="العودة للقائمة — تبقى المسودة محفوظة">← رجوع</Button>
          <Button variant="ghost" onClick={() => {
            if (window.confirm("إغلاق الفاتورة وحذف المسودة؟")) onCloseDraft?.();
          }}>✕ إغلاق</Button>
        </>
      }
    >
      <div style={SALES_PAGE_SCROLL}>
      <div style={{ display: "grid", gridTemplateColumns: SALES_FORM_GRID, gap: 12, alignItems: "start", width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>

        {/* ════════ العمود الرئيسي ════════════════════════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0, maxWidth: "100%", overflow: "visible" }}>

          {/* ── بيانات الفاتورة (رأس) ────────────────────── */}
          <Panel label="بيانات الفاتورة" bodyStyle={{ padding: "10px 12px 12px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>

              <Fld label="التاريخ *">
                <input type="date" value={hdr.Date_FOUT} onChange={e => sh("Date_FOUT")(e.target.value)}
                  style={{ ...compactInvoiceInputSt, width: "100%", boxSizing: "border-box" }} />
              </Fld>

              <Fld label="الزبون *">
                <select value={hdr.id_Zabon} onChange={e => sh("id_Zabon")(e.target.value)} style={compactInvoiceSelSt}>
                  <option value="">— اختر الزبون —</option>
                  {customers.map(c => <option key={c.id_Zabon} value={c.id_Zabon}>{c.ZabonName}</option>)}
                </select>
              </Fld>

              <Fld label="طريقة الدفع *">
                <select value={hdr.id_PayType_FOUT} onChange={e => sh("id_PayType_FOUT")(e.target.value)} style={compactInvoiceSelSt}>
                  <option value="">— اختر —</option>
                  {payTypes.map(p => <option key={p.id_PayType} value={p.id_PayType}>{p.PayTypeName}</option>)}
                </select>
              </Fld>

              <Fld label="المندوب">
                <select value={hdr.id_Mandob} onChange={e => sh("id_Mandob")(e.target.value)} style={compactInvoiceSelSt}>
                  <option value="">بدون مندوب</option>
                  {mandobs.map(m => <option key={m.id_Mandob} value={m.id_Mandob}>{m.MandobName}</option>)}
                </select>
              </Fld>

              <Fld label="اسم السائق">
                <input type="text" value={hdr.DriverName} onChange={e => sh("DriverName")(e.target.value)}
                  placeholder="اختياري..." style={{ ...compactInvoiceInputSt, width: "100%", boxSizing: "border-box" }} />
              </Fld>

              <Fld label="رقم الهاتف">
                <input type="text" value={hdr.DriverMobile} onChange={e => sh("DriverMobile")(e.target.value)}
                  placeholder="أرقام أو نص..." style={{ ...compactInvoiceInputSt, width: "100%", boxSizing: "border-box" }} />
              </Fld>

              <Fld label="رقم المركبة">
                <input type="text" value={hdr.VehicleNumber} onChange={e => sh("VehicleNumber")(e.target.value)}
                  placeholder="حروف وأرقام..." style={{ ...compactInvoiceInputSt, width: "100%", boxSizing: "border-box" }} />
              </Fld>

              <Fld label="ملاحظة">
                <input type="text" value={hdr.Note_FOUT} onChange={e => sh("Note_FOUT")(e.target.value)}
                  placeholder="ملاحظات..." style={{ ...compactInvoiceInputSt, width: "100%", boxSizing: "border-box" }} />
              </Fld>

            </div>
          </Panel>

          {/* ── جدول الأسطر ───────────────────────────────── */}
          <Panel label={`أسطر الفاتورة (${validLines.length} صنف)`} noPad>
            <div style={{ overflowX: "auto", maxWidth: "100%", WebkitOverflowScrolling: "touch" }}>
              <table ref={tableRef} style={{ width: "100%", minWidth: 920, tableLayout: "fixed", borderCollapse: "collapse", fontSize: ".82rem" }}>
                <colgroup>
                  {SALES_LINE_COL_WIDTHS.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>

                {/* ── رؤوس الأعمدة — المطلوبة ─────────────── */}
                <thead>
                  <tr style={{ background: "var(--bg-surface)", borderBottom: "2px solid var(--border)" }}>
                    {[
                      { l: "#",              align: "center" },
                      { l: "اختيار المادة", align: "right"  },
                      { l: "الباركود",       align: "center" },
                      { l: "الوزن",          align: "center" },
                      { l: "الكمية",         align: "center" },
                      { l: "هدية",           align: "center" },
                      { l: "السعر",          align: "left"   },
                      { l: "مجموع السعر",    align: "left"   },
                      { l: "المستودع",       align: "right"  },
                      { l: "المخزون",        align: "center" },
                      { l: "",               align: "center" },
                    ].map((h, i) => (
                      <th key={i} style={{ padding: "8px 6px", textAlign: h.align, color: "var(--text-secondary)", fontWeight: 700, fontSize: ".68rem", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.l}</th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {lines.map((line, idx) => (
                    <SalesLineRow
                      key={line._lid}
                      idx={idx + 1}
                      line={line}
                      allMaterials={allMaterials}
                      warehouses={warehouses}
                      loadingMats={loadingMats}
                      onUpdate={u => setLines(p => p.map((l, i) => i === idx ? { ...l, ...u } : l))}
                      onRemove={() => setLines(p => {
                        const next = p.filter((_, i) => i !== idx);
                        return next.length ? next : [newEmptyLine()];
                      })}
                    />
                  ))}
                </tbody>

                <tfoot>
                  {/* زر إضافة سطر */}
                  <tr style={{ borderTop: "1px dashed var(--border)" }}>
                    <td colSpan={11} style={{ padding: "7px 10px" }}>
                      <button
                        onClick={() => setLines(p => [...p, newEmptyLine()])}
                        style={{ width: "100%", padding: "6px", background: "none", border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", cursor: "pointer", fontSize: ".8rem", fontFamily: "var(--font-main)", transition: "all var(--transition)" }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)";  e.currentTarget.style.color = "var(--text-muted)"; }}
                      >＋ إضافة سطر جديد</button>
                    </td>
                  </tr>
                  {/* إجمالي السطور */}
                  {validLines.length > 0 && (
                    <tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-surface)" }}>
                      <td colSpan={7} style={{ padding: "10px 10px", textAlign: "right", fontWeight: 700, color: "var(--text-secondary)", fontSize: ".82rem" }}>
                        إجمالي السطور ({validLines.length} {validLines.length === 1 ? "صنف" : "أصناف"} · {validLines.reduce((s,l) => s + (+l.AmountOUT||0), 0)} وحدة)
                      </td>
                      <td style={{ padding: "10px 10px", textAlign: "left", fontFamily: "var(--font-mono)", fontWeight: 900, color: "var(--accent)", fontSize: ".95rem" }}>
                        {fmtC(linesTotal)}
                      </td>
                      <td colSpan={3} />
                    </tr>
                  )}
                </tfoot>

              </table>
            </div>
          </Panel>

          {/* ── ماسح الباركود (تحت أسطر الفاتورة) ─────────── */}
          <BarcodeScanner onFillLine={(mat) => {
            const qty = mat.scannedQty > 0 ? mat.scannedQty : 1;
            const priceFromScale = mat.scanType === "scale_price" && mat.scannedLineTotal > 0
              ? String(mat.scannedLineTotal)
              : "";
            setLines(prev => {
              const emptyIdx = prev.findIndex(l => !l.id_Material_NoM);
              const filled = {
                id_Material_NoM : mat.id_Material_NoM,
                MaterialName    : mat.MaterialName,
                Barcode         : mat.Barcode      || "",
                Band            : mat.Band         || "",
                CatiguaryName   : mat.CatiguaryName || "",
                QuantityOnHand  : mat.QuantityOnHand || 0,
                AmountOUT       : qty,
                WeightKg        : +mat.WeightKg || 0,
                PriceOUT        : priceFromScale,
                LastSellPrice   : mat.LastSellPrice || 0,
                SellPrice1      : mat.SellPrice1    || 0,
                SellPrice2      : mat.SellPrice2    || 0,
                SellPrice3      : mat.SellPrice3    || 0,
                SellPrice4      : mat.SellPrice4    || 0,
                SellPrice5      : mat.SellPrice5    || 0,
                priceOptions    : mat.priceOptions  || [],
                expiryWarning   : mat.expiryWarning || null,
              };
              if (emptyIdx >= 0)
                return prev.map((l, i) => i === emptyIdx ? { ...l, ...filled } : l);
              return [...prev, { ...newEmptyLine(), ...filled }];
            });
          }} />

          {/* تحذير مخزون سالب */}
          {belowZero.length > 0 && (
            <div style={{ padding: "12px 16px", background: "var(--warning-bg)", border: "1px solid var(--warning)", borderRadius: "var(--radius-md)", color: "var(--warning)", fontSize: ".84rem" }}>
              <strong>⚠ تحذير — الكميات التالية ستجعل المخزون سالباً (البيع مسموح):</strong>
              <ul style={{ marginTop: 6, paddingRight: 16 }}>
                {belowZero.map((l, i) => (
                  <li key={i} style={{ marginTop: 3 }}>
                    {l.MaterialName}: المخزون الحالي {l.QuantityOnHand}، الكمية المطلوبة {l.AmountOUT}، الناتج {r2(l.QuantityOnHand - l.AmountOUT)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* خطأ الحفظ */}
          {saveErr && (
            <div style={{ padding: "12px 16px", background: "var(--danger-bg)", border: "1px solid var(--danger)", borderRadius: "var(--radius-md)", color: "var(--danger)", fontWeight: 600, fontSize: ".88rem" }}>
              ⚠ {saveErr}
            </div>
          )}
        </div>

        {/* ════════ الشريط الجانبي (مضغوط) ═════════════════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, position: "sticky", top: 72, minWidth: 0, maxWidth: 188, fontSize: ".78rem" }}>

          <Panel label="ملخص" compact>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: ".7rem", color: "var(--text-secondary)", whiteSpace: "nowrap", flexShrink: 0 }}>خصم</span>
              <input type="number" min="0" step="any" value={numFieldValue(hdr.Dis_FOUT)} placeholder="0"
                onChange={e => sh("Dis_FOUT")(e.target.value === "" ? "" : e.target.value)}
                style={{ flex: 1, minWidth: 0, padding: "4px 6px", textAlign: "left", fontSize: ".78rem", ...numSt }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: ".7rem", color: "var(--text-secondary)", whiteSpace: "nowrap", flexShrink: 0 }}>إضافة</span>
              <input type="number" min="0" step="any" value={numFieldValue(hdr.Add_FOUT)} placeholder="0"
                onChange={e => sh("Add_FOUT")(e.target.value === "" ? "" : e.target.value)}
                style={{ flex: 1, minWidth: 0, padding: "4px 6px", textAlign: "left", fontSize: ".78rem", ...numSt }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: ".7rem", color: "var(--text-secondary)", whiteSpace: "nowrap", flexShrink: 0 }}>المبلغ المدفوع</span>
              <input
                type="number"
                min="0"
                step="any"
                value={numFieldValue(paidAmount)}
                placeholder="0"
                title="دفعة سريعة — مثل سند قبض"
                onChange={(e) => setPaidAmount(e.target.value === "" ? "" : e.target.value)}
                style={{ flex: 1, minWidth: 0, padding: "4px 6px", textAlign: "left", fontSize: ".78rem", ...numSt }}
              />
            </div>
            <SumRow dense l="السطور" v={linesTotal} />
            {(+hdr.Dis_FOUT) > 0 && <SumRow dense l="خصم" v={+hdr.Dis_FOUT} c="var(--danger)" minus />}
            {(+hdr.Add_FOUT) > 0 && <SumRow dense l="إضافة" v={+hdr.Add_FOUT} c="var(--success,#22c55e)" />}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4, padding: "4px 0 6px", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: ".7rem", fontWeight: 800, color: "#800020", flexShrink: 0 }}>مجموع الوزن</span>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 900, color: "#800020", fontSize: ".78rem", textAlign: "left" }}>
                {r2(invoiceWeightKg)} كغم
              </span>
            </div>
            <div style={{ borderTop: "1px solid var(--border)", marginTop: 6, paddingTop: 6 }}>
              <SumRow dense l="الإجمالي" v={grandTotal} accent big />
            </div>

            {paidNum > 0 && (
              <SumRow dense l="المتبقي" v={remainDue} c={remainDue > 0 ? "var(--warning)" : "var(--success)"} />
            )}
            {!isDeferred && paidNum > 0 && (
              <div style={{ fontSize: ".62rem", color: "var(--text-muted)", marginTop: 4, lineHeight: 1.35 }}>
                الدفعة السريعة تُطبَّق مع طريقة الدفع «آجل»
              </div>
            )}

            {isDeferred && (
              <div style={{ marginTop: 6, padding: "5px 7px", background: "var(--warning-bg)", border: "1px solid var(--warning)", borderRadius: "var(--radius-sm)", fontSize: ".68rem", color: "var(--warning)", fontWeight: 600, lineHeight: 1.35 }}>
                دين آجل: {fmtC(remainDue)}
              </div>
            )}

            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border)" }}>
              <div style={{ fontSize: ".62rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>حساب الزبون</div>
              {!hdr.id_Zabon ? (
                <div style={{ padding: "8px 6px", border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)", textAlign: "center", fontSize: ".7rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
                  اختر زبوناً
                </div>
              ) : loadingCustBal ? (
                <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: ".72rem" }}>
                  <span className="spinner" style={{ width: 10, height: 10 }} /> جاري جلب حساب الزبون...
                </div>
              ) : custBal ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4, marginBottom: 5 }}>
                    <span style={{ fontSize: ".7rem", color: "var(--text-secondary)" }}>المحصَّل</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: ".76rem", color: "var(--success)" }}>{fmtC(custBal.totalCollected)}</span>
                  </div>
                  <div style={{ padding: "4px 6px", borderRadius: "var(--radius-sm)", background: prevBal > 0 ? "var(--warning-bg)" : "var(--success-bg)", border: `1px solid ${prevBal > 0 ? "var(--warning)" : "var(--success)"}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: ".7rem", fontWeight: 700, color: prevBal > 0 ? "var(--warning)" : "var(--success)" }}>الرصيد السابق</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: ".76rem", color: prevBal > 0 ? "var(--warning)" : "var(--success)" }}>
                      {fmtC(Math.abs(prevBal))}
                      <span style={{ fontSize: ".62rem", color: "var(--text-muted)", marginRight: 4 }}>
                        {prevBal > 0 ? "(مدين)" : prevBal < 0 ? "(دائن)" : "(مسوَّى)"}
                      </span>
                    </span>
                  </div>
                  {isDeferred && (
                    <div style={{ padding: "5px 7px", marginTop: 5, background: "var(--accent-glow)", border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)", display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 800, fontSize: ".72rem" }}>
                      <span>الرصيد النهائي</span>
                      <span style={{ fontFamily: "var(--font-mono)", color: finalBal > 0 ? "var(--danger)" : "var(--success)" }}>{fmtC(Math.abs(finalBal))}</span>
                    </div>
                  )}
                </>
              ) : null}
            </div>

            <div style={{ marginTop: 6, fontSize: ".65rem", color: "var(--text-muted)", textAlign: "center" }}>
              {validLines.length} صنف · {validLines.reduce((s, l) => s + (+l.AmountOUT || 0), 0)} وحدة
            </div>
          </Panel>

          <Button onClick={handleSave} loading={saving} fullWidth size="md" style={{ fontSize: ".8rem", padding: "10px 8px" }}>💾 حفظ</Button>
          <div style={{ padding: "6px 8px", background: "var(--bg-hover)", borderRadius: "var(--radius-sm)", fontSize: ".64rem", color: "var(--text-muted)", lineHeight: 1.35, textAlign: "center" }}>
            خصم المخزون عند الحفظ
          </div>
        </div>
      </div>
      </div>
    </AppLayout>
  );
}

// ============================================================
//  BarcodeScanner — يملأ أول سطر فارغ أو يضيف سطراً جديداً
//  يستخدم: GET /api/invoices-out/material/:identifier
//  يعيد: LastSellPrice + SellPrice1-5 + QuantityOnHand
// ============================================================
function BarcodeScanner({ onFillLine }) {
  const [bc,   setBc  ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg,  setMsg ] = useState({ text: "", ok: true });
  const inputRef = useRef(null);

  const scan = async (val) => {
    const v = (val || "").trim();
    if (!v) return;
    setBusy(true); setMsg({ text: "", ok: true });
    try {
      const res = await salesService.getMaterial(v);
      if (res?.success && res?.data) {
        onFillLine({
          ...res.data,
          priceOptions: res.priceOptions || [],
          expiryWarning: res.expiryWarning?.message || null,
        });
        const scaleHint = res.data?.scanNote ? ` — ${res.data.scanNote}` : "";
        setBc("");
        setMsg({ text: `✅ أُضيفت: ${res.data.MaterialName} (مخزون: ${res.data.QuantityOnHand})${scaleHint}`, ok: true });
        inputRef.current?.focus();
      } else {
        setMsg({ text: `⚠ لا توجد مادة بـ: ${v}`, ok: false });
      }
    } catch (e) { setMsg({ text: e?.message || "❌ خطأ في الاتصال", ok: false }); }
    finally {
      setBusy(false);
      setTimeout(() => setMsg({ text: "", ok: true }), 3000);
    }
  };

  return (
    <Panel label="📷 مسح الباركود — اكتب ID أو Barcode ثم اضغط Enter">
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          ref={inputRef} value={bc}
          onChange={e => setBc(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") scan(bc); }}
          placeholder="امسح الباركود أو اكتب رقم المادة يدوياً..."
          style={{ flex: 1, padding: "10px 14px", ...numSt, fontFamily: "var(--font-mono)", fontSize: ".95rem" }}
          onFocus={e => { e.target.style.borderColor = "var(--accent)"; }}
          onBlur={e  => { e.target.style.borderColor = "var(--border)"; }}
        />
        <Button size="sm" loading={busy} onClick={() => scan(bc)}>إضافة ↵</Button>
      </div>
      {msg.text && (
        <div style={{ marginTop: 8, fontSize: ".82rem", color: msg.ok ? "var(--success)" : "var(--warning)", fontWeight: 600 }}>
          {msg.text}
        </div>
      )}
    </Panel>
  );
}

// ============================================================
//  SalesLineRow — صف واحد في جدول الأسطر
//
//  الأعمدة:
//  1.# 2.مادة 3.باركود 4.كمية 5.هدية 6.سعر 7.مجموع 8.مستودع 9.مخزون 10.حذف
// ============================================================
function SalesLineRow({ idx, line, allMaterials, warehouses, loadingMats, onUpdate, onRemove }) {
  const materialsList = Array.isArray(allMaterials) ? allMaterials : [];

  // مجموع السعر يتحدث فورياً
  const lineTotal = useMemo(() => r2((+line.AmountOUT || 0) * (+line.PriceOUT || 0)), [line.AmountOUT, line.PriceOUT]);
  const lineWeight = useMemo(
    () => r2((+line.WeightKg || 0) * ((+line.AmountOUT || 0) + (+line.gift_qty || 0))),
    [line.WeightKg, line.AmountOUT, line.gift_qty]
  );

  const refreshStockQty = async (matId, whId) => {
    if (!matId) return;
    if (whId) {
      try {
        const r = await warehouseService.getQty(whId, matId);
        onUpdate({ QuantityOnHand: r?.qty ?? 0 });
      } catch {
        onUpdate({ QuantityOnHand: 0 });
      }
      return;
    }
    const mat = allMaterials.find((m) => String(m.id_Material_NoM) === String(matId));
    if (mat) onUpdate({ QuantityOnHand: mat.QuantityOnHand ?? mat.CurrentStock ?? 0 });
  };

  // عند اختيار مادة من الـ Dropdown — جلب أسعار البيع من API
  const pickFromDropdown = async (matId) => {
    if (!matId) return;
    const mat = allMaterials.find(m => String(m.id_Material_NoM) === String(matId));
    if (!mat) return;

    // جلب الأسعار الخمسة من API
    try {
      const res = await salesService.getMaterial(String(matId));
      if (res?.success && res?.data) {
        const base = {
          id_Material_NoM : res.data.id_Material_NoM,
          MaterialName    : res.data.MaterialName,
          Barcode         : res.data.Barcode        || "",
          Band            : res.data.Band           || "",
          CatiguaryName   : res.data.CatiguaryName  || "",
          CostPrice       : res.data.CostPrice      || 0,
          WeightKg        : +res.data.WeightKg || 0,
          PriceOUT        : "",
          LastSellPrice   : res.data.LastSellPrice  || 0,
        };
        onUpdate({ ...base, expiryWarning: res.expiryWarning?.message || null });
        await refreshStockQty(matId, line.id_Warehouse || "");
        return;
      }
    } catch (_) {}

    // fallback: بيانات المادة الأساسية بدون أسعار البيع
    onUpdate({
      id_Material_NoM : mat.id_Material_NoM,
      MaterialName    : mat.MaterialName,
      Barcode         : mat.Barcode         || "",
      Band            : mat.Band            || "",
      CatiguaryName   : mat.CatiguaryName   || "",
      CostPrice       : mat.CostPrice       || 0,
      WeightKg        : +mat.WeightKg || 0,
      PriceOUT        : "",
      LastSellPrice   : mat.LastSellPrice   || 0,
    });
    await refreshStockQty(matId, line.id_Warehouse || "");
  };

  const clearMat = () => onUpdate({
    id_Material_NoM: null, MaterialName: "", Barcode: "",
    Band: "", CatiguaryName: "", QuantityOnHand: 0, id_Warehouse: "",
    PriceOUT: 0, LastSellPrice: 0, SellPrice1: 0,
    SellPrice2: 0, SellPrice3: 0, SellPrice4: 0, SellPrice5: 0,
    WeightKg: 0,
    priceOptions: [],
  });

  const pick = (mat) => pickFromDropdown(String(mat.id_Material_NoM));

  // لون المخزون
  const stockColor = (+line.QuantityOnHand || 0) <= 0 ? "var(--danger)"
                   : (+line.QuantityOnHand || 0) <= 5  ? "var(--warning)"
                   : "var(--success)";

  return (
    <tr
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
      onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = ""; }}
    >

      {/* 1 — تسلسل */}
      <td style={{ ...lineTd, textAlign: "center", fontFamily: "var(--font-mono)", color: "var(--text-muted)", fontSize: ".78rem", fontWeight: 700 }}>
        {idx}
      </td>

      {/* 2 — اختيار المادة */}
      <td style={{ ...lineTd, minWidth: 0 }}>
        {line.MaterialName ? (
          <div style={{ display: "flex", gap: 4, alignItems: "flex-start", minWidth: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: ".86rem", lineHeight: 1.3, wordBreak: "break-word" }}>
                {line.MaterialName}
              </div>
              {line.CatiguaryName && (
                <div style={{ fontSize: ".7rem", color: "var(--text-muted)", marginTop: 2, lineHeight: 1.25, wordBreak: "break-word" }}>{line.CatiguaryName}</div>
              )}
              {line.expiryWarning && (
                <div style={{ fontSize: ".68rem", color: "var(--danger)", fontWeight: 700, marginTop: 4, lineHeight: 1.3 }}>
                  {line.expiryWarning}
                </div>
              )}
            </div>
            <button onClick={clearMat} title="تغيير المادة"
              style={{ flexShrink: 0, background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: ".85rem", padding: "2px 4px" }}>✎</button>
          </div>
        ) : (
          <SalesMaterialTypeahead
            materials={materialsList}
            loading={loadingMats}
            onPick={pick}
            placeholder="اكتب اسم المادة..."
            style={lineSelSt}
          />
        )}
      </td>

      {/* 3 — الباركود */}
      <td style={{ ...lineTd, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: ".78rem", color: line.Barcode ? "var(--accent)" : "var(--text-muted)", wordBreak: "break-all", lineHeight: 1.25 }}>
        {line.Barcode || "—"}
      </td>

      {/* 4 — الوزن (كغم) */}
      <td style={{ ...lineTd, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: ".78rem", fontWeight: 700, color: lineWeight > 0 ? "var(--text-primary)" : "var(--text-muted)" }}>
        {line.id_Material_NoM ? lineWeight : "—"}
      </td>

      {/* 5 — الكمية (+/−) */}
      <td style={lineTd}>
        <div style={{ display: "flex", alignItems: "center", gap: 2, justifyContent: "center" }}>
          <QtyBtn onClick={() => onUpdate({ AmountOUT: Math.max(0.001, r2((+line.AmountOUT||1) - 1)) })}>−</QtyBtn>
          <FlexibleQtyInput
            value={line.AmountOUT ?? 1}
            onChange={(n) => onUpdate({ AmountOUT: n })}
            style={{ ...lineNumSt, padding: "4px 4px" }}
            width={64}
          />
          <QtyBtn accent onClick={() => onUpdate({ AmountOUT: r2((+line.AmountOUT||1) + 1) })}>+</QtyBtn>
        </div>
      </td>

      {/* 6 — هدية */}
      <td style={lineTd}>
        <input
          type="number"
          min="0"
          step="1"
          value={numFieldValue(line.gift_qty)}
          placeholder="0"
          onChange={e => onUpdate({ gift_qty: e.target.value === "" ? "" : Math.max(0, Math.floor(+e.target.value || 0)) })}
          title="كمية الهدية — لا تُحتسب في السعر"
          style={{ ...lineNumSt, width: "100%", maxWidth: 42, margin: "0 auto", display: "block", textAlign: "center", padding: "4px 2px",
                   color: "var(--warning, #d97706)", fontWeight: 700,
                   borderColor: (+line.gift_qty || 0) > 0 ? "var(--warning, #d97706)" : undefined }}
        />
      </td>

      {/* 7 — سعر البيع (يدوي) + تلميح سعر المخزون */}
      <td style={lineTd}>
        <input
          type="number"
          min="0"
          step="any"
          value={line.PriceOUT === "" || line.PriceOUT == null ? "" : line.PriceOUT}
          onChange={e => onUpdate({ PriceOUT: e.target.value === "" ? "" : Math.max(0, +e.target.value || 0) })}
          placeholder="سعر البيع"
          title="أدخل سعر البيع يدوياً"
          {...(!line.id_Material_NoM ? { "data-invoice-line-last": "true" } : {})}
          style={{ ...lineNumSt, width: "100%", padding: "5px 6px", textAlign: "left", fontWeight: 700 }}
        />
        {line.id_Material_NoM && (+line.CostPrice || 0) > 0 && (
          <div style={{ fontSize: ".62rem", color: "var(--text-muted)", marginTop: 3, lineHeight: 1.2 }}>
            مخزون: {fmtC(line.CostPrice)}
          </div>
        )}
      </td>

      {/* 7 — مجموع السعر */}
      <td style={lineTd}>
        <div style={{ padding: "8px 10px", borderRadius: 6, background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", fontFamily: "var(--font-mono)", fontWeight: 900, textAlign: "left", color: lineTotal > 0 ? "var(--accent)" : "var(--text-muted)", fontSize: ".92rem", userSelect: "none", whiteSpace: "nowrap", overflow: "visible" }}>
          {fmtC(lineTotal)}
        </div>
      </td>

      {/* 8 — المستودع */}
      <td style={lineTd}>
        <select
          value={line.id_Warehouse || ""}
          disabled={!line.id_Material_NoM}
          {...(line.id_Material_NoM ? { "data-invoice-line-last": "true" } : {})}
          onChange={async (e) => {
            const wh = e.target.value;
            onUpdate({ id_Warehouse: wh });
            if (line.id_Material_NoM) await refreshStockQty(line.id_Material_NoM, wh);
          }}
          style={{ ...lineSelSt, fontSize: ".8rem", opacity: line.id_Material_NoM ? 1 : .55 }}
          title="بدون مستودع = خصم من المخزون العام — Enter لسطر جديد"
        >
          <option value="">بدون مستودع</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </td>

      {/* 9 — المخزون */}
      <td style={{ ...lineTd, textAlign: "center" }}>
        {line.id_Material_NoM ? (
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: stockColor, fontSize: ".84rem" }} title={line.id_Warehouse ? "مخزون المستودع" : "المخزون العام"}>
            {line.QuantityOnHand}
            {line.Band && <span style={{ fontSize: ".65rem", color: "var(--text-muted)", marginRight: 3 }}>{line.Band}</span>}
          </span>
        ) : <span style={{ color: "var(--text-muted)" }}>—</span>}
      </td>

      {/* 10 — حذف */}
      <td style={{ ...lineTd, textAlign: "center" }}>
        <button onClick={onRemove}
          style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", fontSize: "1.1rem", padding: "2px 6px", borderRadius: 4 }}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--danger-bg)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
          ✕
        </button>
      </td>
    </tr>
  );
}
// ============================================================
//  SalesMaterialTypeahead — بحث مواد المبيعات (كل النتائج المتشابهة)
// ============================================================
const salesMatNorm = (s) => String(s || "").trim().toLowerCase();
const salesMatContains = (text, q) => salesMatNorm(text).includes(q);

function SalesMaterialTypeahead({
  materials = [],
  loading = false,
  onPick,
  placeholder = "اكتب اسم المادة...",
  style = {},
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [menuPos, setMenuPos] = useState(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const q = salesMatNorm(query);
  const filtered = useMemo(() => {
    if (!q) return materials;
    return materials.filter((m) =>
      salesMatContains(m.MaterialName, q) ||
      salesMatContains(m.Barcode, q) ||
      salesMatContains(String(m.id_Material_NoM), q)
    );
  }, [materials, q]);

  const updateMenuPos = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 2,
      left: rect.left,
      width: Math.max(rect.width, 240),
      maxHeight: Math.max(120, window.innerHeight - rect.bottom - 12),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    const onScrollOrResize = () => updateMenuPos();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, filtered.length, query, updateMenuPos]);

  useEffect(() => {
    if (!open) return;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, [open]);

  useEffect(() => {
    const close = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      const portal = document.getElementById("sales-material-typeahead-portal");
      if (portal?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const select = (mat) => {
    setQuery("");
    setOpen(false);
    onPick?.(mat);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
      setOpen(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && open && filtered[highlight]) {
      e.preventDefault();
      e.stopPropagation();
      select(filtered[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "7px 9px",
    boxSizing: "border-box",
    background: "var(--bg-input)",
    border: "1px solid var(--accent)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-main)",
    fontSize: ".84rem",
    outline: "none",
    ...style,
  };

  const menuStyle = {
    position: "fixed",
    zIndex: 10000,
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    boxShadow: "var(--shadow-md)",
  };

  const dropdownPortal = open && menuPos && (
    <div
      id="sales-material-typeahead-portal"
      style={{ position: "fixed", inset: 0, zIndex: 10000, pointerEvents: "none", overflow: "hidden" }}
    >
      {filtered.length > 0 ? (
        <div
          id="sales-material-typeahead-menu"
          style={{
            ...menuStyle,
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            maxHeight: menuPos.maxHeight,
            overflowY: "auto",
            overscrollBehavior: "contain",
            pointerEvents: "auto",
          }}
        >
          {filtered.map((mat, i) => (
            <button
              key={mat.id_Material_NoM}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); select(mat); }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "right",
                padding: "8px 10px",
                border: "none",
                cursor: "pointer",
                background: i === highlight ? "var(--accent-glow)" : "transparent",
                color: "var(--text-primary)",
                fontSize: ".82rem",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ fontWeight: 700 }}>{mat.MaterialName}</div>
              {mat.Barcode && (
                <div style={{ fontSize: ".7rem", color: "var(--text-muted)" }}>{mat.Barcode}</div>
              )}
            </button>
          ))}
        </div>
      ) : q ? (
        <div style={{ ...menuStyle, top: menuPos.top, left: menuPos.left, width: menuPos.width, padding: 10, fontSize: ".8rem", color: "var(--text-muted)", pointerEvents: "auto" }}>
          لا توجد مواد تحتوي على «{query}»
        </div>
      ) : null}
    </div>
  );

  return (
    <div ref={wrapRef} style={{ position: "relative", minWidth: 0 }}>
      <input
        ref={inputRef}
        type="text"
        data-line-material-input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={loading ? "جاري تحميل المواد..." : placeholder}
        disabled={loading}
        autoComplete="off"
        style={inputStyle}
      />
      {typeof document !== "undefined" && dropdownPortal
        ? createPortal(dropdownPortal, document.body)
        : null}
    </div>
  );
}

// ============================================================
//  Shared UI helpers (مطابقة للمشتريات)
// ============================================================
function Panel({ label, children, noPad, compact, bodyStyle }) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: compact ? "var(--radius-md)" : "var(--radius-lg)", overflow: "visible" }}>
      {label && (
        <div style={{
          padding: compact ? "5px 10px" : "10px 16px",
          borderBottom: "1px solid var(--border-subtle)",
          fontSize: compact ? ".62rem" : ".7rem",
          fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em",
        }}>{label}</div>
      )}
      <div style={{ padding: noPad ? 0 : compact ? "8px 10px" : "16px", ...bodyStyle }}>{children}</div>
    </div>
  );
}

function Fld({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 160 }}>
      <label style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</label>
      {children}
    </div>
  );
}

function SumRow({ l, v, c, accent, big, minus, dense }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4, padding: dense ? "3px 0" : "5px 0", borderBottom: dense ? "none" : "1px solid var(--border-subtle)" }}>
      <span style={{ fontSize: dense ? (big ? ".74rem" : ".7rem") : big ? ".9rem" : ".82rem", fontWeight: big ? 800 : 500, color: "var(--text-secondary)", flexShrink: 0 }}>{l}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontWeight: big ? 900 : 600, color: accent ? "var(--accent)" : c || "var(--text-primary)", fontSize: dense ? (big ? ".8rem" : ".72rem") : big ? ".95rem" : ".84rem", textAlign: "left", wordBreak: "break-all" }}>
        {minus ? "− " : ""}{fmtC(v)}
      </span>
    </div>
  );
}

function NavBtn({ children, disabled, onClick, title }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{ width: 32, height: 32, border: "none", background: "none", cursor: disabled ? "default" : "pointer", color: disabled ? "var(--text-muted)" : "var(--text-primary)", borderRadius: "var(--radius-sm)", fontSize: "1rem", opacity: disabled ? .35 : 1, display: "flex", alignItems: "center", justifyContent: "center", transition: "background var(--transition)" }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
      {children}
    </button>
  );
}

function QtyBtn({ children, onClick, accent }) {
  return (
    <button onClick={onClick}
      style={{ width: 26, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-hover)", cursor: "pointer", fontWeight: 800, color: accent ? "var(--accent)" : "var(--text-primary)", fontSize: "1rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {children}
    </button>
  );
}