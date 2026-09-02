// ============================================================
//  ReportsPage.jsx  —  وحدة التقارير المتكاملة  v3
//  ✅ يقرأ الأرقام من NumberLocaleContext العالمي
// ============================================================
import { useState, useEffect, useMemo, useCallback } from "react";
import { useLocation } from "react-router-dom";
import AppLayout          from "@/components/layout/AppLayout";
import { ModalOverlay }   from "@/components/ui/Modal";
import api                from "@/services/api";
import { commonService }  from "@/services/api";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { useLanguage } from "@/context/LanguageContext";
import { useCompany } from "@/context/CompanyContext";
import { openReportPrint } from "@/utils/invoicePrint";

const r2        = (n=0) => Math.round((+n||0)*100)/100;
const today     = () => new Date().toISOString().split("T")[0];
const yearStart = () => `${new Date().getFullYear()}-01-01`;

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

async function exportExcel(filename, sheetName, headers, rows) {
  if (!headers?.length) return alert("لا توجد بيانات للتصدير");
  try {
    const XLSX = await loadXLSX();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
  } catch (e) {
    alert("خطأ في التصدير: " + e.message);
  }
}

function printReportTable(company, title, period, heads, rows) {
  if (!rows?.length) return alert("لا توجد بيانات للطباعة");
  const thead = heads.map((h) => `<th>${escHtml(h)}</th>`).join("");
  const tbody = rows
    .map(
      (cells, i) =>
        `<tr style="background:${i % 2 ? "#f1f5f9" : "#fff"}">${cells
          .map((c) => `<td>${c}</td>`)
          .join("")}</tr>`
    )
    .join("");
  openReportPrint({
    title,
    subtitle: period,
    company: company || {},
    tableHtml: `<table class="items"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`,
  });
}

/* ─── الأنماط ───────────────────────────────────────────── */
const C = {
  card: {background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:"var(--radius-lg,10px)",padding:"16px 18px"},
  th:   {padding:"9px 12px",textAlign:"right",color:"var(--text-muted)",fontWeight:700,fontSize:".68rem",textTransform:"uppercase",letterSpacing:".05em",whiteSpace:"nowrap",background:"var(--bg-surface)",borderBottom:"1px solid var(--border)"},
  td:   {padding:"9px 12px",borderBottom:"1px solid var(--border-subtle)"},
  inp:  {padding:"7px 10px",background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm,6px)",color:"var(--text-primary)",fontFamily:"inherit",fontSize:".85rem",outline:"none"},
  sel:  {padding:"7px 10px",background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:"var(--radius-sm,6px)",color:"var(--text-primary)",fontFamily:"inherit",fontSize:".85rem",outline:"none",cursor:"pointer"},
  btn:  (v="accent") => ({
    padding  :"7px 16px",
    border   : v==="ghost"?"1px solid var(--border)":"none",
    borderRadius:"var(--radius-sm,6px)",
    fontFamily:"inherit",fontWeight:700,fontSize:".82rem",cursor:"pointer",
    background: v==="accent"?"var(--accent)":v==="ghost"?"var(--bg-card)":"var(--bg-hover)",
    color: v==="accent"?"#fff":"var(--text-primary)",
  }),
};

/* ─── التبويبات ─────────────────────────────────────────── */
const TAB_DEFS = [
  { id: "summary",             key: "reports.tabs.summary",             icon: "📋" },
  { id: "stock-movement",      key: "reports.tabs.stockMovement",       icon: "📦" },
  { id: "abc",                 key: "reports.tabs.abc",                 icon: "📊" },
  { id: "aging-expiry",        key: "reports.tabs.agingExpiry",         icon: "⏳" },
  { id: "profitability",       key: "reports.tabs.profitability",       icon: "💰" },
  { id: "aging-receivables",   key: "reports.tabs.agingReceivables",    icon: "⚖️" },
  { id: "entities",            key: "reports.tabs.entities",            icon: "👤" },
  { id: "material-analysis",   key: "reports.tabs.materialAnalysis",    icon: "🔬" },
  { id: "salesmen",            key: "reports.tabs.salesmen",            icon: "🏅" },
  { id: "cash-flow",           key: "reports.tabs.cashFlow",            icon: "💵" },
  { id: "profit-report",       key: "reports.tabs.profitReport",        icon: "📈" },
  { id: "reorder-alert",       key: "reports.tabs.reorderAlert",        icon: "🔔" },
];

/* ════════════════════════════════════════════════════════
   ROOT
════════════════════════════════════════════════════════ */
export default function ReportsPage() {
  const location = useLocation();
  const [tab, setTab]       = useState(location.state?.tab || "summary");
  const [widgets, setWidgets] = useState(null);
  const { fmtC, fmtN }      = useNumberLocale();
  const { t, tr, isRtl }    = useLanguage();

  const TABS = useMemo(
    () => TAB_DEFS.map((x) => ({ ...x, label: t(x.key) })),
    [t]
  );

  useEffect(() => {
    api.get("/reports/dashboard", {params:{startDate:yearStart(), endDate:today()}})
      .then(r => setWidgets(r?.cards || null)).catch(() => {});
  }, []);

  const KPI_LIST = useMemo(() => [
    { l: t("reports.kpi.stockValue"),    v: widgets ? fmtC(widgets.stock?.value)      : "...", c: "var(--accent)",          i: "🏭" },
    { l: t("reports.kpi.outOfStock"),    v: widgets ? fmtN(widgets.stock?.outOfStock)  : "...", c: "var(--danger)",          i: "⚠️" },
    { l: t("reports.kpi.totalSales"),    v: widgets ? fmtC(widgets.sales?.value)       : "...", c: "var(--success,#22c55e)", i: "💹" },
    { l: t("reports.kpi.grossProfit"),   v: widgets ? fmtC(widgets.grossProfit?.value)   : "...",
      c: widgets?.grossProfit?.value >= 0 ? "var(--success,#22c55e)" : "var(--danger)", i: "📈" },
    { l: t("reports.kpi.customerDebt"),  v: widgets ? fmtC(widgets.customers?.value)    : "...", c: "var(--warning,#f59e0b)", i: "👥" },
  ], [t, widgets, fmtC, fmtN]);

  return (
    <AppLayout title={t("reports.title")}>
      <div dir={isRtl ? "rtl" : "ltr"} style={{display:"flex", flexDirection:"column", gap:18}}>

        {/* Widgets */}
        <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:10}}>
          {KPI_LIST.map((w,i) => (
            <div key={i} style={{...C.card, display:"flex", flexDirection:"column", gap:5}}>
              <span style={{fontSize:"1.3rem"}}>{w.i}</span>
              <span style={{fontSize:".7rem", color:"var(--text-muted)", fontWeight:600}}>{w.l}</span>
              <span style={{fontFamily:"monospace", fontWeight:900, color:w.c, fontSize:"1rem"}}>{w.v}</span>
            </div>
          ))}
        </div>

        {/* شريط التبويبات */}
        <div style={{display:"flex", gap:4, padding:"6px 8px", background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg,10px)", overflowX:"auto"}}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{padding:"7px 14px", border:"none", borderRadius:"var(--radius-md,8px)", fontFamily:"inherit", fontWeight:700, fontSize:".82rem", cursor:"pointer", whiteSpace:"nowrap", transition:"all .15s",
                background: tab===t.id ? "var(--accent)" : "transparent",
                color:      tab===t.id ? "#fff" : "var(--text-secondary)",
              }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* محتوى التبويب */}
        {tab === "summary"           && <SummaryReport/>}
        {tab === "stock-movement"    && <StockMovementReport/>}
        {tab === "abc"               && <ABCReport/>}
        {tab === "aging-expiry"      && <AgingExpiryReport/>}
        {tab === "profitability"     && <ProfitabilityReport/>}
        {tab === "aging-receivables" && <AgingReceivablesReport/>}
        {tab === "entities"          && <EntitiesReport/>}
        {tab === "material-analysis" && <MaterialAnalysisReport/>}
        {tab === "salesmen"          && <SalesmenReport/>}
        {tab === "cash-flow"         && <CashFlowReport/>}
        {tab === "profit-report"     && <ProfitReport/>}
        {tab === "reorder-alert"     && <ReorderAlertReport/>}
      </div>
    </AppLayout>
  );
}

/* ════════════════════════════════════════════════════════
   المكوّنات المشتركة
════════════════════════════════════════════════════════ */
function Shell({title, desc, onRun, onExport, onPrint, load, filters, children}) {
  const { tr } = useLanguage();
  return (
    <div style={{...C.card, display:"flex", flexDirection:"column", gap:16}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, flexWrap:"wrap"}}>
        <div>
          <h2 style={{margin:0, fontSize:"1.05rem", fontWeight:800, color:"var(--text-primary)"}}>{tr(title)}</h2>
          {desc && <p style={{margin:"3px 0 0", fontSize:".76rem", color:"var(--text-muted)"}}>{tr(desc)}</p>}
        </div>
        <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
          {onExport && <button onClick={onExport} style={C.btn("ghost")}>📥 {tr("تصدير Excel")}</button>}
          {onPrint  && <button onClick={onPrint}  style={C.btn("ghost")}>🖨️ {tr("طباعة")}</button>}
          <button onClick={onRun} disabled={load} style={{...C.btn("accent"), display:"flex", alignItems:"center", gap:6}}>
            {load ? <Spin sm/> : "🔍"} {tr("تشغيل")}
          </button>
        </div>
      </div>
      {filters && (
        <div style={{display:"flex", gap:10, flexWrap:"wrap", padding:"11px 14px", background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md,8px)", alignItems:"flex-end"}}>
          {filters}
        </div>
      )}
      {children}
    </div>
  );
}

function DR({f, setF}) {
  return (
    <>
      <Lbl label="من تاريخ"><input type="date" value={f.startDate} onChange={e=>setF(p=>({...p,startDate:e.target.value}))} style={C.inp}/></Lbl>
      <Lbl label="إلى تاريخ"><input type="date" value={f.endDate}   onChange={e=>setF(p=>({...p,endDate:e.target.value}))}   style={C.inp}/></Lbl>
    </>
  );
}

function Lbl({label, children}) {
  return (
    <div style={{display:"flex", flexDirection:"column", gap:4}}>
      <label style={{fontSize:".72rem", color:"var(--text-muted)", fontWeight:700}}>{label}</label>
      {children}
    </div>
  );
}

function Tbl({heads, children, load, empty, emptyMsg="لا توجد بيانات"}) {
  return (
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%", borderCollapse:"collapse", fontSize:".82rem"}}>
        <thead><tr>{heads.map((h,i) => <th key={i} style={C.th}>{h}</th>)}</tr></thead>
        <tbody>
          {load  && <tr><td colSpan={heads.length} style={{padding:40, textAlign:"center"}}><Spin/></td></tr>}
          {!load && empty  && <tr><td colSpan={heads.length} style={{padding:40, textAlign:"center", color:"var(--text-muted)"}}>{emptyMsg}</td></tr>}
          {!load && !empty && children}
        </tbody>
      </table>
    </div>
  );
}

