// ============================================================
//  src/pages/settings/FinancialSettings.jsx
//  الإعدادات المالية — رأس المال وملخص الصندوق
//
//  للمدير فقط (AdminRoute)
//  مستقل تماماً — ملف منفصل لا يلمس أي صفحة أخرى
// ============================================================
import { useState }           from "react";
import AppLayout              from "@/components/layout/AppLayout";
import { Card, StatCard }     from "@/components/ui/Card";
import Button                 from "@/components/ui/Button";
import { useApi, useAction }  from "@/hooks/useApi";
import { fmtC, fmtN, r2 }   from "@/utils/numFormat";
import { capitalService }     from "@/services/spendingService";

export default function FinancialSettings() {

  const { data: capData,    loading: capLoading,     refetch: refetchCap     } =
    useApi(() => capitalService.get(),     []);
  const { data: sumData,    loading: sumLoading,     refetch: refetchSummary } =
    useApi(() => capitalService.summary(), []);
  const { data: histData,   loading: histLoading, refetch: refetchHistory } =
    useApi(() => capitalService.history(), []);

  const current   = capData?.data  || {};
  const summary   = sumData?.data  || {};
  const history   = histData?.data || [];

  const [amount,  setAmount ] = useState("");
  const [notes,   setNotes  ] = useState("");
  const [amtErr,  setAmtErr ] = useState("");
  const [saved,   setSaved  ] = useState(false);
  const [editRow, setEditRow ] = useState(null);
  const [editAmt, setEditAmt ] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDate, setEditDate] = useState("");

  const { loading: saving, execute } = useAction();
  const { loading: editing, execute: execEdit } = useAction();

  const refetchAll = () => { refetchCap(); refetchSummary(); refetchHistory(); };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) {
      setAmtErr("أدخل مبلغاً أكبر من صفر");
      return;
    }
    setAmtErr("");
    await execute(
      () => capitalService.set({ CapitalAmount: Number(amount), Notes: notes || undefined }),
      {
        onSuccess: (res) => {
          setAmount("");
          setNotes("");
          setSaved(res?.newTotal ?? true);
          refetchAll();
          setTimeout(() => setSaved(false), 4000);
        },
        onError: (e) => setAmtErr(e),
      }
    );
  };

  const startEdit = (h) => {
    setEditRow(h.id_Capital);
    setEditAmt(String(h.CapitalAmount));
    setEditNotes(h.Notes || "");
    setEditDate(h.DepositDate || "");
  };

  const cancelEdit = () => {
    setEditRow(null);
    setEditAmt("");
    setEditNotes("");
    setEditDate("");
  };

  const saveEdit = async (id) => {
    if (!editAmt || Number(editAmt) <= 0) return;
    await execEdit(
      () => capitalService.update(id, {
        CapitalAmount: Number(editAmt),
        Notes: editNotes || undefined,
        DepositDate: editDate || undefined,
      }),
      {
        onSuccess: () => { cancelEdit(); refetchAll(); },
        onError: (e) => alert(e),
      }
    );
  };

  const handleDelete = async (id, amount) => {
    if (!confirm(`حذف إيداع ${fmtC(amount)}؟`)) return;
    await execEdit(
      () => capitalService.remove(id),
      {
        onSuccess: () => refetchAll(),
        onError: (e) => alert(e),
      }
    );
  };

  return (
    <AppLayout title="الإعدادات المالية">

      {/* ── ملخص الصندوق (للقراءة فقط) ─────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:26 }}>
        <StatCard
          label   ="إجمالي رأس المال التراكمي"
          value   ={capLoading ? "…" : fmtC(current.CapitalAmount || 0)}
          variant ="accent"
          sub     ={`${current.depositsCount || 0} إيداع مسجّل`}
        />
        <StatCard
          label   ="إجمالي المقبوضات"
          value   ={sumLoading ? "…" : fmtC(summary.receipts || 0)}
          variant ="success"
          sub     ="سندات القبض من الزبائن"
        />
        <StatCard
          label   ="إجمالي المصاريف والمدفوعات"
          value   ={sumLoading ? "…" : fmtC((summary.expenses || 0) + (summary.supplierPayments || 0))}
          variant ="danger"
          sub     ="مصاريف + مدفوعات للموردين"
        />
        <StatCard
          label   ="الرصيد الجاري"
          value   ={sumLoading ? "…" : fmtC(summary.balance || 0)}
          variant ={(summary.balance || 0) >= 0 ? "success" : "danger"}
          sub     ={summary.balanceStatus || "رأس المال ± التدفقات"}
        />
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, alignItems:"start" }}>

        {/* ── نموذج تعيين رأس المال ────────────────────── */}
        <Card>
          <div style={{ marginBottom:18 }}>
            <div style={{ fontWeight:800, fontSize:"1rem", marginBottom:4 }}>
              💰 إضافة رأس مال
            </div>
            <div style={{ fontSize:".82rem", color:"var(--text-muted)" }}>
              كل مبلغ تُدخله يُضاف إلى إجمالي رأس المال التراكمي ويُسجَّل في السجل التاريخي.
            </div>
          </div>

          {/* الإجمالي الحالي */}
          <div style={{
            padding:"12px 16px", marginBottom:18,
            background:"var(--bg-surface)", border:"1px solid var(--border-subtle)",
            borderRadius:"var(--radius-md)",
          }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <span style={{ fontSize:".85rem", color:"var(--text-secondary)" }}>إجمالي رأس المال الحالي</span>
              <span style={{ fontFamily:"var(--font-mono)", fontWeight:800, fontSize:"1.1rem", color:"var(--accent)" }}>
                {capLoading ? "…" : fmtC(current.CapitalAmount || 0)}
              </span>
            </div>
            {(current.depositsCount || 0) > 0 && (
              <div style={{ fontSize:".75rem", color:"var(--text-muted)" }}>
                مجموع {current.depositsCount} إيداع
              </div>
            )}
          </div>

          {saved && (
            <div className="alert alert-success animate-fade-in" style={{ marginBottom:14 }}>
              ✅ تمت الإضافة — إجمالي رأس المال الجديد: {fmtC(saved)}
            </div>
          )}

          <form onSubmit={handleSave}>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <div>
                <label style={lblStyle}>المبلغ المُضاف (د.ع) *</label>
                <input
                  type="number" min="0.01" step="any"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setAmtErr(""); setSaved(false); }}
                  placeholder="مثال: 5000000"
                  style={{ ...inputStyle, borderColor: amtErr ? "var(--danger)" : "var(--border)" }}
                />
                {amtErr && <span style={errStyle}>{amtErr}</span>}
                {amount && Number(amount) > 0 && (
                  <div style={{ fontSize:".78rem", color:"var(--success)", marginTop:4, fontFamily:"var(--font-mono)" }}>
                    الإجمالي بعد الإضافة: {fmtC((current.CapitalAmount || 0) + Number(amount))}
                  </div>
                )}
              </div>

              <div>
                <label style={lblStyle}>ملاحظة (اختياري)</label>
                <input
                  type="text" value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="مثال: رأس مال افتتاحي، إضافة رأسمال شريك…"
                  style={{ ...inputStyle }}
                />
              </div>

              <Button type="submit" loading={saving} fullWidth>
                ➕ إضافة إلى رأس المال
              </Button>
            </div>
          </form>
        </Card>

        {/* ── تفصيل التدفقات + السجل التاريخي ─────────────── */}
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

          {/* تفصيل الصندوق */}
          <Card>
            <div style={{ fontWeight:800, fontSize:"1rem", marginBottom:16 }}>
              📊 تفصيل الصندوق (تراكمي)
            </div>
            {sumLoading ? (
              <div style={{ textAlign:"center", padding:20 }}><span className="spinner"/></div>
            ) : (
              <>
                <CashRow label="رأس المال الافتتاحي"        value={summary.capital || 0}          positive />
                <CashRow label="مقبوضات من الزبائن"         value={summary.receipts || 0}         positive />
                <CashRow label="مبيعات نقدية"               value={summary.cashSales || 0}        positive />
                <div style={{ borderTop:"1px solid var(--border)", margin:"10px 0" }}/>
                <CashRow label="مدفوعات للموردين"           value={summary.supplierPayments || 0} negative />
                <CashRow label="المصاريف التشغيلية"         value={summary.expenses || 0}        negative />
                <div style={{ borderTop:"2px solid var(--border)", margin:"10px 0" }}/>
                <div style={{
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"10px 0", fontWeight:800,
                }}>
                  <span style={{ fontSize:".95rem" }}>الرصيد الجاري</span>
                  <span style={{
                    fontFamily:"var(--font-mono)", fontSize:"1.1rem",
                    color:(summary.balance||0) >= 0 ? "var(--success)" : "var(--danger)",
                  }}>
                    {fmtC(summary.balance || 0)}
                  </span>
                </div>

                {/* تفصيل المصاريف حسب الموضوع */}
                {(summary.expensesByTopic || []).length > 0 && (
                  <>
                    <div style={{ fontSize:".78rem", fontWeight:700, color:"var(--text-muted)", marginTop:16, marginBottom:8, textTransform:"uppercase" }}>
                      تفصيل المصاريف حسب الموضوع
                    </div>
                    {summary.expensesByTopic.map((t, i) => (
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", fontSize:".85rem", borderBottom:"1px solid var(--border-subtle)" }}>
                        <span style={{ color:"var(--text-secondary)" }}>{t.topic}</span>
                        <span style={{ fontFamily:"var(--font-mono)", color:"var(--danger)" }}>{fmtC(t.amount)}</span>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </Card>

          {/* السجل التاريخي لرأس المال */}
          <Card padding="0">
            <div style={{ padding:"12px 16px", borderBottom:"1px solid var(--border-subtle)", fontWeight:700, fontSize:".88rem" }}>
              🕐 سجل إيداعات رأس المال
            </div>
            <div style={{ overflowY:"auto", maxHeight:220 }}>
              {histLoading ? (
                <div style={{ textAlign:"center", padding:20 }}><span className="spinner"/></div>
              ) : history.length === 0 ? (
                <div style={{ textAlign:"center", padding:30, color:"var(--text-muted)", fontSize:".85rem" }}>
                  لم يُسجَّل أي إيداع بعد
                </div>
              ) : history.map((h) => (
                <div key={h.id_Capital} style={{
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"10px 16px", borderBottom:"1px solid var(--border-subtle)", gap:8,
                }}>
                  {editRow === h.id_Capital ? (
                    <div style={{ flex:1, display:"flex", flexDirection:"column", gap:6 }}>
                      <input type="number" min="0.01" value={editAmt} onChange={e=>setEditAmt(e.target.value)}
                        style={{ ...inputStyle, padding:"6px 10px" }} />
                      <input type="text" value={editNotes} onChange={e=>setEditNotes(e.target.value)} placeholder="ملاحظة"
                        style={{ ...inputStyle, padding:"6px 10px" }} />
                      <input type="date" value={editDate} onChange={e=>setEditDate(e.target.value)}
                        style={{ ...inputStyle, padding:"6px 10px" }} />
                      <div style={{ display:"flex", gap:6 }}>
                        <Button size="sm" loading={editing} onClick={()=>saveEdit(h.id_Capital)}>حفظ</Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit}>إلغاء</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                          <span style={{ fontSize:".72rem", color:"var(--success)", background:"var(--success-bg)", border:"1px solid var(--success)", borderRadius:"var(--radius-full)", padding:"1px 7px" }}>
                            + إيداع
                          </span>
                          <span style={{ fontFamily:"var(--font-mono)", fontWeight:700, color:"var(--accent)", fontSize:".9rem" }}>
                            {fmtC(h.CapitalAmount)}
                          </span>
                        </div>
                        {h.Notes && <div style={{ fontSize:".75rem", color:"var(--text-muted)", marginTop:3 }}>{h.Notes}</div>}
                      </div>
                      <div style={{ fontSize:".78rem", color:"var(--text-muted)", fontFamily:"var(--font-mono)", flexShrink:0 }}>
                        {h.DepositDate || "—"}
                      </div>
                      <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                        <button onClick={()=>startEdit(h)} title="تعديل"
                          style={{ background:"var(--bg-hover)", border:"1px solid var(--border)", borderRadius:6, padding:"4px 8px", cursor:"pointer", fontSize:".75rem" }}>
                          ✏️
                        </button>
                        <button onClick={()=>handleDelete(h.id_Capital, h.CapitalAmount)} title="حذف"
                          style={{ background:"var(--danger-bg)", border:"1px solid var(--danger)", borderRadius:6, padding:"4px 8px", cursor:"pointer", fontSize:".75rem", color:"var(--danger)" }}>
                          🗑
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

// ── مساعد: صف الصندوق ─────────────────────────────────────
function CashRow({ label, value, positive, negative }) {
  const color = positive ? "var(--success)" : negative ? "var(--danger)" : "var(--text-primary)";
  const prefix = positive ? "+ " : negative ? "- " : "";
  return (
    <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", fontSize:".875rem", borderBottom:"1px solid var(--border-subtle)" }}>
      <span style={{ color:"var(--text-secondary)" }}>{label}</span>
      <span style={{ fontFamily:"var(--font-mono)", fontWeight:600, color }}>
        {prefix}{fmtC(r2(value))}
      </span>
    </div>
  );
}

// ── أنماط ────────────────────────────────────────────────
const lblStyle = { fontSize:".85rem", fontWeight:600, color:"var(--text-secondary)", display:"block", marginBottom:5 };
const errStyle = { fontSize:".8rem", color:"var(--danger)", display:"block", marginTop:3 };
const inputStyle = {
  width:"100%", padding:"10px 14px",
  background:"var(--bg-input)", border:"1px solid var(--border)",
  borderRadius:"var(--radius-md)", color:"var(--text-primary)",
  fontFamily:"var(--font-main)", fontSize:".95rem", outline:"none",
};
