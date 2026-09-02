// ============================================================
//  src/pages/inventory/InventoryDashboard.jsx
//  لوحة تحكم المخزون
//  ✅ الـ interceptor يرجع response.data مباشرة
//     لذا: data = { success, data: {...} }
//     و kpi = data?.data || {}
// ============================================================
import { useState, useEffect, useMemo } from "react";
import { useApi }  from "../../hooks/useApi";
import api         from "../../services/api";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { r2, fmt, fmtN, fmtC, fmtDate } from "@/utils/numFormat";
import { openReportPrint } from "@/utils/invoicePrint";
import { useCompany } from "@/context/CompanyContext";
import { printTableReport, exportTableExcel, ExportPrintBar } from "@/utils/tableReportTools";
import { WarehouseTransfersReport } from "@/pages/reports/ReportsPage";


const COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#f97316","#84cc16"];

// ── Fetchers ───────────────────────────────────────────────
const fetchKPIs       = () => api.get("/inventory/kpis");
const fetchTopSelling = () => api.get("/inventory/top-selling");
const fetchByCategory = () => api.get("/inventory/by-category");
const fetchLowStock   = () => api.get("/inventory/low-stock");

const STOCK_HEADERS = ["#", "المادة", "الباركود", "الصنف", "الوحدة", "الكمية", "سعر الشراء", "تكلفة المخزون", "سعر البيع"];

function mapStockExportRows(items) {
  return items.map((m, i) => [
    i + 1,
    m.MaterialName || "—",
    m.Barcode || "—",
    m.CatiguaryName || "—",
    m.Band || "—",
    fmtN(m.QuantityOnHand),
    fmtC(m.CostPrice),
    fmtC(r2((+m.QuantityOnHand || 0) * (+m.CostPrice || 0))),
    fmtC(m.LastSellPrice),
  ]);
}

async function fetchAllStock(params = {}) {
  const r = await api.get("/inventory/stock", { params: { page: 1, limit: 10000, ...params } });
  return r?.data || [];
}

async function fetchAllWarehouseStock(warehouseId, q) {
  const r = await api.get("/inventory/by-warehouse", { params: { warehouseId, q: q || "", page: 1, limit: 10000 } });
  return r?.data || [];
}

// ============================================================
const INV_TABS = [
  { id: "dashboard",           label: "📦 لوحة المخزون" },
  { id: "by-warehouse",        label: "🏭 المخزون حسب المستودع" },
  { id: "warehouse-transfers", label: "🚚 نقل المستودعات" },
];