function Chip({l, v, c, accent}) {
  return (
    <div style={{padding:"7px 14px", background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md,8px)", display:"flex", flexDirection:"column", gap:3}}>
      <span style={{fontSize:".69rem", color:"var(--text-muted)", fontWeight:600}}>{l}</span>
      <span style={{fontFamily:"monospace", fontWeight:900, color:c||(accent?"var(--accent)":"var(--text-primary)"), fontSize:".94rem"}}>{v}</span>
    </div>
  );
}

function Spin({sm}) { return <span className="spinner" style={{width:sm?12:20, height:sm?12:20, flexShrink:0}}/>; }

/* ════════════════════════════════════════════════════════
   1- الملخص العام
════════════════════════════════════════════════════════ */
function SummaryReport() {
  const { fmtC, fmtN } = useNumberLocale();
  const { company } = useCompany();
  const [f, setF]       = useState({startDate:yearStart(), endDate:today(), q:""});
  const [data, setData] = useState(null);
  const [load, setLoad] = useState(false);

  const run = useCallback(async () => {
    setLoad(true);
    try { const r = await api.get("/reports/summary-report", {params:f}); setData(r); }
    finally { setLoad(false); }
  }, [f]);

  useEffect(() => { run(); }, []);

  const items = useMemo(() => {
    const q = f.q.toLowerCase(); const all = data?.items || [];
    return q ? all.filter(r => r.MaterialName?.toLowerCase().includes(q)) : all;
  }, [data, f.q]);

  const doExport = () => exportExcel("الملخص_العام", "الملخص",
    ["الصنف","تصنيف","شراء(ك)","مرتجع شراء","صافي شراء (ك)","قيمة شراء","مبيعات(ك)","مرتجع مبيعات","صافي مبيعات (ك)","قيمة مبيعات","المخزون بدون هدايا"],
    items.map(r => [
      r.MaterialName, r.CatiguaryName||"", r.purchaseQty, r.purchaseRetQty,
      r.netPurchaseQty, r.netPurchaseVal, r.salesQty, r.salesRetQty,
      r.netSalesQty, r.netSalesVal, r.stockWithoutGifts,
    ]));
  const period = `من ${f.startDate} إلى ${f.endDate}`;
  const doPrint = () => printReportTable(company, "الملخص العام للمشتريات والمبيعات", period,
    ["الصنف","تصنيف","شراء(ك)","مرتجع شراء","صافي شراء","قيمة شراء","مبيعات(ك)","مرتجع مبيعات","صافي مبيعات","قيمة مبيعات","المخزون بدون هدايا"],
    items.map(r => [
      escHtml(r.MaterialName), escHtml(r.CatiguaryName||"—"),
      fmtN(r.purchaseQty), fmtN(r.purchaseRetQty), fmtN(r.netPurchaseQty), fmtC(r.netPurchaseVal),
      fmtN(r.salesQty), fmtN(r.salesRetQty), fmtN(r.netSalesQty), fmtC(r.netSalesVal),
      fmtN(r.stockWithoutGifts),
    ]));

  return (
    <Shell title="📋 الملخص العام للمشتريات والمبيعات"
      desc="لايدخل ضمنها الهدايا و لا الخصم ولا مصاريف LC"
      onRun={run} onExport={doExport} onPrint={doPrint} load={load}
      filters={<><DR f={f} setF={setF}/><Lbl label="بحث"><input value={f.q||""} onChange={e=>setF(p=>({...p,q:e.target.value}))} placeholder="ابحث عن صنف..." style={{...C.inp, minWidth:180}}/></Lbl></>}>
      {data?.totals && (
        <div style={{display:"flex", gap:10, marginBottom:14, flexWrap:"wrap"}}>
          <Chip l="صافي المشتريات"  v={fmtC(data.totals.totalNetPurchase)}/>
          <Chip l="صافي المبيعات"   v={fmtC(data.totals.totalNetSales)}/>
        </div>
      )}
      <Tbl heads={["الصنف","تصنيف","شراء(ك)","مرتجع شراء","صافي شراء","قيمة شراء","مبيعات(ك)","مرتجع مبيعات","صافي مبيعات","قيمة مبيعات","المخزون بدون هدايا"]}
        load={load} empty={items.length===0}>
        {items.map((r,i) => (
          <tr key={r.id_Material_NoM} style={{background:i%2===0?"var(--bg-hover)":""}}>
            <td style={C.td}><b>{r.MaterialName}</b>{r.Band&&<div style={{fontSize:".7rem",color:"var(--text-muted)"}}>{r.Band}</div>}</td>
            <td style={{...C.td,fontSize:".78rem",color:"var(--text-muted)"}}>{r.CatiguaryName||"—"}</td>
            <td style={{...C.td,fontFamily:"monospace",color:"var(--success,#22c55e)"}}>{fmtN(r.purchaseQty)}</td>
            <td style={{...C.td,fontFamily:"monospace",color:"var(--warning,#f59e0b)"}}>{fmtN(r.purchaseRetQty)}</td>
            <td style={{...C.td,fontFamily:"monospace",fontWeight:700}}>{fmtN(r.netPurchaseQty)}</td>
            <td style={{...C.td,fontFamily:"monospace"}}>{fmtC(r.netPurchaseVal)}</td>
            <td style={{...C.td,fontFamily:"monospace",color:"var(--accent)"}}>{fmtN(r.salesQty)}</td>
            <td style={{...C.td,fontFamily:"monospace",color:"var(--danger)"}}>{fmtN(r.salesRetQty)}</td>
            <td style={{...C.td,fontFamily:"monospace",fontWeight:700}}>{fmtN(r.netSalesQty)}</td>
            <td style={{...C.td,fontFamily:"monospace",fontWeight:700,color:"var(--accent)"}}>{fmtC(r.netSalesVal)}</td>
            <td style={{...C.td,fontFamily:"monospace",color:r.stockWithoutGifts>0?"var(--accent)":"var(--danger)"}}>{fmtN(r.stockWithoutGifts)}</td>
          </tr>
        ))}
      </Tbl>
    </Shell>
  );
}

/* ════════════════════════════════════════════════════════
   2- حركة المخزون
════════════════════════════════════════════════════════ */
function StockMovementReport() {
  const { fmtC, fmtN } = useNumberLocale();
  const { company } = useCompany();
  const [f, setF] = useState({startDate:yearStart(), endDate:today(), q:""});
  const [data, setData] = useState(null); const [load, setLoad] = useState(false);
  const run = useCallback(async()=>{setLoad(true);try{const r=await api.get("/reports/stock-movement-analytics",{params:f});setData(r);}finally{setLoad(false);}}, [f]);
  useEffect(()=>{run();},[]);
  const items = useMemo(()=>{const q=f.q.toLowerCase();const all=data?.items||[];return q?all.filter(r=>r.MaterialName?.toLowerCase().includes(q)):all;},[data,f.q]);
  const stockHeads = ["الصنف","افتتاحي","وارد شراء","هدايا شراء","مرتجع شراء","إجمالي وارد","صادر مبيعات","هدايا مبيعات","مرتجع مبيعات","إجمالي صادر","ختامي","قيمة ختامي"];
  const stockRow = (r) => [r.MaterialName,r.openingBalance,r.purchaseQty,r.purchaseGiftQty,r.purchaseReturnQty,r.periodIn,r.soldQty,r.salesGiftQty,r.salesReturnQty,r.periodOut,r.closingBalance,r.closingValue];
  const doExport=()=>exportExcel("stock_movement","stock",stockHeads,items.map(stockRow));
  const period = `من ${f.startDate} إلى ${f.endDate}`;
  const totalClosing = r2(
    data?.totals?.totalClosingValue ??
    items.reduce((s, r) => s + (+r.closingValue || 0), 0)
  );
  const doPrint = () => {
    if (!items.length) return alert("لا توجد بيانات للطباعة");
    const thead = stockHeads.map((h) => `<th>${escHtml(h)}</th>`).join("");
    const tbody = items.map((r, i) =>
      `<tr style="background:${i % 2 ? "#f1f5f9" : "#fff"}">${stockRow(r).map((c, ci) =>
        `<td>${ci === 0 ? escHtml(c) : ci === stockHeads.length - 1 ? fmtC(c) : fmtN(c)}</td>`
      ).join("")}</tr>`
    ).join("");
    const tfoot = `<tfoot><tr style="background:#f0f4ff;font-weight:900;border-top:2px solid #1a1a2e">
      <td colspan="${stockHeads.length - 1}" style="text-align:right;padding:10px 8px">مجموع القيمة الختامية</td>
      <td style="padding:10px 8px;font-family:Consolas,monospace;color:#b8860b">${fmtC(totalClosing)}</td>
    </tr></tfoot>`;
    openReportPrint({
      title: "حركة المخزون التفصيلي",
      subtitle: period,
      company: company || {},
      tableHtml: `<table class="items"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody>${tfoot}</table>`,
    });
  };
  return (
    <Shell title="📦 حركة المخزون التفصيلي" desc="رصيد افتتاحي + وارد − صادر = رصيد ختامي" onRun={run} onExport={doExport} onPrint={doPrint} load={load}
      filters={<><DR f={f} setF={setF}/><Lbl label="بحث"><input value={f.q||""} onChange={e=>setF(p=>({...p,q:e.target.value}))} placeholder="ابحث..." style={{...C.inp,minWidth:160}}/></Lbl></>}>
      {data?.totals&&<div style={{display:"flex",gap:10,marginBottom:14}}><Chip l="أصناف" v={data.totals.totalItems}/><Chip l="قيمة ختامية" v={fmtC(data.totals.totalClosingValue)} accent/></div>}
      <Tbl heads={stockHeads} load={load} empty={items.length===0}>
        {items.map((r,i)=>(
          <tr key={r.id_Material_NoM} style={{background:i%2===0?"var(--bg-hover)":""}}>
            <td style={C.td}><b>{r.MaterialName}</b></td>
            <td style={{...C.td,fontFamily:"monospace"}}>{fmtN(r.openingBalance)}</td>
            <td style={{...C.td,fontFamily:"monospace",color:"var(--success,#22c55e)"}}>{fmtN(r.purchaseQty)}</td>
            <td style={{...C.td,fontFamily:"monospace",color:"var(--success,#22c55e)"}}>{fmtN(r.purchaseGiftQty)}</td>
            <td style={{...C.td,fontFamily:"monospace",color:"var(--warning,#f59e0b)"}}>{fmtN(r.purchaseReturnQty)}</td>
            <td style={{...C.td,fontFamily:"monospace",fontWeight:700,color:"var(--success,#22c55e)"}}>{fmtN(r.periodIn)}</td>
            <td style={{...C.td,fontFamily:"monospace",color:"var(--danger)"}}>{fmtN(r.soldQty)}</td>
            <td style={{...C.td,fontFamily:"monospace",color:"var(--danger)"}}>{fmtN(r.salesGiftQty)}</td>
            <td style={{...C.td,fontFamily:"monospace",color:"var(--info,#3b82f6)"}}>{fmtN(r.salesReturnQty)}</td>
            <td style={{...C.td,fontFamily:"monospace",fontWeight:700,color:"var(--danger)"}}>{fmtN(r.periodOut)}</td>
            <td style={{...C.td,fontFamily:"monospace",fontWeight:900,color:"var(--accent)"}}>{fmtN(r.closingBalance)}</td>
            <td style={{...C.td,fontFamily:"monospace",fontWeight:700,color:"var(--accent)"}}>{fmtC(r.closingValue)}</td>
          </tr>
        ))}
      </Tbl>
    </Shell>
  );
}

/* ════════════════════════════════════════════════════════
   3- ABC
════════════════════════════════════════════════════════ */
function ABCReport() {
  const { fmtC, fmtN } = useNumberLocale();
  const { company } = useCompany();
  const [f, setF]=useState({startDate:yearStart(),endDate:today()});
  const [data,setData]=useState(null);const [load,setLoad]=useState(false);const [fc,setFc]=useState("ALL");
  const run=useCallback(async()=>{setLoad(true);try{const r=await api.get("/reports/abc-analysis",{params:f});setData(r);}finally{setLoad(false);}}, [f]);
  useEffect(()=>{run();},[]);
  const items=useMemo(()=>{const all=data?.items||[];return fc==="ALL"?all:all.filter(r=>r.abcClass===fc);},[data,fc]);
  const BC=({cls})=>{const m={A:["#dcfce7","#16a34a"],B:["#fef9c3","#ca8a04"],C:["#fee2e2","#dc2626"]};const[bg,fg]=m[cls]||["#f1f5f9","#64748b"];return<span style={{background:bg,color:fg,padding:"2px 9px",borderRadius:12,fontWeight:700,fontSize:".77rem"}}>{cls}</span>;};
  const period = `من ${f.startDate} إلى ${f.endDate}`;
  const doExport = () => exportExcel("تحليل_ABC", "ABC", ["الصنف","إيراد المبيعات بدون المرجعات","نسبة%","تراكمي%","تصنيف","مخزون","أيام الدوران"],
    items.map(r => [r.MaterialName, r.salesRevenue, r.revPct, r.cumPct, r.abcClass, r.currentStock, r.turnoverDays ?? ""]));
  const doPrint = () => printReportTable(company, "تحليل ABC للمخزون", period,
    ["الصنف","إيراد المبيعات بدون المرجعات","نسبة%","تراكمي%","تصنيف","مخزون","أيام الدوران"],
    items.map(r => [escHtml(r.MaterialName), fmtC(r.salesRevenue), `${r.revPct}%`, `${r.cumPct}%`, r.abcClass, fmtN(r.currentStock), r.turnoverDays != null ? `${fmtN(r.turnoverDays)} يوم` : "—"]));
  return (
    <Shell title="📊 تحليل ABC للمخزون" desc="A: سريع الحركة · B: متوسط · C: راكد" onRun={run} onExport={doExport} onPrint={doPrint} load={load} filters={<DR f={f} setF={setF}/>}>
      {data&&(<div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {[["ALL","الكل",null],["A","A (سريع)","#16a34a"],["B","B (متوسط)","#ca8a04"],["C","C (راكد)","#dc2626"]].map(([v,l,col])=>(
          <button key={v} onClick={()=>setFc(v)} style={{padding:"5px 14px",border:`2px solid ${fc===v?(col||"var(--accent)"):"var(--border)"}`,borderRadius:"var(--radius-full,20px)",background:fc===v?(col||"var(--accent)"):"var(--bg-card)",color:fc===v?"#fff":"var(--text-primary)",fontWeight:700,fontSize:".8rem",cursor:"pointer",fontFamily:"inherit"}}>
            {l}{v!=="ALL"?` (${data.summary[v]})`:``}
          </button>
        ))}
      </div>)}
      <Tbl heads={["الصنف","إيراد المبيعات بدون المرجعات","نسبة%","تراكمي%","تصنيف","مخزون","أيام الدوران"]} load={load} empty={items.length===0}>
        {items.map((r,i)=>(
          <tr key={r.id_Material_NoM} style={{background:i%2===0?"var(--bg-hover)":""}}>
            <td style={C.td}><b>{r.MaterialName}</b></td>
            <td style={{...C.td,fontFamily:"monospace",fontWeight:700,color:"var(--accent)"}}>{fmtC(r.salesRevenue)}</td>
            <td style={{...C.td,fontFamily:"monospace"}}>{r.revPct}%</td>
            <td style={{...C.td,fontFamily:"monospace"}}>{r.cumPct}%</td>
            <td style={C.td}><BC cls={r.abcClass}/></td>
            <td style={{...C.td,fontFamily:"monospace",color:r.currentStock>0?"var(--accent)":"var(--danger)"}}>{fmtN(r.currentStock)}</td>
            <td style={{...C.td,fontFamily:"monospace",color:"var(--text-secondary)"}}>{r.turnoverDays!=null?`${fmtN(r.turnoverDays)} يوم`:"—"}</td>
          </tr>
        ))}
      </Tbl>
    </Shell>
  );
}

/* ════════════════════════════════════════════════════════
   4- الصلاحية والأعمار
════════════════════════════════════════════════════════ */
function AgingExpiryReport() {
  const { fmtC, fmtN } = useNumberLocale();
  const { company } = useCompany();
  const [data,setData]=useState(null);const [load,setLoad]=useState(false);const [fs,setFs]=useState("ALL");
  const run=useCallback(async()=>{setLoad(true);try{const r=await api.get("/reports/aging-expiry");setData(r);}finally{setLoad(false);}}, []);
  useEffect(()=>{run();},[]);
  const items=useMemo(()=>{const all=data?.items||[];return fs==="ALL"?all:all.filter(r=>r.status===fs);},[data,fs]);
  const SB=({s,l})=>{const m={expired:["rgba(220,38,38,.14)","#dc2626"],critical:["rgba(234,88,12,.14)","#ea580c"],warning:["rgba(202,138,4,.12)","#ca8a04"],ok:["rgba(34,197,94,.12)","#16a34a"]};const[bg,fg]=m[s]||["var(--bg-hover)","var(--text-muted)"];return<span style={{background:bg,color:fg,padding:"2px 8px",borderRadius:10,fontWeight:700,fontSize:".74rem"}}>{l}</span>;};
  const doExport = () => exportExcel("الصلاحية_والأعمار", "الصلاحية", ["الصنف","تاريخ الشراء","تاريخ الصلاحية","أيام متبقية","الحالة","مخزون","قيمة"],
    items.map(r => [r.MaterialName, r.purchaseDate, r.ExpairDate, r.daysLeft, r.statusLabel, r.currentStock, r.stockValue]));
  const doPrint = () => printReportTable(company, "تقرير الصلاحية والأعمار", "جميع الأصناف ذات تاريخ صلاحية",
    ["الصنف","تاريخ الشراء","تاريخ الصلاحية","أيام متبقية","الحالة","مخزون","قيمة"],
    items.map(r => [escHtml(r.MaterialName), r.purchaseDate, r.ExpairDate, r.daysLeft < 0 ? `منتهي (${fmtN(Math.abs(r.daysLeft))} يوم)` : `${fmtN(r.daysLeft)} يوم`, r.statusLabel, fmtN(r.currentStock), fmtC(r.stockValue)]));
  return (
    <Shell title="⏳ تقرير الصلاحية والأعمار" desc="🔴 منتهي · 🟠 حرج (30 يوم) · 🟡 تحذير (90 يوم) · 🟢 جيد" onRun={run} onExport={doExport} onPrint={doPrint} load={load} filters={null}>
      {data?.summary&&(<div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {[["ALL","الكل",null],["expired","منتهي","#dc2626"],["critical","حرج","#ea580c"],["warning","تحذير","#ca8a04"],["ok","جيد","#16a34a"]].map(([v,l,col])=>(
          <button key={v} onClick={()=>setFs(v)} style={{padding:"5px 14px",border:`2px solid ${fs===v?(col||"var(--accent)"):"var(--border)"}`,borderRadius:"var(--radius-full,20px)",background:fs===v?(col||"var(--accent)"):"var(--bg-card)",color:fs===v?"#fff":"var(--text-primary)",fontWeight:700,fontSize:".8rem",cursor:"pointer",fontFamily:"inherit"}}>
            {l}{v!=="ALL"?` (${data.summary[v]})`:``}
          </button>
        ))}
      </div>)}
      <Tbl heads={["الصنف","تاريخ الشراء","تاريخ الصلاحية","أيام متبقية","الحالة","مخزون","قيمة"]} load={load} empty={items.length===0} emptyMsg="لا توجد أصناف بتاريخ صلاحية مسجّل">
        {items.map((r,i)=>{
          const rb=r.status==="expired"?"rgba(220,38,38,.06)":r.status==="critical"?"rgba(234,88,12,.05)":r.status==="warning"?"rgba(202,138,4,.04)":"";
          return (<tr key={i} style={{background:rb||(i%2===0?"var(--bg-hover)":"")}}>
            <td style={C.td}><b>{r.MaterialName}</b></td>
            <td style={{...C.td,fontFamily:"monospace",fontSize:".78rem"}}>{r.purchaseDate}</td>
            <td style={{...C.td,fontFamily:"monospace",fontSize:".78rem"}}>{r.ExpairDate}</td>
            <td style={{...C.td,fontFamily:"monospace",fontWeight:700,color:r.daysLeft<0?"var(--danger)":r.daysLeft<30?"#ea580c":r.daysLeft<90?"#ca8a04":"var(--success,#22c55e)"}}>
              {r.daysLeft<0?`منتهي (${fmtN(Math.abs(r.daysLeft))} يوم)`:`${fmtN(r.daysLeft)} يوم`}
            </td>
            <td style={C.td}><SB s={r.status} l={r.statusLabel}/></td>
            <td style={{...C.td,fontFamily:"monospace"}}>{fmtN(r.currentStock)}</td>
            <td style={{...C.td,fontFamily:"monospace",fontWeight:700}}>{fmtC(r.stockValue)}</td>
          </tr>);
        })}
      </Tbl>
    </Shell>
  );
}

/* ════════════════════════════════════════════════════════
   5- ربحية المبيعات
════════════════════════════════════════════════════════ */
function ProfitabilityReport() {
  const { fmtC, fmtN } = useNumberLocale();
  const { company } = useCompany();
  const [f,setF]=useState({startDate:yearStart(),endDate:today(),groupBy:"item"});
  const [data,setData]=useState(null);const [load,setLoad]=useState(false);
  const run=useCallback(async()=>{setLoad(true);try{const r=await api.get("/reports/sales-profitability",{params:f});setData(r);}finally{setLoad(false);}}, [f]);
  useEffect(()=>{run();},[]);
  const items=data?.items||[];
  const doExport=()=>exportExcel("ربحية_المبيعات","الربحية",["الاسم","إيراد إجمالي","خصومات","مرتجعات","صافي إيراد","عدد مبيع","عدد مرجع","تكلفة","ربح","هامش%"],items.map(r=>[r.name,r.grossRevenue,r.totalDiscount,r.returnValue,r.netRevenue,r.salesCount,r.returnCount,r.netCost,r.profit,r.margin+"%"]));
  const period = `من ${f.startDate} إلى ${f.endDate}`;
  const doPrint = () => printReportTable(company, "ربحية المبيعات", period,
    ["الاسم","إيراد إجمالي","خصومات","مرتجعات","صافي إيراد","عدد مبيع","عدد مرجع","تكلفة","ربح","هامش%"],
    items.map(r => [escHtml(r.name), fmtC(r.grossRevenue), fmtC(r.totalDiscount), fmtC(r.returnValue), fmtC(r.netRevenue), r.salesCount, r.returnCount, fmtC(r.netCost), fmtC(r.profit), `${r.margin}%`]));
  const MB=({p})=>(<div style={{display:"flex",alignItems:"center",gap:6}}><div style={{flex:1,height:6,background:"var(--border)",borderRadius:3,overflow:"hidden"}}><div style={{width:`${Math.min(Math.max(p,0),100)}%`,height:"100%",background:p>20?"var(--success,#22c55e)":p>0?"var(--warning,#f59e0b)":"var(--danger)"}}/></div><span style={{fontFamily:"monospace",fontSize:".76rem",fontWeight:700,minWidth:40,color:p>20?"var(--success,#22c55e)":p>0?"var(--warning,#f59e0b)":"var(--danger)"}}>{p}%</span></div>);
  return (
    <Shell title="💰 ربحية المبيعات" desc="إيراد إجمالي − خصومات − مرتجعات = صافي إيراد — ثم − تكلفة = ربح" onRun={run} onExport={doExport} onPrint={doPrint} load={load}
      filters={<><DR f={f} setF={setF}/><Lbl label="تجميع"><select value={f.groupBy} onChange={e=>setF(p=>({...p,groupBy:e.target.value}))} style={C.sel}><option value="item">الصنف</option><option value="customer">الزبون</option></select></Lbl></>}>
      {data?.totals&&(<div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}><Chip l="إيراد إجمالي" v={fmtC(data.totals.grossRevenue)}/><Chip l="خصومات" v={fmtC(data.totals.totalDiscount)} c="var(--warning,#f59e0b)"/><Chip l="مرتجعات" v={fmtC(data.totals.totalReturns)} c="var(--danger)"/><Chip l="صافي إيراد" v={fmtC(data.totals.netRevenue)} accent/><Chip l="ربح صافي" v={fmtC(data.totals.totalProfit)} c={data.totals.totalProfit>=0?"var(--success,#22c55e)":"var(--danger)"}/></div>)}
      <Tbl heads={["الاسم","إيراد إجمالي","خصومات","مرتجعات","صافي إيراد","عدد مبيع","عدد مرجع","تكلفة","ربح","هامش"]} load={load} empty={items.length===0}>
        {items.map((r,i)=>(<tr key={r.id} style={{background:i%2===0?"var(--bg-hover)":""}}>
          <td style={C.td}><b>{r.name}</b></td>
          <td style={{...C.td,fontFamily:"monospace"}}>{fmtC(r.grossRevenue)}</td>
          <td style={{...C.td,fontFamily:"monospace",color:"var(--warning,#f59e0b)"}}>{fmtC(r.totalDiscount)}</td>
          <td style={{...C.td,fontFamily:"monospace",color:"var(--danger)"}}>{fmtC(r.returnValue)}</td>
          <td style={{...C.td,fontFamily:"monospace",fontWeight:700,color:"var(--accent)"}}>{fmtC(r.netRevenue)}</td>
          <td style={{...C.td,textAlign:"center"}}>{r.salesCount}</td>
          <td style={{...C.td,textAlign:"center"}}>{r.returnCount}</td>
          <td style={{...C.td,fontFamily:"monospace",color:"var(--warning,#f59e0b)"}}>{fmtC(r.netCost)}</td>
          <td style={{...C.td,fontFamily:"monospace",fontWeight:900,color:r.profit>=0?"var(--success,#22c55e)":"var(--danger)"}}>{fmtC(r.profit)}</td>
          <td style={{...C.td,minWidth:120}}><MB p={r.margin}/></td>
        </tr>))}
      </Tbl>
    </Shell>
  );
}

