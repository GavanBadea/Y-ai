import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import { Card, StatCard } from "@/components/ui/Card";
import { useApi, useAction } from "@/hooks/useApi";
import api, { documentsService, partyService, lookupService } from "@/services/api";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { useCompany, companyLogoUrl } from "@/context/CompanyContext";
import { fmtC, amountLabel, fmtDate } from "@/utils/numFormat";

const today = () => new Date().toISOString().split("T")[0];
const yearStart = `${new Date().getFullYear()}-01-01`;
const PROGRAMMER = "المبرمج Gavan 07504505340";

function buildDirectNote(zabonName, amilName) {
  if (zabonName && amilName) return `${zabonName} — ${amilName} — عملية مباشرة`;
  if (zabonName) return `${zabonName} — عملية مباشرة`;
  if (amilName) return `${amilName} — عملية مباشرة`;
  return "عملية مباشرة";
}

function CashFlowSummaryPanel() {
  const { fmtC: fmtCUi } = useNumberLocale();
  const [from, setFrom] = useState(yearStart);
  const [to, setTo] = useState(today());
  const { data, loading, refetch } = useApi(
    () => documentsService.getCashFlowSummary({ from, to }),
    [from, to]
  );
  const s = data?.data || {};

  return (
    <Card style={{ marginBottom: 18, padding: "16px 18px" }}>
      <div style={{ fontWeight: 800, marginBottom: 12, fontSize: ".95rem" }}>
        ملخص المقبوض والمدفوع حسب التاريخ
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 14 }}>
        <div>
          <label style={labelStyle}>من</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={selectStyle} />
        </div>
        <div>
          <label style={labelStyle}>إلى</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={selectStyle} />
        </div>
        <Button size="sm" onClick={refetch}>تطبيق</Button>
      </div>
      {loading ? (
        <span className="spinner" style={{ width: 22, height: 22 }} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <StatCard
            label="إجمالي المقبوض"
            value={fmtCUi(s.totalCollected)}
            sub={`سندات قبض ${fmtCUi(s.catchDocs)} + مبيعات نقدية ${fmtCUi(s.cashSales)}`}
            variant="success"
          />
          <StatCard
            label="إجمالي المدفوع"
            value={fmtCUi(s.totalPaid)}
            sub={`سندات دفع ${fmtCUi(s.payDocs)} + مشتريات نقدية ${fmtCUi(s.cashPurchases)}`}
            variant="warning"
          />
        </div>
      )}
    </Card>
  );
}

