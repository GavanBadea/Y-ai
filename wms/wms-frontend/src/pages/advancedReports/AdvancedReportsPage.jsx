// ============================================================
//  src/pages/advancedReports/AdvancedReportsPage.jsx
//  التقارير التفصيلية — وحدة مستقلة
//
//  التبويبات:
//   📋 كشف الحساب       — مع رصيد افتتاحي وتراكمي
//   📑 تفاصيل الحركات   — أسطر الفواتير كاملة
//   🔍 تتبع الأصناف     — حركة مادة مع كمية تراكمية
//
//  التصدير: Excel (SheetJS/CDN) | طباعة/PDF (نافذة A4)
// ============================================================
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import AppLayout from "@/components/layout/AppLayout";
import api, { lookupService } from "@/services/api";
import { fmtN, fmtC, fmtDate } from "@/utils/numFormat";
import { useApi } from "@/hooks/useApi";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { useCompany } from "@/context/CompanyContext";
import { openReportPrint } from "@/utils/invoicePrint";
import { OverdueSalesInvoicesReport } from "@/pages/reports/ReportsPage";


// ── ثوابت ───────────────────────────────────────────────────
const TODAY      = new Date().toISOString().split("T")[0];
const YEAR_START = `${new Date().getFullYear()}-01-01`;
const BASE       = "/advanced-reports";

// ── جلب قوائم الأطراف من الـ endpoints الموجودة المجرّبة ────
async function fetchCustomers() {
  try {
    const r = await api.get("/party/customers");
    return (r.data || []).map(c => ({
      id    : c.id_Zabon,
      name  : c.ZabonName,
      mobile: c.Mobail || "",
    }));
  } catch { return []; }
}
async function fetchSuppliers() {
  try {
    const r = await api.get("/party/suppliers");
    return (r.data || []).map(s => ({
      id    : s.id_Amil,
      name  : s.AmilName,
      mobile: s.AmilMobail || s.Mobail || "",
    }));
  } catch { return []; }
}
async function fetchMaterials() {
  try {
    const r = await api.get(BASE + "/lists/materials");
    return (r.data || []).map(m => ({
      id           : m.id,
      name         : m.name,
      unit         : m.unit || "",
      barcode      : m.barcode || "",
      stock        : m.stock || 0,
      id_Catiguary : m.id_Catiguary,
      id_Type      : m.id_Type,
    }));
  } catch { return []; }
}

const ROW_COLORS = {
  "فاتورة بيع"     : { bg: "rgba(34,197,94,.07)",  badge: "#16a34a" },
  "فاتورة شراء"    : { bg: "rgba(59,130,246,.07)", badge: "#2563eb" },
  "مرتجع مبيعات"  : { bg: "rgba(249,115,22,.07)", badge: "#ea580c" },
  "مرتجع مشتريات" : { bg: "rgba(168,85,247,.07)", badge: "#9333ea" },
  "دين سابق"       : { bg: "rgba(245,158,11,.07)", badge: "#d97706" },
  "سند قبض"        : { bg: "rgba(20,184,166,.07)", badge: "#0d9488" },
  "سند دفع"        : { bg: "rgba(20,184,166,.07)", badge: "#0d9488" },
  "بيع"            : { bg: "rgba(34,197,94,.07)",  badge: "#16a34a" },
  "شراء"           : { bg: "rgba(59,130,246,.07)", badge: "#2563eb" },
  "مرتجع بيع"     : { bg: "rgba(249,115,22,.07)", badge: "#ea580c" },
  "مرتجع شراء"    : { bg: "rgba(168,85,247,.07)", badge: "#9333ea" },
  "نقل مخزني"     : { bg: "rgba(168,85,247,.14)", badge: "#7c3aed" },
};

// ══════════════════════════════════════════════════════════
//  تحميل SheetJS ديناميكياً من CDN
// ══════════════════════════════════════════════════════════
async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload  = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error("فشل تحميل مكتبة Excel"));
    document.head.appendChild(s);
  });
}

// ══════════════════════════════════════════════════════════
//  تصدير Excel عام
// ══════════════════════════════════════════════════════════
async function doExcelExport(sheetRows, sheetName, fileName) {
  if (!sheetRows.length) return alert("لا توجد بيانات للتصدير");
  try {
    const XLSX = await loadXLSX();
    const ws   = XLSX.utils.aoa_to_sheet(sheetRows);
    const wb   = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, fileName + ".xlsx");
  } catch (e) { alert("خطأ: " + e.message); }
}