/* ════════════════════════════════════════════════════════
   6- ميزان المراجعة
════════════════════════════════════════════════════════ */
function AgingReceivablesReport() {
  const { fmtC } = useNumberLocale();
  const { company } = useCompany();
  const [data,setData]=useState(null);const [load,setLoad]=useState(false);const [view,setView]=useState("customers");
  const run=useCallback(async()=>{setLoad(true);try{const r=await api.get("/reports/aging-receivables");setData(r);}finally{setLoad(false);}}, []);
  useEffect(()=>{run();},[]);
  const items=view==="customers"?(data?.customers||[]):(data?.suppliers||[]);
  const nk=view==="customers"?"ZabonName":"AmilName";
  const custHeads = ["الاسم","إجمالي","مدفوع/مقبوض","مبلغ السماح","مرتجعات","رصيد صافي"];
  const supHeads = ["الاسم","إجمالي","مدفوع/مقبوض","مرتجعات","رصيد صافي"];
  const heads = view === "customers" ? custHeads : supHeads;
  const doExport=()=>exportExcel(`ميزان_${view==="customers"?"الزبائن":"الموردين"}`, "الميزان", heads,
    items.map(r => view === "customers"
      ? [r[nk], r.totalDebt, r.totalPaid, r.totalAllowance || 0, r.totalReturns, r.netBalance]
      : [r[nk], r.totalDebt, r.totalPaid, r.totalReturns, r.netBalance]));
  const doPrint = () => printReportTable(company, `ميزان مراجعة ${view==="customers"?"الزبائن":"الموردين"}`, "الأرصدة الحالية",
    heads,
    items.map(r => view === "customers"
      ? [escHtml(r[nk]), fmtC(r.totalDebt), fmtC(r.totalPaid), fmtC(r.totalAllowance || 0), fmtC(r.totalReturns), fmtC(r.netBalance)]
      : [escHtml(r[nk]), fmtC(r.totalDebt), fmtC(r.totalPaid), fmtC(r.totalReturns), fmtC(r.netBalance)]));
  return (
    <Shell title="⚖️ ميزان مراجعة المستحقات" desc="الرصيد الصافي بعد خصم المرتجعات والمدفوعات" onRun={run} onExport={doExport} onPrint={doPrint} load={load} filters={null}>
      {data?.summary&&(<div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}><Chip l="مستحقاتنا (الزبائن)" v={fmtC(data.summary.totalReceivables)} c="var(--success,#22c55e)"/><Chip l="مديونياتنا (الموردون)" v={fmtC(data.summary.totalPayables)} c="var(--danger)"/><Chip l="صافي المركز" v={fmtC(data.summary.totalReceivables-data.summary.totalPayables)} accent c={(data.summary.totalReceivables-data.summary.totalPayables)>=0?"var(--success,#22c55e)":"var(--danger)"}/></div>)}
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        {[["customers","👥 الزبائن"],["suppliers","🏭 الموردون"]].map(([v,l])=>(
          <button key={v} onClick={()=>setView(v)} style={{padding:"6px 16px",border:`2px solid ${view===v?"var(--accent)":"var(--border)"}`,borderRadius:"var(--radius-full,20px)",background:view===v?"var(--accent)":"var(--bg-card)",color:view===v?"#fff":"var(--text-primary)",fontWeight:700,fontSize:".83rem",cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
        ))}
      </div>
      <Tbl heads={heads} load={load} empty={items.length===0} emptyMsg="لا توجد أرصدة مستحقة">
        {items.map((r,i)=>(<tr key={r.id_Zabon||r.id_Amil} style={{background:i%2===0?"var(--bg-hover)":""}}>
          <td style={C.td}><b>{r[nk]}</b></td>
          <td style={{...C.td,fontFamily:"monospace",color:"var(--warning,#f59e0b)"}}>{fmtC(r.totalDebt)}</td>
          <td style={{...C.td,fontFamily:"monospace",color:"var(--success,#22c55e)"}}>{fmtC(r.totalPaid)}</td>
          {view === "customers" && (
            <td style={{...C.td,fontFamily:"monospace",color:"var(--accent,#d4a017)"}}>{fmtC(r.totalAllowance || 0)}</td>
          )}
          <td style={{...C.td,fontFamily:"monospace",color:"var(--info,#3b82f6)"}}>{fmtC(r.totalReturns)}</td>
          <td style={{...C.td,fontFamily:"monospace",fontWeight:900,color:r.netBalance>0?"var(--danger)":"var(--success,#22c55e)"}}>
            {fmtC(r.netBalance)}<span style={{fontSize:".7rem",color:"var(--text-muted)",marginRight:5}}>{r.netBalance>0?"(مدين)":"(دائن)"}</span>
          </td>
        </tr>))}
      </Tbl>
    </Shell>
  );
}

/* ════════════════════════════════════════════════════════
   7- الكيانات مع Modal
════════════════════════════════════════════════════════ */
function EntitiesReport() {
  const { fmtC } = useNumberLocale();
  const { company } = useCompany();
  const [f,setF]=useState({startDate:yearStart(),endDate:today(),partyType:"CUSTOMER",id_Party:""});
  const [parties,setParties]=useState([]);
  const [data,setData]=useState(null);const [load,setLoad]=useState(false);
  const [modal,setModal]=useState(null);

  useEffect(()=>{
    const url=f.partyType==="CUSTOMER"?"/party/customers":"/party/suppliers";
    api.get(url,{params:{limit:500}}).then(r=>setParties(r?.data||[])).catch(()=>{});
  },[f.partyType]);

  const run=useCallback(async()=>{if(!f.id_Party)return;setLoad(true);try{const r=await api.get("/reports/entity-report",{params:f});setData(r);}finally{setLoad(false);}}, [f]);
  const openModal=async(docType,docNo)=>{setModal({docType,docNo,data:null});try{const r=await api.get(`/reports/entity-invoice/${docType}/${docNo}`);setModal(m=>({...m,data:r.data}));}catch(e){setModal(m=>({...m,data:{error:e.message}}));}};

  const entityModalMeta = (docType, d) => {
    const rows = [
      { l: "التاريخ", v: d.Date_FOUT || d.Date_FIN || d.Date_FRetern },
      { l: "الطرف", v: d.ZabonName || d.AmilName || d.partyName || "—" },
      { l: "طريقة الدفع", v: d.PayTypeName || "—" },
    ];
    if (docType === "FIN") {
      const lc = r2(
        +(d.Trans || 0) + +(d.Customs || 0) + +(d.Porter || 0) +
        +(d.SGS || 0) + +(d.ExportRelease || 0) + +(d.VehicleManifest || 0)
      );
      rows.push({ l: "مصاريف LC", v: fmtC(lc) });
      rows.push({ l: "الخصم", v: fmtC(d.Dis_FIN || 0) });
      if (d.Note_FIN) rows.push({ l: "ملاحظة", v: d.Note_FIN });
    } else if (docType === "FOUT") {
      rows.push({ l: "\u0627\u0644\u062e\u0635\u0645", v: fmtC(d.Dis_FOUT || 0) });
      if (+d.Add_FOUT) rows.push({ l: "\u0627\u0644\u0625\u0636\u0627\u0641\u0629", v: fmtC(d.Add_FOUT) });
      if (d.Note_FOUT) rows.push({ l: "\u0645\u0644\u0627\u062d\u0638\u0629", v: d.Note_FOUT });
    } else if (d.Note_FRetern) {
      rows.push({ l: "ملاحظة", v: d.Note_FRetern });
    }
    return rows;
  };

  const nameKey=f.partyType==="CUSTOMER"?"ZabonName":"AmilName";
  const txs=data?.transactions||[];
  const doExport=()=>exportExcel("كشف_حساب","الكيانات",["رقم","التاريخ","النوع","الإجمالي","الدفع"],txs.map(r=>[r.docNo,r.date,r.type,r.total,r.payType||""]));
  const partyLabel = f.partyType === "SUPPLIER" ? "المورد" : "الزبون";
  const partyName = data?.partyInfo?.name
    || parties.find((p) => String(p.id_Zabon || p.id_Amil) === String(f.id_Party))?.[nameKey]
    || "";
  const period = partyName
    ? `${partyLabel}: ${partyName} | من ${f.startDate} إلى ${f.endDate}`
    : `من ${f.startDate} إلى ${f.endDate}`;
  const doPrint = () => printReportTable(company, "تقرير الكيانات", period,
    ["رقم السند","التاريخ","النوع","أصناف","الإجمالي","طريقة الدفع"],
    txs.map(r => [`#${r.docNo}`, (r.date||"").split("T")[0], r.type, r.itemCount ?? "—", fmtC(r.total), r.payType || "—"]));

  return (
    <Shell title="👤 تقرير الكيانات" desc="كافة تعاملات مورد أو زبون مع إمكانية عرض تفاصيل كل فاتورة" onRun={run} onExport={doExport} onPrint={doPrint} load={load}
      filters={<>
        <DR f={f} setF={setF}/>
        <Lbl label="نوع الطرف"><select value={f.partyType} onChange={e=>setF(p=>({...p,partyType:e.target.value,id_Party:""}))} style={C.sel}><option value="CUSTOMER">زبون</option><option value="SUPPLIER">مورد</option></select></Lbl>
        <Lbl label={f.partyType==="CUSTOMER"?"الزبون":"المورد"}><select value={f.id_Party} onChange={e=>setF(p=>({...p,id_Party:e.target.value}))} style={{...C.sel,minWidth:180}}><option value="">— اختر —</option>{parties.map(p=><option key={p.id_Zabon||p.id_Amil} value={p.id_Zabon||p.id_Amil}>{p[nameKey]}</option>)}</select></Lbl>
      </>}>
      {data?.partyInfo&&(<div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}><Chip l="الطرف" v={data.partyInfo.name}/><Chip l="الحركات" v={data.summary?.txCount}/><Chip l="إجمالي المديونيات" v={fmtC(data.summary?.totalDebit)}/><Chip l="الرصيد الحالي" v={fmtC(data.partyInfo.netBalance)} c={data.partyInfo.netBalance>0?"var(--danger)":"var(--success,#22c55e)"} accent/></div>)}
      <Tbl heads={["رقم السند","التاريخ","النوع","أصناف","الإجمالي","طريقة الدفع","تفاصيل"]} load={load} empty={txs.length===0} emptyMsg={f.id_Party?"لا توجد حركات":"اختر طرفاً ثم اضغط تشغيل"}>
        {txs.map((r,i)=>(<tr key={i} style={{background:i%2===0?"var(--bg-hover)":""}}>
          <td style={{...C.td,fontFamily:"monospace",color:"var(--accent)",fontWeight:700}}>#{r.docNo}</td>
          <td style={{...C.td,fontFamily:"monospace",fontSize:".78rem"}}>{r.date?.split("T")[0]}</td>
          <td style={C.td}><span style={{padding:"2px 8px",borderRadius:10,fontSize:".75rem",fontWeight:700,background:r.type.includes("شراء")||r.type.includes("دفع")?"rgba(239,68,68,.12)":"rgba(34,197,94,.12)",color:r.type.includes("شراء")||r.type.includes("دفع")?"var(--danger)":"var(--success,#22c55e)"}}>{r.type}</span></td>
          <td style={{...C.td,textAlign:"center"}}>{r.itemCount||"—"}</td>
          <td style={{...C.td,fontFamily:"monospace",fontWeight:700,color:"var(--accent)"}}>{fmtC(r.total)}</td>
          <td style={{...C.td,fontSize:".78rem",color:"var(--text-muted)"}}>{r.payType||"—"}</td>
          <td style={C.td}>{["FOUT","FIN","RETERN_C","RETERN_S"].includes(r.docType)&&<button onClick={()=>openModal(r.docType,r.docNo)} style={{...C.btn("ghost"),padding:"3px 10px",fontSize:".76rem"}}>عرض ←</button>}</td>
        </tr>))}
      </Tbl>

      {modal&&(
        <ModalOverlay onClose={()=>setModal(null)} zIndex={2000}>
          <div style={{background:"var(--bg-surface)",border:"1px solid var(--border)",borderRadius:"var(--radius-lg,10px)",padding:22,maxWidth:720,width:"100%",maxHeight:"85vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <h3 style={{margin:0,fontFamily:"monospace",color:"var(--accent)"}}>{modal.docType==="FOUT"?"فاتورة مبيعات":modal.docType==="FIN"?"فاتورة شراء":"سند إرجاع"} #{modal.docNo}</h3>
              <button onClick={()=>setModal(null)} style={{...C.btn("ghost"),padding:"3px 10px"}}>✕</button>
            </div>
            {!modal.data?<div style={{textAlign:"center",padding:30}}><Spin/></div>
            :modal.data.error?<div style={{color:"var(--danger)",padding:16}}>⚠ {modal.data.error}</div>
            :(<>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:16,padding:"10px 12px",background:"var(--bg-card)",borderRadius:"var(--radius-md,8px)"}}>
                {entityModalMeta(modal.docType, modal.data).map((x,i)=>(
                  <div key={i}><div style={{fontSize:".68rem",color:"var(--text-muted)",marginBottom:3}}>{x.l}</div><div style={{fontWeight:700,fontSize:".84rem"}}>{x.v}</div></div>
                ))}
              </div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:".82rem"}}>
                <thead><tr>{["المادة","الكمية","السعر","الإجمالي"].map((h,i)=><th key={i} style={C.th}>{h}</th>)}</tr></thead>
                <tbody>{(modal.data.lines||[]).map((l,i)=>{const qty=l.AmountIN||l.AmountOUT||0;const price=l.PriceIN||l.PriceOUT||0;const lineTotal = modal.docType === "FOUT" ? (qty*price) - 0 : modal.docType === "FIN" ? (qty*price) : -(qty*price);return(<tr key={i} style={{background:i%2===0?"var(--bg-hover)":""}}><td style={C.td}><b>{l.MaterialName}</b></td><td style={{...C.td,fontFamily:"monospace",textAlign:"center"}}>{qty}</td><td style={{...C.td,fontFamily:"monospace"}}>{fmtC(price)}</td><td style={{...C.td,fontFamily:"monospace",fontWeight:700,color:lineTotal<0?"var(--danger)":"var(--accent)"}}>{fmtC(lineTotal)}</td></tr>);})}</tbody>
                <tfoot><tr><td colSpan={3} style={{...C.td,fontWeight:700}}>الإجمالي</td><td style={{...C.td,fontFamily:"monospace",fontWeight:900,color:"var(--accent)"}}>{fmtC(
                  modal.docType === "FOUT"
                    ? (modal.data.lines||[]).reduce((s,l)=>s+(l.AmountOUT||0)*(l.PriceOUT||0),0) - (modal.data.Dis_FOUT||0) + (modal.data.Add_FOUT||0)
                    : modal.docType === "FIN"
                    ? (modal.data.lines||[]).reduce((s,l)=>s+(l.AmountIN||0)*(l.PriceIN||0),0) + (modal.data.Trans||0) + (modal.data.Customs||0) + (modal.data.Porter||0) + (modal.data.SGS||0) + (modal.data.ExportRelease||0) + (modal.data.VehicleManifest||0) - (modal.data.Dis_FIN||0)
                    : - (modal.data.lines||[]).reduce((s,l)=>s+(l.AmountIN||l.AmountOUT||0)*(l.PriceIN||l.PriceOUT||0),0)
                )}</td></tr></tfoot>
              </table>
            </>)}
          </div>
        </ModalOverlay>
      )}
    </Shell>
  );
}