export default function DocumentsPage() {
  useNumberLocale();

  const [tab, setTab] = useState("direct");
  return (
    <AppLayout title="السندات المالية">
      <CashFlowSummaryPanel />
      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
        {[
          { id: "direct", label: "🔄 قبض و دفع مباشر" },
          { id: "pay", label: "💸 سندات الدفع للموردين" },
          { id: "catch", label: "💰 سندات القبض من الزبائن" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "10px 20px",
              background: "none",
              border: "none",
              borderBottom: `2px solid ${tab === t.id ? "var(--accent)" : "transparent"}`,
              color: tab === t.id ? "var(--accent)" : "var(--text-secondary)",
              fontWeight: tab === t.id ? 700 : 500,
              cursor: "pointer",
              fontFamily: "var(--font-main)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "direct" && <DirectCatchPayTab />}
      {tab === "pay" && <PayDocsTab />}
      {tab === "catch" && <CatchDocsTab />}
    </AppLayout>
  );
}

function DirectCatchPayTab() {
  const { company } = useCompany();
  const logoUrl = companyLogoUrl(company?.CompanyInformation_Logo);
  const { fmtC: fmtCUi } = useNumberLocale();

  const { data: custData } = useApi(() => partyService.getCustomers(), []);
  const { data: supData } = useApi(() => partyService.getSuppliers(), []);
  const customers = custData?.data || [];
  const suppliers = supData?.data || [];

  const [form, setForm] = useState({
    id_Zabon: "",
    id_Amil: "",
    Amount_CatchDoc: "",
    Date_CatchDoc: today(),
    Note_CatchDoc: "عملية مباشرة",
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const { loading: saving, execute } = useAction();

  const zabonName = customers.find((c) => String(c.id_Zabon) === String(form.id_Zabon))?.ZabonName || "";
  const amilName = suppliers.find((s) => String(s.id_Amil) === String(form.id_Amil))?.AmilName || "";

  useEffect(() => {
    setForm((p) => ({ ...p, Note_CatchDoc: buildDirectNote(zabonName, amilName) }));
  }, [zabonName, amilName]);

  const set = (k) => (v) => {
    const val = v?.target !== undefined ? v.target.value : v;
    setForm((p) => ({ ...p, [k]: val }));
    setErrors((e) => ({ ...e, [k]: "" }));
    setFormError("");
  };

  const validateForm = () => {
    const er = {};
    if (!form.id_Zabon) er.id_Zabon = "الزبون مطلوب";
    if (!form.id_Amil) er.id_Amil = "المورد مطلوب";
    if (!Number(form.Amount_CatchDoc) || Number(form.Amount_CatchDoc) <= 0) er.Amount_CatchDoc = "المبلغ مطلوب";
    setErrors(er);
    return Object.keys(er).length === 0;
  };

  const resetForm = () => {
    setForm({
      id_Zabon: "",
      id_Amil: "",
      Amount_CatchDoc: "",
      Date_CatchDoc: today(),
      Note_CatchDoc: "عملية مباشرة",
    });
    setErrors({});
    setFormError("");
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setFormError("");
    await execute(
      () => documentsService.createDirectCatchPay({
        id_Zabon: Number(form.id_Zabon),
        id_Amil: Number(form.id_Amil),
        Amount_CatchDoc: Number(form.Amount_CatchDoc),
        Date_CatchDoc: form.Date_CatchDoc,
        Note_CatchDoc: form.Note_CatchDoc.trim(),
      }),
      {
        onSuccess: (res) => {
          setLastResult(res);
          resetForm();
        },
        onError: (msg) => setFormError(msg),
      }
    );
  };

  return (
    <>
      <Card style={{ marginBottom: 16, padding: "18px 20px" }}>
        <div style={{ fontWeight: 800, marginBottom: 14, fontSize: ".95rem" }}>
          قبض و دفع مباشر
        </div>
        <p style={{ margin: "0 0 16px", fontSize: ".85rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
          عملية واحدة: قبض من الزبون ودفع للمورد بنفس المبلغ — مع تسجيل سند قبض وسند دفع وتحديث أرصدة الديون.
        </p>
        {formError && <div className="alert alert-error" style={{ marginBottom: 12 }}>⚠ {formError}</div>}
        <form onSubmit={onSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <div>
              <label style={labelStyle}>الزبون *</label>
              <select value={form.id_Zabon} onChange={(e) => set("id_Zabon")(e)} style={selectStyle}>
                <option value="">اختر الزبون</option>
                {customers.map((c) => (
                  <option key={c.id_Zabon} value={c.id_Zabon}>{c.ZabonName || `#${c.id_Zabon}`}</option>
                ))}
              </select>
              {errors.id_Zabon && <div style={errStyle}>{errors.id_Zabon}</div>}
            </div>
            <div>
              <label style={labelStyle}>المورد *</label>
              <select value={form.id_Amil} onChange={(e) => set("id_Amil")(e)} style={selectStyle}>
                <option value="">اختر المورد</option>
                {suppliers.map((s) => (
                  <option key={s.id_Amil} value={s.id_Amil}>{s.AmilName || `#${s.id_Amil}`}</option>
                ))}
              </select>
              {errors.id_Amil && <div style={errStyle}>{errors.id_Amil}</div>}
            </div>
            <Input
              label={`${amountLabel("المبلغ")} *`}
              type="number"
              value={form.Amount_CatchDoc}
              onChange={set("Amount_CatchDoc")}
              error={errors.Amount_CatchDoc}
            />
            <Input label="تاريخ العملية" type="date" value={form.Date_CatchDoc} onChange={set("Date_CatchDoc")} />
            <Input
              label="الملاحظة"
              value={form.Note_CatchDoc}
              onChange={set("Note_CatchDoc")}
              style={{ gridColumn: "1 / -1" }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <Button type="button" variant="secondary" onClick={resetForm}>مسح</Button>
            <Button type="submit" loading={saving}>💾 تنفيذ العملية</Button>
          </div>
        </form>
      </Card>

      {lastResult && (
        <Card style={{ marginBottom: 16, padding: "16px 18px", borderColor: "var(--success)" }}>
          <div style={{ fontWeight: 800, marginBottom: 10, color: "var(--success)" }}>
            ✓ {lastResult.message}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, fontSize: ".87rem" }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>سند قبض #{lastResult.catchDocId}</div>
              <div>الزبون: {lastResult.zabon?.name}</div>
              <div>الرصيد: {fmtCUi(lastResult.zabon?.balanceBefore)} ← {fmtCUi(lastResult.zabon?.balanceAfter)}</div>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>سند دفع #{lastResult.payDocId}</div>
              <div>المورد: {lastResult.amil?.name}</div>
              <div>الرصيد: {fmtCUi(lastResult.amil?.balanceBefore)} ← {fmtCUi(lastResult.amil?.balanceAfter)}</div>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>المبلغ</div>
              <div>{fmtCUi(lastResult.amount)}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {lastResult.printData?.catch && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => printVoucherFromPrintData(lastResult.printData.catch, company, logoUrl, "catch")}
              >
                🖨 طباعة سند القبض
              </Button>
            )}
            {lastResult.printData?.pay && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => printVoucherFromPrintData(lastResult.printData.pay, company, logoUrl, "pay")}
              >
                🖨 طباعة سند الدفع
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setLastResult(null)}>إغلاق</Button>
          </div>
        </Card>
      )}
    </>
  );
}

function printVoucherFromPrintData(printData, company, logoUrl, kind) {
  const d = printData?.document;
  if (!d) return;
  printVoucherDoc({
    kind,
    company,
    logoUrl,
    voucher: {
      docNo: d.number,
      date: d.date,
      partyName: d.partyName,
      amount: d.amount,
      note: d.notes,
    },
  });
}

function PayDocsTab() {
  const { company } = useCompany();
  const { fmtC: fmtCUi, fmtN: fmtNUi } = useNumberLocale();
  const logoUrl = companyLogoUrl(company?.CompanyInformation_Logo);

  const [idAmil, setIdAmil] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [formError, setFormError] = useState("");

  const { data: supData } = useApi(() => partyService.getSuppliers(), []);
  const { data: docsData, loading, error, refetch } = useApi(
    () => documentsService.getPay({ id_Amil: idAmil || undefined }),
    [idAmil]
  );
  const suppliers = supData?.data || [];
  const docs = docsData?.data || [];
  const total = useMemo(() => docs.reduce((s, d) => s + Number(d.Amount_PayDoc || 0), 0), [docs]);
  const { loading: saving, execute } = useAction();

  const onSave = async (payload) => {
    setFormError("");
    await execute(
      () =>
        editItem
          ? documentsService.updatePay(editItem.id_PayDoc, payload)
          : documentsService.createPay(payload),
      {
        onSuccess: () => {
          setShowForm(false);
          setEditItem(null);
          refetch();
        },
        onError: (msg) => setFormError(msg),
      }
    );
  };

  const onDelete = async (row) => {
    if (!confirm(`حذف سند الدفع #${row.id_PayDoc} ؟`)) return;
    await execute(() => documentsService.removePay(row.id_PayDoc), { onSuccess: refetch });
  };

  const onPrint = (row) => {
    printVoucherDoc({
      kind: "pay",
      company,
      logoUrl,
      voucher: {
        docNo: row.id_PayDoc,
        date: row.Date_PayDoc,
        partyName: row.AmilName || `#${row.id_Amil}`,
        amount: row.Amount_PayDoc,
        note: row.Note_PayDoc,
      },
    });
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        <StatCard label="عدد سندات الدفع" value={fmtNUi(docs.length)} sub="مستندات موردين" />
        <StatCard label="إجمالي المدفوع" value={fmtCUi(total)} variant="warning" />
        <StatCard label="المورد المحدد" value={idAmil ? `#${idAmil}` : "الكل"} sub="فلترة" />
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "end", marginBottom: 14 }}>
        <div style={{ minWidth: 260 }}>
          <label style={labelStyle}>المورد</label>
          <select value={idAmil} onChange={(e) => setIdAmil(e.target.value)} style={selectStyle}>
            <option value="">كل الموردين</option>
            {suppliers.map((s) => (
              <option key={s.id_Amil} value={s.id_Amil}>
                {s.AmilName || `#${s.id_Amil}`}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={() => { setEditItem(null); setFormError(""); setShowForm(true); }}>+ سند دفع جديد</Button>
        <Button variant="secondary" size="sm" onClick={refetch}>↺</Button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 10 }}>⚠ {error}</div>}

      <Card padding="0">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".87rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["#", "التاريخ", "المورد", "المبلغ", "الملاحظة", "الرصيد الحالي", ""].map((h, i) => (
                <th key={i} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 30, textAlign: "center" }}><span className="spinner" /></td></tr>
            ) : docs.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 28, textAlign: "center", color: "var(--text-muted)" }}>لا توجد سندات</td></tr>
            ) : docs.map((d) => (
              <tr key={d.id_PayDoc} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={tdStyle}>{d.id_PayDoc}</td>
                <td style={tdStyle}>{fmtDate(d.Date_PayDoc)}</td>
                <td style={tdStyle}>{d.AmilName || `#${d.id_Amil}`}</td>
                <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", color: "var(--warning)", fontWeight: 700 }}>
                  {fmtCUi(d.Amount_PayDoc)}
                </td>
                <td style={tdStyle}>{d.Note_PayDoc || "—"}</td>
                <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", color: Number(d.CurrentBalance || 0) > 0 ? "var(--warning)" : "var(--success)" }}>
                  {fmtCUi(Math.abs(d.CurrentBalance || 0))}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <Button size="sm" variant="secondary" onClick={() => { setEditItem(d); setFormError(""); setShowForm(true); }}>✏️</Button>
                    <Button size="sm" variant="secondary" onClick={() => onPrint(d)}>🖨</Button>
                    <Button size="sm" variant="danger" onClick={() => onDelete(d)}>🗑</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showForm && (
        <PayDocModal
          item={editItem}
          suppliers={suppliers}
          saving={saving}
          serverError={formError}
          company={company}
          logoUrl={logoUrl}
          onClose={() => { setShowForm(false); setEditItem(null); }}
          onSave={onSave}
        />
      )}
    </>
  );
}

