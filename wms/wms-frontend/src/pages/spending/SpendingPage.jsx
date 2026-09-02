// ============================================================
//  src/pages/spending/SpendingPage.jsx  —  إدارة المصاريف
//
//  الجزء الأول : مواضيع الصرف (Spending_tbl)     — CRUD كامل
//  الجزء الثاني: تسجيل عمليات الصرف (SpendingDetails_tbl)
//
//  مستقل تماماً — لا يلمس أي صفحة أخرى
//  يستخدم: AppLayout, Card, Button, Input, Badge, StatCard
//           useApi, useAction, spendingService.js
// ============================================================
import { useState, useMemo }          from "react";
import AppLayout                      from "@/components/layout/AppLayout";
import { Card, StatCard, Badge }      from "@/components/ui/Card";
import Button                         from "@/components/ui/Button";
import Input                          from "@/components/ui/Input";
import { useApi, useAction }          from "@/hooks/useApi";
import { fmtC, fmtN, amountLabel }                from "@/utils/numFormat";
import { numFieldValue } from "@/utils/numInput";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { useCompany, companyLogoUrl } from "@/context/CompanyContext";
import {
  spendingTopicsService,
  spendingTxService,
  capitalService,
} from "@/services/spendingService";

const defaultGlId = (accounts) =>
  accounts.find((g) => g.AccountCode === "32")?.id_GL_Account ?? accounts[0]?.id_GL_Account ?? "";

// ──────────────────────────────────────────────────────────
//  تاريخ اليوم
// ──────────────────────────────────────────────────────────
const today = () => new Date().toISOString().split("T")[0];