/* ════════════════════════════════════════════════════════
   8- تحليل المواد
════════════════════════════════════════════════════════ */
function MaterialAnalysisReport() {
  const { fmtC, fmtN } = useNumberLocale();
  const { company } = useCompany();
  const [f,setF]=useState({startDate:yearStart(),endDate:today(),id_Material:"",id_Catiguary:""});
  const [mats,setMats]=useState([]);const [cats,setCats]=useState([]);
  const [data,setData]=useState(null);const [load,setLoad]=useState(false);
  useEffect(()=>{api.get("/materials",{params:{limit:1000}}).then(r=>setMats(r?.data||[])).catch(()=>{});api.get("/common/categories").then(r=>setCats(r?.data||[])).catch(()=>{});},[]);
  const run=useCallback(async()=>{setLoad(true);try{const r=await api.get("/reports/material-analysis",{params:f});setData(r);}finally{setLoad(false);}}, [f]);
  useEffect(()=>{run();},[]);
  const items=data?.items||[];
  const doExport=()=>exportExcel("تحليل_المواد","المواد",["الصنف","تصنيف","مخزون","متوسط سعر شراء","سعر بيع","كمية مباعة","صافي الإيراد","تكلفة","ربح"],items.map(r=>[r.MaterialName,r.CatiguaryName||"",r.currentStock,r.avgPurchasePrice,r.lastSellPrice,r.totalSalesQty,r.totalSalesValue,r.totalCost,r.grossProfit]));
  const period = `من ${f.startDate} إلى ${f.endDate}`;
  const doPrint = () => printReportTable(company, "تحليل المواد المخصص", period,
    ["الصنف","تصنيف","مخزون","متوسط سعر شراء","سعر بيع","كمية مباعة","صافي الإيراد","تكلفة","ربح","هامش%"],
    items.map(r => [escHtml(r.MaterialName), escHtml(r.CatiguaryName||"—"), fmtN(r.currentStock), fmtC(r.avgPurchasePrice), fmtC(r.lastSellPrice), fmtN(r.totalSalesQty), fmtC(r.totalSalesValue), fmtC(r.totalCost), fmtC(r.grossProfit), `${r.margin}%`]));
  return (
    <Shell title="🔬 تحليل المواد المخصص" desc="تحليل شامل لمادة أو مجموعة: أسعار، مبيعات، موردون، زبائن" onRun={run} onExport={doExport} onPrint={doPrint} load={load}
      filters={<>
        <DR f={f} setF={setF}/>
        <Lbl label="مادة محددة"><select value={f.id_Material} onChange={e=>setF(p=>({...p,id_Material:e.target.value,id_Catiguary:""}))} style={{...C.sel,minWidth:180}}><option value="">الكل</option>{mats.map(m=><option key={m.id_Material_NoM} value={m.id_Material_NoM}>{m.MaterialName}</option>)}</select></Lbl>
        <Lbl label="أو: تصنيف"><select value={f.id_Catiguary} onChange={e=>setF(p=>({...p,id_Catiguary:e.target.value,id_Material:""}))} style={{...C.sel,minWidth:150}}><option value="">الكل</option>{cats.map(c=><option key={c.id_Catiguary} value={c.id_Catiguary}>{c.CatiguaryName}</option>)}</select></Lbl>
      </>}>
      {data?.totals&&(<div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}><Chip l="أصناف" v={data.totals.items}/><Chip l="صافي الإيراد" v={fmtC(data.totals.totalSalesValue)}/><Chip l="إجمالي الربح" v={fmtC(data.totals.totalGrossProfit)} accent c={data.totals.totalGrossProfit>=0?"var(--success,#22c55e)":"var(--danger)"}/></div>)}
      <Tbl heads={["الصنف","تصنيف","مخزون","متوسط سعر شراء","سعر بيع","كمية مباعة","صافي الإيراد","تكلفة","ربح","هامش%"]} load={load} empty={items.length===0}>
        {items.map((r,i)=>(<tr key={r.id_Material_NoM} style={{background:i%2===0?"var(--bg-hover)":""}}>
          <td style={C.td}><b>{r.MaterialName}</b></td>
          <td style={{...C.td,fontSize:".78rem",color:"var(--text-muted)"}}>{r.CatiguaryName||"—"}</td>
          <td style={{...C.td,fontFamily:"monospace",color:r.currentStock>0?"var(--accent)":"var(--danger)"}}>{fmtN(r.currentStock)}</td>
          <td style={{...C.td,fontFamily:"monospace",color:"var(--warning,#f59e0b)"}}>{fmtC(r.avgPurchasePrice)}</td>
          <td style={{...C.td,fontFamily:"monospace"}}>{fmtC(r.lastSellPrice)}</td>
          <td style={{...C.td,fontFamily:"monospace"}}>{fmtN(r.totalSalesQty)}</td>
          <td style={{...C.td,fontFamily:"monospace",fontWeight:700,color:"var(--accent)"}}>{fmtC(r.totalSalesValue)}</td>
          <td style={{...C.td,fontFamily:"monospace",color:"var(--warning,#f59e0b)"}}>{fmtC(r.totalCost)}</td>
          <td style={{...C.td,fontFamily:"monospace",fontWeight:700,color:r.grossProfit>=0?"var(--success,#22c55e)":"var(--danger)"}}>{fmtC(r.grossProfit)}</td>
          <td style={{...C.td,fontFamily:"monospace"}}>{r.margin}%</td>
        </tr>))}
      </Tbl>
    </Shell>
  );
}