function CatchDocsTab() {
  const { company } = useCompany();
  const { fmtC: fmtCUi, fmtN: fmtNUi } = useNumberLocale();
  const logoUrl = companyLogoUrl(company?.CompanyInformation_Logo);

  const [idZabon, setIdZabon] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [formError, setFormError] = useState("");

  const { data: custData } = useApi(() => partyService.getCustomers(), []);
  const { data: docsData, loading, error, refetch } = useApi(
    () => documentsService.getCatch({ id_Zabon: idZabon || undefined }),
    [idZabon]
  );
  const customers = custData?.data || [];
  const docs = docsData?.data || [];
  const total = useMemo(() => docs.reduce((s, d) => s + Number(d.Amount_CatchDoc || 0), 0), [docs]);
  const { loading: saving, execute } = useAction();

  const onSave = async (payload) => {
    setFormError("");
    await execute(
      () =>
        editItem
          ? documentsService.updateCatch(editItem.id_CatchDoc, payload)
          : documentsService.createCatch(payload),
      {
        onSuccess: () => {
          setShowForm(false);
          setEditItem(null);
          refetch();
        },
        onError: (msg) => setFormError(msg),
      }
    );
  };

  const onDelete = async (row) => {
    if (!confirm(`حذف سند القبض #${row.id_CatchDoc} ؟`)) return;
    await execute(() => documentsService.removeCatch(row.id_CatchDoc), { onSuccess: refetch });
  };

  const onPrint = (row) => {
    printVoucherDoc({
      kind: "catch",
      company,
      logoUrl,
      voucher: {
        docNo: row.id_CatchDoc,
        date: row.Date_CatchDoc,
        partyName: row.ZabonName || `#${row.id_Zabon}`,
        amount: row.Amount_CatchDoc,
        allowance: row.AllowanceAmount,
        note: row.Note_CatchDoc,
      },
    });
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        <StatCard label="عدد سندات القبض" value={fmtNUi(docs.length)} sub="مستندات زبائن" />
        <StatCard label="إجمالي المقبوض" value={fmtCUi(total)} variant="success" />
        <StatCard label="الزبون المحدد" value={idZabon ? `#${idZabon}` : "الكل"} sub="فلترة" />
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "end", marginBottom: 14 }}>
        <div style={{ minWidth: 260 }}>
          <label style={labelStyle}>الزبون</label>
          <select value={idZabon} onChange={(e) => setIdZabon(e.target.value)} style={selectStyle}>
            <option value="">كل الزبائن</option>
            {customers.map((s) => (
              <option key={s.id_Zabon} value={s.id_Zabon}>
                {s.ZabonName || `#${s.id_Zabon}`}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={() => { setEditItem(null); setFormError(""); setShowForm(true); }}>+ سند قبض جديد</Button>
        <Button variant="secondary" size="sm" onClick={refetch}>↺</Button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 10 }}>⚠ {error}</div>}

      <Card padding="0">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".87rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["#", "التاريخ", "الزبون", "المبلغ", "السماح", "الملاحظة", "الرصيد الحالي", ""].map((h, i) => (
                <th key={i} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: "center" }}><span className="spinner" /></td></tr>
            ) : docs.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 28, textAlign: "center", color: "var(--text-muted)" }}>لا توجد سندات</td></tr>
            ) : docs.map((d) => (
              <tr key={d.id_CatchDoc} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={tdStyle}>{d.id_CatchDoc}</td>
                <td style={tdStyle}>{fmtDate(d.Date_CatchDoc)}</td>
                <td style={tdStyle}>{d.ZabonName || `#${d.id_Zabon}`}</td>
                <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", color: "var(--success)", fontWeight: 700 }}>
                  {fmtCUi(d.Amount_CatchDoc)}
                </td>
                <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", color: Number(d.AllowanceAmount || 0) > 0 ? "#d97706" : "var(--text-muted)", fontWeight: Number(d.AllowanceAmount || 0) > 0 ? 700 : 400 }}>
                  {Number(d.AllowanceAmount || 0) > 0 ? fmtCUi(d.AllowanceAmount) : "—"}
                </td>
                <td style={tdStyle}>{d.Note_CatchDoc || "—"}</td>
                <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", color: Number(d.CurrentBalance || 0) > 0 ? "var(--danger)" : "var(--success)" }}>
                  {fmtCUi(Math.abs(d.CurrentBalance || 0))}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <Button size="sm" variant="secondary" onClick={() => { setEditItem(d); setFormError(""); setShowForm(true); }}>✏️</Button>
                    <Button size="sm" variant="secondary" onClick={() => onPrint(d)}>🖨</Button>
                    <Button size="sm" variant="danger" onClick={() => onDelete(d)}>🗑</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showForm && (
        <CatchDocModal
          item={editItem}
          customers={customers}
          saving={saving}
          serverError={formError}
          company={company}
          logoUrl={logoUrl}
          onClose={() => { setShowForm(false); setEditItem(null); }}
          onSave={onSave}
        />
      )}
    </>
  );
}

