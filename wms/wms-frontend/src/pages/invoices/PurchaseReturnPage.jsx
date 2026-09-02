// ============================================================
//  PurchaseReturnPage.jsx  —  📤 مرتجعات المشتريات
//  نفس نمط PurchaseInvoicePage تماماً
// ============================================================
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import AppLayout      from "@/components/layout/AppLayout";
import Button         from "@/components/ui/Button";
import { useApi }     from "@/hooks/useApi";
import { partyService, materialsService } from "@/services/api";
import api from "@/services/api";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { useCompany, companyLogoUrl } from "@/context/CompanyContext";
import { openInvoicePrint, returnPayloadFromDetail } from "@/utils/invoicePrint";
import ReturnEditModal from "@/components/invoices/ReturnEditModal";
import { r2, fmt, fmtN, fmtC } from "@/utils/numFormat";
import { numFieldValue } from "@/utils/numInput";

const today = ()      => new Date().toISOString().split("T")[0];

const thSt  = { padding:"10px 14px", textAlign:"right", color:"var(--text-secondary)", fontWeight:700, fontSize:".7rem", textTransform:"uppercase", whiteSpace:"nowrap" };
const tdSt  = { padding:"10px 14px" };
const selSt = { width:"100%", padding:"10px 12px", background:"var(--bg-input)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", color:"var(--text-primary)", fontFamily:"var(--font-main)", fontSize:".88rem", outline:"none", cursor:"pointer" };
const inpSt = { padding:"10px 12px", background:"var(--bg-input)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", color:"var(--text-primary)", fontFamily:"var(--font-main)", fontSize:".88rem", outline:"none" };
const numSt = { background:"var(--bg-input)", border:"1px solid var(--border)", borderRadius:6, color:"var(--text-primary)", fontFamily:"var(--font-mono)", fontSize:".88rem", outline:"none" };

const RETURN_FORM_GRID = "minmax(0, 1fr) minmax(220px, 280px)";
const PUR_RETURN_LINE_COL_WIDTHS = ["3%", "26%", "10%", "7%", "11%", "10%", "18%", "11%", "4%"];

let _lid = 0;
const newLine = () => ({ _lid:++_lid, id_Material_NoM:null, MaterialName:"", Barcode:"", Band:"", PriceOUT:0, AmountReturn:1, ReturnReason:"", stock:0 });

// ── Root ────────────────────────────────────────────────────
export default function PurchaseReturnPage() {
  const { locale } = useNumberLocale(); // locale متاح للمكوّن الرئيسي

  const [tab, setTab] = useState("list");
  return (
    <>
      {tab === "list" && <ListScreen  onNew={() => setTab("new")} />}
      {tab === "new"  && <FormScreen  onDone={() => setTab("list")} />}
    </>
  );
}