/* ════════════════════════════════════════════════════════
   9- أداء المندوبين
════════════════════════════════════════════════════════ */
function SalesmenReport() {
  const { fmtC } = useNumberLocale();
  const { company } = useCompany();
  const [f,setF]=useState({startDate:yearStart(),endDate:today(),commissionRate:"2",collectionCommissionRate:"0"});
  const [data,setData]=useState(null);const [load,setLoad]=useState(false);
  const run=useCallback(async()=>{setLoad(true);try{const r=await api.get("/reports/salesmen-performance",{params:f});setData(r);}finally{setLoad(false);}}, [f]);
  useEffect(()=>{run();},[]);
  const reps=data?.reps||[];
  const doExport=()=>exportExcel("أداء_المندوبين","المندوبين",["المندوب","فواتير","زبائن","صافي مبيعات","مرتجعات","صافي بعد مرتجعات","مُحصَّل","عمولة مبيعات","عمولة تحصيل","العمولة الكلية"],reps.map(r=>[r.MandobName,r.invoiceCount,r.customerCount,r.netSales,r.returnValue,r.netAfterReturns,r.collected,r.salesCommission,r.collectionCommission,r.totalCommission]));
  const period = `من ${f.startDate} إلى ${f.endDate}`;
  const doPrint = () => printReportTable(company, "أداء المندوبين والعمولات", period,
    ["المندوب","فواتير","زبائن","صافي مبيعات","مرتجعات","صافي بعد مرتجعات","مُحصَّل","عمولة مبيعات","عمولة تحصيل","العمولة الكلية","الحصة%"],
    reps.map(r => [escHtml(r.MandobName), r.invoiceCount, r.customerCount, fmtC(r.netSales), fmtC(r.returnValue), fmtC(r.netAfterReturns), fmtC(r.collected), fmtC(r.salesCommission), fmtC(r.collectionCommission), fmtC(r.totalCommission), `${r.sharePct ?? ""}%`]));
  const CB=({rate})=>{const p=parseFloat(rate)||0;return(<div style={{display:"flex",alignItems:"center",gap:6}}><div style={{flex:1,height:6,background:"var(--border)",borderRadius:3,overflow:"hidden"}}><div style={{width:`${Math.min(p,100)}%`,height:"100%",background:p>=80?"var(--success,#22c55e)":p>=50?"var(--warning,#f59e0b)":"var(--danger)"}}/></div><span style={{fontFamily:"monospace",fontSize:".76rem",fontWeight:700,minWidth:42,color:p>=80?"var(--success,#22c55e)":p>=50?"var(--warning,#f59e0b)":"var(--danger)"}}>{rate}</span></div>);};
  return (
    <Shell title="🏅 أداء المندوبين والعمولات" desc="صافي مبيعات = إيراد كلي − خصم + إضافة — عمولة المبيعات + عمولة التحصيل" onRun={run} onExport={doExport} onPrint={doPrint} load={load}
      filters={<><DR f={f} setF={setF}/><Lbl label="نسبة عمولة المبيعات %"><input type="number" min="0" max="100" step="0.5" value={f.commissionRate} onChange={e=>setF(p=>({...p,commissionRate:e.target.value}))} style={{...C.inp,width:80}}/></Lbl><Lbl label="نسبة عمولة التحصيل %"><input type="number" min="0" max="100" step="0.5" value={f.collectionCommissionRate} onChange={e=>setF(p=>({...p,collectionCommissionRate:e.target.value}))} style={{...C.inp,width:80}}/></Lbl></>}>
      {data?.summary&&(<div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}><Chip l="مندوبين" v={data.summary.totalReps}/><Chip l="صافي المبيعات" v={fmtC(data.summary.totalNet)}/><Chip l="إجمالي المحصَّل" v={fmtC(data.summary.totalCollected)} c="var(--success,#22c55e)"/><Chip l="عمولات مبيعات" v={fmtC(data.summary.totalSalesCommission)} accent/><Chip l="عمولات تحصيل" v={fmtC(data.summary.totalCollectionCommission)} c="var(--info,#3b82f6)"/><Chip l="العمولة الكلية" v={fmtC(data.summary.totalCommission)} accent/></div>)}
      <Tbl heads={["المندوب","فواتير","زبائن","صافي مبيعات","مرتجعات","صافي بعد مرتجعات","مُحصَّل","نسبة التحصيل","عمولة مبيعات","عمولة تحصيل","العمولة الكلية","الحصة%"]} load={load} empty={reps.length===0}>
        {reps.map((r,i)=>(<tr key={r.id_Mandob} style={{background:i%2===0?"var(--bg-hover)":""}}>
          <td style={{...C.td,fontWeight:700}}>{r.MandobName}</td>
          <td style={{...C.td,textAlign:"center"}}>{r.invoiceCount}</td>
          <td style={{...C.td,textAlign:"center"}}>{r.customerCount}</td>
          <td style={{...C.td,fontFamily:"monospace",fontWeight:700}}>{fmtC(r.netSales)}</td>
          <td style={{...C.td,fontFamily:"monospace",color:"var(--warning,#f59e0b)"}}>{fmtC(r.returnValue)}</td>
          <td style={{...C.td,fontFamily:"monospace",fontWeight:700,color:"var(--accent)"}}>{fmtC(r.netAfterReturns)}</td>
          <td style={{...C.td,fontFamily:"monospace",color:"var(--success,#22c55e)"}}>{fmtC(r.collected)}</td>
          <td style={{...C.td,minWidth:130}}><CB rate={r.collectionRate}/></td>
          <td style={{...C.td,fontFamily:"monospace",color:"var(--accent)"}}>{fmtC(r.salesCommission)}</td>
          <td style={{...C.td,fontFamily:"monospace",color:"var(--info,#3b82f6)"}}>{fmtC(r.collectionCommission)}</td>
          <td style={{...C.td,fontFamily:"monospace",fontWeight:900,color:"var(--accent)"}}>{fmtC(r.totalCommission)}</td>
          <td style={{...C.td,fontFamily:"monospace",color:"var(--text-muted)"}}>{r.sharePct}</td>
        </tr>))}
      </Tbl>
    </Shell>
  );
}