function CashBoxSelect({ value, onChange }) {
  const { data } = useApi(() => lookupService.getCashBoxes(), []);
  const boxes = data?.data || [];
  return (
    <div>
      <label style={labelStyle}>الصندوق</label>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        <option value="">بلا صندوق</option>
        {boxes.map((b) => (
          <option key={b.id_CashBox} value={b.id_CashBox}>{b.CashBoxName}</option>
        ))}
      </select>
    </div>
  );
}

function PayDocModal({ item, suppliers, saving, serverError, company, logoUrl, onClose, onSave }) {
  useNumberLocale();
  const isEdit = Boolean(item?.id_PayDoc);
  const [form, setForm] = useState({
    id_Amil: item?.id_Amil || "",
    Amount_PayDoc: item?.Amount_PayDoc || "",
    Date_PayDoc: item?.Date_PayDoc || today(),
    Note_PayDoc: item?.Note_PayDoc || "سند دفع",
    id_CashBox: item?.id_CashBox || "",
  });
  const [errors, setErrors] = useState({});
  const set = (k) => (v) => { setForm((p) => ({ ...p, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };

  const validateForm = () => {
    const er = {};
    if (!form.id_Amil) er.id_Amil = "المورد مطلوب";
    if (!Number(form.Amount_PayDoc)) er.Amount_PayDoc = "المبلغ مطلوب";
    if (!form.Note_PayDoc.trim()) er.Note_PayDoc = "الملاحظة مطلوبة";
    setErrors(er);
    return Object.keys(er).length === 0;
  };

  const handlePrint = () => {
    if (!validateForm()) return;
    const partyName = suppliers.find((s) => String(s.id_Amil) === String(form.id_Amil))?.AmilName || `#${form.id_Amil}`;
    printVoucherDoc({
      kind: "pay",
      company,
      logoUrl,
      voucher: {
        docNo: item?.id_PayDoc || null,
        date: form.Date_PayDoc,
        partyName,
        amount: form.Amount_PayDoc,
        note: form.Note_PayDoc.trim(),
      },
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    const payload = {
      id_Amil: Number(form.id_Amil),
      Amount_PayDoc: Number(form.Amount_PayDoc),
      Note_PayDoc: form.Note_PayDoc.trim(),
      id_CashBox: form.id_CashBox ? Number(form.id_CashBox) : undefined,
    };
    if (!isEdit) payload.Date_PayDoc = form.Date_PayDoc;
    await onSave(payload);
  };

  return (
    <Modal title={isEdit ? `تعديل سند دفع #${item.id_PayDoc}` : "إضافة سند دفع"} onClose={onClose}>
      {isEdit && (
        <div style={{ marginBottom: 10, padding: "8px 12px", background: "var(--bg-surface)", borderRadius: 8, fontSize: ".82rem", color: "var(--text-secondary)" }}>
          تاريخ التسجيل: <strong style={{ color: "var(--text-primary)" }}>{fmtDate(item.Date_PayDoc)}</strong>
          <span style={{ marginRight: 8 }}>— يبقى ثابتاً ولا يؤثر على السجلات الأخرى</span>
        </div>
      )}
      {serverError && <div className="alert alert-error" style={{ marginBottom: 10 }}>⚠ {serverError}</div>}
      <form onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={labelStyle}>المورد *</label>
            <select value={form.id_Amil} onChange={(e) => set("id_Amil")(e.target.value)} style={selectStyle}>
              <option value="">اختر المورد</option>
              {suppliers.map((s) => <option key={s.id_Amil} value={s.id_Amil}>{s.AmilName || `#${s.id_Amil}`}</option>)}
            </select>
            {errors.id_Amil && <div style={errStyle}>{errors.id_Amil}</div>}
          </div>
          <Input label={`${amountLabel("المبلغ")} *`} type="number" value={form.Amount_PayDoc} onChange={set("Amount_PayDoc")} error={errors.Amount_PayDoc} />
          {!isEdit ? (
            <Input label="التاريخ" type="date" value={form.Date_PayDoc} onChange={set("Date_PayDoc")} />
          ) : (
            <div>
              <label style={labelStyle}>التاريخ</label>
              <div style={{ ...selectStyle, opacity: 0.75, cursor: "not-allowed" }}>{fmtDate(item.Date_PayDoc)}</div>
            </div>
          )}
          <CashBoxSelect value={form.id_CashBox} onChange={set("id_CashBox")} />
          <Input label="الملاحظة *" value={form.Note_PayDoc} onChange={set("Note_PayDoc")} error={errors.Note_PayDoc} style={{ gridColumn: "1/-1" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="button" variant="secondary" onClick={handlePrint}>🖨 طباعة</Button>
          <Button type="submit" loading={saving}>{isEdit ? "💾 حفظ التعديل" : "💾 حفظ"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function CatchDocModal({ item, customers, saving, serverError, company, logoUrl, onClose, onSave }) {
  const { fmtC: fmtCUi } = useNumberLocale();
  const isEdit = Boolean(item?.id_CatchDoc);
  const [form, setForm] = useState({
    id_Zabon: item?.id_Zabon || "",
    Amount_CatchDoc: item?.Amount_CatchDoc || "",
    AllowanceAmount: item?.AllowanceAmount || "",
    Date_CatchDoc: item?.Date_CatchDoc || today(),
    Note_CatchDoc: item?.Note_CatchDoc || "سند قبض",
    id_CashBox: item?.id_CashBox || "",
  });
  const [errors, setErrors] = useState({});
  const [custDetails, setCustDetails] = useState({
    shown: false, loading: false, debitOwed: null, netProfit: null, error: "",
  });
  const set = (k) => (v) => {
    setForm((p) => ({ ...p, [k]: v }));
    setErrors((e) => ({ ...e, [k]: "" }));
    if (k === "id_Zabon") setCustDetails({ shown: false, loading: false, debitOwed: null, netProfit: null, error: "" });
  };

  const showCustomerDetails = async () => {
    if (!form.id_Zabon) return;
    setCustDetails({ shown: true, loading: true, debitOwed: null, netProfit: null, error: "" });
    try {
      const [profitRes, stmtRes] = await Promise.all([
        documentsService.customerProfit(form.id_Zabon),
        api.get("/statements/customer", { params: { id_Zabon: form.id_Zabon } }),
      ]);
      const finalBal = +(stmtRes?.totals?.finalBalance ?? 0);
      setCustDetails({
        shown: true,
        loading: false,
        debitOwed: finalBal >= 0 ? finalBal : 0,
        netProfit: profitRes?.data?.netProfit ?? 0,
        error: "",
      });
    } catch (e) {
      setCustDetails({
        shown: true,
        loading: false,
        debitOwed: null,
        netProfit: null,
        error: e?.message || "تعذر جلب التفاصيل",
      });
    }
  };

  const validateForm = () => {
    const er = {};
    if (!form.id_Zabon) er.id_Zabon = "الزبون مطلوب";
    if (!Number(form.Amount_CatchDoc)) er.Amount_CatchDoc = "المبلغ مطلوب";
    if (form.AllowanceAmount !== "" && Number(form.AllowanceAmount) < 0) er.AllowanceAmount = "مبلغ السماح لا يمكن أن يكون سالباً";
    if (!form.Note_CatchDoc.trim()) er.Note_CatchDoc = "الملاحظة مطلوبة";
    setErrors(er);
    return Object.keys(er).length === 0;
  };

  const handlePrint = () => {
    if (!validateForm()) return;
    const partyName = customers.find((s) => String(s.id_Zabon) === String(form.id_Zabon))?.ZabonName || `#${form.id_Zabon}`;
    printVoucherDoc({
      kind: "catch",
      company,
      logoUrl,
      voucher: {
        docNo: item?.id_CatchDoc || null,
        date: isEdit ? item.Date_CatchDoc : form.Date_CatchDoc,
        partyName,
        amount: form.Amount_CatchDoc,
        allowance: form.AllowanceAmount,
        note: form.Note_CatchDoc.trim(),
      },
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    const payload = {
      id_Zabon: Number(form.id_Zabon),
      Amount_CatchDoc: Number(form.Amount_CatchDoc),
      AllowanceAmount: Number(form.AllowanceAmount) || 0,
      Note_CatchDoc: form.Note_CatchDoc.trim(),
      id_CashBox: form.id_CashBox ? Number(form.id_CashBox) : undefined,
    };
    if (!isEdit) payload.Date_CatchDoc = form.Date_CatchDoc;
    await onSave(payload);
  };

  return (
    <Modal title={isEdit ? `تعديل سند قبض #${item.id_CatchDoc}` : "إضافة سند قبض"} onClose={onClose}>
      {isEdit && (
        <div style={{ marginBottom: 10, padding: "8px 12px", background: "var(--bg-surface)", borderRadius: 8, fontSize: ".82rem", color: "var(--text-secondary)" }}>
          تاريخ التسجيل: <strong style={{ color: "var(--text-primary)" }}>{fmtDate(item.Date_CatchDoc)}</strong>
          <span style={{ marginRight: 8 }}>— يبقى ثابتاً ولا يؤثر على السجلات الأخرى</span>
        </div>
      )}
      {serverError && <div className="alert alert-error" style={{ marginBottom: 10 }}>⚠ {serverError}</div>}
      <form onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={labelStyle}>الزبون *</label>
            <select value={form.id_Zabon} onChange={(e) => set("id_Zabon")(e.target.value)} style={selectStyle}>
              <option value="">اختر الزبون</option>
              {customers.map((s) => <option key={s.id_Zabon} value={s.id_Zabon}>{s.ZabonName || `#${s.id_Zabon}`}</option>)}
            </select>
            {errors.id_Zabon && <div style={errStyle}>{errors.id_Zabon}</div>}
          </div>
          <Input label={`${amountLabel("المبلغ")} *`} type="number" value={form.Amount_CatchDoc} onChange={set("Amount_CatchDoc")} error={errors.Amount_CatchDoc} />
          <Input label={amountLabel("مبلغ السماح")} type="number" value={form.AllowanceAmount} onChange={set("AllowanceAmount")} error={errors.AllowanceAmount} />
          {!isEdit ? (
            <Input label="التاريخ" type="date" value={form.Date_CatchDoc} onChange={set("Date_CatchDoc")} />
          ) : (
            <div>
              <label style={labelStyle}>التاريخ</label>
              <div style={{ ...selectStyle, opacity: 0.75, cursor: "not-allowed" }}>{fmtDate(item.Date_CatchDoc)}</div>
            </div>
          )}
          <CashBoxSelect value={form.id_CashBox} onChange={set("id_CashBox")} />
          <Input label="الملاحظة *" value={form.Note_CatchDoc} onChange={set("Note_CatchDoc")} error={errors.Note_CatchDoc} style={{ gridColumn: "1/-1" }} />
        </div>
        {!isEdit && form.id_Zabon && (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={showCustomerDetails}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                color: "var(--accent)",
                cursor: "pointer",
                fontFamily: "var(--font-main)",
                fontWeight: 700,
                fontSize: ".88rem",
                textDecoration: "underline",
              }}
            >
              اظهار تفاصيل
            </button>
            {custDetails.shown && (
              <div style={{ marginTop: 8, fontSize: ".9rem" }}>
                {custDetails.loading ? (
                  <span style={{ color: "var(--text-muted)" }}>جاري الحساب...</span>
                ) : custDetails.error ? (
                  <span style={{ color: "var(--danger)" }}>{custDetails.error}</span>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span>
                      مدين لنا:{" "}
                      <strong style={{ fontFamily: "var(--font-mono)", color: "#1d4ed8" }}>
                        {fmtCUi(custDetails.debitOwed)}
                      </strong>
                    </span>
                    <span>
                      الربح الصافي:{" "}
                      <strong style={{
                        fontFamily: "var(--font-mono)",
                        color: (custDetails.netProfit || 0) >= 0 ? "var(--success)" : "var(--danger)",
                      }}>
                        {fmtCUi(custDetails.netProfit)}
                      </strong>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="button" variant="secondary" onClick={handlePrint}>🖨 طباعة</Button>
          <Button type="submit" loading={saving}>{isEdit ? "💾 حفظ التعديل" : "💾 حفظ"}</Button>
        </div>
      </form>
    </Modal>
  );
}

const thStyle = { padding: "10px 12px", textAlign: "right", color: "var(--text-secondary)", fontWeight: 700, fontSize: ".73rem" };
const tdStyle = { padding: "10px 12px", textAlign: "right" };
const labelStyle = { fontSize: ".8rem", color: "var(--text-secondary)", marginBottom: 4, display: "block" };
const errStyle = { fontSize: ".78rem", color: "var(--danger)", marginTop: 4 };
const selectStyle = {
  width: "100%",
  padding: "10px 12px",
  background: "var(--bg-input)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-main)",
  outline: "none",
};

const escPrint = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function printVoucherDoc({ kind, company, logoUrl, voucher }) {
  const coName = company?.CompanyInformation_Name || "اسم الشركة";
  const mobile = company?.CompanyInformation_Mobile || "";
  const address = company?.CompanyInformation_Adress || "";
  const infoExtra = [company?.CompanyInformation_Info1, company?.CompanyInformation_Info2]
    .filter(Boolean)
    .join("  |  ");
  const isPay = kind === "pay";
  const typeTitle = isPay ? "سند دفع" : "سند قبض";
  const partyLabel = isPay ? "المورد" : "الزبون";
  const docNoLabel = voucher.docNo ? `#${voucher.docNo}` : "مسودة";
  const allowanceAmt = Number(voucher.allowance) || 0;

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
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    padding: 12mm 10mm 10mm;
  }
  .main { flex: 1 0 auto; }
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
  .doc-type.pay { border-color: #2563eb; color: #dbeafe; background: linear-gradient(135deg, #1e3a5f, #1a1a2e); }
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
  .voucher-body {
    padding: 20px 16px;
    border: 1px dashed #c4a84d;
    border-radius: 12px;
    background: linear-gradient(145deg, rgba(250, 251, 252, 0.95) 0%, #fff 100%);
    margin-bottom: 28px;
  }
  .amount-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 8px;
    border-bottom: 2px solid #b8860b;
    margin-bottom: 14px;
  }
  .amount-label { font-size: 1rem; font-weight: 700; color: #334155; }
  .amount-value {
    font-family: Consolas, monospace;
    font-size: 1.35rem;
    font-weight: 900;
    color: ${isPay ? "#dc2626" : "#059669"};
  }
  .note-block { padding: 8px 4px; }
  .note-label { font-size: 0.75rem; font-weight: 700; color: #64748b; margin-bottom: 6px; }
  .note-text { font-size: 1rem; line-height: 1.7; color: #0f172a; font-weight: 600; }
  .signatures {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    margin-top: 36px;
    margin-bottom: 24px;
    padding-top: 8px;
  }
  .sig {
    flex: 1;
    text-align: center;
    min-width: 0;
  }
  .sig-line {
    border-bottom: 1px solid #334155;
    height: 48px;
    margin-bottom: 8px;
  }
  .sig-label {
    font-size: 0.82rem;
    font-weight: 700;
    color: #475569;
    line-height: 1.4;
  }
  .ftr {
    margin-top: auto;
    padding: 12px 8px 4px;
    border-top: 2px solid #b8860b;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 8px 20px;
    font-size: 0.8rem;
    color: #475569;
    text-align: center;
  }
  .ftr-item { white-space: nowrap; }
  .ftr-sep { color: #cbd5e1; user-select: none; }
  .ftr-dev { font-weight: 700; color: #1a1a2e; }
  @media print {
    html, body { height: auto; min-height: 100%; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .wrap { min-height: 100vh; page-break-inside: avoid; }
    .ftr { position: fixed; bottom: 0; left: 0; right: 0; background: #fff; padding: 10px 12mm; }
    .main { padding-bottom: 48px; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="hdr">
    <div class="hdr-co">
      <h1>${escPrint(coName)}</h1>
      ${infoExtra ? `<div class="sub">${escPrint(infoExtra)}</div>` : ""}
      <div class="doc-type ${isPay ? "pay" : "catch"}">${escPrint(typeTitle)}</div>
    </div>
    <div class="hdr-logo">${logoUrl ? `<img src="${escPrint(logoUrl)}" alt=""/>` : ""}</div>
  </header>

  <div class="main">
    <section class="meta">
      <div class="meta-item"><span class="ml">رقم السند</span><span class="mv accent">${escPrint(docNoLabel)}</span></div>
      <div class="meta-item"><span class="ml">التاريخ</span><span class="mv">${escPrint(voucher.date || "—")}</span></div>
      <div class="meta-item"><span class="ml">${escPrint(partyLabel)}</span><span class="mv">${escPrint(voucher.partyName || "—")}</span></div>
    </section>

    <div class="voucher-body">
      <div class="amount-row">
        <span class="amount-label">المبلغ (${isPay ? "مدفوع" : "مقبوض"})</span>
        <span class="amount-value">${escPrint(fmtC(voucher.amount))}</span>
      </div>
      ${!isPay && allowanceAmt > 0 ? `
      <div class="amount-row" style="border-bottom:1px solid #e2e8f0;margin-bottom:14px;padding-bottom:12px;">
        <span class="amount-label">السماح</span>
        <span class="amount-value" style="color:#d97706;font-size:1.15rem;">${escPrint(fmtC(allowanceAmt))}</span>
      </div>` : ""}
      <div class="note-block">
        <div class="note-label">البيان / الملاحظة</div>
        <div class="note-text">${escPrint(voucher.note || "—")}</div>
      </div>
    </div>

    <section class="signatures">
      <div class="sig">
        <div class="sig-line"></div>
        <div class="sig-label">توقيع المستلم</div>
      </div>
      <div class="sig">
        <div class="sig-line"></div>
        <div class="sig-label">توقيع أمين الصندوق / المحاسب</div>
      </div>
      <div class="sig">
        <div class="sig-line"></div>
        <div class="sig-label">توقيع المدير</div>
      </div>
    </section>
  </div>

  <footer class="ftr">
    ${[
      mobile ? `<span class="ftr-item">📞 ${escPrint(mobile)}</span>` : "",
      address ? `<span class="ftr-item">📍 ${escPrint(address)}</span>` : "",
      `<span class="ftr-item ftr-dev">${escPrint(PROGRAMMER)}</span>`,
    ]
      .filter(Boolean)
      .join('<span class="ftr-sep">|</span>')}
  </footer>
</div>
</body>
</html>`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", " ");
  iframe.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;visibility:hidden";
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = win.document;
  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    try {
      document.body.removeChild(iframe);
    } catch {
      /* ignore */
    }
  };

  const doPrint = () => {
    try {
      doc.title = " ";
    } catch {
      /* ignore */
    }
    win.focus();
    win.print();
    setTimeout(cleanup, 2000);
  };

  if (doc.readyState === "complete") {
    setTimeout(doPrint, 80);
  } else {
    iframe.onload = () => setTimeout(doPrint, 80);
  }
}