// ══════════════════════════════════════════════════════════
//  Screen 1 — قائمة السندات
// ══════════════════════════════════════════════════════════
function ListScreen({ onNew }) {
  const { user } = useAuth();
  const { company } = useCompany();
  const logoUrl = companyLogoUrl(company?.CompanyInformation_Logo);
  const isAdmin = Number(user?.id_Roles) === 1;
  const [detail, setDetail] = useState(null);
  const [editId, setEditId] = useState(null);

  const { data, loading, refetch } = useApi(
    () => api.get("/returns", { params:{ type:"SUPPLIER", limit:100 } }), []
  );
  const rows = Array.isArray(data) ? data : (data?.data || []);

  const openDetail = async (id) => {
    try { const r = await api.get(`/returns/${id}`); setDetail(r?.data || null); }
    catch { /* ignore */ }
  };

  return (
    <AppLayout title="مرتجعات المشتريات" actions={<Button onClick={onNew}>✚ مرتجع جديد</Button>}>

      <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", overflow:"hidden", marginBottom:16 }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:".875rem" }}>
          <thead>
            <tr style={{ background:"var(--bg-surface)", borderBottom:"1px solid var(--border)" }}>
              {["رقم","التاريخ","المورد","أصناف","الإجمالي","ملاحظة",""].map((h,i)=>(
                <th key={i} style={thSt}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding:40, textAlign:"center" }}><span className="spinner"/></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} style={{ padding:48, textAlign:"center", color:"var(--text-muted)" }}>لا توجد سندات مرتجعات</td></tr>
            ) : rows.map(r => (
              <tr key={r.id_NoFRetern} onClick={() => openDetail(r.id_NoFRetern)}
                style={{ borderBottom:"1px solid var(--border-subtle)", cursor:"pointer" }}
                onMouseEnter={e => e.currentTarget.style.background="var(--bg-hover)"}
                onMouseLeave={e => e.currentTarget.style.background=""}>
                <td style={{ ...tdSt, fontFamily:"var(--font-mono)", color:"var(--accent)", fontWeight:800 }}>#{r.id_NoFRetern}</td>
                <td style={tdSt}>{r.Date_FRetern?.split("T")[0]}</td>
                <td style={{ ...tdSt, fontWeight:700 }}>{r.PartyName || "—"}</td>
                <td style={{ ...tdSt, textAlign:"center" }}><span style={{ padding:"2px 10px", background:"var(--info-bg)", color:"var(--info)", borderRadius:20, fontSize:".76rem", fontWeight:700 }}>{r.ItemCount||0}</span></td>
                <td style={{ ...tdSt, fontFamily:"var(--font-mono)", color:"var(--accent)", fontWeight:900 }}>{fmtC(r.TotalValue)}</td>
                <td style={{ ...tdSt, color:"var(--text-muted)", fontSize:".82rem" }}>{r.Note_FRetern||"—"}</td>
                <td style={{ ...tdSt, color:"var(--text-muted)", fontSize:".78rem" }}>عرض ←</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* نافذة التفاصيل */}
      {detail && (
        <DetailPanel data={detail} onClose={() => setDetail(null)}
          onDeleted={() => { setDetail(null); refetch(); }}
          onEdit={() => setEditId(detail.id_NoFRetern)}
          onPrint={() => openInvoicePrint(returnPayloadFromDetail(detail, company, logoUrl))}
          isAdmin={isAdmin} />
      )}
      {editId && (
        <ReturnEditModal
          returnId={editId}
          onClose={() => setEditId(null)}
          onSaved={async (id) => {
            setEditId(null);
            refetch();
            if (detail?.id_NoFRetern === id) {
              try {
                const r = await api.get(`/returns/${id}`);
                setDetail(r?.data || null);
              } catch { /* ignore */ }
            }
          }}
        />
      )}
    </AppLayout>
  );
}