/* ════════════════════════════════════════════════════════
   10- حركة الصندوق
════════════════════════════════════════════════════════ */
function CashFlowReport() {
  const { fmtC } = useNumberLocale();
  const { company } = useCompany();
  const [f,setF]=useState({startDate:yearStart(),endDate:today()});
  const [data,setData]=useState(null);const [load,setLoad]=useState(false);
  const run=useCallback(async()=>{setLoad(true);try{const r=await api.get("/reports/cash-flow-detailed",{params:f});setData(r);}finally{setLoad(false);}}, [f]);
  useEffect(()=>{run();},[]);
  const txs=data?.transactions||[];
  const doExport=()=>exportExcel("حركة_الصندوق","الصندوق",["التاريخ","النوع","الطرف","المبلغ","الرصيد الجاري"],txs.map(r=>[r.date,r.type,r.party||"",r.amount,r.balance]));
  const period = `من ${f.startDate} إلى ${f.endDate}`;
  const doPrint = () => printReportTable(company, "حركة الصندوق التفصيلية", period,
    ["التاريخ","النوع","الطرف","المبلغ","الرصيد الجاري","ملاحظة"],
    txs.map(r => [(r.date||"").split("T")[0], r.type, r.party || "—", `${r.dir === "IN" ? "+" : "-"} ${fmtC(r.amount)}`, fmtC(r.balance), r.note || "—"]));
  return (
    <Shell title="💵 حركة الصندوق التفصيلية" desc="كل فلس دخل أو خرج مع الرصيد الافتتاحي والجاري" onRun={run} onExport={doExport} onPrint={doPrint} load={load} filters={<DR f={f} setF={setF}/>}>
      {data?.summary&&(<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginBottom:14}}>
        {[{l:"رصيد افتتاحي",v:fmtC(data.summary.openingBalance),c:"var(--text-primary)"},{l:"إجمالي الداخل",v:fmtC(data.summary.totalIn),c:"var(--success,#22c55e)"},{l:"إجمالي الخارج",v:fmtC(data.summary.totalOut),c:"var(--danger)"},{l:"رصيد ختامي",v:fmtC(data.summary.closingBalance),c:data.summary.closingBalance>=0?"var(--accent)":"var(--danger)"}].map((x,i)=><Chip key={i} l={x.l} v={x.v} c={x.c} accent={i===3}/>)}
      </div>)}
      <Tbl heads={["التاريخ","النوع","الطرف","المبلغ","الرصيد الجاري","ملاحظة"]} load={load} empty={txs.length===0}>
        {txs.map((r,i)=>(<tr key={i} style={{background:i%2===0?"var(--bg-hover)":""}}>
          <td style={{...C.td,fontFamily:"monospace",fontSize:".78rem"}}>{r.date?.split("T")[0]}</td>
          <td style={C.td}><span style={{padding:"2px 8px",borderRadius:10,fontSize:".75rem",fontWeight:700,background:r.dir==="IN"?"rgba(34,197,94,.12)":"rgba(239,68,68,.12)",color:r.dir==="IN"?"var(--success,#22c55e)":"var(--danger)"}}>{r.dir==="IN"?"▲":"▼"} {r.type}</span></td>
          <td style={{...C.td,fontSize:".82rem"}}>{r.party||"—"}</td>
          <td style={{...C.td,fontFamily:"monospace",fontWeight:700,color:r.dir==="IN"?"var(--success,#22c55e)":"var(--danger)"}}>{r.dir==="IN"?"+":"-"} {fmtC(r.amount)}</td>
          <td style={{...C.td,fontFamily:"monospace",fontWeight:900,color:r.balance>=0?"var(--accent)":"var(--danger)"}}>{fmtC(r.balance)}</td>
          <td style={{...C.td,fontSize:".78rem",color:"var(--text-muted)"}}>{r.note||"—"}</td>
        </tr>))}
      </Tbl>
    </Shell>
  );
}

