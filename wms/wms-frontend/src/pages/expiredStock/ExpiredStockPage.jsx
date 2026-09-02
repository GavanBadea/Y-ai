// ============================================================
//  src/pages/expiredStock/ExpiredStockPage.jsx
//  قسم المواد منتهية الصلاحية — مشطوبة ومعلّقة
// ============================================================
import { useState, useMemo }         from "react";
import AppLayout                     from "@/components/layout/AppLayout";
import { Card, StatCard, Badge }     from "@/components/ui/Card";
import Button                        from "@/components/ui/Button";
import { useApi, useAction }         from "@/hooks/useApi";
import { fmtC, fmtN }               from "@/utils/numFormat";
import { expiredService }            from "@/services/expiredService";
import { useCompany } from "@/context/CompanyContext";
import { printTableReport, exportTableExcel, ExportPrintBar } from "@/utils/tableReportTools";

const today = () => new Date().toISOString().split("T")[0];

// ═══════════════════════════════════════════════════════
export default function ExpiredStockPage() {

  const { company } = useCompany();
  const [tab, setTab] = useState("pending"); // pending | written

  const { data: sumData,  refetch: refetchSum  } = useApi(() => expiredService.getSummary(), []);
  const { data: penData,  loading: penLoad, refetch: refetchPen } = useApi(() => expiredService.getPending(), []);
  const { data: writData, loading: writLoad, refetch: refetchWrit} = useApi(() => expiredService.getAll(), []);

  const summary   = sumData?.data   || {};
  const pending   = penData?.data   || [];
  const written   = writData?.data  || [];

  const { loading: processing, execute } = useAction();
  const [msg, setMsg] = useState(null);

  const refetchAll = () => { refetchSum(); refetchPen(); refetchWrit(); };

  // ── شطب الكل تلقائياً ──────────────────────────────────
  const handleProcessAll = async () => {
    if (!confirm(`شطب جميع المواد المنتهية الصلاحية (${pending.length} دفعة) وخصمها من المخزون؟`)) return;
    await execute(() => expiredService.processAll(), {
      onSuccess: (r) => {
        setMsg({ type:"success", text: r?.message || "تم الشطب" });
        window.dispatchEvent(new CustomEvent("wms-expired-stock-changed"));
        refetchAll();
        setTimeout(() => setMsg(null), 4000);
      },
      onError: (e) => setMsg({ type:"error", text: e }),
    });
  };

  // ── شطب دفعة واحدة ─────────────────────────────────────
  const handleProcessOne = async (id, name) => {
    if (!confirm(`شطب دفعة "${name}" وخصمها من المخزون؟`)) return;
    await execute(() => expiredService.processOne(id), {
      onSuccess: (r) => {
        setMsg({ type:"success", text: r?.message || "تم الشطب" });
        window.dispatchEvent(new CustomEvent("wms-expired-stock-changed"));
        refetchAll();
        setTimeout(() => setMsg(null), 3000);
      },
      onError: (e) => setMsg({ type:"error", text: e }),
    });
  };

  const totalPotentialLoss = penData?.totalPotentialLoss || 0;
  const totalWrittenLoss   = writData?.totalLoss         || 0;

  const pendingHeaders = ["المادة", "الصنف", "الوحدة", "الكمية", "سعر الشراء", "خسارة متوقعة", "تاريخ الشراء", "تاريخ الانتهاء", "منذ (يوم)"];
  const pendingRows = pending.map((r) => [
    r.MaterialName, r.CatiguaryName || "—", r.Band || "—", r.remainingQty, r.costPrice,
    r.potentialLoss, r.purchaseDate, r.ExpairDate, r.daysExpired,
  ]);

  const writtenHeaders = ["تاريخ الشطب", "المادة", "الصنف", "الكمية", "سعر الشراء", "الخسارة", "تاريخ الانتهاء", "ملاحظة"];
  const writtenRows = written.map((r) => [
    r.ProcessedDate, r.MaterialName, r.CatiguaryName || "—", `${r.ExpiredQty} ${r.Band || ""}`.trim(),
    r.CostPrice, r.TotalLoss, r.ExpairDate, r.Notes || "—",
  ]);

  const summaryHeaders = ["النوع", "البند", "الكمية", "الخسارة"];
  const summaryRows = [
    ...(summary.byCategory || []).map((c) => ["حسب الصنف", c.category, c.totalQty, c.totalLoss]),
    ...(summary.byMonth || []).map((m) => ["حسب الشهر", m.month, "—", m.totalLoss]),
  ];

  return (
    <AppLayout
      title="⚠️ المواد منتهية الصلاحية"
      actions={
        tab === "pending" && pending.length > 0 ? (
          <Button variant="danger" loading={processing} onClick={handleProcessAll}>
            🗑 شطب الكل ({pending.length})
          </Button>
        ) : null
      }
    >

      {/* ── إحصائيات ──────────────────────────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:24 }}>
        <StatCard
          label  ="تنتظر الشطب"
          value  ={fmtN(summary.pending?.count || 0)}
          variant="danger"
          sub    ="دفعة منتهية لم تُشطب"
        />
        <StatCard
          label  ="خسارة متوقعة"
          value  ={fmtC(totalPotentialLoss)}
          variant="warning"
          sub    ="قيمة الكميات المعلّقة"
        />
        <StatCard
          label  ="إجمالي المشطوب"
          value  ={fmtN(summary.totals?.records || 0)}
          variant="default"
          sub    ="عملية شطب مسجّلة"
        />
        <StatCard
          label  ="إجمالي الخسائر"
          value  ={fmtC(summary.totals?.totalLoss || 0)}
          variant="danger"
          sub    ="تكلفة كل المشطوبات"
        />
      </div>

      {/* ── رسالة ─────────────────────────────────────────── */}
      {msg && (
        <div className={`alert alert-${msg.type} animate-fade-in`} style={{ marginBottom:16 }}>
          {msg.text}
        </div>
      )}

      {/* ── تبويبات ───────────────────────────────────────── */}
      <div style={{ display:"flex", gap:8, marginBottom:18 }}>
        {[
          { id:"pending", label:`⏳ تنتظر الشطب (${pending.length})`, color:"var(--danger)" },
          { id:"written", label:`🗑 المشطوبات (${written.length})`,    color:"var(--text-secondary)" },
          { id:"summary", label:"📊 تفصيل الخسائر",                   color:"var(--accent)" },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:"8px 18px", borderRadius:"var(--radius-full)",
            border:`2px solid ${tab===t.id ? t.color : "var(--border)"}`,
            background: tab===t.id ? t.color+"22" : "var(--bg-card)",
            color: tab===t.id ? t.color : "var(--text-secondary)",
            fontWeight:700, fontSize:".85rem", cursor:"pointer", fontFamily:"inherit",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════
          تبويب 1: تنتظر الشطب
      ══════════════════════════════════════════════════ */}
      {tab === "pending" && (
        <Card padding="0">
          <div style={{ padding:"12px 18px", borderBottom:"1px solid var(--border-subtle)", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
            <span style={{ fontWeight:700, color:"var(--danger)" }}>
              📦 دفعات منتهية الصلاحية — لم تُشطب من المخزون بعد
            </span>
            <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
              {pending.length > 0 && (
                <span style={{ fontSize:".82rem", color:"var(--text-muted)" }}>
                  خسارة متوقعة: <strong style={{ color:"var(--danger)" }}>{fmtC(totalPotentialLoss)}</strong>
                </span>
              )}
              <ExportPrintBar
                disabled={!pending.length}
                onPrint={() => printTableReport(company, "مواد تنتظر الشطب", `${pending.length} دفعة`, pendingHeaders, pendingRows)}
                onExcel={() => exportTableExcel("تنتظر_الشطب", "تنتظر الشطب", pendingHeaders, pendingRows)}
              />
            </div>
          </div>

          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:".875rem" }}>
              <thead>
                <tr style={{ borderBottom:"1px solid var(--border)" }}>
                  {["المادة","الوحدة","الكمية المنتهية","سعر الشراء","الخسارة المتوقعة","تاريخ الشراء","تاريخ الانتهاء","منذ (يوم)",""].map((h,i) => (
                    <th key={i} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {penLoad ? (
                  <tr><td colSpan={9} style={emptyCell}><span className="spinner"/></td></tr>
                ) : pending.length === 0 ? (
                  <tr><td colSpan={9} style={emptyCell}>
                    <div style={{ fontSize:"2rem", marginBottom:8 }}>✅</div>
                    لا توجد مواد منتهية الصلاحية تحتاج إلى شطب
                  </td></tr>
                ) : pending.map((r, i) => (
                  <tr key={i}
                    style={{ borderBottom:"1px solid var(--border-subtle)", background:"rgba(220,38,38,0.04)" }}
                    onMouseEnter={e => e.currentTarget.style.background="rgba(220,38,38,0.08)"}
                    onMouseLeave={e => e.currentTarget.style.background="rgba(220,38,38,0.04)"}>
                    <td style={{ padding:"10px 14px", fontWeight:700 }}>
                      {r.MaterialName}
                      <div style={{ fontSize:".72rem", color:"var(--text-muted)" }}>{r.CatiguaryName || "—"}</div>
                    </td>
                    <td style={{ padding:"10px 14px" }}><Badge label={r.Band||"—"}/></td>
                    <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontWeight:700, color:"var(--danger)" }}>
                      {fmtN(r.remainingQty)}
                    </td>
                    <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)" }}>{fmtC(r.costPrice)}</td>
                    <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontWeight:700, color:"var(--danger)" }}>
                      {fmtC(r.potentialLoss)}
                    </td>
                    <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontSize:".78rem" }}>{r.purchaseDate}</td>
                    <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontSize:".78rem", color:"var(--danger)", fontWeight:700 }}>
                      {r.ExpairDate}
                    </td>
                    <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", color:"var(--danger)" }}>
                      {fmtN(r.daysExpired)}
                    </td>
                    <td style={{ padding:"10px 14px" }}>
                      <Button size="sm" variant="danger"
                        loading={processing}
                        onClick={() => handleProcessOne(r.id_DetailsIN, r.MaterialName)}>
                        🗑 شطب
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ══════════════════════════════════════════════════
          تبويب 2: المشطوبات
      ══════════════════════════════════════════════════ */}
      {tab === "written" && (
        <Card padding="0">
          <div style={{ padding:"12px 18px", borderBottom:"1px solid var(--border-subtle)", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
            <span style={{ fontWeight:700 }}>🗑 سجل المواد المشطوبة من المخزون</span>
            <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
              <span style={{ fontSize:".82rem", color:"var(--text-muted)" }}>
                إجمالي الخسائر: <strong style={{ color:"var(--danger)" }}>{fmtC(totalWrittenLoss)}</strong>
              </span>
              <ExportPrintBar
                disabled={!written.length}
                onPrint={() => printTableReport(company, "المواد المشطوبة", `${written.length} سجل`, writtenHeaders, writtenRows)}
                onExcel={() => exportTableExcel("المشطوبات", "المشطوبات", writtenHeaders, writtenRows)}
              />
            </div>
          </div>

          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:".875rem" }}>
              <thead>
                <tr style={{ borderBottom:"1px solid var(--border)" }}>
                  {["تاريخ الشطب","المادة","الكمية","سعر الشراء","الخسارة","تاريخ الانتهاء","ملاحظة"].map((h,i) => (
                    <th key={i} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {writLoad ? (
                  <tr><td colSpan={7} style={emptyCell}><span className="spinner"/></td></tr>
                ) : written.length === 0 ? (
                  <tr><td colSpan={7} style={emptyCell}>لا توجد سجلات شطب بعد</td></tr>
                ) : written.map((r, i) => (
                  <tr key={i}
                    style={{ borderBottom:"1px solid var(--border-subtle)" }}
                    onMouseEnter={e => e.currentTarget.style.background="var(--bg-hover)"}
                    onMouseLeave={e => e.currentTarget.style.background=""}>
                    <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontSize:".8rem" }}>
                      {r.ProcessedDate}
                    </td>
                    <td style={{ padding:"10px 14px", fontWeight:600 }}>
                      {r.MaterialName}
                      <div style={{ fontSize:".72rem", color:"var(--text-muted)" }}>{r.CatiguaryName||"—"} | فاتورة #{r.invoiceNo}</div>
                    </td>
                    <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontWeight:700, color:"var(--warning)" }}>
                      {fmtN(r.ExpiredQty)} {r.Band}
                    </td>
                    <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)" }}>{fmtC(r.CostPrice)}</td>
                    <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontWeight:700, color:"var(--danger)" }}>
                      {fmtC(r.TotalLoss)}
                    </td>
                    <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontSize:".78rem", color:"var(--danger)" }}>
                      {r.ExpairDate}
                    </td>
                    <td style={{ padding:"10px 14px", fontSize:".8rem", color:"var(--text-muted)" }}>
                      {r.Notes||"—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ══════════════════════════════════════════════════
          تبويب 3: تفصيل الخسائر
      ══════════════════════════════════════════════════ */}
      {tab === "summary" && (
        <div>
          <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:12 }}>
            <ExportPrintBar
              disabled={!summaryRows.length}
              onPrint={() => printTableReport(company, "تفصيل خسائر منتهية الصلاحية", "حسب الصنف والشهر", summaryHeaders, summaryRows)}
              onExcel={() => exportTableExcel("تفصيل_الخسائر", "تفصيل الخسائر", summaryHeaders, summaryRows)}
            />
          </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>

          {/* حسب الصنف */}
          <Card>
            <div style={{ fontWeight:800, marginBottom:14 }}>📦 الخسائر حسب الصنف</div>
            {(summary.byCategory||[]).length === 0 ? (
              <p style={{ color:"var(--text-muted)", fontSize:".88rem" }}>لا توجد بيانات بعد</p>
            ) : (summary.byCategory||[]).map((c, i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:"1px solid var(--border-subtle)" }}>
                <div>
                  <span style={{ fontWeight:600, fontSize:".88rem" }}>{c.category}</span>
                  <div style={{ fontSize:".75rem", color:"var(--text-muted)" }}>{fmtN(c.totalQty)} وحدة مشطوبة</div>
                </div>
                <span style={{ fontFamily:"var(--font-mono)", fontWeight:700, color:"var(--danger)" }}>
                  {fmtC(c.totalLoss)}
                </span>
              </div>
            ))}
          </Card>

          {/* حسب الشهر */}
          <Card>
            <div style={{ fontWeight:800, marginBottom:14 }}>📅 الخسائر الشهرية</div>
            {(summary.byMonth||[]).length === 0 ? (
              <p style={{ color:"var(--text-muted)", fontSize:".88rem" }}>لا توجد بيانات بعد</p>
            ) : (summary.byMonth||[]).map((m, i) => {
              const maxLoss = Math.max(...(summary.byMonth||[]).map(x => x.totalLoss), 1);
              const pct = Math.min(100, (m.totalLoss / maxLoss) * 100);
              return (
                <div key={i} style={{ marginBottom:10 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3, fontSize:".85rem" }}>
                    <span style={{ color:"var(--text-secondary)" }}>{m.month}</span>
                    <span style={{ fontFamily:"var(--font-mono)", fontWeight:700, color:"var(--danger)" }}>{fmtC(m.totalLoss)}</span>
                  </div>
                  <div style={{ height:6, background:"var(--bg-hover)", borderRadius:3, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${pct}%`, background:"var(--danger)", borderRadius:3, transition:"width .3s" }}/>
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
        </div>
      )}
    </AppLayout>
  );
}

const thStyle  = { padding:"9px 14px", textAlign:"right", color:"var(--text-secondary)", fontWeight:700, fontSize:".72rem", textTransform:"uppercase", whiteSpace:"nowrap" };
const emptyCell= { padding:48, textAlign:"center", color:"var(--text-muted)" };
