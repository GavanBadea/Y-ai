// ============================================================
//  src/pages/invoices/PurchaseInvoicePage.jsx
//  فاتورة المشتريات — YVG WMS  ★ CLEAN REWRITE
// ============================================================
import { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import AppLayout    from "../../components/layout/AppLayout";
import Button       from "../../components/ui/Button";
import Input        from "../../components/ui/Input";
import { useApi }   from "../../hooks/useApi";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { r2, fmt, fmtN, fmtC, fmtDate } from "@/utils/numFormat";
import { useRegisterWorkTab } from "@/hooks/useRegisterWorkTab";
import { numFieldValue } from "@/utils/numInput";
import { useAuth }    from "@/context/AuthContext";
import { useCompany, companyLogoUrl } from "@/context/CompanyContext";
import {
  openInvoicePrint,
  purchasePayloadFromForm,
  purchasePayloadFromDetail,
} from "@/utils/invoicePrint";
import AdminEditModal from "@/components/invoices/AdminEditModal";
import FlexibleQtyInput from "@/components/invoices/FlexibleQtyInput";
import {
  PURCHASE_DRAFT_KEY,
  loadInvoiceDraft,
  saveInvoiceDraft,
  clearInvoiceDraft,
  hasInvoiceDraft,
} from "./invoiceDraft";
import {
  purchasesService,
  partyService,
  commonService,
  materialsService,
  warehouseService,
} from "../../services/api";

const today = () => new Date().toISOString().split("T")[0];
const isDeferredPay = (name = "") => {
  const n = String(name).trim();
  return n === "آجل" || n === "اجل" || n.toLowerCase() === "deferred" || n.toLowerCase() === "credit";
};

const isCashPay = (name = "") => {
  const n = String(name).trim();
  return n === "نقد" || n === "نقدي" || n.toLowerCase() === "cash";
};

const LANDED_EXTRA_FIELDS = [
  { k: "Trans",            icon: "🚛", l: "نقل" },
  { k: "Customs",          icon: "🛃", l: "جمارك" },
  { k: "Porter",           icon: "👷", l: "حمالة" },
  { k: "SGS",              icon: "📋", l: "SGS" },
  { k: "ExportRelease",    icon: "📤", l: "الاخراجي" },
  { k: "VehicleManifest",  icon: "🚚", l: "منفيست مركبة" },
  { k: "Dis_FIN",          icon: "🏷", l: "خصم", isDiscount: true },
  { k: "GeneralTax",       icon: "🏛", l: "ظريبة عامة", excludedFromCalc: true },
];

const sumLandedExtras = (h) =>
  r2(+h.Trans + +h.Customs + +h.Porter + +h.SGS + +h.ExportRelease + +h.VehicleManifest);

const landedFieldLbl = {
  fontSize: ".64rem",
  fontWeight: 600,
  color: "var(--text-muted)",
  lineHeight: 1.2,
  marginBottom: 3,
  display: "block",
  wordBreak: "break-word",
};
const landedFieldInp = {
  width: "100%",
  boxSizing: "border-box",
  padding: "4px 6px",
  textAlign: "left",
  fontSize: ".74rem",
  background: "var(--bg-input)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
  outline: "none",
};

/* ─── shared style tokens ─────────────────────────────────── */
const thSt    = { padding: "10px 14px", textAlign: "right", color: "var(--text-secondary)", fontWeight: 700, fontSize: ".7rem", textTransform: "uppercase", whiteSpace: "nowrap" };
const tdSt    = { padding: "10px 14px" };
const selSt   = { width: "100%", padding: "10px 12px", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text-primary)", fontFamily: "var(--font-main)", fontSize: ".88rem", outline: "none", cursor: "pointer" };
const inputSt = { padding: "10px 12px", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text-primary)", fontFamily: "var(--font-main)", fontSize: ".88rem", outline: "none" };
const numSt   = { background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: ".88rem", outline: "none" };

const PURCHASE_FORM_GRID = "minmax(0, 1fr) minmax(260px, 300px)";
const PURCHASE_LINE_COL_WIDTHS = ["3%", "19%", "8%", "12%", "6%", "13%", "16%", "15%", "8%"];
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

/* ─── empty-line factory ──────────────────────────────────── */
let _lid = 0;
const newEmptyLine = () => ({
  _lid: ++_lid, id_Material_NoM: null,
  MaterialName: "", Barcode: "", CatiguaryName: "", Band: "",
  PriceIN: 0, AmountIN: 1, Gift_IN: 0, ExpairDate: "",
});

// ============================================================
//  Root page
// ============================================================
export default function PurchaseInvoicePage() {
  const { locale } = useNumberLocale(); // locale متاح للمكوّن الرئيسي
  const location = useLocation();

  const [tab, setTab] = useState(() => (
    location.state?.openInvoiceForm || hasInvoiceDraft(PURCHASE_DRAFT_KEY) ? "new" : "list"
  ));

  useEffect(() => {
    if (location.state?.openInvoiceForm) setTab("new");
  }, [location.state?.openInvoiceForm]);
  return (
    <>
      {tab === "list" && <InvoiceListScreen onNew={() => setTab("new")} />}
      {tab === "new"  && (
        <InvoiceFormScreen
          onDone={() => setTab("list")}
          onCloseDraft={() => { clearInvoiceDraft(PURCHASE_DRAFT_KEY); setTab("list"); }}
        />
      )}
    </>
  );
}

// ============================================================
//  Screen 1 — Invoice list
// ============================================================
function InvoiceListScreen({ onNew }) {
  const [page,       setPage    ] = useState(1);
  const [editId,     setEditId  ] = useState(null);
  const { user, hasPermission } = useAuth();
  const canEdit = Number(user?.id_Roles) === 1 || hasPermission("can_add_purchase");
  const [filter,     setFilter  ] = useState({ from: "", to: "", id_Amil: "" });
  const [detail,     setDetail  ] = useState(null);
  const [navId,      setNavId   ] = useState(null);
  const [bounds,     setBounds  ] = useState({ first: null, last: null });
  const [navLoading, setNavLoad ] = useState(false);

  const { data: invData, loading, refetch } = useApi(
    () => purchasesService.getAll({ ...filter, page, limit: 20 }), [page, filter]
  );
  const { data: suppData } = useApi(() => partyService.getSuppliers(), []);
  const invoices  = Array.isArray(invData) ? invData : (invData?.data || []);
  const suppliers = Array.isArray(suppData) ? suppData : (suppData?.data || []);

  useEffect(() => {
    purchasesService.getBounds()
      .then(r => setBounds({ first: r.first, last: r.last }))
      .catch(() => {});
  }, [invData]);

  const openDetail = useCallback(async (id) => {
    setNavLoad(true);
    try { const r = await purchasesService.getOne(id); setDetail(r.data); setNavId(id); }
    finally { setNavLoad(false); }
  }, []);

  const navigate = useCallback(async (dir) => {
    setNavLoad(true);
    try {
      let r;
      if (dir === "first" && bounds.first)     r = await purchasesService.getOne(bounds.first);
      else if (dir === "last" && bounds.last)  r = await purchasesService.getOne(bounds.last);
      else                                      r = await purchasesService.navigate(navId, dir);
      setDetail(r.data); setNavId(r.data.id_NoFIN);
    } catch (e) { alert(e.message || "لا يوجد سجل في هذا الاتجاه"); }
    finally { setNavLoad(false); }
  }, [navId, bounds]);

  return (
    <AppLayout title="فواتير المشتريات" actions={<Button onClick={onNew}>✚ فاتورة جديدة</Button>}>

      {/* فلاتر */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "flex-end", padding: "14px 16px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
        <Fld label="من تاريخ"><input type="date" value={filter.from} onChange={e => setFilter(p => ({ ...p, from: e.target.value }))} style={inputSt} /></Fld>
        <Fld label="إلى تاريخ"><input type="date" value={filter.to} onChange={e => setFilter(p => ({ ...p, to: e.target.value }))} style={inputSt} /></Fld>
        <Fld label="المورد">
          <select value={filter.id_Amil} onChange={e => setFilter(p => ({ ...p, id_Amil: e.target.value }))} style={selSt}>
            <option value="">الكل</option>
            {suppliers.map(s => <option key={s.id_Amil} value={s.id_Amil}>{s.AmilName}</option>)}
          </select>
        </Fld>
        <Button variant="secondary" size="sm" onClick={() => { setPage(1); refetch(); }}>🔍 بحث</Button>
        <Button variant="ghost"     size="sm" onClick={() => { setFilter({ from: "", to: "", id_Amil: "" }); setPage(1); }}>↺ مسح</Button>
      </div>

      {/* جدول الفواتير */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden", marginBottom: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".875rem" }}>
          <thead>
            <tr style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
              {["رقم","التاريخ","المورد","أصناف","مجموع السطور","مصاريف LC","الإجمالي","الدفع",""].map((h,i)=>(
                <th key={i} style={thSt}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></td></tr>
            ) : invoices.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 48, textAlign: "center", color: "var(--text-muted)" }}>لا توجد فواتير</td></tr>
            ) : invoices.map(inv => (
              <tr key={inv.id_NoFIN} onClick={() => openDetail(inv.id_NoFIN)}
                style={{ borderBottom: "1px solid var(--border-subtle)", cursor: "pointer", background: navId === inv.id_NoFIN ? "var(--accent-glow)" : "" }}
                onMouseEnter={e => { if (navId !== inv.id_NoFIN) e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={e => { if (navId !== inv.id_NoFIN) e.currentTarget.style.background = ""; }}>
                <td style={{ ...tdSt, fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: 800 }}>#{inv.id_NoFIN}</td>
                <td style={tdSt}>{fmtDate(inv.Date_FIN)}</td>
                <td style={{ ...tdSt, fontWeight: 700 }}>{inv.AmilName || "—"}</td>
                <td style={{ ...tdSt, textAlign: "center" }}><span style={{ padding: "2px 10px", background: "var(--info-bg)", color: "var(--info)", borderRadius: 20, fontSize: ".76rem", fontWeight: 700 }}>{inv.ItemCount || 0}</span></td>
                <td style={{ ...tdSt, fontFamily: "var(--font-mono)" }}>{fmtC(inv.LinesTotal)}</td>
                <td style={{ ...tdSt, fontFamily: "var(--font-mono)", color: "var(--warning)" }}>+{fmtC(inv.NetExtras)}</td>
                <td style={{ ...tdSt, fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: 900 }}>{fmtC(inv.GrandTotal)}</td>
                <td style={tdSt}><span style={{ padding: "3px 10px", borderRadius: 20, fontSize: ".74rem", fontWeight: 700, background: isDeferredPay(inv.PayTypeName) ? "var(--warning-bg)" : "var(--success-bg)", color: isDeferredPay(inv.PayTypeName) ? "var(--warning)" : "var(--success)", border: `1px solid ${isDeferredPay(inv.PayTypeName) ? "var(--warning)" : "var(--success)"}` }}>{inv.PayTypeName || "—"}</span></td>
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
          invoiceId={editId} invoiceType="purchases"
          onClose={() => setEditId(null)}
          onSaved={(id) => {
            const reloadId = id || editId || detail?.id_NoFIN;
            setEditId(null);
            if (reloadId) {
              purchasesService.getOne(reloadId)
                .then((r) => { if (r?.data) setDetail(r.data); })
                .catch(() => {});
            }
            refetch();
          }}
        />
      )}
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
    if (!confirm("Y-ai لا ينصح بحذف الفاتورة، لأنه سيغيّر الترتيب الزمني لتسجيل الفواتير والحسابات عامة.\n\nهل تريد ذلك؟")) return;
    setDeleting(true);
    try { await purchasesService.remove(data.id_NoFIN); onDeleted(); }
    catch (e) { alert(`خطأ: ${e.message}`); }
    finally { setDeleting(false); }
  };

  const handlePrint = () => {
    openInvoicePrint(purchasePayloadFromDetail(data, company, logoUrl));
  };

  const prevBal     = data.previousBalance ?? 0;
  const isDef       = isDeferredPay(data.PayTypeName);
  const isCash      = isCashPay(data.PayTypeName);
  const paidOnInv   = isCash ? r2(data.GrandTotal || 0) : +(data.paidAmount || 0);
  const invoiceDebt = isDef ? (data.thisInvoiceDebt ?? data.GrandTotal ?? 0) : 0;
  const finalBal    = isDef
    ? r2(data.finalBalance ?? (prevBal + invoiceDebt - paidOnInv))
    : r2(data.finalBalance ?? prevBal);
  const totalQty = (data.lines || []).reduce(
    (s, l) => s + (+l.AmountIN || 0) + (+l.Gift_IN || 0), 0
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
          فاتورة #{data.id_NoFIN}
        </span>
        <div style={{ flex: 1 }} />
        {canEdit && (
          <Button size="sm" variant="warning" onClick={() => onEdit(data.id_NoFIN)}>✏️ تعديل الفاتورة</Button>
        )}
        <Button size="sm" onClick={handlePrint}>🖨 طباعة</Button>
        <Button size="sm" variant="danger" loading={deleting} onClick={handleDelete}>🗑 حذف</Button>
        <Button size="sm" variant="ghost"  onClick={onClose}>✕ إغلاق</Button>
      </div>

      <div style={{ padding: "20px 22px" }}>
        {/* رأس الفاتورة */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 20 }}>
          {[
            { l: "رقم الفاتورة", v: `#${data.id_NoFIN}`, mono: true, accent: true },
            { l: "التاريخ",      v: fmtDate(data.Date_FIN) },
            { l: "مجموع الكميات", v: `${fmt(totalQty)} وحدة`, bold: true },
            { l: "طريقة الدفع", v: data.PayTypeName },
            { l: "المورد",       v: data.AmilName, bold: true },
            { l: "هاتف المورد",  v: data.AmilMobile || "—" },
            { l: "عدد الأصناف", v: `${data.ItemCount || 0} صنف` },
          ].map((f, i) => (
            <div key={i}>
              <div style={{ fontSize: ".68rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 5 }}>{f.l}</div>
              <div style={{ fontWeight: f.bold ? 800 : 600, fontFamily: f.mono ? "var(--font-mono)" : "inherit", color: f.accent ? "var(--accent)" : "var(--text-primary)" }}>{f.v}</div>
            </div>
          ))}
        </div>

        {/* أسطر الفاتورة */}
        <div style={{ overflowX: "auto", marginBottom: 20 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".83rem" }}>
            <thead>
              <tr style={{ background: "var(--bg-surface)", borderBottom: "2px solid var(--border)" }}>
                {["#","المادة","الباركود","الكمية","الهدية","سعر الشراء","حصة LC","سعر بعد LC","إجمالي"].map((h,i)=>(
                  <th key={i} style={{ padding: "9px 11px", textAlign: i===0||i===3||i===4 ? "center" : i>=5 ? "left" : "right", color: "var(--text-secondary)", fontWeight: 700, fontSize: ".67rem", textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.lines || []).map((l, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)", background: i%2===0 ? "var(--bg-hover)" : "" }}>
                  <td style={{ padding: "9px 11px", textAlign: "center", color: "var(--text-muted)", fontSize: ".74rem", fontFamily: "var(--font-mono)" }}>{i+1}</td>
                  <td style={{ padding: "9px 11px" }}>
                    <div style={{ fontWeight: 700 }}>{l.MaterialName}</div>
                    {l.CatiguaryName && <div style={{ fontSize: ".68rem", color: "var(--text-muted)" }}>{l.CatiguaryName}</div>}
                  </td>
                  <td style={{ padding: "9px 11px", fontFamily: "var(--font-mono)", fontSize: ".74rem", color: l.Barcode ? "var(--accent)" : "var(--text-muted)" }}>{l.Barcode || "—"}</td>
                  <td style={{ padding: "9px 11px", textAlign: "center", fontFamily: "var(--font-mono)", fontWeight: 800 }}>{l.AmountIN}</td>
                  <td style={{ padding: "9px 11px", textAlign: "center", fontFamily: "var(--font-mono)", fontWeight: 700, color: (l.Gift_IN||0)>0 ? "var(--success)" : "var(--text-muted)" }}>{l.Gift_IN||0}</td>
                  <td style={{ padding: "9px 11px", textAlign: "left", fontFamily: "var(--font-mono)" }}>{fmtC(l.PriceIN)}</td>
                  <td style={{ padding: "9px 11px", textAlign: "left", fontFamily: "var(--font-mono)", color: l.LandedCostShare ? "var(--warning)" : "var(--text-muted)" }}>{l.LandedCostShare ? `+${fmtC(l.LandedCostShare)}` : "—"}</td>
                  <td style={{ padding: "9px 11px", textAlign: "left", fontFamily: "var(--font-mono)", fontWeight: 800, color: "var(--accent)" }}>{fmtC(l.LandedCostPerUnit || l.PriceIN)}</td>
                  <td style={{ padding: "9px 11px", textAlign: "left", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{fmtC(l.LineTotal)}</td>
                </tr>
              ))}
              <tr style={{ background: "var(--bg-surface)", borderTop: "1px solid var(--border)" }}>
                <td colSpan={8} style={{ padding: "10px 11px", textAlign: "right", fontWeight: 700, color: "var(--text-secondary)", fontSize: ".82rem" }}>مجموع الكميات</td>
                <td style={{ padding: "10px 11px", textAlign: "center", fontFamily: "var(--font-mono)", fontWeight: 900, color: "var(--text-primary)", fontSize: ".9rem" }}>{fmt(totalQty)}</td>
              </tr>
              <tr style={{ background: "var(--bg-surface)", borderTop: "2px solid var(--border)" }}>
                <td colSpan={8} style={{ padding: "10px 11px", textAlign: "right", fontWeight: 700, color: "var(--text-secondary)", fontSize: ".82rem" }}>إجمالي السطور</td>
                <td style={{ padding: "10px 11px", textAlign: "left", fontFamily: "var(--font-mono)", fontWeight: 900, color: "var(--accent)", fontSize: ".95rem" }}>{fmtC(data.LinesTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* التذييل المالي */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
            <div style={{ fontSize: ".7rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12 }}>مصاريف Landed Cost</div>
            {[["🚛 نقل", data.Trans, false], ["🛃 جمارك", data.Customs, false], ["👷 حمالة", data.Porter, false], ["📋 SGS", data.SGS, false], ["📤 الاخراجي", data.ExportRelease, false], ["🚚 منفيست مركبة", data.VehicleManifest, false], ["🏷 خصم", data.Dis_FIN, true], ["🏛 ظريبة عامة", data.GeneralTax, false, true]]
              .filter(([, v]) => +v !== 0)
              .map(([l, v, neg, infoOnly], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border-subtle)", fontSize: ".84rem" }}>
                  <span style={{ color: "var(--text-secondary)" }}>
                    {l}
                    {infoOnly && <span style={{ display: "block", fontSize: ".62rem", color: "var(--text-muted)" }}>لا تدخل في حساب الفاتورة</span>}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: neg ? "var(--danger)" : infoOnly ? "var(--accent)" : "var(--warning)" }}>{neg ? "− " : "+ "}{fmtC(v)}</span>
                </div>
              ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontWeight: 700 }}>
              <span>صافي المصاريف</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--info)" }}>{fmtC(data.NetExtras)}</span>
            </div>
          </div>
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
            <div style={{ fontSize: ".7rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12 }}>حساب المورد — {data.AmilName}</div>
            <SumRow l="الحساب السابق"    v={Math.abs(prevBal)}        c={prevBal > 0 ? "var(--warning)" : "var(--success)"} />
            {isDef && <SumRow l="+ قيمة الفاتورة" v={invoiceDebt} c="var(--danger)" />}
            {(isCash || paidOnInv > 0) && (
              <SumRow l={isCash ? "− المدفوع نقداً (كامل)" : "− المدفوع من الفاتورة"} v={paidOnInv} c="var(--success)" minus />
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", marginTop: 8, background: "var(--accent-glow)", border: "2px solid var(--accent)", borderRadius: "var(--radius-md)" }}>
              <span style={{ fontWeight: 800 }}>الحساب النهائي</span>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 900, color: "var(--accent)", fontSize: "1.05rem" }}>{fmtC(Math.abs(finalBal))}</span>
            </div>
          </div>
        </div>

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
  const restoredDraft = useMemo(() => loadInvoiceDraft(PURCHASE_DRAFT_KEY), []);

  /* ─── header state ─────────────────────────────────────── */
  const [hdr, setHdr] = useState(() => restoredDraft?.hdr || {
    Date_FIN: today(), id_Amil: "", id_PayType_FIN: "", id_Warehouse: "",
    Dis_FIN: 0, Trans: 0, Customs: 0, Porter: 0, SGS: 0, ExportRelease: 0, VehicleManifest: 0, GeneralTax: 0,
    DriverName: "", DriverMobile: "", VehicleNumber: "",
  });
  const sh = k => v => setHdr(p => ({ ...p, [k]: v }));

  /* ─── lines state — start with one empty row ───────────── */
  const [lines, setLines] = useState(() => {
    if (restoredDraft?.lines?.length) {
      restoredDraft.lines.forEach((l) => { if (l._lid > _lid) _lid = l._lid; });
      return restoredDraft.lines;
    }
    return [newEmptyLine()];
  });

  const [paidAmount, setPaidAmount] = useState(restoredDraft?.paidAmount ?? "");

  useEffect(() => {
    saveInvoiceDraft(PURCHASE_DRAFT_KEY, { hdr, lines, paidAmount });
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

  /* ─── supplier balance — useApi مع dependency على id_Amil ─── */
  const { data: supBalData, loading: loadingSupBal } = useApi(
    () => hdr.id_Amil ? partyService.getOneSupplier(hdr.id_Amil) : Promise.resolve(null),
    [hdr.id_Amil]
  );
  // يدعم شكلين للرد:
  // 1) /party/suppliers/:id => { data: { TotalDebt, TotalPaid, NetBalance, ... } }
  // 2) /purchases/supplier/:id/balance => { data: { balance: { totalDebt, totalPaid, netBalance } } }
  const supplierBalRaw = supBalData?.data?.balance || supBalData?.data || null;
  const supplierBal = supplierBalRaw
    ? {
        totalDebt: +(supplierBalRaw.TotalDebt ?? supplierBalRaw.totalDebt ?? 0),
        totalPaid: +(supplierBalRaw.TotalPaid ?? supplierBalRaw.totalPaid ?? 0),
        netBalance: +(supplierBalRaw.NetBalance ?? supplierBalRaw.netBalance ?? 0),
      }
    : null;

  /* ─── reference data ───────────────────────────────────── */
  const { data: suppData } = useApi(() => partyService.getSuppliers(), []);
  const { data: payData  } = useApi(() => commonService.getPayTypes(),  []);

  // 2. جلب المواد بنفس طريقة MaterialsPage تماماً
  const { data: matsData, loading: loadingMaterials } = useApi(() => materialsService.getAll(), []);
  const allMaterials = Array.isArray(matsData)
    ? matsData
    : (Array.isArray(matsData?.data) ? matsData.data : []);

  const suppliers = Array.isArray(suppData) ? suppData : (suppData?.data || []);
  const payTypes  = payData?.data || [];

  const { data: whData } = useApi(() => warehouseService.listActive(), []);
  const warehouses = whData?.data || [];

  /* ─── computed totals ──────────────────────────────────── */
  const validLines = useMemo(() => lines.filter(l => l.id_Material_NoM), [lines]);

  useRegisterWorkTab({
    id: "purchase-invoice-draft",
    title: "فاتورة شراء",
    path: "/invoices-in",
    state: { openInvoiceForm: true },
    active: validLines.length > 0 || !!hdr.id_Amil || !!paidAmount,
  });
  // 4. مجموع السعر يُحسَب فورياً عند تغيير الكمية أو السعر
  const linesTotal = useMemo(() => validLines.reduce((s, l) => s + r2((+l.AmountIN||0) * (+l.PriceIN||0)), 0), [validLines]);
  const netExtras  = useMemo(() => r2(sumLandedExtras(hdr) - +hdr.Dis_FIN), [hdr]);
  const grandTotal = useMemo(() => r2(linesTotal + netExtras), [linesTotal, netExtras]);
  const paidNum    = useMemo(() => Math.max(0, +paidAmount || 0), [paidAmount]);
  const remainDue  = useMemo(() => r2(Math.max(0, grandTotal - paidNum)), [grandTotal, paidNum]);
  const selectedPayType = payTypes.find(p => String(p.id_PayType) === String(hdr.id_PayType_FIN));
  const isDeferred      = isDeferredPay(selectedPayType?.PayTypeName || "");
  const isCash          = isCashPay(selectedPayType?.PayTypeName || "");
  const effectivePaid   = useMemo(
    () => (isCash ? grandTotal : paidNum),
    [isCash, grandTotal, paidNum]
  );

  useEffect(() => {
    if (isCash && grandTotal > 0) {
      setPaidAmount(String(grandTotal));
    }
  }, [isCash, grandTotal]);
  /* ─── save ─────────────────────────────────────────────── */
  const [saving,    setSaving   ] = useState(false);
  const [saveErr,   setSaveErr  ] = useState("");
  const [savedResult, setSavedResult] = useState(null);

  const handleSave = async () => {
    setSaveErr("");
    if (!hdr.id_Amil)       return setSaveErr("يرجى اختيار المورد");
    if (!hdr.id_PayType_FIN) return setSaveErr("يرجى اختيار طريقة الدفع");
    if (!validLines.length)  return setSaveErr("يرجى إضافة مادة واحدة على الأقل");
    setSaving(true);
    try {
      const res = await purchasesService.create({
        ...hdr,
        id_Warehouse: hdr.id_Warehouse ? Number(hdr.id_Warehouse) : null,
        Dis_FIN: +hdr.Dis_FIN, Trans: +hdr.Trans, Customs: +hdr.Customs, Porter: +hdr.Porter,
        SGS: +hdr.SGS, ExportRelease: +hdr.ExportRelease, VehicleManifest: +hdr.VehicleManifest,
        GeneralTax: +hdr.GeneralTax || 0,
        lines: validLines.map(l => ({
          id_Material_NoM: l.id_Material_NoM,
          AmountIN: +l.AmountIN || 1,
          PriceIN:  +l.PriceIN  || 0,
          Gift_IN:  +l.Gift_IN  || 0,
          ExpairDate: l.ExpairDate || null,
        })),
        PaidAmount: paidNum > 0 ? paidNum : undefined,
      });
      clearInvoiceDraft(PURCHASE_DRAFT_KEY);
      setSavedResult({
        ...res,
        invoiceId: res.invoiceId || res.data?.id_NoFIN,
        printSnap: {
          company, logoUrl, hdr: { ...hdr }, validLines: validLines.map(l => ({ ...l })),
          suppliers, payTypes, supplierBal, linesTotal, grandTotal, paidAmount: effectivePaid,
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
      purchasePayloadFromForm({
        company,
        logoUrl,
        hdr,
        validLines,
        suppliers,
        payTypes,
        supplierBal,
        linesTotal,
        grandTotal,
        invoiceNo,
        paidAmount: effectivePaid,
      })
    );
  };

  /* ─── success screen ───────────────────────────────────── */
  if (savedResult) {
    const savedId = savedResult?.invoiceId;
    const printSaved = async () => {
      if (!savedId) return;
      try {
        const r = await purchasesService.getOne(savedId);
        openInvoicePrint(purchasePayloadFromDetail(r.data, company, logoUrl));
      } catch (e) {
        alert(e?.message || "تعذّر تحميل الفاتورة للطباعة");
      }
    };
    return (
      <AppLayout title="فاتورة مشتريات جديدة" actions={<Button variant="ghost" onClick={onDone}>← رجوع</Button>}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, padding: "60px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 52 }}>✅</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>تم حفظ الفاتورة بنجاح!</div>
          <div style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", fontSize: "1.1rem" }}>فاتورة #{savedId}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <Button onClick={printSaved}>🖨 طباعة الفاتورة</Button>
            <Button variant="ghost" onClick={onDone}>← العودة للقائمة</Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  /* ─── render ────────────────────────────────────────────── */
  return (
    <AppLayout
      title="فاتورة مشتريات جديدة"
      actions={
        <>
          <Button variant="ghost" onClick={onDone} title="العودة للقائمة — تبقى المسودة محفوظة">← رجوع</Button>
          <Button variant="ghost" onClick={() => {
            if (window.confirm("إغلاق الفاتورة وحذف المسودة؟")) onCloseDraft?.();
          }}>✕ إغلاق</Button>
        </>
      }
    >
      {/* ══════════════════════════════════════════════════════
          تخطيط الصفحة: عمودان — المحتوى الرئيسي + الشريط الجانبي
      ══════════════════════════════════════════════════════ */}
      <div style={{
        display: "grid",
        gridTemplateColumns: PURCHASE_FORM_GRID,
        gap: 16,
        alignItems: "start",
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
      }}>

        {/* ════════ العمود الرئيسي ════════════════════════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0, maxWidth: "100%", overflow: "visible" }}>

          {/* ── بيانات الفاتورة (رأس) ───────────────────── */}
          <Panel label="بيانات الفاتورة">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>

              <Fld label="التاريخ *">
                <input type="date" value={hdr.Date_FIN} onChange={e => sh("Date_FIN")(e.target.value)}
                  style={{ ...inputSt, width: "100%", boxSizing: "border-box" }} />
              </Fld>

              <Fld label="المورد *">
                <select value={hdr.id_Amil} onChange={e => sh("id_Amil")(e.target.value)} style={selSt}>
                  <option value="">— اختر المورد —</option>
                  {suppliers.map(s => <option key={s.id_Amil} value={s.id_Amil}>{s.AmilName}</option>)}
                </select>
              </Fld>

              <Fld label="طريقة الدفع *">
                <select value={hdr.id_PayType_FIN} onChange={e => sh("id_PayType_FIN")(e.target.value)} style={selSt}>
                  <option value="">— اختر —</option>
                  {payTypes.map(p => <option key={p.id_PayType} value={p.id_PayType}>{p.PayTypeName}</option>)}
                </select>
              </Fld>

              <Fld label="المستودع">
                <select value={hdr.id_Warehouse || ""} onChange={e => sh("id_Warehouse")(e.target.value)} style={selSt}>
                  <option value="">بدون مستودع (المخزون العام)</option>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}{w.location ? ` — ${w.location}` : ""}</option>
                  ))}
                </select>
              </Fld>

              <Fld label="اسم السائق">
                <input type="text" value={hdr.DriverName} onChange={e => sh("DriverName")(e.target.value)}
                  placeholder="اختياري..." style={{ ...inputSt, width: "100%", boxSizing: "border-box" }} />
              </Fld>

              <Fld label="رقم الهاتف">
                <input type="text" value={hdr.DriverMobile} onChange={e => sh("DriverMobile")(e.target.value)}
                  placeholder="أرقام أو نص..." style={{ ...inputSt, width: "100%", boxSizing: "border-box" }} />
              </Fld>

              <Fld label="رقم المركبة">
                <input type="text" value={hdr.VehicleNumber} onChange={e => sh("VehicleNumber")(e.target.value)}
                  placeholder="حروف وأرقام..." style={{ ...inputSt, width: "100%", boxSizing: "border-box" }} />
              </Fld>
            </div>

            {/* حساب المورد — يظهر فوراً بعد اختيار المورد */}
            {hdr.id_Amil && (
              <div style={{ marginTop: 14, padding: "12px 14px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, alignItems: "center" }}>
                {loadingSupBal ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: ".84rem" }}>
                    <span className="spinner" style={{ width: 14, height: 14 }} /> جاري جلب حساب المورد...
                  </div>
                ) : supplierBal ? (
                  <>
                    <div>
                      <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase" }}>إجمالي ديوننا</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--warning)" }}>{fmtC(supplierBal.totalDebt)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase" }}>المدفوع</div>
                      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--success)" }}>{fmtC(supplierBal.totalPaid)}</div>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </Panel>

          {/* ── ماسح الباركود ──────────────────────────── */}
          <BarcodeScanner onFillLine={(mat) => {
            const matData = {
              id_Material_NoM: mat.id_Material_NoM,
              MaterialName:    mat.MaterialName,
              Barcode:         mat.Barcode     || "",
              CatiguaryName:   mat.CatiguaryName || "",
              Band:            mat.Band         || "",
              PriceIN:         "",
            };
            setLines(prev => {
              const emptyIdx = prev.findIndex(l => !l.id_Material_NoM);
              if (emptyIdx >= 0)
                return prev.map((l, i) => i === emptyIdx ? { ...l, ...matData } : l);
              return [...prev, { ...newEmptyLine(), ...matData }];
            });
          }} />

          {/* ── جدول الأسطر ───────────────────────────────── */}
          <Panel label={`أسطر الفاتورة (${validLines.length} صنف)`} noPad>
            <div style={{ overflowX: "auto", maxWidth: "100%", WebkitOverflowScrolling: "touch" }}>
              <table ref={tableRef} style={{ width: "100%", minWidth: 980, tableLayout: "fixed", borderCollapse: "collapse", fontSize: ".86rem" }}>
                <colgroup>
                  {PURCHASE_LINE_COL_WIDTHS.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>

                <thead>
                  <tr style={{ background: "var(--bg-surface)", borderBottom: "2px solid var(--border)" }}>
                    {[
                      { l: "#",              align: "center" },
                      { l: "اختيار المادة", align: "right"  },
                      { l: "الباركود",       align: "center" },
                      { l: "الكمية",         align: "center" },
                      { l: "هدية",           align: "center" },
                      { l: "سعر الشراء",     align: "left"   },
                      { l: "مجموع السعر",    align: "left"   },
                      { l: "تاريخ النفاذ",   align: "center" },
                      { l: "",               align: "center" },
                    ].map((h, i) => (
                      <th key={i} style={{ padding: "8px 6px", textAlign: h.align, color: "var(--text-secondary)", fontWeight: 700, fontSize: ".68rem", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.l}</th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {lines.map((line, idx) => (
                    <PurchaseLineRow
                      key={line._lid}
                      idx={idx + 1}
                      line={line}
                      allMaterials={allMaterials}
                      loadingMaterials={loadingMaterials}
                      onUpdate={u => setLines(p => p.map((l, i) => i === idx ? { ...l, ...u } : l))}
                      onRemove={() => setLines(p => {
                        const next = p.filter((_, i) => i !== idx);
                        return next.length ? next : [newEmptyLine()];
                      })}
                    />
                  ))}
                </tbody>

                <tfoot>
                  <tr style={{ borderTop: "1px dashed var(--border)" }}>
                    <td colSpan={9} style={{ padding: "7px 10px" }}>
                      <button
                        onClick={() => setLines(p => [...p, newEmptyLine()])}
                        style={{ width: "100%", padding: "6px", background: "none", border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", cursor: "pointer", fontSize: ".8rem", fontFamily: "var(--font-main)", transition: "all var(--transition)" }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
                      >＋ إضافة سطر جديد</button>
                    </td>
                  </tr>
                  {validLines.length > 0 && (
                    <tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-surface)" }}>
                      <td colSpan={6} style={{ padding: "10px 10px", textAlign: "right", fontWeight: 700, color: "var(--text-secondary)", fontSize: ".82rem" }}>
                        إجمالي السطور ({validLines.length} {validLines.length === 1 ? "صنف" : "أصناف"} · {validLines.reduce((s, l) => s + (+l.AmountIN || 0), 0)} وحدة)
                      </td>
                      <td style={{ padding: "10px 10px", textAlign: "left", fontFamily: "var(--font-mono)", fontWeight: 900, color: "var(--accent)", fontSize: ".95rem" }}>
                        {fmtC(linesTotal)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          </Panel>

          {/* خطأ الحفظ */}
          {saveErr && (
            <div style={{ padding: "12px 16px", background: "var(--danger-bg)", border: "1px solid var(--danger)", borderRadius: "var(--radius-md)", color: "var(--danger)", fontWeight: 600, fontSize: ".88rem" }}>
              ⚠ {saveErr}
            </div>
          )}
        </div>

        {/* ════════ الشريط الجانبي ════════════════════════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 72, minWidth: 0, maxWidth: 300 }}>

          {/* مصاريف Landed Cost */}
          <Panel label="🚢 Landed Cost" compact>
            <div style={{ fontSize: ".62rem", color: "var(--text-muted)", marginBottom: 8, lineHeight: 1.3 }}>
              تُوزَّع بالتناسب على قيمة كل سطر
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 8px" }}>
              {LANDED_EXTRA_FIELDS.filter((f) => !f.excludedFromCalc).map(({ k, icon, l }) => (
                <div key={k} style={{ minWidth: 0 }}>
                  <label style={landedFieldLbl}>{icon} {l}</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={numFieldValue(hdr[k])}
                    placeholder="0"
                    onChange={e => sh(k)(e.target.value === "" ? "" : e.target.value)}
                    style={landedFieldInp}
                  />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <label style={landedFieldLbl}>🏛 ظريبة عامة</label>
              <input
                type="number"
                min="0"
                step="any"
                value={numFieldValue(hdr.GeneralTax)}
                placeholder="0"
                title="مبلغ إعلامي — لا يدخل في إجمالي الفاتورة أو توزيع Landed Cost"
                onChange={e => sh("GeneralTax")(e.target.value === "" ? "" : e.target.value)}
                style={{ ...landedFieldInp, width: "100%" }}
              />
              <div style={{ fontSize: ".58rem", color: "var(--text-muted)", marginTop: 4, lineHeight: 1.35 }}>
                لا تدخل في حساب الفاتورة — تظهر في قائمة الدخل (حـ/ 39)
              </div>
            </div>
            <div style={{ marginTop: 8, padding: "6px 8px", background: "var(--info-bg)", border: "1px solid var(--info)", borderRadius: "var(--radius-sm)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, fontSize: ".68rem", color: "var(--info)" }}>
              <span>صافي المصاريف</span>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: ".72rem" }}>{fmtC(netExtras)}</span>
            </div>
          </Panel>

          {/* ملخص الفاتورة */}
          <Panel label="ملخص الفاتورة">
            <SumRow l="مجموع السطور"   v={linesTotal} />
            {+hdr.Trans   > 0 && <SumRow l="🚛 نقل"            v={+hdr.Trans}            c="var(--warning)" />}
            {+hdr.Customs > 0 && <SumRow l="🛃 جمارك"          v={+hdr.Customs}          c="var(--warning)" />}
            {+hdr.Porter  > 0 && <SumRow l="👷 حمالة"          v={+hdr.Porter}           c="var(--warning)" />}
            {+hdr.SGS     > 0 && <SumRow l="📋 SGS"            v={+hdr.SGS}              c="var(--warning)" />}
            {+hdr.ExportRelease   > 0 && <SumRow l="📤 الاخراجي"       v={+hdr.ExportRelease}    c="var(--warning)" />}
            {+hdr.VehicleManifest > 0 && <SumRow l="🚚 منفيست مركبة" v={+hdr.VehicleManifest}  c="var(--warning)" />}
            {+hdr.Dis_FIN > 0 && <SumRow l="🏷 خصم"            v={+hdr.Dis_FIN}          c="var(--danger)"  minus />}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 8 }}>
              <span style={{ fontSize: ".78rem", color: "var(--text-secondary)", minWidth: 68 }}>
                {isCash ? "المدفوع نقداً" : "المبلغ المدفوع"}
              </span>
              <input
                type="number"
                min="0"
                step="any"
                value={numFieldValue(isCash ? effectivePaid : paidAmount)}
                placeholder="0"
                readOnly={isCash}
                title={isCash ? "الفاتورة النقدية — الدفع = إجمالي الفاتورة (شامل LC)" : "دفعة سريعة — مع الدفع الآجل"}
                onChange={(e) => { if (!isCash) setPaidAmount(e.target.value === "" ? "" : e.target.value); }}
                style={{ flex: 1, padding: "7px 10px", textAlign: "left", ...numSt, ...(isCash ? { opacity: 0.85, cursor: "default" } : {}) }}
              />
            </div>
            {isCash && (
              <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginBottom: 6, lineHeight: 1.35 }}>
                الدفع النقدي = إجمالي الفاتورة (مجموع السطور + مصاريف LC − الخصم)
              </div>
            )}
            <div style={{ borderTop: "2px solid var(--border)", marginTop: 10, paddingTop: 10 }}>
              <SumRow l="إجمالي الفاتورة" v={grandTotal} accent big />
            </div>
            {paidNum > 0 && (
              <SumRow l="المتبقي للمورد" v={remainDue} c={remainDue > 0 ? "var(--warning)" : "var(--success)"} />
            )}
            {isDeferred && paidNum > 0 && (
              <div style={{ marginTop: 8, padding: "8px 10px", background: "var(--warning-bg)", border: "1px solid var(--warning)", borderRadius: "var(--radius-sm)", fontSize: ".74rem", color: "var(--warning)" }}>
                دين آجل بعد الدفعة: {fmtC(remainDue)}
              </div>
            )}
            {!isDeferred && !isCash && paidNum > 0 && (
              <div style={{ fontSize: ".7rem", color: "var(--text-muted)", marginTop: 6, lineHeight: 1.35 }}>
                الدفعة السريعة تُطبَّق مع طريقة الدفع «آجل»
              </div>
            )}

            <div style={{ marginTop: 10, fontSize: ".74rem", color: "var(--text-muted)", textAlign: "center" }}>
              {validLines.length} صنف · {validLines.reduce((s,l) => s + (+l.AmountIN||0), 0)} وحدة
            </div>
          </Panel>

          <Button onClick={handleSave} loading={saving} fullWidth size="lg">💾 حفظ وتحديث المخزون</Button>
          <div style={{ padding: "10px 12px", background: "var(--bg-hover)", borderRadius: "var(--radius-md)", fontSize: ".72rem", color: "var(--text-muted)" }}>
            <strong>📐 WAC:</strong> سيُحسَب المعدل المرجح وتُحدَّث Stock_tbl و Materials_tbl تلقائياً عند الحفظ
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

// ============================================================
//  Barcode scanner — fills first empty row or adds a new one
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
      const res  = await materialsService.getAll({ barcode: v });
      // r = { success: true, count: N, data: [...] }
      const mats = Array.isArray(res?.data) ? res.data : [];
      const hit  = mats.find(m => m.Barcode?.toLowerCase() === v.toLowerCase()) || mats[0];
      if (hit) {
        onFillLine(hit);
        setBc("");
        setMsg({ text: `✅ أُضيفت: ${hit.MaterialName}`, ok: true });
        inputRef.current?.focus();
      } else {
        setMsg({ text: `⚠ لا توجد مادة بالباركود: ${v}`, ok: false });
      }
    } catch { setMsg({ text: "❌ خطأ في الاتصال", ok: false }); }
    finally {
      setBusy(false);
      setTimeout(() => setMsg({ text: "", ok: true }), 2500);
    }
  };

  return (
    <Panel label="📷 مسح الباركود — اكتب أو امسح ثم اضغط Enter">
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          ref={inputRef} value={bc}
          onChange={e => setBc(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") scan(bc); }}
          placeholder="امسح الباركود أو اكتبه يدوياً..."
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
//  PurchaseLineRow — صف واحد في جدول الأسطر
// ============================================================
function PurchaseLineRow({ idx, line, allMaterials, loadingMaterials, onUpdate, onRemove }) {
  const materialsList = Array.isArray(allMaterials) ? allMaterials : [];
  const lineTotal = useMemo(() => r2((+line.AmountIN || 0) * (+line.PriceIN || 0)), [line.AmountIN, line.PriceIN]);

  const pick = (mat) => {
    onUpdate({
      id_Material_NoM: mat.id_Material_NoM,
      MaterialName:    mat.MaterialName,
      Barcode:         mat.Barcode        || "",
      CatiguaryName:   mat.CatiguaryName  || "",
      Band:            mat.Band           || "",
      PriceIN:         "",
    });
  };

  const clearMat = () => onUpdate({
    id_Material_NoM: null, MaterialName: "", Barcode: "",
    CatiguaryName: "", Band: "", PriceIN: 0,
  });

  return (
    <tr
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
      onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = ""; }}
    >
      <td style={{ ...lineTd, textAlign: "center", fontFamily: "var(--font-mono)", color: "var(--text-muted)", fontSize: ".78rem", fontWeight: 700 }}>
        {idx}
      </td>

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
            </div>
            <button onClick={clearMat} title="تغيير المادة"
              style={{ flexShrink: 0, background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: ".85rem", padding: "2px 4px" }}>✎</button>
          </div>
        ) : (
          <PurchaseMaterialTypeahead
            materials={materialsList}
            loading={loadingMaterials}
            onPick={pick}
            placeholder="اكتب اسم المادة..."
            style={lineSelSt}
          />
        )}
      </td>

      <td style={{ ...lineTd, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: ".8rem", color: line.Barcode ? "var(--accent)" : "var(--text-muted)", wordBreak: "break-all", lineHeight: 1.25 }}>
        {line.Barcode || "—"}
      </td>

      <td style={lineTd}>
        <div style={{ display: "flex", alignItems: "center", gap: 3, justifyContent: "center" }}>
          <QtyBtn onClick={() => onUpdate({ AmountIN: Math.max(0.001, r2((+line.AmountIN || 1) - 1)) })}>−</QtyBtn>
          <FlexibleQtyInput
            value={line.AmountIN ?? 1}
            onChange={(n) => onUpdate({ AmountIN: n })}
            style={{ ...lineNumSt, padding: "6px 6px" }}
            width={84}
          />
          <QtyBtn accent onClick={() => onUpdate({ AmountIN: r2((+line.AmountIN || 1) + 1) })}>+</QtyBtn>
        </div>
      </td>

      <td style={lineTd}>
        <input
          type="number"
          min="0"
          value={numFieldValue(line.Gift_IN)}
          placeholder="0"
          onChange={e => onUpdate({ Gift_IN: e.target.value === "" ? "" : Math.max(0, +e.target.value || 0) })}
          title="كمية الهدية — لا تُحتسب في السعر"
          style={{ ...lineNumSt, width: "100%", maxWidth: 52, margin: "0 auto", display: "block", textAlign: "center", padding: "5px 4px",
                   color: "var(--success)", fontWeight: 700,
                   borderColor: (+line.Gift_IN || 0) > 0 ? "var(--success)" : undefined }}
        />
      </td>

      <td style={lineTd}>
        <input
          type="number"
          min="0"
          step="any"
          value={line.PriceIN === "" || line.PriceIN == null ? "" : line.PriceIN}
          onChange={e => onUpdate({ PriceIN: e.target.value === "" ? "" : Math.max(0, +e.target.value || 0) })}
          placeholder="سعر الشراء"
          title="أدخل سعر الشراء يدوياً"
          style={{ ...lineNumSt, width: "100%", padding: "7px 10px", textAlign: "left", fontWeight: 700 }}
        />
      </td>

      <td style={lineTd}>
        <div style={{ padding: "8px 10px", borderRadius: 6, background: "var(--bg-surface)", border: "1px solid var(--border-subtle)", fontFamily: "var(--font-mono)", fontWeight: 900, textAlign: "left", color: lineTotal > 0 ? "var(--accent)" : "var(--text-muted)", fontSize: ".92rem", userSelect: "none", whiteSpace: "nowrap", overflow: "visible" }}>
          {fmtC(lineTotal)}
        </div>
      </td>

      <td style={{ ...lineTd, minWidth: 130 }}>
        <input
          type="date"
          value={line.ExpairDate || ""}
          data-invoice-line-last="true"
          onChange={e => onUpdate({ ExpairDate: e.target.value })}
          title="Enter لإضافة سطر جديد"
          style={{ ...lineNumSt, width: "100%", minWidth: 124, padding: "6px 6px", fontSize: ".78rem", cursor: "pointer" }}
        />
      </td>

      <td style={{ ...lineTd, textAlign: "center" }}>
        <button onClick={onRemove} title="حذف السطر"
          style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", fontSize: "1rem", padding: "4px 6px", borderRadius: 6, lineHeight: 1 }}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--danger-bg)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
          ✕
        </button>
      </td>
    </tr>
  );
}

// ============================================================
//  PurchaseMaterialTypeahead — بحث مواد المشتريات (كل النتائج المتشابهة)
// ============================================================
const matNorm = (s) => String(s || "").trim().toLowerCase();
const matContains = (text, q) => matNorm(text).includes(q);

function PurchaseMaterialTypeahead({
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

  const q = matNorm(query);
  const filtered = useMemo(() => {
    if (!q) return materials;
    return materials.filter((m) =>
      matContains(m.MaterialName, q) ||
      matContains(m.Barcode, q) ||
      matContains(String(m.id_Material_NoM), q)
    );
  }, [materials, q]);

  const updateMenuPos = () => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 2,
      left: rect.left,
      width: rect.width,
      maxHeight: Math.max(120, window.innerHeight - rect.bottom - 12),
    });
  };

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
  }, [open, filtered.length, query]);

  useEffect(() => {
    const close = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      const portal = document.getElementById("purchase-material-typeahead-portal");
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
    overflowY: "auto",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    boxShadow: "var(--shadow-md)",
  };

  const dropdownPortal = open && menuPos && (
    <div id="purchase-material-typeahead-portal">
      {filtered.length > 0 ? (
        <div style={{ ...menuStyle, top: menuPos.top, left: menuPos.left, width: menuPos.width, maxHeight: menuPos.maxHeight }}>
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
        <div style={{ ...menuStyle, top: menuPos.top, left: menuPos.left, width: menuPos.width, padding: 10, fontSize: ".8rem", color: "var(--text-muted)" }}>
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
//  Shared UI helpers
// ============================================================
function Panel({ label, children, noPad, compact }) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: compact ? "var(--radius-md)" : "var(--radius-lg)", overflow: "hidden" }}>
      {label && (
        <div style={{
          padding: compact ? "6px 10px" : "10px 16px",
          borderBottom: "1px solid var(--border-subtle)",
          fontSize: compact ? ".62rem" : ".7rem",
          fontWeight: 700,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: ".05em",
        }}>{label}</div>
      )}
      <div style={{ padding: noPad ? 0 : compact ? "8px 10px" : "16px" }}>{children}</div>
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

function SumRow({ l, v, c, accent, big, minus }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid var(--border-subtle)" }}>
      <span style={{ fontSize: big ? ".9rem" : ".82rem", fontWeight: big ? 800 : 500, color: "var(--text-secondary)" }}>{l}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontWeight: big ? 900 : 600, color: accent ? "var(--accent)" : c || "var(--text-primary)", fontSize: big ? ".95rem" : ".84rem" }}>
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