export default function InventoryDashboard() {
  const { locale } = useNumberLocale(); // locale متاح للمكوّن الرئيسي
  const { company } = useCompany();
  const [invTab, setInvTab] = useState("dashboard");

  const [q,    setQ   ] = useState("");
  const [page, setPage] = useState(1);
  const [dq,   setDq  ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => { setDq(q); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [q]);

  const { data: kpiRaw,  loading: l1, error: e1 } = useApi(fetchKPIs,       []);
  const { data: topRaw,  loading: l2              } = useApi(fetchTopSelling, []);
  const { data: catRaw,  loading: l3              } = useApi(fetchByCategory, []);
  const { data: lowRaw,  loading: l4              } = useApi(fetchLowStock,   []);

  // stock يُجلب يدوياً
  const [stockRes,  setStockRes ] = useState(null);
  const [stockLoad, setStockLoad] = useState(false);
  const [stockExporting, setStockExporting] = useState(false);
  const [moveMat,   setMoveMat  ] = useState(null);

  useEffect(() => {
    setStockLoad(true);
    api.get("/inventory/stock", { params: { q: dq, page, limit: 30 } })
      .then(r  => setStockRes(r))
      .catch(() => setStockRes(null))
      .finally(()=> setStockLoad(false));
  }, [dq, page]);

  // ── استخراج البيانات ──────────────────────────────────
  const kpi      = kpiRaw?.data          || {};
  const topItems = topRaw?.data          || [];
  const cats     = catRaw?.data          || [];
  const lowItems = lowRaw?.data          || [];
  const stocks   = stockRes?.data        || [];
  const total    = stockRes?.total       || 0;
  const pages    = stockRes?.totalPages  || 1;

  const maxSold  = useMemo(() => Math.max(...topItems.map(i => i.totalSold || 0), 1), [topItems]);
  const stockCostSum = useMemo(
    () => r2(stocks.reduce((s, m) => s + (+m.QuantityOnHand || 0) * (+m.CostPrice || 0), 0)),
    [stocks]
  );
  const purchasePriceSum = useMemo(
    () => r2(stocks.reduce((s, m) => s + (+m.CostPrice || 0), 0)),
    [stocks]
  );
  const catTotal = useMemo(() => cats.reduce((s, c) => s + (c.totalValue || 0), 0), [cats]);

  const exportFullStock = async (mode) => {
    setStockExporting(true);
    try {
      const items = await fetchAllStock({ q: dq });
      const rows = mapStockExportRows(items);
      const subtitle = dq ? `بحث: ${dq} — ${items.length} صنف` : `${items.length} صنف`;
      if (mode === "print") printTableReport(company, "الجرد الكامل", subtitle, STOCK_HEADERS, rows);
      else await exportTableExcel("الجرد_الكامل", "الجرد الكامل", STOCK_HEADERS, rows);
    } catch (e) {
      alert(e.message || "خطأ في التصدير");
    } finally {
      setStockExporting(false);
    }
  };

  if (e1) return (
    <div style={{ padding:40, textAlign:"center", color:"#f87171", background:"#020817", minHeight:"100vh" }}>
      <div style={{ fontSize:"2rem", marginBottom:12 }}>⚠</div>
      <div style={{ fontWeight:700 }}>خطأ في تحميل لوحة المخزون</div>
      <div style={{ color:"#64748b", marginTop:8, fontSize:".88rem" }}>{e1}</div>
      <div style={{ marginTop:16, fontSize:".8rem", color:"#334155" }}>
        تأكد أن <code>inventory.controller.js</code> و <code>inventory.routes.js</code> مطبَّقان والسيرفر يعمل
      </div>
    </div>
  );

  if (invTab === "warehouse-transfers") {
    return (
      <div style={S.page} dir="rtl">
        <InvTabBar tab={invTab} setTab={setInvTab} />
        <WarehouseTransfersReport />
      </div>
    );
  }

  if (invTab === "by-warehouse") {
    return (
      <div style={S.page} dir="rtl">
        <InvTabBar tab={invTab} setTab={setInvTab} />
        <WarehouseStockTab />
      </div>
    );
  }

  return (
    <div style={S.page} dir="rtl">
      <InvTabBar tab={invTab} setTab={setInvTab} />

      {/* ══ الرأس ══ */}
      <div style={S.header}>
        <div>
          <h1 style={S.h1}>📦 لوحة تحكم المخزون</h1>
          <p style={S.sub}>مراقبة المخزون والمبيعات في مكان واحد</p>
        </div>
        <div style={{ fontSize:".76rem", color:"#334155", fontFamily:"monospace" }}>
          آخر تحديث: {new Date().toLocaleTimeString("en-US", { hour12:false })}
        </div>
      </div>

      {/* ══ KPI Cards ══ */}
      <div style={S.kpiGrid}>
        <KpiCard icon="📦" label="إجمالي الأصناف"       value={fmtN(kpi.totalItems)} color="#3b82f6" loading={l1} />
        <KpiCard icon="💰" label="قيمة المخزون (تكلفة)" value={fmtC(kpi.stockValue)} color="#10b981" loading={l1} />
        <KpiCard icon="🔴" label="مواد نفدت"            value={fmtN(kpi.outOfStock)} color="#ef4444" loading={l1} alert={kpi.outOfStock > 0} />
        <KpiCard icon="⚠️" label="مواد أوشكت على النفاذ" value={fmtN(kpi.lowStock)}   color="#f59e0b" loading={l1} alert={kpi.lowStock > 0} />
      </div>

      {/* ══ المخططات ══ */}
      <div style={S.chartsRow}>
        <div style={S.card}>
          <div style={S.cardHdr}><span style={S.cardTitle}>📊 أكثر 5 مواد مبيعاً</span></div>
          <div style={S.cardBody}>
            {l2 ? <Loader/> : topItems.length === 0 ? <Empty msg="لا توجد بيانات مبيعات"/> : (
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                {topItems.map((item, i) => (
                  <div key={i}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5, fontSize:".83rem" }}>
                      <span style={{ fontWeight:700, color:"#e2e8f0" }}>{item.MaterialName}</span>
                      <span style={{ fontFamily:"monospace", color:COLORS[i], fontWeight:700 }}>{fmtN(item.totalSold)}</span>
                    </div>
                    <div style={{ background:"#1e293b", borderRadius:6, overflow:"hidden", height:10 }}>
                      <div style={{ width:`${(item.totalSold/maxSold)*100}%`, height:"100%", background:COLORS[i], borderRadius:6 }}/>
                    </div>
                    <div style={{ fontSize:".7rem", color:"#64748b", marginTop:3 }}>الإيراد: {fmtC(item.totalRevenue)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={S.card}>
          <div style={S.cardHdr}><span style={S.cardTitle}>🥧 المخزون حسب التصنيف</span></div>
          <div style={S.cardBody}>
            {l3 ? <Loader/> : cats.length === 0 ? <Empty msg="لا توجد تصنيفات"/> : (
              <div>
                <DonutChart items={cats} total={catTotal}/>
                <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:12 }}>
                  {cats.slice(0,7).map((c, i) => (
                    <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                        <div style={{ width:10, height:10, borderRadius:2, background:COLORS[i%COLORS.length], flexShrink:0 }}/>
                        <span style={{ fontSize:".8rem", color:"#cbd5e1" }}>{c.category}</span>
                      </div>
                      <span style={{ fontSize:".78rem", fontFamily:"monospace", color:COLORS[i%COLORS.length], fontWeight:700 }}>
                        {catTotal>0?`${Math.round((c.totalValue/catTotal)*100)}%`:"0%"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══ تنبيه المخزون المنخفض ══ */}
      <div style={S.card}>
        <div style={S.cardHdr}>
          <span style={S.cardTitle}>🚨 مواد أوشكت على النفاذ (≤ 10)</span>
          <span style={{ fontSize:".72rem", color:"#64748b", marginRight:8 }}>الكمية = الرصيد في المخزون العام (Stock_tbl) بوحدة المادة</span>
          <span style={{ fontSize:".76rem", color:"#ef4444", fontWeight:700 }}>{lowItems.length} صنف</span>
        </div>
        <div style={{ overflowX:"auto" }}>
          {l4 ? <Loader/> : lowItems.length===0 ? <Empty msg="✅ جميع المواد بمستويات آمنة"/> : (
            <table style={S.table}>
              <thead>
                <tr style={S.thead}>
                  {["المادة","الصنف","الكمية","سعر الشراء","سعر البيع","الباركود"].map((h,i)=>(
                    <th key={i} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lowItems.map((m,i) => (
                  <tr key={i} style={{ background:m.QuantityOnHand<=0?"rgba(239,68,68,.08)":"rgba(245,158,11,.05)", borderBottom:"1px solid #1e293b" }}>
                    <td style={S.td}><span style={{ fontWeight:700, color:"#e2e8f0" }}>{m.MaterialName}</span></td>
                    <td style={S.td}><span style={S.badge}>{m.CatiguaryName}</span></td>
                    <td style={S.td}>
                      <span style={{ fontFamily:"monospace", fontWeight:900, color:m.QuantityOnHand<=0?"#ef4444":"#f59e0b" }}>
                        {fmtN(m.QuantityOnHand)} {m.Band}
                      </span>
                    </td>
                    <td style={S.td}><span style={S.mono}>{fmtC(m.CostPrice)}</span></td>
                    <td style={S.td}><span style={{ ...S.mono, color:"#10b981" }}>{fmtC(m.LastSellPrice)}</span></td>
                    <td style={S.td}><span style={{ ...S.mono, color:"#64748b", fontSize:".76rem" }}>{m.Barcode||"—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ══ الجرد الكامل ══ */}
      <div style={S.card}>
        <div style={{ ...S.cardHdr, flexWrap: "wrap", gap: 10 }}>
          <span style={S.cardTitle}>📋 الجرد الكامل</span>
          <span style={{ fontSize:".72rem", color:"#64748b", marginRight:8 }}>الكمية = مجموع الرصيد المتبقي في المخزون العام — اضغط على مادة لعرض حركاتها</span>
          <span style={{ fontSize:".76rem", color:"#64748b", marginRight: "auto" }}>{fmtN(total)} صنف</span>
          <ExportPrintBar
            disabled={stockExporting || total === 0}
            onPrint={() => exportFullStock("print")}
            onExcel={() => exportFullStock("excel")}
          />
        </div>
        <div style={{ padding:"10px 14px", borderBottom:"1px solid #1e293b" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, background:"#0f172a", border:"1px solid #1e293b", borderRadius:8, padding:"7px 12px" }}>
            <span style={{ color:"#475569" }}>🔍</span>
            <input type="text" value={q} onChange={e=>setQ(e.target.value)} placeholder="ابحث بالاسم أو الباركود..."
              style={{ flex:1, background:"none", border:"none", outline:"none", color:"#e2e8f0", fontFamily:"inherit", fontSize:".88rem" }}/>
            {q&&<button onClick={()=>{setQ("");setDq("");}} style={{ background:"none", border:"none", color:"#475569", cursor:"pointer" }}>✕</button>}
          </div>
        </div>
        <div style={{ overflowX:"auto" }}>
          {stockLoad ? <Loader/> : stocks.length===0 ? <Empty msg="لا توجد نتائج"/> : (
            <table style={S.table}>
              <thead>
                <tr style={S.thead}>
                  {["#","المادة","الباركود","الصنف","الكمية","سعر الشراء","تكلفة المخزون","سعر البيع"].map((h,i)=>(
                    <th key={i} style={{ ...S.th, textAlign:i===0?"center":"right" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stocks.map((m,i) => {
                  const isOut=m.QuantityOnHand<=0;
                  const isLow=m.QuantityOnHand>0&&m.QuantityOnHand<=10;
                  const lineCost = r2((+m.QuantityOnHand || 0) * (+m.CostPrice || 0));
                  return (
                    <tr key={i} onClick={() => setMoveMat(m)} style={{ background:isOut?"rgba(239,68,68,.1)":isLow?"rgba(245,158,11,.07)":"transparent", borderBottom:"1px solid #1e293b", cursor:"pointer" }} title="عرض حركات الشراء والبيع والنقل">
                      <td style={{ ...S.td, textAlign:"center", color:"#475569", fontFamily:"monospace", fontSize:".76rem" }}>{((page-1)*30)+i+1}</td>
                      <td style={S.td}>
                        <div style={{ fontWeight:700, color:"#e2e8f0", fontSize:".86rem" }}>{m.MaterialName}</div>
                        {m.Band&&<div style={{ fontSize:".7rem", color:"#475569" }}>{m.Band}</div>}
                      </td>
                      <td style={S.td}><span style={{ fontFamily:"monospace", fontSize:".75rem", color:"#3b82f6" }}>{m.Barcode||"—"}</span></td>
                      <td style={S.td}><span style={S.badge}>{m.CatiguaryName}</span></td>
                      <td style={S.td}>
                        <span style={{ fontFamily:"monospace", fontWeight:900, padding:"2px 8px", borderRadius:6,
                          color:isOut?"#ef4444":isLow?"#f59e0b":"#10b981",
                          background:isOut?"rgba(239,68,68,.12)":isLow?"rgba(245,158,11,.1)":"rgba(16,185,129,.08)" }}>
                          {fmtN(m.QuantityOnHand)}
                        </span>
                      </td>
                      <td style={S.td}><span style={S.mono}>{fmtC(m.CostPrice)}</span></td>
                      <td style={S.td}><span style={{ ...S.mono, color:"#f59e0b", fontWeight:700 }}>{fmtC(lineCost)}</span></td>
                      <td style={S.td}><span style={{ ...S.mono, color:"#10b981" }}>{fmtC(m.LastSellPrice)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
              {stocks.length > 0 && (
                <tfoot>
                  <tr style={{ background:"#070d1a", borderTop:"2px solid #334155" }}>
                    <td colSpan={5} style={{ ...S.td, fontWeight:800, color:"#94a3b8" }}>المجاميع (هذه الصفحة)</td>
                    <td style={{ ...S.td, fontFamily:"monospace", fontWeight:800, color:"#cbd5e1" }}>
                      <div style={{ fontSize:".68rem", color:"#64748b", marginBottom:2 }}>مجموع سعر الشراء</div>
                      {fmtC(purchasePriceSum)}
                    </td>
                    <td style={{ ...S.td, fontFamily:"monospace", fontWeight:900, color:"#f59e0b" }}>
                      <div style={{ fontSize:".68rem", color:"#64748b", marginBottom:2 }}>مجموع تكلفة المخزون</div>
                      {fmtC(stockCostSum)}
                    </td>
                    <td style={S.td}>—</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
        {pages>1&&(
          <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:12, padding:"12px 16px", borderTop:"1px solid #1e293b" }}>
            <button style={S.pgBtn} disabled={page<=1} onClick={()=>setPage(p=>p-1)}>← السابق</button>
            <span style={{ fontSize:".84rem", color:"#64748b" }}>صفحة {page} من {pages} ({fmtN(total)} صنف)</span>
            <button style={S.pgBtn} disabled={page>=pages} onClick={()=>setPage(p=>p+1)}>التالي →</button>
          </div>
        )}
      </div>

      {moveMat && (
        <MaterialMovementModal material={moveMat} onClose={() => setMoveMat(null)} />
      )}
    </div>
  );
}

const MOVE_ROW_BG = {
  شراء: "rgba(59,130,246,.12)",
  بيع: "rgba(34,197,94,.12)",
  "مرتجع مبيعات": "rgba(249,115,22,.1)",
  "مرتجع مشتريات": "rgba(168,85,247,.1)",
  "نقل مخزني": "rgba(168,85,247,.22)",
  "نقل وارد": "rgba(16,185,129,.15)",
  "نقل صادر": "rgba(168,85,247,.22)",
};

function MaterialMovementModal({ material, onClose, warehouseId = null, warehouseName = "" }) {
  const { company } = useCompany();
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const today = new Date().toISOString().split("T")[0];
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!material?.id_Material_NoM) return;
    setLoading(true);
    const params = {
      id_Material: material.id_Material_NoM,
      from: yearStart,
      to: today,
    };
    const req = warehouseId
      ? api.get("/inventory/warehouse-movements", { params: { ...params, warehouseId } })
      : api.get("/advanced-reports/tracking", { params });
    req
      .then((r) => { if (r.success) setResult(r); })
      .catch((e) => alert(e.message))
      .finally(() => setLoading(false));
  }, [material, warehouseId]);

  const rows = result?.data || [];
  const whLabel = warehouseName || result?.warehouse?.name || "";
  const stockLabel = warehouseId ? "مخزون المستودع" : "المخزون الحالي";

  const handlePrint = () => {
    if (!rows.length) return alert("لا توجد بيانات للطباعة");
    const body = rows.map((r) => `
      <tr>
        <td class="n" style="text-align:right">${fmtDate(r.txDate)}</td>
        <td class="name">${r.txType}</td>
        <td>${r.party || "—"}</td>
        <td class="n">#${r.txRef}</td>
        <td class="n" style="text-align:center">${fmtN(r.qty)}</td>
        <td class="n">${r.price ? fmtC(r.price) : "—"}</td>
        <td class="n">${r.txType === "شراء" && r.lcShare ? fmtC(r.lcShare) : "—"}</td>
        <td class="n">${r.txType === "شراء" && r.discountShare ? fmtC(r.discountShare) : "—"}</td>
        <td class="n total">${r.lineTotal ? fmtC(r.lineTotal) : "—"}</td>
      </tr>`).join("");
    const tableHtml = `
      <table class="items">
        <thead>
          <tr>
            <th>التاريخ</th><th>النوع</th><th>الجهة</th><th>#</th>
            <th>الكمية</th><th>السعر</th><th>مصاريف LC</th><th>الخصم</th><th>الإجمالي</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>`;
    const subtitleParts = [
      whLabel ? `المستودع: ${whLabel}` : null,
      `الباركود: ${material.Barcode || "—"}`,
      `${stockLabel}: ${fmtN(material.QuantityOnHand)}`,
    ].filter(Boolean);
    openReportPrint({
      title: `حركة المادة: ${material.MaterialName}`,
      subtitle: subtitleParts.join(" | "),
      company,
      tableHtml,
    });
  };

  const handleExport = async () => {
    if (!rows.length) return alert("لا توجد بيانات للتصدير");
    setExporting(true);
    try {
      if (!window.XLSX) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js";
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const XLSX = window.XLSX;
      const ws = XLSX.utils.aoa_to_sheet([
        [`حركة المادة: ${material.MaterialName}`],
        ...(whLabel ? [[`المستودع: ${whLabel}`]] : []),
        [`الباركود: ${material.Barcode || "—"}`],
        [],
        ["التاريخ", "النوع", "الجهة", "رقم السند", "الكمية", "السعر", "مصاريف LC", "الخصم", "الإجمالي"],
        ...rows.map((r) => [
          fmtDate(r.txDate), r.txType, r.party || "", r.txRef,
          r.qty, r.price || "", r.lcShare || "", r.discountShare || "", r.lineTotal || "",
        ]),
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "حركة المادة");
      const fileSuffix = whLabel ? `_${whLabel}` : "";
      XLSX.writeFile(wb, `حركة_${material.MaterialName}${fileSuffix}_${today}.xlsx`);
    } catch (e) {
      alert("خطأ في التصدير: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      style={{ position:"fixed", inset:0, zIndex:200, background:"rgba(2,8,23,.75)", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background:"#0f172a", border:"1px solid #334155", borderRadius:12, width:"min(920px,100%)", maxHeight:"88vh", overflow:"hidden", display:"flex", flexDirection:"column" }}
      >
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 18px", borderBottom:"1px solid #1e293b", gap:12, flexWrap:"wrap" }}>
          <div>
            <div style={{ fontWeight:800, color:"#e2e8f0", fontSize:"1rem" }}>حركة المادة: {material.MaterialName}</div>
            <div style={{ fontSize:".78rem", color:"#64748b", marginTop:4 }}>
              {whLabel ? `المستودع: ${whLabel} | ` : ""}{stockLabel}: {fmtN(material.QuantityOnHand)} {material.Band || ""}
            </div>
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <button type="button" onClick={handlePrint} disabled={!rows.length}
              style={{ padding:"6px 12px", background:"#1e3a5f", border:"1px solid #3b82f6", borderRadius:8, color:"#93c5fd", cursor:rows.length?"pointer":"not-allowed", fontFamily:"inherit", fontSize:".8rem", fontWeight:700 }}>
              🖨 طباعة
            </button>
            <button type="button" onClick={handleExport} disabled={!rows.length || exporting}
              style={{ padding:"6px 12px", background:"#14532d", border:"1px solid #16a34a", borderRadius:8, color:"#4ade80", cursor:rows.length?"pointer":"not-allowed", fontFamily:"inherit", fontSize:".8rem", fontWeight:700 }}>
              {exporting ? "جاري..." : "📊 Excel"}
            </button>
            <button type="button" onClick={onClose} style={{ background:"none", border:"none", color:"#94a3b8", fontSize:"1.2rem", cursor:"pointer" }}>✕</button>
          </div>
        </div>
        <div style={{ overflowY:"auto", padding:"12px 16px" }}>
          {loading ? (
            <div style={{ textAlign:"center", padding:40, color:"#64748b" }}><span className="spinner" /> جاري التحميل...</div>
          ) : !rows.length ? (
            <div style={{ textAlign:"center", padding:40, color:"#64748b" }}>لا توجد حركات في الفترة الحالية</div>
          ) : (
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:".82rem" }}>
              <thead>
                <tr style={{ borderBottom:"2px solid #334155" }}>
                  {["التاريخ","النوع","الجهة","#","الكمية","السعر","مصاريف LC","الخصم","الإجمالي"].map((h) => (
                    <th key={h} style={{ padding:"8px 10px", textAlign:"right", color:"#94a3b8", fontSize:".7rem" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ background: MOVE_ROW_BG[r.txType] || "transparent", borderBottom:"1px solid #1e293b" }}>
                    <td style={{ padding:"8px 10px", fontFamily:"monospace", color:"#cbd5e1" }}>{fmtDate(r.txDate)}</td>
                    <td style={{ padding:"8px 10px", fontWeight:700, color: (r.txType === "نقل مخزني" || r.txType === "نقل صادر" || r.txType === "نقل وارد") ? "#a78bfa" : "#e2e8f0" }}>{r.txType}</td>
                    <td style={{ padding:"8px 10px", color:"#94a3b8" }}>{r.party || "—"}</td>
                    <td style={{ padding:"8px 10px", fontFamily:"monospace", color:"#3b82f6" }}>#{r.txRef}</td>
                    <td style={{ padding:"8px 10px", fontFamily:"monospace", fontWeight:700, textAlign:"center" }}>{fmtN(r.qty)}</td>
                    <td style={{ padding:"8px 10px", fontFamily:"monospace", textAlign:"left" }}>{r.price ? fmtC(r.price) : "—"}</td>
                    <td style={{ padding:"8px 10px", fontFamily:"monospace", textAlign:"left", color:"#fbbf24" }}>{r.txType === "شراء" && r.lcShare ? fmtC(r.lcShare) : "—"}</td>
                    <td style={{ padding:"8px 10px", fontFamily:"monospace", textAlign:"left", color:"#f87171" }}>{r.txType === "شراء" && r.discountShare ? fmtC(r.discountShare) : "—"}</td>
                    <td style={{ padding:"8px 10px", fontFamily:"monospace", fontWeight:700, textAlign:"left", color:"#10b981" }}>{r.lineTotal ? fmtC(r.lineTotal) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function DonutChart({ items, total }) {
  if (!total) return null;
  const R=54, CX=70, CY=70, circ=2*Math.PI*R;
  let cum=0;
  const segs=items.slice(0,7).map((c,i)=>{ const pct=(c.totalValue||0)/total; const off=circ*(1-cum); cum+=pct; return {pct,off,color:COLORS[i%COLORS.length]}; });
  return (
    <div style={{ display:"flex", justifyContent:"center" }}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#1e293b" strokeWidth={20}/>
        {segs.map((seg,i)=>(
          <circle key={i} cx={CX} cy={CY} r={R} fill="none" stroke={seg.color} strokeWidth={20}
            strokeDasharray={`${circ*seg.pct} ${circ*(1-seg.pct)}`}
            strokeDashoffset={seg.off} transform={`rotate(-90 ${CX} ${CY})`}/>
        ))}
        <text x={CX} y={CY-6} textAnchor="middle" fill="#94a3b8" fontSize="9">أصناف</text>
        <text x={CX} y={CY+8} textAnchor="middle" fill="#e2e8f0" fontSize="11" fontWeight="bold">{items.length}</text>
      </svg>
    </div>
  );
}

function KpiCard({ icon, label, value, color, loading, alert }) {
  return (
    <div style={{ background:"#0f172a", border:`1px solid ${alert?color+"55":"#1e293b"}`, borderRadius:12, padding:"18px 20px", display:"flex", alignItems:"center", gap:16, boxShadow:alert?`0 0 20px ${color}22`:"none" }}>
      <div style={{ fontSize:"2rem" }}>{icon}</div>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:".72rem", color:"#64748b", fontWeight:600, textTransform:"uppercase", marginBottom:6 }}>{label}</div>
        {loading ? <div style={{ height:28, background:"#1e293b", borderRadius:6, width:"60%" }}/> : <div style={{ fontFamily:"monospace", fontWeight:900, fontSize:"1.35rem", color }}>{value}</div>}
      </div>
    </div>
  );
}

function InvTabBar({ tab, setTab }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
      {INV_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTab(t.id)}
          style={{
            padding: "8px 16px",
            border: tab === t.id ? "2px solid #3b82f6" : "1px solid #334155",
            borderRadius: 8,
            background: tab === t.id ? "#1e3a5f" : "#0f172a",
            color: tab === t.id ? "#93c5fd" : "#94a3b8",
            fontWeight: tab === t.id ? 800 : 600,
            fontSize: ".84rem",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function WarehouseStockTab() {
  const { company } = useCompany();
  const [summaries, setSummaries] = useState([]);
  const [sumLoad, setSumLoad]     = useState(true);
  const [sumErr, setSumErr]       = useState(null);
  const [whId, setWhId]           = useState(null);
  const [q, setQ]                 = useState("");
  const [dq, setDq]               = useState("");
  const [page, setPage]           = useState(1);
  const [detail, setDetail]       = useState(null);
  const [detailLoad, setDetailLoad] = useState(false);
  const [whExporting, setWhExporting] = useState(false);
  const [moveMat, setMoveMat]     = useState(null);

  useEffect(() => {
    setSumLoad(true);
    setSumErr(null);
    api.get("/inventory/by-warehouse")
      .then((r) => {
        const rows = r?.data || [];
        setSummaries(rows);
        if (rows.length) setWhId((prev) => prev ?? rows[0].id_Warehouse);
      })
      .catch((e) => setSumErr(e.message || "خطأ في التحميل"))
      .finally(() => setSumLoad(false));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setDq(q); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!whId) return;
    setDetailLoad(true);
    api.get("/inventory/by-warehouse", { params: { warehouseId: whId, q: dq, page, limit: 30 } })
      .then((r) => setDetail(r))
      .catch(() => setDetail(null))
      .finally(() => setDetailLoad(false));
  }, [whId, dq, page]);

  const stocks = detail?.data || [];
  const total  = detail?.total || 0;
  const pages  = detail?.totalPages || 1;
  const whName = detail?.warehouse?.WarehouseName || summaries.find((w) => w.id_Warehouse === whId)?.WarehouseName || "—";

  const stockCostSum = useMemo(
    () => r2(stocks.reduce((s, m) => s + (+m.QuantityOnHand || 0) * (+m.CostPrice || 0), 0)),
    [stocks]
  );
  const grandTotal = useMemo(
    () => r2(summaries.reduce((s, w) => s + (+w.totalValue || 0), 0)),
    [summaries]
  );

  const exportWarehouseStock = async (mode) => {
    if (!whId) return;
    setWhExporting(true);
    try {
      const items = await fetchAllWarehouseStock(whId, dq);
      const rows = mapStockExportRows(items);
      const subtitle = `${whName}${dq ? ` — بحث: ${dq}` : ""} — ${items.length} صنف`;
      if (mode === "print") printTableReport(company, `مخزون المستودع: ${whName}`, subtitle, STOCK_HEADERS, rows);
      else await exportTableExcel(`مخزون_${whName}`, whName.slice(0, 31), STOCK_HEADERS, rows);
    } catch (e) {
      alert(e.message || "خطأ في التصدير");
    } finally {
      setWhExporting(false);
    }
  };

  if (sumErr) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#f87171" }}>
        <div style={{ fontWeight: 700 }}>خطأ في تحميل المخزون حسب المستودع</div>
        <div style={{ color: "#64748b", marginTop: 8, fontSize: ".88rem" }}>{sumErr}</div>
      </div>
    );
  }

  return (
    <>
      <div style={S.header}>
        <div>
          <h1 style={S.h1}>🏭 المخزون حسب المستودع</h1>
          <p style={S.sub}>قيمة المواد والكميات لكل مستودع على حدة</p>
        </div>
        <div style={{ fontFamily: "monospace", fontSize: ".84rem", color: "#10b981", fontWeight: 800 }}>
          إجمالي كل المستودعات: {fmtC(grandTotal)}
        </div>
      </div>

      <div style={S.kpiGrid}>
        {sumLoad ? (
          <Loader />
        ) : summaries.length === 0 ? (
          <Empty msg="لا توجد مستودعات نشطة" />
        ) : (
          summaries.map((w, i) => (
            <button
              key={w.id_Warehouse}
              type="button"
              onClick={() => { setWhId(w.id_Warehouse); setPage(1); }}
              style={{
                background: whId === w.id_Warehouse ? "#1e3a5f" : "#0f172a",
                border: whId === w.id_Warehouse ? `2px solid ${COLORS[i % COLORS.length]}` : "1px solid #1e293b",
                borderRadius: 12,
                padding: "16px 18px",
                textAlign: "right",
                cursor: "pointer",
                fontFamily: "inherit",
                color: "#e2e8f0",
              }}
            >
              <div style={{ fontWeight: 800, fontSize: ".95rem", marginBottom: 8 }}>{w.WarehouseName}</div>
              {w.Location && <div style={{ fontSize: ".72rem", color: "#64748b", marginBottom: 10 }}>{w.Location}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: ".78rem" }}>
                <div>
                  <div style={{ color: "#64748b" }}>أصناف</div>
                  <div style={{ fontFamily: "monospace", fontWeight: 800, color: COLORS[i % COLORS.length] }}>{fmtN(w.itemCount)}</div>
                </div>
                <div>
                  <div style={{ color: "#64748b" }}>الكمية</div>
                  <div style={{ fontFamily: "monospace", fontWeight: 800, color: "#94a3b8" }}>{fmtN(w.totalQty)}</div>
                </div>
                <div>
                  <div style={{ color: "#64748b" }}>القيمة</div>
                  <div style={{ fontFamily: "monospace", fontWeight: 800, color: "#10b981" }}>{fmtC(w.totalValue)}</div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {whId && (
        <div style={S.card}>
          <div style={{ ...S.cardHdr, flexWrap: "wrap", gap: 10 }}>
            <span style={S.cardTitle}>📋 مواد المستودع: {whName}</span>
            <span style={{ fontSize:".72rem", color:"#64748b", marginRight:8 }}>اضغط على مادة لعرض حركاتها في هذا المستودع</span>
            <span style={{ fontSize: ".76rem", color: "#64748b", marginRight: "auto" }}>{fmtN(total)} صنف</span>
            <ExportPrintBar
              disabled={whExporting || total === 0}
              onPrint={() => exportWarehouseStock("print")}
              onExcel={() => exportWarehouseStock("excel")}
            />
          </div>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #1e293b" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "7px 12px" }}>
              <span style={{ color: "#475569" }}>🔍</span>
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ابحث بالاسم أو الباركود..."
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: "#e2e8f0", fontFamily: "inherit", fontSize: ".88rem" }}
              />
              {q && (
                <button type="button" onClick={() => { setQ(""); setDq(""); }} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer" }}>✕</button>
              )}
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            {detailLoad ? (
              <Loader />
            ) : stocks.length === 0 ? (
              <Empty msg="لا توجد مواد في هذا المستودع" />
            ) : (
              <table style={S.table}>
                <thead>
                  <tr style={S.thead}>
                    {["#", "المادة", "الباركود", "الصنف", "الكمية", "سعر الشراء", "تكلفة المخزون", "سعر البيع"].map((h, i) => (
                      <th key={i} style={{ ...S.th, textAlign: i === 0 ? "center" : "right" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stocks.map((m, i) => {
                    const lineCost = r2((+m.QuantityOnHand || 0) * (+m.CostPrice || 0));
                    return (
                      <tr
                        key={i}
                        onClick={() => setMoveMat(m)}
                        style={{ borderBottom: "1px solid #1e293b", cursor: "pointer" }}
                        title="عرض حركات المادة في هذا المستودع"
                      >
                        <td style={{ ...S.td, textAlign: "center", color: "#475569", fontFamily: "monospace", fontSize: ".76rem" }}>{((page - 1) * 30) + i + 1}</td>
                        <td style={S.td}>
                          <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: ".86rem" }}>{m.MaterialName}</div>
                          {m.Band && <div style={{ fontSize: ".7rem", color: "#475569" }}>{m.Band}</div>}
                        </td>
                        <td style={S.td}><span style={{ fontFamily: "monospace", fontSize: ".75rem", color: "#3b82f6" }}>{m.Barcode || "—"}</span></td>
                        <td style={S.td}><span style={S.badge}>{m.CatiguaryName}</span></td>
                        <td style={S.td}>
                          <span style={{ fontFamily: "monospace", fontWeight: 900, color: "#10b981", padding: "2px 8px", borderRadius: 6, background: "rgba(16,185,129,.08)" }}>
                            {fmtN(m.QuantityOnHand)}
                          </span>
                        </td>
                        <td style={S.td}><span style={S.mono}>{fmtC(m.CostPrice)}</span></td>
                        <td style={S.td}><span style={{ ...S.mono, color: "#f59e0b", fontWeight: 700 }}>{fmtC(lineCost)}</span></td>
                        <td style={S.td}><span style={{ ...S.mono, color: "#10b981" }}>{fmtC(m.LastSellPrice)}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
                {stocks.length > 0 && (
                  <tfoot>
                    <tr style={{ background: "#070d1a", borderTop: "2px solid #334155" }}>
                      <td colSpan={6} style={{ ...S.td, fontWeight: 800, color: "#94a3b8" }}>مجموع تكلفة المخزون (هذه الصفحة)</td>
                      <td style={{ ...S.td, fontFamily: "monospace", fontWeight: 900, color: "#f59e0b" }}>{fmtC(stockCostSum)}</td>
                      <td style={S.td}>—</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
          {pages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid #1e293b" }}>
              <button type="button" style={S.pgBtn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← السابق</button>
              <span style={{ fontSize: ".84rem", color: "#64748b" }}>صفحة {page} من {pages} ({fmtN(total)} صنف)</span>
              <button type="button" style={S.pgBtn} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>التالي →</button>
            </div>
          )}
        </div>
      )}

      {moveMat && (
        <MaterialMovementModal
          material={moveMat}
          warehouseId={whId}
          warehouseName={whName}
          onClose={() => setMoveMat(null)}
        />
      )}
    </>
  );
}

const Loader = () => <div style={{ display:"flex", alignItems:"center", justifyContent:"center", padding:32, gap:10, color:"#475569" }}><div style={{ width:20, height:20, border:"2px solid #1e293b", borderTopColor:"#3b82f6", borderRadius:"50%" }}/>جاري التحميل...</div>;
const Empty  = ({msg}) => <div style={{ padding:32, textAlign:"center", color:"#475569", fontSize:".88rem" }}>{msg}</div>;

const S = {
  page    :{display:"flex",flexDirection:"column",gap:20,padding:24,background:"#020817",minHeight:"100vh",color:"#e2e8f0",fontFamily:"'Segoe UI',Tahoma,sans-serif"},
  header  :{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:12},
  h1      :{margin:0,fontSize:"1.5rem",fontWeight:900,color:"#f1f5f9"},
  sub     :{margin:"4px 0 0",color:"#64748b",fontSize:".88rem"},
  kpiGrid :{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14},
  chartsRow:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16},
  card    :{background:"#0f172a",border:"1px solid #1e293b",borderRadius:12,overflow:"hidden"},
  cardHdr :{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"13px 16px",borderBottom:"1px solid #1e293b",background:"#070d1a"},
  cardTitle:{fontWeight:700,fontSize:".9rem",color:"#e2e8f0"},
  cardBody:{padding:16},
  table   :{width:"100%",borderCollapse:"collapse",fontSize:".83rem"},
  thead   :{background:"#070d1a",borderBottom:"2px solid #1e293b"},
  th      :{padding:"10px 14px",textAlign:"right",color:"#64748b",fontWeight:700,fontSize:".68rem",textTransform:"uppercase",whiteSpace:"nowrap"},
  td      :{padding:"9px 14px",verticalAlign:"middle"},
  mono    :{fontFamily:"monospace",color:"#94a3b8",fontSize:".83rem"},
  badge   :{display:"inline-block",padding:"2px 8px",background:"#1e293b",color:"#94a3b8",borderRadius:20,fontSize:".72rem",fontWeight:600},
  pgBtn   :{padding:"6px 14px",background:"#1e293b",border:"1px solid #334155",borderRadius:7,color:"#94a3b8",cursor:"pointer",fontFamily:"inherit",fontSize:".82rem"},
};