/* ════════════════════════════════════════════════════════
   11- صافي الربح
════════════════════════════════════════════════════════ */
function ProfitReport() {
  const { fmtC } = useNumberLocale();
  const { company } = useCompany();
  const [f,setF]=useState({startDate:yearStart(),endDate:today()});
  const [data,setData]=useState(null);const [load,setLoad]=useState(false);
  const [cogsOpen,setCogsOpen]=useState(false);
  const run=useCallback(async()=>{setLoad(true);try{const r=await api.get("/reports/profit-report",{params:f});setData(r);}finally{setLoad(false);}}, [f]);
  useEffect(()=>{run();},[]);
  const Row=({l,v,c,bold,minus})=>(<div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid var(--border-subtle)"}}><span style={{fontSize:bold?".9rem":".84rem",fontWeight:bold?800:500,color:"var(--text-secondary)"}}>{l}</span><span style={{fontFamily:"monospace",fontWeight:bold?900:600,color:c||"var(--text-primary)"}}>{minus?"− ":""}{v}</span></div>);
  const period = `من ${f.startDate} إلى ${f.endDate}`;
  const doExport = () => {
    if (!data) return;
    exportExcel("صافي_الربح", "الربح", ["البند", "القيمة"], [
      ["إيراد إجمالي", data.revenue.grossRevenue],
      ["خصومات", data.revenue.discounts],
      ["مرتجعات مبيعات", data.revenue.salesReturns],
      ["صافي الإيراد", data.revenue.netRevenue],
      ["COGS", data.costs.cogs],
      ["− COGS مرتجعات", data.costs.cogsReturns],
      ["COGS صافي", data.costs.totalCOGS],
      ["ربح إجمالي", data.costs.grossProfit],
      ...(data.expenses.breakdown || []).map(s => [s.cat, -s.amount]),
      ["إجمالي المصاريف", -data.expenses.total],
      ["صافي الربح", data.netProfit.value],
    ]);
  };
  const doPrint = () => {
    if (!data) return alert("لا توجد بيانات للطباعة");
    printReportTable(company, "تقرير صافي الربح الحقيقي", period, ["البند", "القيمة"], [
      ["إيراد إجمالي", fmtC(data.revenue.grossRevenue)],
      ["− الخصومات", fmtC(data.revenue.discounts)],
      ["− مرتجعات مبيعات", fmtC(data.revenue.salesReturns)],
      ["صافي الإيراد", fmtC(data.revenue.netRevenue)],
      ["− COGS", fmtC(data.costs.cogs)],
      ["− COGS مرتجعات", fmtC(data.costs.cogsReturns)],
            [`الربح الإجمالي (${data.costs.grossMargin}%)`, fmtC(data.costs.grossProfit)],
      ...(data.expenses.breakdown || []).map(s => [`− ${s.cat}`, fmtC(s.amount)]),
      ["− إجمالي المصاريف", fmtC(data.expenses.total)],
      ["صافي الربح", fmtC(data.netProfit.value)],
    ]);
  };
  return (
    <Shell title="📈 تقرير صافي الربح الحقيقي" desc="إيراد صافي − COGS − مصاريف = صافي الربح" onRun={run} onExport={doExport} onPrint={doPrint} load={load} filters={<DR f={f} setF={setF}/>}>
      {data&&(<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
        <div style={C.card}>
          <div style={{fontWeight:800,color:"var(--success,#22c55e)",marginBottom:10}}>💹 الإيرادات</div>
          <Row l="إيراد إجمالي"       v={fmtC(data.revenue.grossRevenue)}/>
          <Row l="− الخصومات"         v={fmtC(data.revenue.discounts)} c="var(--danger)" minus/>
          <Row l="− مرتجعات مبيعات"   v={fmtC(data.revenue.salesReturns)} c="var(--danger)" minus/>
          <Row l="صافي الإيراد"       v={fmtC(data.revenue.netRevenue)} c="var(--accent)" bold/>
        </div>
        <div style={{...C.card,cursor:"pointer"}} onClick={()=>setCogsOpen(true)} title="اضغط لعرض تفاصيل COGS لكل مادة">
          <div style={{fontWeight:800,color:"var(--warning,#f59e0b)",marginBottom:10,display:"flex",justifyContent:"space-between",gap:8}}>
            <span>📦 التكاليف (COGS)</span>
            <span style={{fontSize:".72rem",color:"var(--accent)"}}>تفاصيل ←</span>
          </div>
          <Row l="تكلفة البضاعة المباعة" v={fmtC(data.costs.cogs)} c="var(--danger)" minus/>
          <Row l="− COGS مرتجعات مبيعات" v={fmtC(data.costs.cogsReturns)} c="var(--success,#22c55e)"/>
          <Row l={`الربح الإجمالي (${data.costs.grossMargin}%)`} v={fmtC(data.costs.grossProfit)} c={data.costs.grossProfit>=0?"var(--success,#22c55e)":"var(--danger)"} bold/>
        </div>
        <div style={C.card}>
          <div style={{fontWeight:800,color:"var(--danger)",marginBottom:10}}>💸 المصاريف والخسائر</div>
          {(data.expenses.breakdown||[]).map((s,i)=><Row key={i} l={s.cat} v={fmtC(s.amount)} c="var(--danger)" minus/>)}
          <Row l="إجمالي المصاريف" v={fmtC(data.expenses.total)} c="var(--danger)" minus/>
          {(data.expiredLoss?.total || 0) > 0 && (
            <Row l="خسارة تشطيب الصلاحية" v={fmtC(data.expiredLoss.total)} c="var(--danger)" bold minus/>
          )}
        </div>
        <div style={{...C.card,background:data.netProfit.value>=0?"rgba(34,197,94,.06)":"rgba(239,68,68,.06)",border:`2px solid ${data.netProfit.value>=0?"rgba(34,197,94,.3)":"rgba(239,68,68,.3)"}`}}>
          <div style={{fontWeight:800,fontSize:"1rem",marginBottom:14}}>🎯 النتيجة الإجمالية</div>
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <div style={{fontSize:"2rem",fontWeight:900,fontFamily:"monospace",color:data.netProfit.value>=0?"var(--success,#22c55e)":"var(--danger)"}}>{fmtC(Math.abs(data.netProfit.value))}</div>
            <div style={{fontSize:".9rem",color:"var(--text-secondary)",marginTop:6}}>{data.netProfit.status}</div>
            <div style={{fontSize:".82rem",color:"var(--text-muted)",marginTop:4}}>هامش صافي: {data.netProfit.netMargin}%</div>
          </div>
          <Row l="الفواتير الصادرة" v={`${data.invoiceCount} فاتورة`}/>
        </div>
        {cogsOpen&&(
          <ModalOverlay onClose={()=>setCogsOpen(false)} zIndex={2100}>
            <div style={{background:"var(--bg-surface)",border:"1px solid var(--border)",borderRadius:"var(--radius-lg,10px)",padding:22,maxWidth:980,width:"100%",maxHeight:"85vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,marginBottom:14}}>
                <div>
                  <h3 style={{margin:"0 0 4px",color:"var(--accent)"}}>تفاصيل تكاليف COGS</h3>
                  <div style={{fontSize:".8rem",color:"var(--text-muted)"}}>من {f.startDate} إلى {f.endDate}</div>
                </div>
                <button onClick={()=>setCogsOpen(false)} style={{...C.btn("ghost"),padding:"3px 10px"}}>✕</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,marginBottom:14}}>
                <Chip l="تكلفة البضاعة المباعة" v={fmtC(data.costs.cogs)} c="var(--danger)"/>
                <Chip l="مرتجع مبيعات COGS" v={fmtC(data.costs.cogsReturns)} c="var(--success,#22c55e)"/>
                <Chip l="COGS صافي" v={fmtC(data.costs.totalCOGS)} accent/>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:".82rem"}}>
                  <thead>
                    <tr>
                      {["المادة","الوحدة","تكلفة الوحدة","كمية مباعة","تكلفة البضاعة المباعة","كمية مرتجع مبيعات","مرتجع مبيعات COGS","COGS صافي"].map((h,i)=><th key={i} style={C.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {(data.costs.details||[]).map((r,i)=>(
                      <tr key={r.id_Material_NoM||i} style={{background:i%2===0?"var(--bg-hover)":""}}>
                        <td style={C.td}><b>{r.MaterialName}</b></td>
                        <td style={{...C.td,color:"var(--text-muted)"}}>{r.Band||"—"}</td>
                        <td style={{...C.td,fontFamily:"monospace"}}>{fmtC(r.costPrice)}</td>
                        <td style={{...C.td,fontFamily:"monospace",textAlign:"center"}}>{r.soldQty}</td>
                        <td style={{...C.td,fontFamily:"monospace",fontWeight:700,color:"var(--danger)"}}>{fmtC(r.soldCost)}</td>
                        <td style={{...C.td,fontFamily:"monospace",textAlign:"center"}}>{r.returnQty}</td>
                        <td style={{...C.td,fontFamily:"monospace",fontWeight:700,color:"var(--success,#22c55e)"}}>{fmtC(r.returnCost)}</td>
                        <td style={{...C.td,fontFamily:"monospace",fontWeight:900,color:"var(--accent)"}}>{fmtC(r.netCost)}</td>
                      </tr>
                    ))}
                    {!(data.costs.details||[]).length&&(
                      <tr><td colSpan={8} style={{...C.td,textAlign:"center",color:"var(--text-muted)",padding:24}}>لا توجد تفاصيل COGS في هذه الفترة</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </ModalOverlay>
        )}
      </div>)}
    </Shell>
  );
}

/* ════════════════════════════════════════════════════════
   12- تنبيه المخزون
════════════════════════════════════════════════════════ */
function ReorderAlertReport() {
  const { fmtC, fmtN } = useNumberLocale();
  const { company } = useCompany();
  const TH_KEY = "wms_stock_alert_threshold";
  const [f,setF]=useState(()=>({
    threshold: String(Number(localStorage.getItem(TH_KEY)) || 5),
  }));
  const [data,setData]=useState(null);const [load,setLoad]=useState(false);
  const run=useCallback(async()=>{setLoad(true);try{const r=await api.get("/reports/reorder-alert",{params:f});setData(r);}finally{setLoad(false);}}, [f]);
  useEffect(()=>{run();},[run]);
  const onThreshold=(v)=>{
    const n=Math.max(1, Number(v)||5);
    const s=String(n);
    setF({threshold:s});
    localStorage.setItem(TH_KEY, s);
    window.dispatchEvent(new Event("wms-stock-threshold"));
  };
  const items=data?.items||[];
  const doExport=()=>exportExcel("تنبيه_المخزون","التنبيه",["الصنف","مخزون","الحالة","أيام تغطية","آخر مورد","آخر سعر شراء"],items.map(r=>[r.MaterialName,r.currentStock,r.urgency,r.daysOfStock||"",r.lastSupplier||"",r.lastPurchasePrice]));
  const doPrint = () => printReportTable(company, "تنبيه المخزون المنخفض", `حد التنبيه: أقل من ${f.threshold}`,
    ["الصنف","التصنيف","الباركود","مخزون حالي","الحالة","أيام التغطية","آخر مورد","آخر سعر شراء","متوسط مبيعات/يوم"],
    items.map(r => [escHtml(r.MaterialName), escHtml(r.CatiguaryName||"—"), r.Barcode||"—", fmtN(r.currentStock), r.urgency, r.daysOfStock != null ? `${fmtN(r.daysOfStock)} يوم` : "—", r.lastSupplier||"—", fmtC(r.lastPurchasePrice), r.avgDailySales > 0 ? fmtN(r.avgDailySales) : "—"]));
  const UB=({u})=>{const m={نفد:["rgba(220,38,38,.15)","var(--danger)"],حرج:["rgba(234,88,12,.15)","#ea580c"],منخفض:["rgba(202,138,4,.12)","#ca8a04"]};const[bg,fg]=m[u]||["var(--bg-hover)","var(--text-muted)"];return<span style={{padding:"2px 8px",borderRadius:10,fontSize:".74rem",fontWeight:700,background:bg,color:fg}}>{u}</span>;};
  return (
    <Shell title="🔔 تنبيه المخزون المنخفض" desc="الأصناف التي وصلت أو اقتربت من مستوى إعادة الطلب" onRun={run} onExport={doExport} onPrint={doPrint} load={load}
      filters={<Lbl label="حد التنبيه — أقل من (كمية)"><input type="number" min="1" value={f.threshold} onChange={e=>onThreshold(e.target.value)} style={{...C.inp,width:90}}/></Lbl>}>
      {data?.summary&&(<div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}><Chip l="إجمالي المنبّهة" v={data.summary.total}/><Chip l="نفد من المخزون" v={data.summary.outOfStock} c="var(--danger)"/><Chip l="حالة حرجة" v={data.summary.critical} c="#ea580c"/></div>)}
      <Tbl heads={["الصنف","التصنيف","الباركود","مخزون حالي","الحالة","أيام التغطية","آخر مورد","آخر سعر شراء","متوسط مبيعات/يوم"]} load={load} empty={items.length===0} emptyMsg="لا توجد أصناف تحت حد التنبيه 🎉">
        {items.map((r,i)=>(<tr key={r.id_Material_NoM} style={{background:r.urgency==="نفد"?"rgba(220,38,38,.06)":r.urgency==="حرج"?"rgba(234,88,12,.05)":i%2===0?"var(--bg-hover)":""}}>
          <td style={C.td}><b>{r.MaterialName}</b></td>
          <td style={{...C.td,fontSize:".78rem",color:"var(--text-muted)"}}>{r.CatiguaryName||"—"}</td>
          <td style={{...C.td,fontFamily:"monospace",fontSize:".76rem",color:"var(--accent)"}}>{r.Barcode||"—"}</td>
          <td style={{...C.td,fontFamily:"monospace",fontWeight:900,color:r.currentStock<=0?"var(--danger)":r.currentStock<=2?"#ea580c":"var(--warning,#f59e0b)"}}>{fmtN(r.currentStock)}</td>
          <td style={C.td}><UB u={r.urgency}/></td>
          <td style={{...C.td,fontFamily:"monospace",color:r.daysOfStock!=null&&r.daysOfStock<=7?"var(--danger)":"var(--text-secondary)"}}>{r.daysOfStock!=null?`${fmtN(r.daysOfStock)} يوم`:"—"}</td>
          <td style={{...C.td,fontSize:".82rem"}}>{r.lastSupplier||"—"}</td>
          <td style={{...C.td,fontFamily:"monospace",color:"var(--warning,#f59e0b)"}}>{fmtC(r.lastPurchasePrice)}</td>
          <td style={{...C.td,fontFamily:"monospace"}}>{r.avgDailySales>0?fmtN(r.avgDailySales):"—"}</td>
        </tr>))}
      </Tbl>
    </Shell>
  );
}

/* ════════════════════════════════════════════════════════
   13- نقل مخزني بين المستودعات
════════════════════════════════════════════════════════ */
function WarehouseTransfersReport() {
  const { fmtN } = useNumberLocale();
  const { company } = useCompany();
  const [f, setF] = useState({ startDate: yearStart(), endDate: today() });
  const [data, setData] = useState(null);
  const [load, setLoad] = useState(false);
  const run = useCallback(async () => {
    setLoad(true);
    try {
      const r = await api.get("/reports/warehouse-transfers", { params: f });
      setData(r);
    } finally { setLoad(false); }
  }, [f]);
  useEffect(() => { run(); }, []);
  const items = data?.items || [];
  const doExport = () => exportExcel("نقل_المستودعات", "النقل",
    ["إذن#", "التاريخ", "من", "إلى", "المادة", "الكمية", "ملاحظة"],
    items.map(r => [r.id, r.date, r.fromName, r.toName, r.MaterialName, r.qty, r.note || ""])
  );
  const period = `من ${f.startDate} إلى ${f.endDate}`;
  const doPrint = () => printReportTable(company, "نقل مخزني بين المستودعات", period,
    ["إذن#", "التاريخ", "من مستودع", "إلى مستودع", "المادة", "الكمية", "ملاحظة"],
    items.map(r => [`#${r.id}`, r.date, escHtml(r.fromName), escHtml(r.toName), escHtml(r.MaterialName), fmtN(r.qty), r.note || "—"]));
  return (
    <Shell title="🚚 نقل مخزني بين المستودعات" desc="حركات النقل بين المستودعات ضمن الفترة المحددة"
      onRun={run} onExport={doExport} onPrint={doPrint} load={load} filters={<DR f={f} setF={setF} />}>
      {data?.summary && (
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <Chip l="عدد الأذونات" v={data.summary.transferCount} />
          <Chip l="عدد الأسطر" v={data.summary.lineCount} />
          <Chip l="إجمالي الكميات" v={fmtN(data.summary.totalQty)} accent />
        </div>
      )}
      <Tbl heads={["إذن#", "التاريخ", "من مستودع", "إلى مستودع", "المادة", "الكمية", "ملاحظة"]}
        load={load} empty={items.length === 0}>
        {items.map((r, i) => (
          <tr key={`${r.id}-${r.id_Material_NoM}-${i}`} style={{ background: i % 2 === 0 ? "var(--bg-hover)" : "" }}>
            <td style={{ ...C.td, fontFamily: "monospace", fontWeight: 700, color: "var(--accent)" }}>#{r.id}</td>
            <td style={{ ...C.td, fontFamily: "monospace", fontSize: ".78rem" }}>{r.date}</td>
            <td style={C.td}>{r.fromName}</td>
            <td style={C.td}>{r.toName}</td>
            <td style={C.td}><b>{r.MaterialName}</b>{r.Band ? ` (${r.Band})` : ""}</td>
            <td style={{ ...C.td, fontFamily: "monospace", fontWeight: 700 }}>{fmtN(r.qty)}</td>
            <td style={{ ...C.td, fontSize: ".78rem", color: "var(--text-muted)" }}>{r.note || "—"}</td>
          </tr>
        ))}
      </Tbl>
    </Shell>
  );
}

/* ════════════════════════════════════════════════════════
   فواتير مبيعات مستحقة التسديد (حسب أيام مضت)
════════════════════════════════════════════════════════ */
function OverdueSalesInvoicesReport() {
  const { fmtC, fmtN } = useNumberLocale();
  const { company } = useCompany();
  const [f, setF] = useState({ startDate: yearStart(), endDate: today(), id_PayType: "" });
  const [data, setData] = useState(null);
  const [load, setLoad] = useState(false);
  const [payTypes, setPayTypes] = useState([]);

  useEffect(() => {
    commonService.getPayTypes()
      .then((r) => setPayTypes(r?.data || []))
      .catch(() => setPayTypes([]));
  }, []);

  const run = useCallback(async () => {
    setLoad(true);
    try {
      const params = { startDate: f.startDate, endDate: f.endDate };
      if (f.id_PayType) params.id_PayType = f.id_PayType;
      const r = await api.get("/reports/overdue-sales-invoices", { params });
      setData(r);
    } finally {
      setLoad(false);
    }
  }, [f]);

  useEffect(() => { run(); }, []);

  const items = data?.items || [];
  const byMandob = data?.byMandob || [];

  const doExport = () => exportExcel(
    `فواتير_مستحقة_${f.startDate}_${f.endDate}`,
    "مستحقة",
    ["رقم الفاتورة", "التاريخ", "الزبون", "المندوب", "الدفع", "الإجمالي", "أيام مضت"],
    items.map((r) => [
      r.id_NoFOUT, r.Date_FOUT, r.ZabonName || "", r.MandobName || "",
      r.PayTypeName || "", r.invoiceTotal, r.daysPassed,
    ])
  );

  const doPrint = () => {
    printReportTable(
      company,
      "فواتير مبيعات مستحقة التسديد",
      `من ${f.startDate} إلى ${f.endDate}`,
      ["فاتورة", "التاريخ", "الزبون", "المندوب", "الإجمالي", "أيام"],
      items.map((r) => [
        `#${r.id_NoFOUT}`,
        r.Date_FOUT,
        escHtml(r.ZabonName || "—"),
        escHtml(r.MandobName || "—"),
        fmtC(r.invoiceTotal),
        r.daysPassed,
      ])
    );
  };

  return (
    <Shell
      title="📋 فواتير مستحقة التسديد"
      desc="فواتير المبيعات ضمن نطاق التاريخ — مع فلتر اختياري لطريقة الدفع"
      onRun={run}
      onExport={doExport}
      onPrint={doPrint}
      load={load}
      filters={
        <>
          <DR f={f} setF={setF} />
          <Lbl label="طريقة الدفع">
            <select
              value={f.id_PayType}
              onChange={(e) => setF((p) => ({ ...p, id_PayType: e.target.value }))}
              style={C.sel}
            >
              <option value="">الكل (افتراضي)</option>
              {payTypes.map((p) => (
                <option key={p.id_PayType} value={p.id_PayType}>{p.PayTypeName}</option>
              ))}
            </select>
          </Lbl>
        </>
      }
    >
      {data?.summary && (
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <Chip l="فواتير مستحقة" v={data.summary.invoiceCount} accent />
          <Chip l="إجمالي القيمة" v={fmtC(data.summary.totalValue)} c="var(--warning,#f59e0b)" />
          <Chip l="مناديب" v={data.summary.mandobCount} />
        </div>
      )}

      {byMandob.length > 0 && (
        <div style={{ marginBottom: 14, padding: "10px 12px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
          <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>ملخص حسب المندوب</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {byMandob.map((m) => (
              <span key={m.mandobName} style={{ fontSize: ".8rem", padding: "4px 10px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6 }}>
                <b>{m.mandobName}</b> — {m.count} فاتورة — {fmtC(m.total)}
              </span>
            ))}
          </div>
        </div>
      )}

      <Tbl
        heads={["رقم الفاتورة", "التاريخ", "الزبون", "المندوب", "طريقة الدفع", "الإجمالي", "أيام مضت"]}
        load={load}
        empty={items.length === 0}
      >
        {items.map((r, i) => (
          <tr key={r.id_NoFOUT} style={{ background: i % 2 === 0 ? "var(--bg-hover)" : "" }}>
            <td style={{ ...C.td, fontFamily: "monospace", fontWeight: 700, color: "var(--accent)" }}>#{r.id_NoFOUT}</td>
            <td style={{ ...C.td, fontFamily: "monospace", fontSize: ".78rem" }}>{r.Date_FOUT}</td>
            <td style={C.td}>{r.ZabonName || "—"}</td>
            <td style={C.td}>{r.MandobName || "—"}</td>
            <td style={{ ...C.td, fontSize: ".78rem" }}>{r.PayTypeName || "—"}</td>
            <td style={{ ...C.td, fontFamily: "monospace", fontWeight: 700 }}>{fmtC(r.invoiceTotal)}</td>
            <td style={{ ...C.td, fontFamily: "monospace", fontWeight: 900, color: r.daysPassed >= 60 ? "var(--danger)" : "var(--warning,#f59e0b)" }}>
              {fmtN(r.daysPassed)}
            </td>
          </tr>
        ))}
      </Tbl>
    </Shell>
  );
}

export { WarehouseTransfersReport, OverdueSalesInvoicesReport };