// ══════════════════════════════════════════════════════════
//  الصفحة الرئيسية
// ══════════════════════════════════════════════════════════
export default function SpendingPage() {
  const { fmtC: fmtCUi, fmtN: fmtNUi } = useNumberLocale();

  // ── بيانات ────────────────────────────────────────────
  const { data: topicsData, loading: topicsLoading, refetch: refetchTopics } =
    useApi(() => spendingTopicsService.getAll(), []);

  const [txFilters, setTxFilters] = useState({ from: "", to: "", id_Spending: "" });
  const { data: txData, loading: txLoading, refetch: refetchTx } =
    useApi(() => spendingTxService.getAll({
      from        : txFilters.from       || undefined,
      to          : txFilters.to         || undefined,
      id_Spending : txFilters.id_Spending || undefined,
    }), [txFilters]);

  const { data: summaryData, refetch: refetchSummary } =
    useApi(() => capitalService.summary(), []);

  const { data: glData } =
    useApi(() => spendingTopicsService.listGlAccounts(), []);

  const glAccounts = glData?.data || [];
  const topics      = topicsData?.data  || [];
  const transactions= txData?.data      || [];
  const txTotal     = txData?.total     || 0;
  const summary     = summaryData?.data || {};

  // ── إحصائيات هذا الشهر ─────────────────────────────────
  const thisMonth = useMemo(() => {
    const now   = new Date();
    const start = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`;
    return transactions
      .filter((t) => t.Date_SpendingDetails >= start)
      .reduce((s, t) => s + (t.Price_SpendingDetails || 0), 0);
  }, [transactions]);

  // ── إعادة تحميل كل شيء ─────────────────────────────────
  const refetchAll = () => { refetchTopics(); refetchTx(); refetchSummary(); };

  return (
    <AppLayout title="إدارة المصاريف">

      {/* ── الإحصائيات ──────────────────────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:26 }}>
        <StatCard
          label   ="إجمالي مصاريف هذا الشهر"
          value   ={fmtCUi(thisMonth)}
          variant ="danger"
          sub     ="صرف الشهر الحالي"
        />
        <StatCard
          label   ="إجمالي كل المصاريف"
          value   ={fmtCUi(summary.expenses || 0)}
          variant ="warning"
          sub     ="منذ بداية النظام"
        />
        <StatCard
          label   ="عدد مواضيع الصرف"
          value   ={fmtNUi(topics.length)}
          variant ="default"
          sub     ="موضوع مُعرَّف"
        />
        <StatCard
          label   ="الرصيد الجاري"
          value   ={fmtCUi(summary.balance || 0)}
          variant ={(summary.balance || 0) >= 0 ? "success" : "danger"}
          sub     ={summary.balanceStatus || "رأس المال + مقبوضات - مصاريف"}
        />
      </div>

      {/* ── المحتوى الرئيسي: جزئان ──────────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1.4fr", gap:20, alignItems:"start" }}>

        {/* ══════════════════════════════════════════════
            الجزء الأول: مواضيع الصرف
        ══════════════════════════════════════════════ */}
        <TopicsSection
          topics       ={topics}
          glAccounts   ={glAccounts}
          loading      ={topicsLoading}
          onRefresh    ={refetchAll}
        />

        {/* ══════════════════════════════════════════════
            الجزء الثاني: تسجيل عمليات الصرف
        ══════════════════════════════════════════════ */}
        <TransactionSection
          topics       ={topics}
          transactions ={transactions}
          txTotal      ={txTotal}
          loading      ={txLoading}
          filters      ={txFilters}
          setFilters   ={setTxFilters}
          onRefresh    ={refetchAll}
        />
      </div>
    </AppLayout>
  );
}

// ══════════════════════════════════════════════════════════
//  مكوّن الجزء الأول: مواضيع الصرف
// ══════════════════════════════════════════════════════════
function TopicsSection({ topics, glAccounts, loading, onRefresh }) {
  const { fmtC: fmtCUi } = useNumberLocale();
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [name,     setName    ] = useState("");
  const [glId,     setGlId    ] = useState("");
  const [nameErr,  setNameErr ] = useState("");
  const { loading: saving, execute } = useAction();

  const openAdd  = () => {
    setEditItem(null);
    setName("");
    setGlId(String(defaultGlId(glAccounts)));
    setNameErr("");
    setShowForm(true);
  };
  const openEdit = (t) => {
    setEditItem(t);
    setName(t.NamePersonFor_Spending);
    setGlId(String(t.id_GL_Account || defaultGlId(glAccounts)));
    setNameErr("");
    setShowForm(true);
  };
  const closeForm= () => { setShowForm(false); setEditItem(null); setName(""); setGlId(""); };

  const handleSave = async () => {
    if (!name.trim()) { setNameErr("اسم الموضوع مطلوب"); return; }
    if (!glId) { setNameErr("اختر حساب المصروف (31/32/33)"); return; }
    const payload = { NamePersonFor_Spending: name.trim(), id_GL_Account: Number(glId) };
    const fn = editItem
      ? () => spendingTopicsService.update(editItem.id_Spending, payload)
      : () => spendingTopicsService.create(payload);
    await execute(fn, {
      onSuccess: () => { closeForm(); onRefresh(); },
      onError  : (e) => setNameErr(e),
    });
  };

  const handleDelete = async (id, nm) => {
    if (!confirm(`حذف موضوع الصرف "${nm}"؟\nسيتم حذفه فقط إذا لم تكن له عمليات مرتبطة.`)) return;
    await execute(() => spendingTopicsService.remove(id), {
      onSuccess: onRefresh,
      onError  : (e) => alert(`لا يمكن الحذف: ${e}`),
    });
  };

  return (
    <Card padding="0">
      {/* رأس الجزء الأول */}
      <div style={secHeader}>
        <div>
          <div style={secTitle}>📂 الجزء الأول: مواضيع الصرف</div>
          <div style={secSub}>تعريف بنود الإنفاق (معاشات، إيجار، فواتير…)</div>
        </div>
        <Button size="sm" onClick={openAdd}>✚ إضافة موضوع</Button>
      </div>

      {/* نموذج الإضافة/التعديل (مدمج) */}
      {showForm && (
        <div style={{ padding:"14px 18px", borderBottom:`1px solid var(--border-subtle)`, background:"var(--bg-surface)" }}>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ display:"flex", gap:8, alignItems:"flex-end", flexWrap:"wrap" }}>
              <Input
                label     ={editItem ? "تعديل اسم الموضوع" : "اسم الموضوع الجديد"}
                value     ={name}
                onChange  ={setName}
                error     ={nameErr && !glId ? nameErr : ""}
                placeholder="مثال: رواتب الموظفين، إيجار المستودع"
                autoFocus
                style={{ flex:"1 1 180px" }}
              />
              <div style={{ flex:"1 1 200px" }}>
                <label style={lblStyle}>حساب المصروف (GL) *</label>
                <select
                  value={glId}
                  onChange={(e) => { setGlId(e.target.value); setNameErr(""); }}
                  style={{ ...selStyle, width: "100%", borderColor: nameErr && !name.trim() ? "var(--border)" : nameErr ? "var(--danger)" : "var(--border)" }}
                >
                  <option value="">— اختر الحساب —</option>
                  {glAccounts.map((g) => (
                    <option key={g.id_GL_Account} value={g.id_GL_Account}>
                      {g.AccountCode} — {g.AccountName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {nameErr && <span style={errStyle}>{nameErr}</span>}
            <div style={{ display:"flex", gap:8 }}>
              <Button size="sm" loading={saving} onClick={handleSave}>
                {editItem ? "💾 حفظ" : "✚ إضافة"}
              </Button>
              <Button size="sm" variant="secondary" onClick={closeForm}>إلغاء</Button>
            </div>
          </div>
        </div>
      )}

      {/* الجدول */}
      <div style={{ overflowX:"auto" }}>
        <table style={tblStyle}>
          <thead>
            <tr style={{ borderBottom:`1px solid var(--border)` }}>
              {["#","موضوع الصرف","حساب GL","إجمالي المنصرف",""].map((h,i) => (
                <th key={i} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={emptyCell}><span className="spinner"/></td></tr>
            ) : topics.length === 0 ? (
              <tr><td colSpan={5} style={emptyCell}>
                لا توجد مواضيع — أضف موضوعاً جديداً
              </td></tr>
            ) : topics.map((t) => (
              <tr key={t.id_Spending}
                style={{ borderBottom:`1px solid var(--border-subtle)` }}
                onMouseEnter={(e) => { e.currentTarget.style.background="var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background=""; }}>
                <td style={tdMono}>{t.id_Spending}</td>
                <td style={{ padding:"10px 14px", fontWeight:600 }}>{t.NamePersonFor_Spending}</td>
                <td style={{ padding:"10px 14px", fontSize:".78rem" }}>
                  {t.GlAccountCode ? (
                    <Badge label={`${t.GlAccountCode} — ${t.GlAccountName}`} />
                  ) : (
                    <span style={{ color:"var(--text-muted)" }}>32 (افتراضي)</span>
                  )}
                </td>
                <td style={{ padding:"10px 14px" }}>
                  <span style={{ color:"var(--danger)", fontFamily:"var(--font-mono)", fontWeight:700 }}>
                    {fmtCUi(t.TotalSpent || 0)}
                  </span>
                </td>
                <td style={{ padding:"10px 14px" }}>
                  <div style={{ display:"flex", gap:6, justifyContent:"flex-end" }}>
                    <Button size="sm" variant="secondary" onClick={() => openEdit(t)}>✏</Button>
                    <Button size="sm" variant="danger"    onClick={() => handleDelete(t.id_Spending, t.NamePersonFor_Spending)}>🗑</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {topics.length > 0 && (
            <tfoot>
              <tr style={{ borderTop:`1px solid var(--border)` }}>
                <td colSpan={3} style={{ padding:"8px 14px", fontSize:".8rem", color:"var(--text-muted)" }}>
                  إجمالي {topics.length} موضوع
                </td>
                <td style={{ padding:"8px 14px", color:"var(--danger)", fontFamily:"var(--font-mono)", fontWeight:700, fontSize:".85rem" }}>
                  {fmtCUi(topics.reduce((s,t) => s + (t.TotalSpent||0), 0))}
                </td>
                <td/>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════
//  مكوّن الجزء الثاني: تسجيل عمليات الصرف
// ══════════════════════════════════════════════════════════
function TransactionSection({ topics, transactions, txTotal, loading, filters, setFilters, onRefresh }) {
  const { company } = useCompany();
  const { fmtC: fmtCUi } = useNumberLocale();
  const logoUrl = companyLogoUrl(company?.CompanyInformation_Logo);

  const emptyForm = { id_Spending:"", Price_SpendingDetails:"", Date_SpendingDetails: today(), Note_SpendingDetails:"" };
  const [form,    setForm   ] = useState(emptyForm);
  const [errors,  setErrors ] = useState({});
  const [success, setSuccess] = useState("");
  const { loading: saving, execute } = useAction();

  const set = (k) => (v) => {
    setForm((p) => ({ ...p, [k]: v }));
    setErrors((e) => ({ ...e, [k]: "" }));
    setSuccess("");
  };

  const validate = () => {
    const e = {};
    if (!form.id_Spending)           e.id_Spending = "اختر موضوع الصرف";
    if (!form.Price_SpendingDetails || Number(form.Price_SpendingDetails) <= 0)
                                      e.Price_SpendingDetails = "المبلغ يجب أن يكون أكبر من صفر";
    if (!form.Date_SpendingDetails)  e.Date_SpendingDetails = "التاريخ مطلوب";
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    await execute(
      () => spendingTxService.create({
        id_Spending          : Number(form.id_Spending),
        Price_SpendingDetails: Number(form.Price_SpendingDetails),
        Date_SpendingDetails : form.Date_SpendingDetails,
        Note_SpendingDetails : form.Note_SpendingDetails || null,
      }),
      {
        onSuccess: () => {
          setForm(emptyForm);
          setSuccess("✅ تم تسجيل المصروف بنجاح");
          onRefresh();
          setTimeout(() => setSuccess(""), 3000);
        },
        onError: (e) => setErrors({ submit: e }),
      }
    );
  };

  const handleDelete = async (id) => {
    if (!confirm("حذف هذه العملية؟")) return;
    await execute(() => spendingTxService.remove(id), {
      onSuccess: onRefresh,
      onError  : (e) => alert(e),
    });
  };

  const handlePrintLog = () => {
    if (!transactions.length) return alert("لا توجد عمليات للطباعة");
    const topicLabel = filters.id_Spending
      ? (topics.find((t) => String(t.id_Spending) === String(filters.id_Spending))?.NamePersonFor_Spending || "—")
      : "كل المواضيع";
    printSpendingLog({
      company,
      logoUrl,
      transactions,
      txTotal,
      filters,
      topicLabel,
    });
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

      {/* ── نموذج تسجيل المصروف ──────────────────────────── */}
      <Card>
        <div style={{ marginBottom:16 }}>
          <div style={secTitle}>💸 الجزء الثاني: تسجيل عملية صرف</div>
          <div style={secSub}>اختر الموضوع وأدخل تفاصيل الصرف</div>
        </div>

        {success && (
          <div className="alert alert-success animate-fade-in" style={{ marginBottom:14 }}>
            {success}
          </div>
        )}
        {errors.submit && (
          <div className="alert alert-error" style={{ marginBottom:14 }}>
            ⚠ {errors.submit}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>

            {/* موضوع الصرف */}
            <div style={{ gridColumn:"1/-1" }}>
              <label style={lblStyle}>موضوع الصرف *</label>
              <select value={form.id_Spending} onChange={(e) => set("id_Spending")(e.target.value)}
                style={{ ...selStyle, borderColor: errors.id_Spending ? "var(--danger)" : "var(--border)" }}>
                <option value="">— اختر الموضوع —</option>
                {topics.map((t) => (
                  <option key={t.id_Spending} value={t.id_Spending}>
                    {t.NamePersonFor_Spending}
                    {t.GlAccountCode ? ` (${t.GlAccountCode})` : ""}
                  </option>
                ))}
              </select>
              {errors.id_Spending && <span style={errStyle}>{errors.id_Spending}</span>}
            </div>

            {/* المبلغ */}
            <div>
              <label style={lblStyle}>{amountLabel("المبلغ")} *</label>
              <input type="number" min="0.01" step="any"
                value={numFieldValue(form.Price_SpendingDetails)}
                placeholder="0"
                onChange={(e) => set("Price_SpendingDetails")(e.target.value === "" ? "" : e.target.value)}
                style={{ ...inputStyle, borderColor: errors.Price_SpendingDetails ? "var(--danger)" : "var(--border)" }}
              />
              {errors.Price_SpendingDetails && <span style={errStyle}>{errors.Price_SpendingDetails}</span>}
            </div>

            {/* التاريخ */}
            <div>
              <label style={lblStyle}>التاريخ *</label>
              <input type="date"
                value={form.Date_SpendingDetails}
                onChange={(e) => set("Date_SpendingDetails")(e.target.value)}
                style={{ ...inputStyle, borderColor: errors.Date_SpendingDetails ? "var(--danger)" : "var(--border)" }}
              />
              {errors.Date_SpendingDetails && <span style={errStyle}>{errors.Date_SpendingDetails}</span>}
            </div>

            {/* الملاحظة */}
            <div style={{ gridColumn:"1/-1" }}>
              <Input
                label       ="غرض الصرف التفصيلي"
                value       ={form.Note_SpendingDetails}
                onChange    ={set("Note_SpendingDetails")}
                placeholder ="مثال: راتب شهر مارس لموظف X، إيجار المستودع الشمالي…"
              />
            </div>
          </div>

          <div style={{ marginTop:16 }}>
            <Button type="submit" fullWidth loading={saving}>
              💸 تسجيل المصروف
            </Button>
          </div>
        </form>
      </Card>

      {/* ── سجل عمليات الصرف ────────────────────────────── */}
      <Card padding="0">
        {/* رأس الجدول + فلاتر */}
        <div style={{ padding:"12px 16px", borderBottom:`1px solid var(--border-subtle)` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, flexWrap:"wrap", gap:8 }}>
            <span style={{ fontWeight:700, fontSize:".9rem" }}>📋 سجل عمليات الصرف</span>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:".8rem", color:"var(--text-muted)" }}>
                {txTotal > 0 ? <><strong style={{ color:"var(--danger)" }}>{fmtCUi(txTotal)}</strong> إجمالي</> : "لا توجد عمليات"}
              </span>
              <Button size="sm" variant="secondary" onClick={handlePrintLog} disabled={loading || !transactions.length}>
                🖨 طباعة السجل
              </Button>
            </div>
          </div>
          {/* فلاتر */}
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <input type="date" value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
              title="من تاريخ"
              style={{ ...filterInputStyle, flex:1 }}
              placeholder="من"
            />
            <input type="date" value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
              title="إلى تاريخ"
              style={{ ...filterInputStyle, flex:1 }}
            />
            <select value={filters.id_Spending}
              onChange={(e) => setFilters((f) => ({ ...f, id_Spending: e.target.value }))}
              style={{ ...filterInputStyle, flex:1.5 }}>
              <option value="">كل المواضيع</option>
              {topics.map((t) => (
                <option key={t.id_Spending} value={t.id_Spending}>{t.NamePersonFor_Spending}</option>
              ))}
            </select>
            <button
              onClick={() => setFilters({ from:"", to:"", id_Spending:"" })}
              style={{ padding:"6px 12px", background:"transparent", border:`1px solid var(--border)`, borderRadius:"var(--radius-md)", color:"var(--text-muted)", cursor:"pointer", fontSize:".8rem" }}>
              مسح
            </button>
          </div>
        </div>

        {/* الجدول */}
        <div style={{ overflowX:"auto", maxHeight:360, overflowY:"auto" }}>
          <table style={tblStyle}>
            <thead style={{ position:"sticky", top:0, background:"var(--bg-card)", zIndex:1 }}>
              <tr style={{ borderBottom:`1px solid var(--border)` }}>
                {["التاريخ","الموضوع","المبلغ","الملاحظة",""].map((h,i) => (
                  <th key={i} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={emptyCell}><span className="spinner"/></td></tr>
              ) : transactions.length === 0 ? (
                <tr><td colSpan={5} style={emptyCell}>لا توجد عمليات صرف</td></tr>
              ) : transactions.map((tx) => (
                <tr key={tx.id_SpendingDetails}
                  style={{ borderBottom:`1px solid var(--border-subtle)` }}
                  onMouseEnter={(e) => { e.currentTarget.style.background="var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background=""; }}>
                  <td style={tdMono}>{tx.Date_SpendingDetails || "—"}</td>
                  <td style={{ padding:"9px 14px" }}>
                    <Badge label={tx.NamePersonFor_Spending || "غير محدد"} variant="warning"/>
                  </td>
                  <td style={{ padding:"9px 14px", color:"var(--danger)", fontFamily:"var(--font-mono)", fontWeight:700 }}>
                    {fmtCUi(tx.Price_SpendingDetails)}
                  </td>
                  <td style={{ padding:"9px 14px", fontSize:".82rem", color:"var(--text-muted)", maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {tx.Note_SpendingDetails || "—"}
                  </td>
                  <td style={{ padding:"9px 14px" }}>
                    <Button size="sm" variant="danger"
                      onClick={() => handleDelete(tx.id_SpendingDetails)}>🗑</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
//  أنماط مشتركة
// ──────────────────────────────────────────────────────────
const secHeader = {
  display:"flex", justifyContent:"space-between", alignItems:"center",
  padding:"14px 18px", borderBottom:"1px solid var(--border-subtle)",
  background:"var(--bg-surface)",
};
const secTitle = { fontWeight:800, fontSize:".95rem", color:"var(--text-primary)" };
const secSub   = { fontSize:".78rem", color:"var(--text-muted)", marginTop:3 };
const tblStyle = { width:"100%", borderCollapse:"collapse", fontSize:".875rem" };
const thStyle  = { padding:"9px 14px", textAlign:"right", color:"var(--text-secondary)", fontWeight:700, fontSize:".72rem", textTransform:"uppercase", whiteSpace:"nowrap" };
const tdMono   = { padding:"9px 14px", fontFamily:"var(--font-mono)", fontSize:".78rem", color:"var(--text-muted)" };
const emptyCell= { padding:40, textAlign:"center", color:"var(--text-muted)", fontSize:".88rem" };
const lblStyle = { fontSize:".85rem", fontWeight:600, color:"var(--text-secondary)", display:"block", marginBottom:5 };
const errStyle = { fontSize:".8rem", color:"var(--danger)", display:"block", marginTop:3 };
const inputStyle = {
  width:"100%", padding:"10px 14px",
  background:"var(--bg-input)", border:"1px solid var(--border)",
  borderRadius:"var(--radius-md)", color:"var(--text-primary)",
  fontFamily:"var(--font-main)", fontSize:".95rem", outline:"none",
};
const selStyle = {
  width:"100%", padding:"10px 12px",
  background:"var(--bg-input)", border:"1px solid var(--border)",
  borderRadius:"var(--radius-md)", color:"var(--text-primary)",
  fontFamily:"var(--font-main)", fontSize:".88rem", outline:"none", cursor:"pointer",
};
const filterInputStyle = {
  padding:"7px 10px",
  background:"var(--bg-input)", border:"1px solid var(--border)",
  borderRadius:"var(--radius-md)", color:"var(--text-primary)",
  fontFamily:"var(--font-main)", fontSize:".82rem", outline:"none",
};

const escPrint = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function printSpendingLog({ company, logoUrl, transactions, txTotal, filters, topicLabel }) {
  const coName = company?.CompanyInformation_Name || "اسم الشركة";
  const infoExtra = [company?.CompanyInformation_Info1, company?.CompanyInformation_Info2]
    .filter(Boolean)
    .join("  |  ");
  const printDate = new Date().toISOString().split("T")[0];
  const periodFrom = filters.from || "—";
  const periodTo = filters.to || "—";

  const rows = transactions.map((tx, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${escPrint(tx.Date_SpendingDetails || "—")}</td>
      <td class="name">${escPrint(tx.NamePersonFor_Spending || "غير محدد")}</td>
      <td class="n">${escPrint(fmtC(tx.Price_SpendingDetails))}</td>
      <td>${escPrint(tx.Note_SpendingDetails || "—")}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8"/>
<title> </title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body {
    height: 100%;
    font-family: "Segoe UI", Tahoma, Arial, sans-serif;
    font-size: 13px;
    color: #1a1f2e;
    margin: 0;
    padding: 0;
    background: #fff;
  }
  .wrap {
    max-width: 820px;
    margin: 0 auto;
    padding: 12mm 10mm 0;
  }
  .hdr {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 28px;
    min-height: 118px;
    padding: 22px 20px 20px;
    border-bottom: 4px solid #b8860b;
    margin-bottom: 16px;
    background: linear-gradient(180deg, #fafbfc 0%, #fff 100%);
  }
  .hdr-co { flex: 1; text-align: right; }
  .hdr-co h1 {
    margin: 0 0 10px;
    font-size: 2.15rem;
    font-weight: 900;
    color: #0f172a;
    line-height: 1.2;
    letter-spacing: -0.02em;
  }
  .hdr-co .sub {
    font-size: 1.05rem;
    color: #475569;
    line-height: 1.65;
    font-weight: 600;
    max-width: 520px;
    margin-right: 0;
    margin-left: auto;
  }
  .doc-type {
    display: inline-block;
    margin-top: 14px;
    padding: 9px 26px;
    background: linear-gradient(135deg, #1a1a2e 0%, #2a3568 55%, #1a1a2e 100%);
    color: #f0bb2a;
    font-size: 1.12rem;
    font-weight: 800;
    border-radius: 10px;
    letter-spacing: 0.04em;
    border: 2px solid #b8860b;
    box-shadow: 0 2px 8px rgba(26, 26, 46, 0.12);
  }
  .hdr-logo { flex-shrink: 0; text-align: left; padding-left: 8px; }
  .hdr-logo img { max-height: 96px; max-width: 160px; object-fit: contain; display: block; }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 24px;
    padding: 12px 14px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    margin-bottom: 16px;
  }
  .meta-item { min-width: 140px; }
  .ml { display: block; font-size: 0.68rem; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 3px; }
  .mv { font-weight: 700; color: #0f172a; }
  .mv.accent { color: #b8860b; font-family: Consolas, monospace; }
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 0;
    font-size: 12px;
  }
  table.items th {
    background: #1a1a2e;
    color: #fff;
    padding: 10px 8px;
    font-weight: 700;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  table.items th, table.items td { border: 1px solid #cbd5e1; }
  table.items td { padding: 8px; vertical-align: middle; }
  table.items tr:nth-child(even) { background: #f1f5f9; }
  table.items .c { text-align: center; width: 36px; color: #64748b; font-weight: 600; }
  table.items .name { text-align: right; font-weight: 700; }
  table.items .n { text-align: left; font-family: Consolas, monospace; font-weight: 700; color: #dc2626; }
  tfoot td {
    padding: 10px 8px;
    font-weight: 800;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
  }
  @media print {
    html, body { height: auto; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .wrap { padding: 12mm 10mm 0; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="hdr">
    <div class="hdr-co">
      <h1>${escPrint(coName)}</h1>
      ${infoExtra ? `<div class="sub">${escPrint(infoExtra)}</div>` : ""}
      <div class="doc-type">سجل عمليات الصرف</div>
    </div>
    <div class="hdr-logo">${logoUrl ? `<img src="${escPrint(logoUrl)}" alt=""/>` : ""}</div>
  </header>

  <section class="meta">
    <div class="meta-item"><span class="ml">تاريخ الطباعة</span><span class="mv">${escPrint(printDate)}</span></div>
    <div class="meta-item"><span class="ml">من تاريخ</span><span class="mv">${escPrint(periodFrom)}</span></div>
    <div class="meta-item"><span class="ml">إلى تاريخ</span><span class="mv">${escPrint(periodTo)}</span></div>
    <div class="meta-item"><span class="ml">الموضوع</span><span class="mv">${escPrint(topicLabel)}</span></div>
    <div class="meta-item"><span class="ml">عدد العمليات</span><span class="mv accent">${escPrint(fmtN(transactions.length))}</span></div>
    <div class="meta-item"><span class="ml">إجمالي المنصرف</span><span class="mv accent">${escPrint(fmtC(txTotal))}</span></div>
  </section>

  <table class="items">
    <thead>
      <tr>
        <th>ت</th>
        <th>التاريخ</th>
        <th>موضوع الصرف</th>
        <th>المبلغ</th>
        <th>الملاحظة</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="text-align:right">الإجمالي</td>
        <td class="n" colspan="2">${escPrint(fmtC(txTotal))}</td>
      </tr>
    </tfoot>
  </table>
</div>
</body>
</html>`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", " ");
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;visibility:hidden";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = win.document;
  doc.open();
  doc.write(html);
  doc.close();
  const cleanup = () => { try { document.body.removeChild(iframe); } catch { /* ignore */ } };
  const doPrint = () => {
    try { doc.title = " "; } catch { /* ignore */ }
    win.focus();
    win.print();
    setTimeout(cleanup, 2000);
  };
  if (doc.readyState === "complete") setTimeout(doPrint, 80);
  else iframe.onload = () => setTimeout(doPrint, 80);
}