// ══════════════════════════════════════════════════════════
//  Detail Panel
// ══════════════════════════════════════════════════════════
function DetailPanel({ data, onClose, onDeleted, onEdit, onPrint, isAdmin }) {
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async () => {
    if (!confirm(`⚠ حذف سند #${data.id_NoFRetern}؟\n\nسيُعكَس المخزون والديون بالكامل.`)) return;
    setDeleting(true);
    try { await api.delete(`/returns/${data.id_NoFRetern}`); onDeleted(); }
    catch (e) { alert(`خطأ: ${e.message}`); }
    finally { setDeleting(false); }
  };

  return (
    <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"12px 18px", background:"var(--bg-surface)", borderBottom:"1px solid var(--border-subtle)" }}>
        <span style={{ fontFamily:"var(--font-mono)", fontWeight:900, color:"var(--accent)", padding:"5px 14px", background:"var(--accent-glow)", border:"1px solid var(--accent)", borderRadius:"var(--radius-full)" }}>
          سند #{data.id_NoFRetern}
        </span>
        <div style={{ flex:1 }} />
        {isAdmin && (
          <Button size="sm" onClick={onEdit}>✏️ تعديل المدير</Button>
        )}
        <Button size="sm" onClick={onPrint}>🖨 طباعة</Button>
        <Button size="sm" variant="danger" loading={deleting} onClick={handleDelete}>🗑 حذف</Button>
        <Button size="sm" variant="ghost"  onClick={onClose}>✕ إغلاق</Button>
      </div>

      <div style={{ padding:"20px 22px" }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:14, marginBottom:20 }}>
          {[
            { l:"رقم السند", v:`#${data.id_NoFRetern}`, mono:true, accent:true },
            { l:"التاريخ",   v:data.Date_FRetern?.split("T")[0] },
            { l:"المورد",    v:data.PartyName, bold:true },
            { l:"عدد الأصناف", v:`${data.ItemCount||0} صنف` },
            { l:"الإجمالي",  v:fmtC(data.TotalValue), mono:true, accent:true },
          ].map((f,i)=>(
            <div key={i}>
              <div style={{ fontSize:".68rem", fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", marginBottom:5 }}>{f.l}</div>
              <div style={{ fontWeight:f.bold?800:600, fontFamily:f.mono?"var(--font-mono)":"inherit", color:f.accent?"var(--accent)":"var(--text-primary)" }}>{f.v}</div>
            </div>
          ))}
        </div>

        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:".83rem" }}>
            <thead>
              <tr style={{ background:"var(--bg-surface)", borderBottom:"2px solid var(--border)" }}>
                {["#","المادة","الكمية","السعر","سبب المرتجع","الإجمالي"].map((h,i)=>(
                  <th key={i} style={{ padding:"9px 11px", textAlign:i===2?"center":"right", color:"var(--text-secondary)", fontWeight:700, fontSize:".67rem", textTransform:"uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.lines||[]).map((l,i)=>(
                <tr key={i} style={{ borderBottom:"1px solid var(--border-subtle)", background:i%2===0?"var(--bg-hover)":"" }}>
                  <td style={{ padding:"9px 11px", color:"var(--text-muted)", fontFamily:"var(--font-mono)", fontSize:".74rem" }}>{i+1}</td>
                  <td style={{ padding:"9px 11px", fontWeight:700 }}>{l.MaterialName}</td>
                  <td style={{ padding:"9px 11px", textAlign:"center", fontFamily:"var(--font-mono)", fontWeight:800 }}>{l.AmountReturn}</td>
                  <td style={{ padding:"9px 11px", fontFamily:"var(--font-mono)" }}>{fmtC(l.PriceReturn)}</td>
                  <td style={{ padding:"9px 11px", color:"var(--text-muted)", fontSize:".82rem" }}>{l.ReturnReason||"—"}</td>
                  <td style={{ padding:"9px 11px", fontFamily:"var(--font-mono)", fontWeight:700, color:"var(--accent)" }}>{fmtC(l.LineTotal)}</td>
                </tr>
              ))}
              <tr style={{ background:"var(--bg-surface)", borderTop:"2px solid var(--border)" }}>
                <td colSpan={5} style={{ padding:"10px 11px", textAlign:"right", fontWeight:700, color:"var(--text-secondary)", fontSize:".82rem" }}>الإجمالي</td>
                <td style={{ padding:"10px 11px", fontFamily:"var(--font-mono)", fontWeight:900, color:"var(--accent)", fontSize:".95rem" }}>{fmtC(data.TotalValue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  Screen 2 — نموذج الإنشاء
// ══════════════════════════════════════════════════════════
function FormScreen({ onDone }) {
  const { company } = useCompany();
  const logoUrl = companyLogoUrl(company?.CompanyInformation_Logo);
  const [hdr, setHdr] = useState({ Date_FRetern: today(), id_Amil:"", Note_FRetern:"" });
  const sh = k => v => setHdr(p => ({ ...p, [k]:v }));

  const [lines, setLines] = useState(() => [newLine()]);

  const { data: suppData } = useApi(() => partyService.getSuppliers(), []);
  const { data: matsData, loading: loadingMats } = useApi(() => materialsService.getAll(), []);
  const suppliers  = Array.isArray(suppData) ? suppData : (suppData?.data || []);
  const allMats    = Array.isArray(matsData) ? matsData : (matsData?.data || []);

  // حساب المورد المختار
  const { data: supBalData, loading: loadingBal } = useApi(
    () => hdr.id_Amil ? partyService.getOneSupplier(hdr.id_Amil) : Promise.resolve(null),
    [hdr.id_Amil]
  );
  const supBal = supBalData?.data || null;
  // TotalDebt = صافي ديون DionAmil (يشمل تسويات السندات) — لا نطرح TotalPaid مرة ثانية
  // لأن NetBalance يخصم المدفوعات مرتين (LC/خصم/دفعات الفاتورة)
  const prevBal = +(supBal?.TotalDebt ?? supBal?.totalDebt ?? 0);

  const validLines  = useMemo(() => lines.filter(l => l.id_Material_NoM), [lines]);
  const grandTotal  = useMemo(() => r2(validLines.reduce((s,l) => s + r2((+l.AmountReturn||0)*(+l.PriceOUT||0)), 0)), [validLines]);
  const finalBal    = useMemo(() => r2(prevBal - grandTotal), [prevBal, grandTotal]);

  const getReturnPrice = async (mat) => {
    try {
      const r = await api.get("/returns/price-default", {
        params: { type: "SUPPLIER", id_Material_NoM: mat.id_Material_NoM, id_Party: hdr.id_Amil || undefined },
      });
      return r2(r?.defaultPrice ?? r?.data?.defaultPrice ?? mat.CostPrice ?? 0);
    } catch {
      return r2(mat.CostPrice || 0);
    }
  };

  const [saving,  setSaving ] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [savedId, setSavedId] = useState(null);

  const handleSave = async () => {
    setSaveErr("");
    if (!hdr.id_Amil)       return setSaveErr("يرجى اختيار المورد");
    if (!validLines.length)  return setSaveErr("يرجى إضافة مادة واحدة على الأقل");
    const over = validLines.filter(l => l.AmountReturn > l.stock);
    if (over.length) return setSaveErr(`الكمية تتجاوز المخزون: ${over.map(l=>`${l.MaterialName}(${l.stock})`).join("، ")}`);
    setSaving(true);
    try {
      const res = await api.post("/returns", {
        ReturnType   : "SUPPLIER",
        id_Party     : hdr.id_Amil,
        Date_FRetern : hdr.Date_FRetern,
        Note_FRetern : hdr.Note_FRetern,
        lines: validLines.map(l => ({
          id_Material_NoM : l.id_Material_NoM,
          AmountReturn    : +l.AmountReturn || 1,
          PriceOUT        : +l.PriceOUT    || 0,
          ReturnReason    : l.ReturnReason  || "",
        })),
      });
      setSavedId(res?.returnId);
    } catch (e) { setSaveErr(e.message || "حدث خطأ"); }
    finally { setSaving(false); }
  };

  if (savedId) {
    const printSaved = async () => {
      try {
        const r = await api.get(`/returns/${savedId}`);
        openInvoicePrint(returnPayloadFromDetail(r?.data, company, logoUrl));
      } catch (e) {
        alert(e?.message || "تعذّر تحميل السند للطباعة");
      }
    };
    return (
    <AppLayout title="مرتجع مشتريات جديد" actions={<Button variant="ghost" onClick={onDone}>← رجوع</Button>}>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:18, padding:"60px 20px", textAlign:"center" }}>
        <div style={{ fontSize:52 }}>✅</div>
        <div style={{ fontSize:"1.3rem", fontWeight:800 }}>تم حفظ سند الإرجاع بنجاح!</div>
        <div style={{ fontFamily:"var(--font-mono)", color:"var(--accent)", fontSize:"1.1rem" }}>سند #{savedId}</div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", justifyContent:"center" }}>
          <Button onClick={printSaved}>🖨 طباعة السند</Button>
          <Button variant="ghost" onClick={onDone}>← العودة للقائمة</Button>
        </div>
      </div>
    </AppLayout>
    );
  }

  return (
    <AppLayout title="مرتجع مشتريات جديد" actions={<Button variant="ghost" onClick={onDone}>← رجوع</Button>}>
      <div style={{ display:"grid", gridTemplateColumns:RETURN_FORM_GRID, gap:16, alignItems:"start", width:"100%", maxWidth:"100%", boxSizing:"border-box" }}>

        {/* ══ العمود الرئيسي ══ */}
        <div style={{ display:"flex", flexDirection:"column", gap:14, minWidth:0, maxWidth:"100%", overflow:"hidden" }}>

          {/* رأس السند */}
          <Panel label="بيانات الإرجاع">
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:14 }}>
              <Fld label="التاريخ *">
                <input type="date" value={hdr.Date_FRetern} onChange={e=>sh("Date_FRetern")(e.target.value)} style={{ ...inpSt, width:"100%", boxSizing:"border-box" }} />
              </Fld>
              <Fld label="المورد *">
                <select value={hdr.id_Amil} onChange={e=>sh("id_Amil")(e.target.value)} style={selSt}>
                  <option value="">— اختر المورد —</option>
                  {suppliers.map(s=><option key={s.id_Amil} value={s.id_Amil}>{s.AmilName}</option>)}
                </select>
              </Fld>
              <Fld label="ملاحظة">
                <input value={hdr.Note_FRetern} onChange={e=>sh("Note_FRetern")(e.target.value)} placeholder="اختياري..." style={{ ...inpSt, width:"100%", boxSizing:"border-box" }} />
              </Fld>
            </div>

            {/* حساب المورد */}
            {hdr.id_Amil && (
              <div style={{ marginTop:14, padding:"12px 14px", background:"var(--bg-surface)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12 }}>
                {loadingBal ? (
                  <div style={{ display:"flex", gap:8, alignItems:"center", color:"var(--text-muted)", fontSize:".84rem" }}>
                    <span className="spinner" style={{ width:14, height:14 }}/> جاري جلب الحساب...
                  </div>
                ) : supBal ? (
                  <>
                    <SumInfo l="إجمالي الديون" v={fmtC(supBal.TotalDebt||0)} c="var(--warning)" />
                    <SumInfo l="المدفوع"        v={fmtC(supBal.TotalPaid||0)} c="var(--success)" />
                  </>
                ) : null}
              </div>
            )}
          </Panel>

          {/* ماسح الباركود */}
          <BarcodeScanner allMats={allMats} onAdd={async mat => {
            const price = await getReturnPrice(mat);
            setLines(prev => {
              const empty = prev.findIndex(l=>!l.id_Material_NoM);
              const data  = { id_Material_NoM:mat.id_Material_NoM, MaterialName:mat.MaterialName, Barcode:mat.Barcode||"", Band:mat.Band||"", PriceOUT:price, stock:mat.QuantityOnHand||0 };
              if (empty >= 0) return prev.map((l,i)=>i===empty?{...l,...data}:l);
              return [...prev, { ...newLine(), ...data }];
            });
          }} />

          {/* جدول الأسطر */}
          <Panel label={`أسطر الإرجاع (${validLines.length} صنف)`} noPad>
            <div style={{ overflowX:"auto", maxWidth:"100%", WebkitOverflowScrolling:"touch" }}>
              <table style={{ width:"100%", minWidth:680, tableLayout:"fixed", borderCollapse:"collapse", fontSize:".82rem" }}>
                <colgroup>
                  {PUR_RETURN_LINE_COL_WIDTHS.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead>
                  <tr style={{ background:"var(--bg-surface)", borderBottom:"2px solid var(--border)" }}>
                    {[
                      { l:"#",              a:"center" },
                      { l:"اختيار المادة", a:"right" },
                      { l:"الباركود",       a:"center" },
                      { l:"مخزون",          a:"center" },
                      { l:"الكمية",         a:"center" },
                      { l:"السعر",          a:"left" },
                      { l:"سبب المرتجع",   a:"right" },
                      { l:"الإجمالي",       a:"left" },
                      { l:"",               a:"center" },
                    ].map((h,i)=>(
                      <th key={i} style={{ padding:"9px 6px", textAlign:h.a, color:"var(--text-secondary)", fontWeight:700, fontSize:".67rem", textTransform:"uppercase", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{h.l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line,idx)=>(
                    <ReturnLineRow
                      key={line._lid} idx={idx+1} line={line}
                      allMats={allMats} loadingMats={loadingMats}
                      getReturnPrice={getReturnPrice}
                      onUpdate={u=>setLines(p=>p.map((l,i)=>i===idx?{...l,...u}:l))}
                      onRemove={()=>setLines(p=>{ const n=p.filter((_,i)=>i!==idx); return n.length?n:[newLine()]; })}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop:"1px dashed var(--border)" }}>
                    <td colSpan={9} style={{ padding:"7px 10px" }}>
                      <button onClick={()=>setLines(p=>[...p,newLine()])}
                        style={{ width:"100%", padding:"6px", background:"none", border:"1px dashed var(--border)", borderRadius:"var(--radius-sm)", color:"var(--text-muted)", cursor:"pointer", fontSize:".8rem", fontFamily:"var(--font-main)" }}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--accent)";e.currentTarget.style.color="var(--accent)"}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.color="var(--text-muted)"}}>
                        ＋ إضافة سطر جديد
                      </button>
                    </td>
                  </tr>
                  {validLines.length > 0 && (
                    <tr style={{ borderTop:"2px solid var(--border)", background:"var(--bg-surface)" }}>
                      <td colSpan={7} style={{ padding:"10px", textAlign:"right", fontWeight:700, color:"var(--text-secondary)", fontSize:".82rem" }}>
                        إجمالي الأسطر ({validLines.length} صنف · {validLines.reduce((s,l)=>s+(+l.AmountReturn||0),0)} وحدة)
                      </td>
                      <td style={{ padding:"10px", textAlign:"left", fontFamily:"var(--font-mono)", fontWeight:900, color:"var(--accent)", fontSize:".95rem" }}>
                        {fmtC(grandTotal)}
                      </td>
                      <td/>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          </Panel>

          {saveErr && (
            <div style={{ padding:"12px 16px", background:"var(--danger-bg)", border:"1px solid var(--danger)", borderRadius:"var(--radius-md)", color:"var(--danger)", fontWeight:600, fontSize:".88rem" }}>⚠ {saveErr}</div>
          )}
        </div>

        {/* ══ الشريط الجانبي ══ */}
        <div style={{ display:"flex", flexDirection:"column", gap:14, position:"sticky", top:72, minWidth:0, maxWidth:280 }}>

          {/* ملخص السند */}
          <Panel label="ملخص الإرجاع">
            <SumRow l="مجموع السطور"   v={grandTotal} />
            <div style={{ borderTop:"2px solid var(--border)", marginTop:10, paddingTop:10 }}>
              <SumRow l="إجمالي المرتجع" v={grandTotal} accent big />
            </div>

            {/* الأثر على حساب المورد */}
            <div style={{ marginTop:14, paddingTop:14, borderTop:"1px dashed var(--border)" }}>
              <div style={{ fontSize:".68rem", fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:".04em", marginBottom:10 }}>💳 حساب المورد</div>
              {hdr.id_Amil && supBal ? (
                <>
                  <SumRow l="الحساب السابق"  v={Math.abs(prevBal)} c={prevBal > 0 ? "var(--warning)" : "var(--success)"} />
                  <SumRow l="− قيمة المرتجع" v={grandTotal} c="var(--success)" minus />
                  <div style={{ padding:"9px 12px", marginTop:8, background:"var(--accent-glow)", border:"2px solid var(--accent)", borderRadius:"var(--radius-md)", display:"flex", justifyContent:"space-between", alignItems:"center", fontWeight:800 }}>
                    <span style={{ fontSize:".88rem" }}>الحساب النهائي</span>
                    <div style={{ textAlign:"left" }}>
                      <div style={{ fontFamily:"var(--font-mono)", fontSize:".95rem", color:finalBal>0?"var(--danger)":"var(--success)" }}>{fmtC(Math.abs(finalBal))}</div>
                      <div style={{ fontSize:".66rem", color:"var(--text-muted)" }}>{finalBal>0?"(مدين)":finalBal<0?"(دائن)":"(مسوَّى)"}</div>
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ padding:"14px 10px", border:"1px dashed var(--border)", borderRadius:"var(--radius-sm)", textAlign:"center", fontSize:".8rem", color:"var(--text-muted)", lineHeight:1.7 }}>
                  اختر مورداً<br/><span style={{ fontSize:".72rem" }}>لعرض الحساب</span>
                </div>
              )}
            </div>

            {/* الأثر المخزني */}
            {grandTotal > 0 && (
              <div style={{ marginTop:10, padding:"10px 12px", background:"rgba(239,68,68,.08)", border:"1px solid rgba(239,68,68,.25)", borderRadius:"var(--radius-md)", fontSize:".77rem", color:"var(--danger)", lineHeight:1.9 }}>
                <b>الأثر عند الحفظ:</b><br/>
                📦 نقصان المخزون لكل صنف<br/>
                💳 خصم {fmtC(grandTotal)} من ديننا للمورد
              </div>
            )}

            <div style={{ marginTop:10, fontSize:".74rem", color:"var(--text-muted)", textAlign:"center" }}>
              {validLines.length} صنف · {validLines.reduce((s,l)=>s+(+l.AmountReturn||0),0)} وحدة
            </div>
          </Panel>

          <Button onClick={handleSave} loading={saving} fullWidth size="lg">📤 حفظ سند الإرجاع</Button>
        </div>
      </div>
    </AppLayout>
  );
}

// ── مكوّن سطر الإرجاع ──────────────────────────────────────
function ReturnLineRow({ idx, line, allMats, loadingMats, getReturnPrice, onUpdate, onRemove }) {
  const lineTotal = useMemo(() => r2((+line.AmountReturn||0)*(+line.PriceOUT||0)), [line.AmountReturn, line.PriceOUT]);
  const over = line.AmountReturn > line.stock && line.id_Material_NoM;

  const pick = async mat => {
    const price = await getReturnPrice(mat);
    onUpdate({ id_Material_NoM:mat.id_Material_NoM, MaterialName:mat.MaterialName, Barcode:mat.Barcode||"", Band:mat.Band||"", PriceOUT:price, stock:mat.QuantityOnHand||0 });
  };
  const clear = () => onUpdate({ id_Material_NoM:null, MaterialName:"", Barcode:"", Band:"", PriceOUT:0, stock:0 });

  return (
    <tr style={{ borderBottom:"1px solid var(--border-subtle)", background:over?"rgba(239,68,68,.04)":"" }}
      onMouseEnter={e=>{e.currentTarget.style.background=over?"rgba(239,68,68,.08)":"var(--bg-hover)"}}
      onMouseLeave={e=>{e.currentTarget.style.background=over?"rgba(239,68,68,.04)":""}}>

      {/* # */}
      <td style={{ padding:"8px 10px", textAlign:"center", fontFamily:"var(--font-mono)", color:"var(--text-muted)", fontSize:".8rem", fontWeight:700 }}>{idx}</td>

      {/* اختيار المادة */}
      <td style={{ padding:"8px 6px", position:"relative", minWidth:0 }}>
        {line.MaterialName ? (
          <div style={{ display:"flex", gap:5, alignItems:"flex-start" }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, fontSize:".84rem", color:"var(--text-primary)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{line.MaterialName}</div>
              {line.Band && <div style={{ fontSize:".67rem", color:"var(--text-muted)", marginTop:2 }}>{line.Band}</div>}
            </div>
            <button onClick={clear} style={{ flexShrink:0, background:"none", border:"none", color:"var(--text-muted)", cursor:"pointer", fontSize:".85rem", padding:"1px 4px" }}>✎</button>
          </div>
        ) : (
          <select value="" onChange={e=>{ const m=allMats.find(x=>Number(x.id_Material_NoM)===Number(e.target.value)); if(m)pick(m); }}
            style={{ ...selSt, padding:"6px 10px", borderColor:"var(--accent)", fontSize:".83rem" }}>
            <option value="">{loadingMats?"جاري التحميل...":"اختر مادة..."}</option>
            {allMats.map(m=><option key={m.id_Material_NoM} value={m.id_Material_NoM}>{m.MaterialName}{m.Barcode?` (${m.Barcode})`:""}</option>)}
          </select>
        )}
      </td>

      {/* الباركود */}
      <td style={{ padding:"8px 10px", textAlign:"center", fontFamily:"var(--font-mono)", fontSize:".76rem", color:line.Barcode?"var(--accent)":"var(--text-muted)" }}>{line.Barcode||"—"}</td>

      {/* المخزون */}
      <td style={{ padding:"8px 10px", textAlign:"center" }}>
        <span style={{ fontFamily:"var(--font-mono)", fontWeight:700, color:over?"var(--danger)":line.stock>0?"var(--accent)":"var(--text-muted)" }}>{line.stock||0}</span>
        {over && <div style={{ fontSize:".62rem", color:"var(--danger)" }}>⚠ يتجاوز</div>}
      </td>

      {/* الكمية */}
      <td style={{ padding:"8px 10px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:3, justifyContent:"center" }}>
          <QtyBtn onClick={()=>onUpdate({AmountReturn:Math.max(1,(+line.AmountReturn||1)-1)})}>−</QtyBtn>
          <input type="number" min="1" value={line.AmountReturn??1}
            onChange={e=>onUpdate({AmountReturn:Math.max(1,+e.target.value||1)})}
            style={{ ...numSt, width:44, textAlign:"center", padding:"4px 3px", fontWeight:800, borderColor:over?"var(--danger)":"var(--border)" }}/>
          <QtyBtn accent onClick={()=>onUpdate({AmountReturn:(+line.AmountReturn||1)+1})}>+</QtyBtn>
        </div>
      </td>

      {/* السعر */}
      <td style={{ padding:"8px 10px" }}>
        <input type="number" min="0" step="any" value={numFieldValue(line.PriceOUT)} placeholder="0"
          onChange={e=>onUpdate({PriceOUT: e.target.value === "" ? "" : Math.max(0,+e.target.value||0)})}
          style={{ ...numSt, width:90, padding:"5px 8px", textAlign:"left", fontWeight:700, color:"#fbbf24" }}/>
      </td>

      {/* السبب */}
      <td style={{ padding:"8px 10px" }}>
        <input value={line.ReturnReason||""} onChange={e=>onUpdate({ReturnReason:e.target.value})}
          placeholder="اختياري..."
          style={{ ...numSt, width:130, padding:"5px 8px", fontFamily:"var(--font-main)", fontSize:".82rem" }}/>
      </td>

      {/* الإجمالي */}
      <td style={{ padding:"8px 10px" }}>
        <div style={{ padding:"5px 8px", borderRadius:6, background:"var(--bg-surface)", border:"1px solid var(--border-subtle)", fontFamily:"var(--font-mono)", fontWeight:900, color:lineTotal>0?"var(--accent)":"var(--text-muted)", fontSize:".9rem", minWidth:88 }}>
          {fmtC(lineTotal)}
        </div>
      </td>

      {/* حذف */}
      <td style={{ padding:"8px 10px", textAlign:"center" }}>
        <button onClick={onRemove}
          style={{ background:"none", border:"none", color:"var(--danger)", cursor:"pointer", fontSize:"1.1rem", padding:"2px 6px", borderRadius:4 }}
          onMouseEnter={e=>e.currentTarget.style.background="var(--danger-bg)"}
          onMouseLeave={e=>e.currentTarget.style.background="none"}>✕</button>
      </td>
    </tr>
  );
}

// ── ماسح الباركود ───────────────────────────────────────────
function BarcodeScanner({ allMats, onAdd }) {
  const [bc, setBc] = useState("");
  const [msg, setMsg] = useState({ text:"", ok:true });
  const ref = useRef(null);

  const scan = (val) => {
    const v = (val||"").trim(); if(!v) return;
    const mat = allMats.find(m => m.Barcode?.toLowerCase()===v.toLowerCase() || m.MaterialName?.toLowerCase().includes(v.toLowerCase()));
    if (mat) { onAdd(mat); setBc(""); setMsg({ text:`✅ أُضيفت: ${mat.MaterialName}`, ok:true }); ref.current?.focus(); }
    else      { setMsg({ text:`⚠ لا توجد مادة: ${v}`, ok:false }); }
    setTimeout(()=>setMsg({text:"",ok:true}), 2500);
  };

  return (
    <Panel label="📷 مسح الباركود — اكتب أو امسح ثم اضغط Enter">
      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
        <input ref={ref} value={bc} onChange={e=>setBc(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter") scan(bc); }}
          placeholder="امسح الباركود أو اكتبه يدوياً..."
          style={{ flex:1, padding:"10px 14px", ...numSt, fontFamily:"var(--font-mono)", fontSize:".95rem" }}
          onFocus={e=>e.target.style.borderColor="var(--accent)"}
          onBlur={e=>e.target.style.borderColor="var(--border)"}/>
        <Button size="sm" onClick={()=>scan(bc)}>إضافة ↵</Button>
      </div>
      {msg.text && <div style={{ marginTop:8, fontSize:".82rem", color:msg.ok?"var(--success)":"var(--warning)", fontWeight:600 }}>{msg.text}</div>}
    </Panel>
  );
}

// ── مساعدات UI ──────────────────────────────────────────────
function Panel({ label, children, noPad }) {
  return (
    <div style={{ background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)", overflow:"hidden" }}>
      {label && <div style={{ padding:"10px 16px", borderBottom:"1px solid var(--border-subtle)", fontSize:".7rem", fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:".05em" }}>{label}</div>}
      <div style={{ padding:noPad?0:"16px" }}>{children}</div>
    </div>
  );
}
function Fld({ label, children }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:5, flex:1, minWidth:160 }}>
      <label style={{ fontSize:".72rem", fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:".04em" }}>{label}</label>
      {children}
    </div>
  );
}
function SumRow({ l, v, c, accent, big, minus }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"5px 0", borderBottom:"1px solid var(--border-subtle)" }}>
      <span style={{ fontSize:big?".9rem":".82rem", fontWeight:big?800:500, color:"var(--text-secondary)" }}>{l}</span>
      <span style={{ fontFamily:"var(--font-mono)", fontWeight:big?900:600, color:accent?"var(--accent)":c||"var(--text-primary)", fontSize:big?".95rem":".84rem" }}>
        {minus?"− ":""}{fmtC(v)}
      </span>
    </div>
  );
}
function SumInfo({ l, v, c }) {
  return (
    <div>
      <div style={{ fontSize:".68rem", color:"var(--text-muted)", marginBottom:4, textTransform:"uppercase" }}>{l}</div>
      <div style={{ fontFamily:"var(--font-mono)", fontWeight:700, color:c||"var(--text-primary)" }}>{v}</div>
    </div>
  );
}
function QtyBtn({ children, onClick, accent }) {
  return (
    <button onClick={onClick} style={{ width:26, height:26, borderRadius:6, border:"1px solid var(--border)", background:"var(--bg-hover)", cursor:"pointer", fontWeight:800, color:accent?"var(--accent)":"var(--text-primary)", fontSize:"1rem", display:"flex", alignItems:"center", justifyContent:"center" }}>
      {children}
    </button>
  );
}