// ══════════════════════════════════════════════════════════
//  طباعة — نافذة A4 مع شعار النظام
// ══════════════════════════════════════════════════════════
function doPrint(titleLine, infoLines, tableHead, tableBody, footerLines = []) {
  const headHtml = tableHead.map(h => `<th>${h}</th>`).join("");
  const bodyHtml = tableBody.map(row =>
    `<tr style="background:${row._bg || "#fff"}">${
      row._cells.map(c => `<td style="${c.style || ""}">${c.v ?? ""}</td>`).join("")
    }</tr>`
  ).join("");
  const footHtml = footerLines.map(row =>
    `<tr class="foot-row">${row.map(c => `<td style="${c.style || ""}" colspan="${c.span || 1}">${c.v ?? ""}</td>`).join("")}</tr>`
  ).join("");

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head>
<meta charset="UTF-8"><title>${titleLine}</title>
<style>
  @page{size:A4;margin:12mm} *{box-sizing:border-box;font-family:"Segoe UI",Tahoma,Arial,sans-serif}
  body{direction:rtl;font-size:11px;color:#111}
  .hdr{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1d4ed8;padding-bottom:8px;margin-bottom:12px}
  .logo{width:40px;height:40px;background:#1d4ed8;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:900;letter-spacing:2px}
  .sysName{font-size:12px;font-weight:700;color:#1d4ed8} .dev{font-size:9px;color:#666}
  .docTitle{text-align:left} .docTitle h2{margin:0;font-size:14px;color:#1d4ed8} .docTitle p{margin:1px 0;font-size:9px;color:#555}
  .info{display:flex;flex-wrap:wrap;gap:10px;background:#f0f4ff;border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:10px}
  .info span{font-weight:700}
  table{width:100%;border-collapse:collapse;font-size:10px}
  th{background:#1d4ed8;color:#fff;padding:6px 7px;text-align:right;font-weight:600}
  td{padding:4px 7px;border-bottom:1px solid #e5e7eb}
  .foot-row td{background:#f0f4ff;font-weight:700;border-top:2px solid #1d4ed8;font-size:11px}
  .footer{margin-top:12px;font-size:8px;color:#999;text-align:center;border-top:1px solid #e5e7eb;padding-top:4px}
  @media print{button{display:none}}
</style></head><body>
<div class="hdr">
  <div style="display:flex;align-items:center;gap:10px">
    <div class="logo">Y-ai</div>
    <div><div class="sysName">نظام إدارة المستودعات</div><div class="dev">Developed by Yara Gavan</div></div>
  </div>
  <div class="docTitle"><h2>${titleLine}</h2>${infoLines.map(l=>`<p>${l}</p>`).join("")}</div>
</div>
<table>
  <thead><tr>${headHtml}</tr></thead>
  <tbody>${bodyHtml}</tbody>
  <tfoot>${footHtml}</tfoot>
</table>
<div class="footer">Y-ai Warehouse Management System • Yara Gavan • ${new Date().toLocaleString("ar-IQ")}</div>
<script>window.onload=()=>window.print();</script>
</body></html>`;

  const w = window.open("", "_blank", "width=920,height=700");
  w.document.write(html);
  w.document.close();
}

function buildPrintTableHtml(tableHead, tableBody, footerLines = []) {
  const headHtml = tableHead.map((h) => `<th>${h}</th>`).join("");
  const bodyHtml = tableBody
    .map(
      (row) =>
        `<tr style="background:${row._bg || "#fff"}">${row._cells
          .map((c) => `<td style="${c.style || ""}">${c.v ?? ""}</td>`)
          .join("")}</tr>`
    )
    .join("");
  const footHtml = footerLines
    .map(
      (row) =>
        `<tr>${row
          .map((c) => `<td style="${c.style || ""}" colspan="${c.span || 1}">${c.v ?? ""}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `<table class="items"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody>${
    footHtml ? `<tfoot>${footHtml}</tfoot>` : ""
  }</table>`;
}

function doInvoiceStylePrint(company, titleLine, infoLines, tableHead, tableBody, footerLines = []) {
  openReportPrint({
    title: titleLine,
    subtitle: infoLines.join(" · "),
    company: company || {},
    tableHtml: buildPrintTableHtml(tableHead, tableBody, footerLines),
  });
}

// ══════════════════════════════════════════════════════════
//  SimpleSelect — قائمة منسدلة بسيطة مع بحث فوري
// ══════════════════════════════════════════════════════════
function SimpleSelect({ items, value, onChange, placeholder, disabled, searchPlaceholder }) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? items.filter(i =>
        (i.name   || "").includes(search) ||
        (i.mobile || "").includes(search) ||
        (i.barcode|| "").includes(search)
      )
    : items;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {/* حقل البحث */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={searchPlaceholder || "🔍 بحث بالاسم أو الجوال..."}
        disabled={disabled}
        style={{ ...iSt, fontSize: ".82rem" }}
      />
      {/* القائمة المنسدلة */}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        style={{
          ...iSt,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? .6 : 1,
        }}
      >
        <option value="">{placeholder}</option>
        {filtered.map(item => (
          <option key={item.id} value={item.id}>
            {item.name}{item.mobile ? ` — ${item.mobile}` : ""}
          </option>
        ))}
      </select>
      {/* عداد النتائج */}
      {search.trim() && (
        <div style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>
          {filtered.length} نتيجة
          <button onClick={() => setSearch("")}
            style={{ marginRight: 8, background: "none", border: "none", color: "var(--danger)", cursor: "pointer", fontSize: ".72rem" }}>
            ✕ مسح البحث
          </button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  Badge نوع الحركة
// ══════════════════════════════════════════════════════════
function TypeBadge({ type }) {
  const style = ROW_COLORS[type] || { badge: "#6b7280" };
  return (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 99,
      fontSize: ".7rem", fontWeight: 700, whiteSpace: "nowrap",
      color: style.badge, background: style.badge + "18",
      border: `1px solid ${style.badge}40`,
    }}>{type}</span>
  );
}

// ══════════════════════════════════════════════════════════
//  مكوّن الفلاتر المشترك
// ══════════════════════════════════════════════════════════
function FilterBar({ children, onFetch, loading }) {
  return (
    <div style={{
      background: "var(--bg-card)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)", padding: "16px 20px", marginBottom: 18,
    }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        {children}
        <button onClick={onFetch} disabled={loading} style={{
          padding: "9px 22px", background: "var(--accent)", color: "#fff",
          border: "none", borderRadius: "var(--radius-md)", fontWeight: 700,
          fontSize: ".88rem", cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? .65 : 1, fontFamily: "var(--font-main)", whiteSpace: "nowrap",
          flexShrink: 0,
        }}>
          {loading ? "⏳ جاري..." : "🔍 عرض"}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  بطاقات الملخص
// ══════════════════════════════════════════════════════════
function SummaryStrip({ cards }) {
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
      {cards.map((c, i) => (
        <div key={i} style={{
          flex: "1 1 130px", background: "var(--bg-card)",
          border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
          padding: "10px 14px", borderTop: `3px solid ${c.color}`,
        }}>
          <div style={{ fontSize: ".68rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>{c.label}</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 800, color: c.color, fontFamily: c.text ? "inherit" : "var(--font-mono)" }}>{c.value}</div>
          {c.sub && <div style={{ fontSize: ".68rem", color: "var(--text-muted)", marginTop: 2 }}>{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  أزرار التصدير
// ══════════════════════════════════════════════════════════
function ExportBar({ onExcel, onPrint, count }) {
  if (!count) return null;
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      <Btn onClick={onPrint}  bg="#1d4ed8">🖨 طباعة / PDF</Btn>
      <Btn onClick={onExcel}  bg="#16a34a">📊 تصدير Excel</Btn>
      <span style={{ marginRight: "auto", fontSize: ".8rem", color: "var(--text-muted)", alignSelf: "center" }}>
        {count} سطر
      </span>
    </div>
  );
}
function Btn({ children, onClick, bg }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 5,
      padding: "6px 14px", background: bg, color: "#fff",
      border: "none", borderRadius: "var(--radius-md)",
      fontWeight: 700, fontSize: ".8rem", cursor: "pointer",
      fontFamily: "var(--font-main)",
    }}>{children}</button>
  );
}

// ══════════════════════════════════════════════════════════
//  TAB 2 — تفاصيل الحركات (أسطر الفواتير)
// ══════════════════════════════════════════════════════════
function ActivityTab({ customers, suppliers }) {
  const { company } = useCompany();
  const [mode,    setMode]    = useState("customer");
  const [partyId, setPartyId] = useState("");
  const [from,    setFrom]    = useState(YEAR_START);
  const [to,      setTo]      = useState(TODAY);
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const parties = mode === "customer" ? customers : suppliers;
  const isC     = mode === "customer";

  const fetch = useCallback(async () => {
    if (!partyId) return alert("اختر " + (isC ? "الزبون" : "المورد"));
    setLoading(true); setResult(null);
    try {
      const ep  = isC ? "/activity/customer" : "/activity/supplier";
      const key = isC ? "id_Zabon" : "id_Amil";
      const r   = await api.get(BASE + ep, { params: { [key]: partyId, from, to } });
      if (r.success) setResult(r);
    } catch (e) { alert(e.message); }
    finally { setLoading(false); setFetched(true); }
  }, [partyId, from, to, mode, isC]);

  const excel = async () => {
    if (!result) return;
    const rows = [
      [`تفاصيل حركات ${isC ? "الزبون" : "المورد"}: ${result.party.name}`],
      [`الفترة: ${from} → ${to}`], [],
      ["التاريخ", "نوع", "رقم الفاتورة", "طريقة الدفع", "المادة", "الوحدة", "الكمية", "هدية", "السعر", "LC", "الخصم", "الإجمالي"],
      ...result.data.map(r => [r.txDate, r.txType, r.invoiceNo, r.payType || "", r.MaterialName, r.unit, r.qty, r.giftQty || 0, r.price, r.lcShare || 0, r.discountShare || 0, r.lineTotal]),
      [],
      ["", "", "", "", "", "", "", "", "", "", "", fmtC(isC ? result.totals.netTotal : result.totals.netTotal)],
    ];
    await doExcelExport(rows, "تفاصيل الحركات", `تفاصيل_${result.party.name}_${from}_${to}`);
  };

  const print = () => {
    if (!result) return;
    const head = ["التاريخ", "نوع", "#", "المادة", "وحدة", "كمية", "هدية", "سعر", "LC", "الخصم", "إجمالي"];
    const body = result.data.map(r => ({
      _bg: (ROW_COLORS[r.txType] || {}).bg || "#fff",
      _cells: [
        { v: r.txDate }, { v: r.txType },
        { v: r.invoiceNo, style: "font-weight:700;color:#4f46e5" },
        { v: r.MaterialName, style: "font-weight:600" },
        { v: r.unit }, { v: fmtN(r.qty) },
        { v: r.giftQty ? fmtN(r.giftQty) : "" },
        { v: fmtC(r.price), style: "text-align:left" },
        { v: r.lcShare ? fmtC(r.lcShare) : "—", style: "text-align:left" },
        { v: r.discountShare ? fmtC(r.discountShare) : "—", style: "text-align:left" },
        { v: fmtC(r.lineTotal), style: "text-align:left;font-weight:700" },
      ],
    }));
    const t = result.totals;
    const foot = [[
      { v: "الإجماليات", span: 10 },
      { v: fmtC(t.netTotal), style: "text-align:left;font-weight:800" },
    ]];
    doInvoiceStylePrint(company, `تفاصيل حركات ${isC ? "الزبون" : "المورد"}: ${result.party.name}`, [`الفترة: ${from} → ${to}`], head, body, foot);
  };

  return (
    <div>
      <FilterBar onFetch={fetch} loading={loading}>
        <div>
          <div style={lSt}>النوع</div>
          <div style={{ display: "flex", gap: 6 }}>
            {["customer", "supplier"].map(m => (
              <button key={m} onClick={() => { setMode(m); setPartyId(""); setResult(null); setFetched(false); }}
                style={{ padding: "7px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", fontFamily: "var(--font-main)", fontWeight: 700, fontSize: ".82rem", cursor: "pointer", background: mode === m ? "var(--accent)" : "var(--bg-input)", color: mode === m ? "#fff" : "var(--text-secondary)" }}>
                {m === "customer" ? "🧑 زبون" : "🏭 مورد"}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: "1 1 220px", minWidth: 200 }}>
          <div style={lSt}>{isC ? "الزبون" : "المورد"}</div>
          <SimpleSelect items={parties} value={partyId} onChange={setPartyId} placeholder={`— اختر ${isC ? "زبون" : "مورد"} —`} />
        </div>
        <DateField label="من" value={from} onChange={setFrom} />
        <DateField label="إلى" value={to}   onChange={setTo}   />
      </FilterBar>

      {result && (
        <>
          <SummaryStrip cards={isC ? [
            { label: "الزبون",          value: result.party.name,            color: "#6366f1", text: true },
            { label: "إجمالي المبيعات", value: fmtC(result.totals.totalSales),   color: "#16a34a" },
            { label: "المرتجعات",       value: fmtC(result.totals.totalReturns), color: "#ea580c" },
            { label: "الصافي",          value: fmtC(result.totals.netTotal),     color: "#1d4ed8" },
            { label: "الكمية الصافية",  value: fmtN(result.totals.totalQty),     color: "#7c3aed" },
          ] : [
            { label: "المورد",            value: result.party.name,              color: "#6366f1", text: true },
            { label: "إجمالي المشتريات", value: fmtC(result.totals.totalPurch),  color: "#2563eb" },
            { label: "المرتجعات",         value: fmtC(result.totals.totalReturns),color: "#9333ea" },
            { label: "الصافي",            value: fmtC(result.totals.netTotal),   color: "#1d4ed8" },
            { label: "الكمية الصافية",   value: fmtN(result.totals.totalQty),   color: "#7c3aed" },
          ]} />

          <ExportBar onExcel={excel} onPrint={print} count={result.data.length} />

          <TableWrap headers={["#", "التاريخ", "نوع", "فاتورة#", "طريقة الدفع", "المادة", "وحدة", "الكمية", "هدية", "السعر", "LC", "الخصم", "الإجمالي"]}>
            {result.data.map((r, i) => (
              <tr key={i} style={{ background: (ROW_COLORS[r.txType] || {}).bg || "transparent" }}
                onMouseEnter={e => e.currentTarget.style.filter = "brightness(.96)"}
                onMouseLeave={e => e.currentTarget.style.filter = ""}>
                <td style={tdC}>{i + 1}</td>
                <td style={{ ...td, fontFamily: "var(--font-mono)", fontSize: ".8rem" }}>{fmtDate(r.txDate)}</td>
                <td style={td}><TypeBadge type={r.txType} /></td>
                <td style={{ ...td, fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: 700 }}>#{r.invoiceNo}</td>
                <td style={{ ...td, fontSize: ".78rem", color: "var(--text-secondary)" }}>{r.payType || "—"}</td>
                <td style={{ ...td, fontWeight: 700 }}>{r.MaterialName}</td>
                <td style={{ ...td, color: "var(--text-muted)", fontSize: ".78rem" }}>{r.unit}</td>
                <td style={{ ...tdR, fontWeight: 700 }}>{fmtN(r.qty)}</td>
                <td style={{ ...tdR, color: r.giftQty ? "#d97706" : "var(--text-muted)" }}>{r.giftQty ? fmtN(r.giftQty) : "—"}</td>
                <td style={{ ...tdR, fontFamily: "var(--font-mono)" }}>{fmtC(r.price)}</td>
                <td style={{ ...tdR, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{r.lcShare ? fmtC(r.lcShare) : "—"}</td>
                <td style={{ ...tdR, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{r.discountShare ? fmtC(r.discountShare) : "—"}</td>
                <td style={{ ...tdR, fontWeight: 900, fontSize: ".9rem", color: r.txType.includes("مرتجع") ? "#ea580c" : "var(--accent)" }}>{fmtC(r.lineTotal)}</td>
              </tr>
            ))}
            <tr style={{ background: "var(--bg-surface)", borderTop: "2px solid var(--border)" }}>
              <td colSpan={12} style={{ ...td, fontWeight: 700, color: "var(--text-secondary)" }}>الإجماليات — {result.data.length} سطر</td>
              <td style={{ ...tdR, fontWeight: 900, fontSize: ".92rem", color: "var(--accent)" }}>{fmtC(result.totals.netTotal)}</td>
            </tr>
          </TableWrap>
        </>
      )}

      {!loading && fetched && !result && <EmptyState msg="لا توجد حركات في هذه الفترة" />}
      {!loading && !fetched && <HintState icon="📑" msg="اختر الطرف ونطاق التاريخ لعرض تفاصيل أسطر الفواتير" sub="يعرض: اسم المادة، الكمية، السعر، الإجمالي لكل سطر" />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  TAB 3 — تتبع الأصناف
// ══════════════════════════════════════════════════════════
function TrackingTab({ materials }) {
  useNumberLocale();
  const { company } = useCompany();
  const [catId,   setCatId]   = useState("");
  const [typeId,  setTypeId]  = useState("");
  const [matId,   setMatId]   = useState("");
  const [from,    setFrom]    = useState(YEAR_START);
  const [to,      setTo]      = useState(TODAY);
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const { data: catRaw } = useApi(() => lookupService.getCategories(), []);
  const { data: typeRaw } = useApi(() => lookupService.getTypes(), []);
  const categories = catRaw?.data || [];
  const types = typeRaw?.data || [];

  const pickCat = (v) => {
    setCatId(v);
    if (v) { setTypeId(""); setMatId(""); }
    setResult(null); setFetched(false);
  };
  const pickType = (v) => {
    setTypeId(v);
    if (v) { setCatId(""); setMatId(""); }
    setResult(null); setFetched(false);
  };
  const pickMat = (v) => {
    setMatId(v);
    if (v) { setCatId(""); setTypeId(""); }
    setResult(null); setFetched(false);
  };

  const fetch = useCallback(async () => {
    const modes = [
      matId   && "material",
      catId   && "category",
      typeId  && "type",
    ].filter(Boolean);
    if (!modes.length) return alert("اختر معيار بحث واحد: مادة أو صنف أو نوع");
    if (modes.length > 1) return alert("معيار بحث واحد فقط — اختر إما مادة أو صنف أو نوع");

    const params = { from, to };
    if (matId) params.id_Material = matId;
    else if (catId) params.id_Catiguary = catId;
    else if (typeId) params.id_Type = typeId;

    setLoading(true); setResult(null);
    try {
      const r = await api.get(BASE + "/tracking", { params });
      if (r.success) setResult(r);
      else alert(r.message || "لا توجد نتائج");
    } catch (e) { alert(e.message); }
    finally { setLoading(false); setFetched(true); }
  }, [matId, catId, typeId, from, to]);

  const excel = async () => {
    if (!result) return;
    const rows = [
      [`تتبع حركة المادة: ${result.material.name} (${result.material.unit})`],
      [`الفترة: ${from} → ${to}`, `كمية افتتاحية: ${result.openingQty}`], [],
      ["التاريخ", "نوع الحركة", "الجهة", "#", "طريقة الدفع", "الكمية", "هدية", "السعر", "LC", "الخصم", "الإجمالي", "الكمية التراكمية"],
      ...result.data.map(r => [r.txDate, r.txType, r.party, r.txRef, r.payType || "", r.qty, r.giftQty || 0, r.price, r.lcShare || 0, r.discountShare || 0, r.lineTotal, r.runningQty]),
      [],
      ["", "", "", "", "الإجماليات", result.totals.totalPurchased, result.totals.totalGifted, "", "", ""],
    ];
    await doExcelExport(rows, "تتبع المادة", `تتبع_${result.material.name}_${from}_${to}`);
  };

  const print = () => {
    if (!result) return;
    const head = ["التاريخ", "نوع", "الجهة", "#", "كمية", "هدية", "سعر", "LC", "الخصم", "إجمالي", "كمية تراكمية"];
    const body = result.data.map(r => ({
      _bg: (ROW_COLORS[r.txType] || {}).bg || "#fff",
      _cells: [
        { v: r.txDate }, { v: r.txType },
        { v: r.party, style: "font-weight:600" },
        { v: r.txRef, style: "font-weight:700;color:#4f46e5" },
        { v: fmtN(r.qty), style: "text-align:left" },
        { v: r.giftQty ? fmtN(r.giftQty) : "" },
        { v: fmtC(r.price), style: "text-align:left" },
        { v: r.lcShare ? fmtC(r.lcShare) : "—", style: "text-align:left" },
        { v: r.discountShare ? fmtC(r.discountShare) : "—", style: "text-align:left" },
        { v: fmtC(r.lineTotal), style: "text-align:left;font-weight:700" },
        { v: fmtN(r.runningQty), style: `text-align:left;font-weight:800;color:${r.runningQty < 0 ? "#dc2626" : "#1d4ed8"}` },
      ],
    }));
    const t = result.totals;
    const foot = [[
      { v: "الإجماليات", span: 4 },
      { v: fmtN(t.totalPurchased - t.totalSold), style: "color:#1d4ed8" },
      { v: fmtN(t.totalGifted), style: "color:#d97706" },
      { v: "" },
      { v: "" },
      { v: "" },
      { v: "" },
      { v: "" },
    ]];
    doInvoiceStylePrint(
      company,
      `تتبع حركة المادة: ${result.material.name}`,
      [`الوحدة: ${result.material.unit}`, `الفترة: ${from} → ${to}`, `كمية افتتاحية: ${result.openingQty}`],
      head,
      body,
      foot
    );
  };

  return (
    <div>
      <FilterBar onFetch={fetch} loading={loading}>
        <div style={{ flex: "1 1 180px", minWidth: 160 }}>
          <div style={lSt}>الصنف</div>
          <select value={catId} onChange={(e) => pickCat(e.target.value)} style={filterSelectSt}>
            <option value="">— اختر صنف —</option>
            {categories.map((c) => (
              <option key={c.id_Catiguary} value={c.id_Catiguary}>{c.CatiguaryName}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: "1 1 180px", minWidth: 160 }}>
          <div style={lSt}>النوع</div>
          <select value={typeId} onChange={(e) => pickType(e.target.value)} style={filterSelectSt}>
            <option value="">— اختر نوع —</option>
            {types.map((t) => (
              <option key={t.id_Type} value={t.id_Type}>{t.TypeName}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: "1 1 260px", minWidth: 220 }}>
          <div style={lSt}>المادة</div>
          <SimpleSelect
            items={materials}
            value={matId}
            onChange={pickMat}
            placeholder="— اختر مادة —"
            searchPlaceholder="🔍 بحث بالاسم أو الباركود..."
          />
        </div>
        <DateField label="من" value={from} onChange={setFrom} />
        <DateField label="إلى" value={to}   onChange={setTo}   />
      </FilterBar>

      {result && (
        <>
          <SummaryStrip cards={result.groupMode ? [
            { label: "نطاق البحث",       value: result.material.name,                     color: "#6366f1", text: true },
            { label: "عدد الحركات",     value: fmtN(result.data.length),                  color: "#6b7280" },
            { label: "مشتريات الفترة",  value: fmtN(result.totals.totalPurchased),        color: "#2563eb" },
            { label: "مبيعات الفترة",   value: fmtN(result.totals.totalSold),             color: "#16a34a" },
            { label: "قيمة المبيعات",   value: fmtC(result.totals.totalValue),            color: "#7c3aed" },
          ] : [
            { label: "المادة",            value: result.material.name,                     color: "#6366f1", text: true },
            { label: "كمية افتتاحية",    value: fmtN(result.openingQty) + " " + result.material.unit, color: "#6b7280" },
            { label: "مشتريات الفترة",  value: fmtN(result.totals.totalPurchased) + " " + result.material.unit, color: "#2563eb" },
            { label: "مبيعات الفترة",   value: fmtN(result.totals.totalSold) + " " + result.material.unit,      color: "#16a34a" },
            { label: "المخزون الحالي",   value: fmtN(result.material.currentStock) + " " + result.material.unit,color: "#7c3aed" },
          ]} />

          <ExportBar onExcel={excel} onPrint={print} count={result.data.length} />

          <TableWrap headers={result.groupMode
            ? ["#", "التاريخ", "المادة", "نوع الحركة", "الجهة", "رقم السند", "طريقة الدفع", "الكمية", "هدية", "السعر", "LC", "الخصم", "الإجمالي"]
            : ["#", "التاريخ", "نوع الحركة", "الجهة", "رقم السند", "طريقة الدفع", "الكمية", "هدية", "السعر", "LC", "الخصم", "الإجمالي", "كمية تراكمية"]}>
            {/* صف الكمية الافتتاحية */}
            {!result.groupMode && result.openingQty !== 0 && (
              <tr style={{ background: "#eef2ff" }}>
                <td style={tdC}>—</td>
                <td style={{ ...td, fontStyle: "italic", color: "var(--text-muted)", fontSize: ".8rem" }}>قبل الفترة</td>
                <td style={td}><TypeBadge type="دين سابق" /></td>
                <td colSpan={7} style={{ ...td, color: "var(--text-muted)", fontSize: ".78rem" }}>كمية افتتاحية</td>
                <td style={td} /><td style={td} /><td style={td} />
                <td style={{ ...tdR, fontWeight: 800, color: "#6366f1" }}>{fmtN(result.openingQty)}</td>
              </tr>
            )}

            {result.data.map((r, i) => (
              <tr key={i} style={{ background: (ROW_COLORS[r.txType] || {}).bg || "transparent" }}
                onMouseEnter={e => e.currentTarget.style.filter = "brightness(.96)"}
                onMouseLeave={e => e.currentTarget.style.filter = ""}>
                <td style={tdC}>{i + 1}</td>
                <td style={{ ...td, fontFamily: "var(--font-mono)", fontSize: ".8rem" }}>{fmtDate(r.txDate)}</td>
                {result.groupMode && (
                  <td style={{ ...td, fontWeight: 700, fontSize: ".78rem" }}>{r.MaterialName || "—"}</td>
                )}
                <td style={td}><TypeBadge type={r.txType} /></td>
                <td style={{ ...td, fontWeight: 600 }}>{r.party}</td>
                <td style={{ ...td, fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: 700 }}>#{r.txRef}</td>
                <td style={{ ...td, fontSize: ".75rem", color: "var(--text-muted)" }}>{r.payType || "—"}</td>
                <td style={{ ...tdR, fontWeight: 700 }}>{fmtN(r.qty)}</td>
                <td style={{ ...tdR, color: r.giftQty ? "#d97706" : "var(--text-muted)" }}>{r.giftQty ? fmtN(r.giftQty) : "—"}</td>
                <td style={{ ...tdR, fontFamily: "var(--font-mono)" }}>{fmtC(r.price)}</td>
                <td style={{ ...tdR, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{r.lcShare ? fmtC(r.lcShare) : "—"}</td>
                <td style={{ ...tdR, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{r.discountShare ? fmtC(r.discountShare) : "—"}</td>
                <td style={{ ...tdR, fontWeight: 800, color: r.txType === "بيع" ? "#16a34a" : r.txType === "شراء" ? "#2563eb" : "#ea580c" }}>{fmtC(r.lineTotal)}</td>
                {!result.groupMode && (
                  <td style={{ ...tdR, fontWeight: 900, fontSize: ".9rem", color: r.runningQty < 0 ? "#dc2626" : "#1d4ed8" }}>{fmtN(r.runningQty)}</td>
                )}
              </tr>
            ))}

            <tr style={{ background: "var(--bg-surface)", borderTop: "2px solid var(--border)" }}>
              {result.groupMode ? (
                <>
                  <td colSpan={7} style={{ ...td, fontWeight: 700, color: "var(--text-secondary)" }}>الإجماليات</td>
                  <td style={{ ...tdR, fontWeight: 900 }}>{fmtN(result.totals.totalPurchased - result.totals.totalSold)}</td>
                  <td style={{ ...tdR, fontWeight: 700, color: "#d97706" }}>{fmtN(result.totals.totalGifted)}</td>
                  <td style={td} /><td style={td} /><td style={td} />
                </>
              ) : (
                <>
                  <td colSpan={6} style={{ ...td, fontWeight: 700, color: "var(--text-secondary)" }}>الإجماليات</td>
                  <td style={{ ...tdR, fontWeight: 900 }}>{fmtN(result.totals.totalPurchased - result.totals.totalSold)}</td>
                  <td style={{ ...tdR, fontWeight: 700, color: "#d97706" }}>{fmtN(result.totals.totalGifted)}</td>
                  <td style={td} /><td style={td} /><td style={td} />
                  <td style={{ ...tdR, fontWeight: 900, color: "#1d4ed8" }}>{fmtN(result.material.currentStock)}</td>
                </>
              )}
            </tr>
          </TableWrap>
        </>
      )}

      {!loading && fetched && !result && <EmptyState msg="لا توجد حركات للمعايير المحددة في هذه الفترة" />}
      {!loading && !fetched && <HintState icon="🔍" msg="اختر معيار بحث واحد فقط" sub="مادة أو صنف أو نوع — القوائم مستقلة ولا تُصفّي بعضها. البحث بالصنف أو النوع يجمع حركات كل المواد التابعة له" />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  TAB — مرتجعات المبيعات / المشتريات
// ══════════════════════════════════════════════════════════
function ReturnsReportTab({ returnType, label, partyLabel, customers = [], suppliers = [] }) {
  const { company } = useCompany();
  const [from,    setFrom]    = useState(YEAR_START);
  const [to,      setTo]      = useState(TODAY);
  const [partyType, setPartyType] = useState(returnType === "ALL" ? "ALL" : returnType);
  const [partyId, setPartyId] = useState("");
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const showType = returnType === "ALL";
  const rows    = result?.rows || [];
  const txLabel = (r) => r.ReturnType === "CUSTOMER" ? "مرتجع مبيعات" : "مرتجع مشتريات";
  const partyOptions = partyType === "CUSTOMER" ? customers : partyType === "SUPPLIER" ? suppliers : [];
  const selectedPartyLabel = partyType === "CUSTOMER" ? "الزبون" : partyType === "SUPPLIER" ? "المورد" : partyLabel;
  const selectedPartyName = partyOptions.find((p) => String(p.id) === String(partyId))?.name || "";

  const fetch = useCallback(async () => {
    setLoading(true); setResult(null);
    try {
      const r = await api.get(BASE + "/returns", {
        params: { type: returnType, partyType, id_Party: partyId, from, to },
      });
      if (r.success) setResult(r);
    } catch (e) { alert(e.message); }
    finally { setLoading(false); setFetched(true); }
  }, [returnType, partyType, partyId, from, to]);

  const excel = async () => {
    if (!result?.rows?.length) return alert("لا توجد بيانات للتصدير");
    const head = [
      "#", "التاريخ", "رقم المرتجع", ...(showType ? ["نوع المرتجع"] : []), partyLabel, "المادة", "الباركود", "النوع", "الوحدة",
      "الكمية", "السعر", "سبب الإرجاع", "الإجمالي", "ملاحظة", "السائق", "جوال السائق", "المركبة",
    ];
    const sheet = [
      [label],
      [`الفترة: ${from} → ${to}${selectedPartyName ? ` | ${selectedPartyLabel}: ${selectedPartyName}` : ""}`], [],
      head,
      ...rows.map((r, i) => [
        i + 1, r.Date_FRetern, r.id_NoFRetern, ...(showType ? [txLabel(r)] : []), r.PartyName || "—", r.MaterialName || "—",
        r.Barcode || "", r.TypeName || "", r.Band || "", r.AmountReturn, r.PriceReturn,
        r.ReturnReason || "", r.LineTotal, r.Note_FRetern || "", r.DriverName_R || "",
        r.DriverMobile_R || "", r.VehicleNumber_R || "",
      ]),
      [],
      ["", "", "", "", "", "", "", "", "", "", "الإجمالي", result.totals.totalValue],
    ];
    const fname = returnType === "CUSTOMER"
      ? `مرتجعات_المبيعات_${from}_${to}`
      : `مرتجعات_المشتريات_${from}_${to}`;
    await doExcelExport(sheet, label.slice(0, 31), fname);
  };

  const print = () => {
    if (!result?.rows?.length) return alert("لا توجد بيانات للطباعة");
    const head = ["#", "التاريخ", "#مرتجع", ...(showType ? ["نوع المرتجع"] : []), partyLabel, "المادة", "وحدة", "كمية", "سعر", "سبب", "إجمالي"];
    const body = rows.map((r, i) => ({
      _bg: (ROW_COLORS[txLabel(r)] || {}).bg || "#fff",
      _cells: [
        { v: i + 1 },
        { v: fmtDate(r.Date_FRetern) },
        { v: r.id_NoFRetern, style: "font-weight:700;color:#4f46e5" },
        ...(showType ? [{ v: txLabel(r), style: "font-weight:700" }] : []),
        { v: r.PartyName || "—", style: "font-weight:600" },
        { v: r.MaterialName || "—", style: "font-weight:600" },
        { v: r.Band || "—" },
        { v: fmtN(r.AmountReturn) },
        { v: fmtC(r.PriceReturn), style: "text-align:left" },
        { v: r.ReturnReason || "—", style: "font-size:9px" },
        { v: fmtC(r.LineTotal), style: "text-align:left;font-weight:700" },
      ],
    }));
    const foot = [[
      { v: "الإجماليات", span: showType ? 7 : 6 },
      { v: `${result.totals.returnCount} مرتجع / ${result.totals.lineCount} سطر` },
      { v: "" },
      { v: fmtC(result.totals.totalValue), style: "color:#1d4ed8;font-weight:800" },
    ]];
    doInvoiceStylePrint(
      company,
      label,
      [`الفترة: ${from} → ${to}${selectedPartyName ? ` | ${selectedPartyLabel}: ${selectedPartyName}` : ""}`],
      head,
      body,
      foot
    );
  };

  return (
    <div>
      <FilterBar onFetch={fetch} loading={loading}>
        <DateField label="من" value={from} onChange={setFrom} />
        <DateField label="إلى" value={to}   onChange={setTo}   />
        {showType && (
          <div style={{ minWidth: 150 }}>
            <div style={lSt}>نوع الطرف</div>
            <select value={partyType} onChange={e => { setPartyType(e.target.value); setPartyId(""); }} style={filterSelectSt}>
              <option value="ALL">الكل</option>
              <option value="CUSTOMER">زبون</option>
              <option value="SUPPLIER">مورد</option>
            </select>
          </div>
        )}
        {partyType !== "ALL" && (
          <div style={{ minWidth: 190 }}>
            <div style={lSt}>{partyType === "CUSTOMER" ? "الزبون" : "المورد"}</div>
            <select value={partyId} onChange={e => setPartyId(e.target.value)} style={filterSelectSt}>
              <option value="">— الكل —</option>
              {partyOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
      </FilterBar>

      {result && rows.length > 0 && (
        <>
          <SummaryStrip cards={[
            { label: "عدد المرتجعات", value: fmtN(result.totals.returnCount), color: "#6366f1" },
            { label: "عدد الأسطر",    value: fmtN(result.totals.lineCount),    color: "#7c3aed" },
            { label: "إجمالي القيمة", value: fmtC(result.totals.totalValue), color: returnType === "CUSTOMER" ? "#ea580c" : "#9333ea" },
          ]} />

          <ExportBar onExcel={excel} onPrint={print} count={rows.length} />

          <TableWrap headers={["#", "التاريخ", "رقم المرتجع", ...(showType ? ["نوع المرتجع"] : []), partyLabel, "المادة", "الباركود", "النوع", "الوحدة", "الكمية", "السعر", "سبب الإرجاع", "الإجمالي", "ملاحظة", "السائق", "المركبة"]}>
            {rows.map((r, i) => (
              <tr key={`${r.id_NoFRetern}-${i}`} style={{ background: (ROW_COLORS[txLabel(r)] || {}).bg || "transparent" }}>
                <td style={tdC}>{i + 1}</td>
                <td style={{ ...td, fontFamily: "var(--font-mono)", fontSize: ".8rem" }}>{fmtDate(r.Date_FRetern)}</td>
                <td style={{ ...td, fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: 700 }}>#{r.id_NoFRetern}</td>
                {showType && <td style={{ ...td, fontWeight: 700 }}>{txLabel(r)}</td>}
                <td style={{ ...td, fontWeight: 700 }}>{r.PartyName || "—"}</td>
                <td style={{ ...td, fontWeight: 700 }}>{r.MaterialName || "—"}</td>
                <td style={{ ...td, fontFamily: "var(--font-mono)", fontSize: ".78rem", color: "var(--text-muted)" }}>{r.Barcode || "—"}</td>
                <td style={{ ...td, fontSize: ".78rem", color: "var(--text-secondary)" }}>{r.TypeName || "—"}</td>
                <td style={{ ...td, color: "var(--text-muted)", fontSize: ".78rem" }}>{r.Band || "—"}</td>
                <td style={{ ...tdR, fontWeight: 700 }}>{fmtN(r.AmountReturn)}</td>
                <td style={{ ...tdR, fontFamily: "var(--font-mono)" }}>{fmtC(r.PriceReturn)}</td>
                <td style={{ ...td, fontSize: ".78rem", color: "var(--text-secondary)" }}>{r.ReturnReason || "—"}</td>
                <td style={{ ...tdR, fontWeight: 900, color: returnType === "CUSTOMER" ? "#ea580c" : "#9333ea" }}>{fmtC(r.LineTotal)}</td>
                <td style={{ ...td, fontSize: ".76rem", color: "var(--text-muted)", maxWidth: 120 }}>{r.Note_FRetern || "—"}</td>
                <td style={{ ...td, fontSize: ".78rem" }}>{r.DriverName_R || "—"}</td>
                <td style={{ ...td, fontSize: ".78rem", fontFamily: "var(--font-mono)" }}>{r.VehicleNumber_R || "—"}</td>
              </tr>
            ))}
            <tr style={{ background: "var(--bg-surface)", borderTop: "2px solid var(--border)" }}>
              <td colSpan={showType ? 12 : 11} style={{ ...td, fontWeight: 700, color: "var(--text-secondary)" }}>الإجماليات — {rows.length} سطر</td>
              <td style={{ ...tdR, fontWeight: 900, fontSize: ".92rem", color: "var(--accent)" }}>{fmtC(result.totals.totalValue)}</td>
              <td colSpan={3} style={td} />
            </tr>
          </TableWrap>
        </>
      )}

      {!loading && fetched && (!result || !rows.length) && <EmptyState msg="لا توجد مرتجعات في هذه الفترة" />}
      {!loading && !fetched && (
        <HintState icon="↩️" msg="حدد نطاق التاريخ ثم اضغط عرض" sub="يعرض تفاصيل كل سطر: المادة، الكمية، السعر، سبب الإرجاع، السائق والمركبة" />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  الصفحة الرئيسية
// ══════════════════════════════════════════════════════════
const TABS = [
  { id: "activity",          label: "📑 تفاصيل الحركات"       },
  { id: "tracking",          label: "🔍 تتبع الأصناف"         },
  { id: "all-returns",       label: "↩️ جميع المرتجعات"       },
  { id: "sales-returns",     label: "↩️ مرتجعات المبيعات"     },
  { id: "purchase-returns",  label: "↩️ مرتجعات المشتريات"    },
  { id: "overdue-sales",     label: "📋 فواتير مستحقة التسديد" },
];

export default function AdvancedReportsPage() {
  const [tab,       setTab]       = useState("activity");
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [materials, setMaterials] = useState([]);

  useEffect(() => {
    fetchCustomers().then(setCustomers);
    fetchSuppliers().then(setSuppliers);
    fetchMaterials().then(setMaterials);
  }, []);

  return (
    <AppLayout title="التقارير التفصيلية">
      {/* شريط التبويبات */}
      <div style={{
        display: "flex", gap: 4, marginBottom: 20,
        borderBottom: "2px solid var(--border)", paddingBottom: 0,
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: "9px 20px", border: "none", background: "none",
              fontWeight: tab === t.id ? 800 : 500,
              fontSize: ".88rem", cursor: "pointer",
              fontFamily: "var(--font-main)",
              color: tab === t.id ? "var(--accent)" : "var(--text-secondary)",
              borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: -2, transition: "all .15s",
            }}
          >{t.label}</button>
        ))}
      </div>

      {tab === "activity"          && <ActivityTab  customers={customers} suppliers={suppliers} />}
      {tab === "tracking"          && <TrackingTab  materials={materials} />}
      {tab === "all-returns"       && <ReturnsReportTab returnType="ALL" label="جميع المرتجعات" partyLabel="الطرف" customers={customers} suppliers={suppliers} />}
      {tab === "sales-returns"     && <ReturnsReportTab returnType="CUSTOMER" label="مرتجعات المبيعات" partyLabel="الزبون" customers={customers} suppliers={suppliers} />}
      {tab === "purchase-returns"  && <ReturnsReportTab returnType="SUPPLIER" label="مرتجعات المشتريات" partyLabel="المورد" customers={customers} suppliers={suppliers} />}
      {tab === "overdue-sales"     && <OverdueSalesInvoicesReport />}
    </AppLayout>
  );
}

// ══════════════════════════════════════════════════════════
//  مكوّنات مساعدة مشتركة
// ══════════════════════════════════════════════════════════
function DateField({ label, value, onChange }) {
  return (
    <div style={{ minWidth: 130 }}>
      <div style={lSt}>{label}</div>
      <input type="date" value={value} onChange={e => onChange(e.target.value)} style={{ ...iSt, width: "100%" }} />
    </div>
  );
}

function TableWrap({ headers, children }) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".83rem" }}>
          <thead>
            <tr style={{ background: "var(--bg-surface)", borderBottom: "2px solid var(--border)" }}>
              {headers.map((h, i) => (
                <th key={i} style={{ padding: "9px 11px", textAlign: i > 4 ? "left" : "right", fontWeight: 700, fontSize: ".7rem", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: ".04em", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function EmptyState({ msg }) {
  return (
    <div style={{ textAlign: "center", padding: 60, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", color: "var(--text-muted)" }}>
      <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>📭</div>
      <p style={{ fontWeight: 600 }}>{msg}</p>
    </div>
  );
}

function HintState({ icon, msg, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "50px 20px", background: "var(--bg-card)", border: "1px dashed var(--border)", borderRadius: "var(--radius-lg)", color: "var(--text-muted)" }}>
      <div style={{ fontSize: "3rem", marginBottom: 12 }}>{icon}</div>
      <p style={{ fontWeight: 600, fontSize: ".95rem", color: "var(--text-secondary)" }}>{msg}</p>
      {sub && <p style={{ fontSize: ".82rem", marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

// ── أنماط CSS مشتركة ─────────────────────────────────────
const iSt = {
  background: "var(--bg-input)", border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)", color: "var(--text-primary)",
  padding: "8px 10px", outline: "none", fontFamily: "var(--font-main)",
};
const filterSelectSt = { ...iSt, width: "100%", cursor: "pointer" };
const lSt = {
  display: "block", fontSize: ".7rem", fontWeight: 700,
  color: "var(--text-secondary)", marginBottom: 4,
  textTransform: "uppercase", letterSpacing: ".04em",
};
const td  = { padding: "7px 11px", borderBottom: "1px solid var(--border-subtle)", verticalAlign: "middle" };
const tdC = { ...td, textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: ".72rem" };
const tdR = { ...td, textAlign: "left",   fontFamily: "var(--font-mono)" };
