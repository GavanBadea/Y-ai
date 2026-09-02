import { useMemo, useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import { Card, StatCard } from "@/components/ui/Card";
import { useApi, useAction } from "@/hooks/useApi";
import { debtService, partyService } from "@/services/api";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { useCompany } from "@/context/CompanyContext";
import { printTableReport, exportTableExcel, ExportPrintBar } from "@/utils/tableReportTools";
import { r2, fmt, fmtN, fmtC } from "@/utils/numFormat";

const today = () => new Date().toISOString().split("T")[0];
const isAutoDebtEntry = (note = "") => {
  const n = String(note || "").trim();
  return (
    n.startsWith("فاتورة مشتريات رقم") ||
    n.startsWith("فاتورة مبيعات رقم") ||
    n.startsWith("تسوية سند دفع رقم") ||
    n.startsWith("تسوية سند قبض رقم")
  );
};

export default function DebtsPage() {
  const { locale } = useNumberLocale(); // locale متاح للمكوّن الرئيسي

  const [tab, setTab] = useState("suppliers");
  const [showAutoEntries, setShowAutoEntries] = useState(false);
  return (
    <AppLayout title="الديون السابقة">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: ".82rem", color: "var(--text-muted)" }}>
          القيود التلقائية تشمل فواتير الشراء/المبيعات وتسويات السندات
        </div>
        <Button
          size="sm"
          variant={showAutoEntries ? "secondary" : "ghost"}
          onClick={() => setShowAutoEntries((v) => !v)}
        >
          {showAutoEntries ? "إخفاء القيود التلقائية" : "إظهار القيود التلقائية"}
        </Button>
      </div>

      <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
        {[
          { id: "suppliers", label: "🏭 ديون الموردين" },
          { id: "customers", label: "🧑‍💼 ديون الزبائن" },
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

      {tab === "suppliers"
        ? <SuppliersDebtTab showAutoEntries={showAutoEntries} />
        : <CustomersDebtTab showAutoEntries={showAutoEntries} />}
    </AppLayout>
  );
}

function SuppliersDebtTab({ showAutoEntries }) {
  const { company } = useCompany();
  const [idAmil, setIdAmil] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [formError, setFormError] = useState("");

  const { data: suppliersData } = useApi(() => partyService.getSuppliers(), []);
  const { data: debtData, loading, error, refetch } = useApi(
    () => debtService.getSupplierDebts({ id_Amil: idAmil || undefined }),
    [idAmil]
  );
  const suppliers = suppliersData?.data || [];
  const debtsRaw = debtData?.data || [];
  const debts = showAutoEntries
    ? debtsRaw
    : debtsRaw.filter((d) => !isAutoDebtEntry(d.Note_DionAmil));

  const total = useMemo(() => debts.reduce((s, d) => s + Number(d.Amount_DionAmil || 0), 0), [debts]);
  const { loading: saving, execute } = useAction();

  const debtHeaders = ["#", "التاريخ", "المورد", "المبلغ", "الملاحظة"];
  const debtRows = debts.map((d) => [
    d.id_DionAmil, d.Date_DionAmil || "—", d.AmilName || `#${d.id_Amil}`, d.Amount_DionAmil, d.Note_DionAmil || "—",
  ]);

  const onSave = async (payload) => {
    setFormError("");
    await execute(
      () =>
        editItem
          ? debtService.updateSupplierDebt(editItem.id_DionAmil, payload)
          : debtService.createSupplierDebt(payload),
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
    if (!confirm(`حذف السند #${row.id_DionAmil} ؟`)) return;
    await execute(() => debtService.removeSupplierDebt(row.id_DionAmil), { onSuccess: refetch });
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        <StatCard label="عدد السندات" value={fmtN(debts.length)} sub="سند دين مورد" />
        <StatCard label="الإجمالي" value={fmtC(total)} sub="ديون مسجلة" variant="warning" />
        <StatCard label="المورد المختار" value={idAmil ? `#${idAmil}` : "الكل"} sub="فلترة" />
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
        <Button onClick={() => { setEditItem(null); setFormError(""); setShowForm(true); }}>+ سند جديد</Button>
        <Button variant="secondary" size="sm" onClick={refetch}>↺</Button>
        <ExportPrintBar
          disabled={!debts.length}
          onPrint={() => printTableReport(company, "ديون الموردين السابقة", `${debts.length} سند`, debtHeaders, debtRows)}
          onExcel={() => exportTableExcel("ديون_الموردين", "ديون الموردين", debtHeaders, debtRows)}
        />
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 10 }}>⚠ {error}</div>}

      <Card padding="0">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".87rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["#", "التاريخ", "المورد", "المبلغ", "الملاحظة", ""].map((h, i) => (
                <th key={i} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: "center" }}><span className="spinner" /></td></tr>
            ) : debts.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 28, textAlign: "center", color: "var(--text-muted)" }}>لا توجد سندات</td></tr>
            ) : debts.map((d) => (
              <tr key={d.id_DionAmil} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={tdStyle}>{d.id_DionAmil}</td>
                <td style={tdStyle}>{d.Date_DionAmil || "—"}</td>
                <td style={tdStyle}>{d.AmilName || `#${d.id_Amil}`}</td>
                <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", color: "var(--warning)", fontWeight: 700 }}>
                  {fmtC(d.Amount_DionAmil)}
                </td>
                <td style={tdStyle}>{d.Note_DionAmil || "—"}</td>
                <td style={tdStyle}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Button size="sm" variant="secondary" onClick={() => { setEditItem(d); setFormError(""); setShowForm(true); }}>✏</Button>
                    <Button size="sm" variant="danger" onClick={() => onDelete(d)}>🗑</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showForm && (
        <SupplierDebtModal
          item={editItem}
          suppliers={suppliers}
          saving={saving}
          serverError={formError}
          onClose={() => { setShowForm(false); setEditItem(null); }}
          onSave={onSave}
        />
      )}
    </>
  );
}

function CustomersDebtTab({ showAutoEntries }) {
  const { company } = useCompany();
  const [idZabon, setIdZabon] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [formError, setFormError] = useState("");

  const { data: customersData } = useApi(() => partyService.getCustomers(), []);
  const { data: debtData, loading, error, refetch } = useApi(
    () => debtService.getCustomerDebts({ id_Zabon: idZabon || undefined }),
    [idZabon]
  );
  const customers = customersData?.data || [];
  const debtsRaw = debtData?.data || [];
  const debts = showAutoEntries
    ? debtsRaw
    : debtsRaw.filter((d) => !isAutoDebtEntry(d.Note_DionZabon));

  const total = useMemo(() => debts.reduce((s, d) => s + Number(d.Amount_DionZabon || 0), 0), [debts]);
  const { loading: saving, execute } = useAction();

  const debtHeaders = ["#", "التاريخ", "الزبون", "المبلغ", "الملاحظة"];
  const debtRows = debts.map((d) => [
    d.id_DionZabon, d.Date_DionZabon || "—", d.ZabonName || `#${d.id_Zabon}`, d.Amount_DionZabon, d.Note_DionZabon || "—",
  ]);

  const onSave = async (payload) => {
    setFormError("");
    await execute(
      () =>
        editItem
          ? debtService.updateCustomerDebt(editItem.id_DionZabon, payload)
          : debtService.createCustomerDebt(payload),
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
    if (!confirm(`حذف السند #${row.id_DionZabon} ؟`)) return;
    await execute(() => debtService.removeCustomerDebt(row.id_DionZabon), { onSuccess: refetch });
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        <StatCard label="عدد السندات" value={fmtN(debts.length)} sub="سند دين زبون" />
        <StatCard label="الإجمالي" value={fmtC(total)} sub="ديون مسجلة" variant="danger" />
        <StatCard label="الزبون المختار" value={idZabon ? `#${idZabon}` : "الكل"} sub="فلترة" />
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
        <Button onClick={() => { setEditItem(null); setFormError(""); setShowForm(true); }}>+ سند جديد</Button>
        <Button variant="secondary" size="sm" onClick={refetch}>↺</Button>
        <ExportPrintBar
          disabled={!debts.length}
          onPrint={() => printTableReport(company, "ديون الزبائن السابقة", `${debts.length} سند`, debtHeaders, debtRows)}
          onExcel={() => exportTableExcel("ديون_الزبائن", "ديون الزبائن", debtHeaders, debtRows)}
        />
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 10 }}>⚠ {error}</div>}

      <Card padding="0">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".87rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["#", "التاريخ", "الزبون", "المبلغ", "الملاحظة", ""].map((h, i) => (
                <th key={i} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: "center" }}><span className="spinner" /></td></tr>
            ) : debts.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 28, textAlign: "center", color: "var(--text-muted)" }}>لا توجد سندات</td></tr>
            ) : debts.map((d) => (
              <tr key={d.id_DionZabon} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={tdStyle}>{d.id_DionZabon}</td>
                <td style={tdStyle}>{d.Date_DionZabon || "—"}</td>
                <td style={tdStyle}>{d.ZabonName || `#${d.id_Zabon}`}</td>
                <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", color: "var(--danger)", fontWeight: 700 }}>
                  {fmtC(d.Amount_DionZabon)}
                </td>
                <td style={tdStyle}>{d.Note_DionZabon || "—"}</td>
                <td style={tdStyle}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Button size="sm" variant="secondary" onClick={() => { setEditItem(d); setFormError(""); setShowForm(true); }}>✏</Button>
                    <Button size="sm" variant="danger" onClick={() => onDelete(d)}>🗑</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showForm && (
        <CustomerDebtModal
          item={editItem}
          customers={customers}
          saving={saving}
          serverError={formError}
          onClose={() => { setShowForm(false); setEditItem(null); }}
          onSave={onSave}
        />
      )}
    </>
  );
}

function SupplierDebtModal({ item, suppliers, saving, serverError, onClose, onSave }) {
  const [form, setForm] = useState({
    id_Amil: item?.id_Amil || "",
    Amount_DionAmil: item?.Amount_DionAmil || 0,
    Date_DionAmil: item?.Date_DionAmil || today(),
    Note_DionAmil: item?.Note_DionAmil || "رصيد افتتاحي",
  });
  const [errors, setErrors] = useState({});

  const set = (k) => (v) => { setForm((p) => ({ ...p, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (!form.id_Amil) er.id_Amil = "المورد مطلوب";
    if (!Number(form.Amount_DionAmil)) er.Amount_DionAmil = "المبلغ مطلوب";
    if (!form.Note_DionAmil.trim()) er.Note_DionAmil = "الملاحظة مطلوبة";
    setErrors(er);
    if (Object.keys(er).length) return;
    await onSave({
      id_Amil: Number(form.id_Amil),
      Amount_DionAmil: Number(form.Amount_DionAmil),
      Date_DionAmil: form.Date_DionAmil,
      Note_DionAmil: form.Note_DionAmil.trim(),
    });
  };

  return (
    <Modal title={item ? `✏ تعديل سند #${item.id_DionAmil}` : "✚ سند دين مورد"} onClose={onClose}>
      {serverError && <div className="alert alert-error" style={{ marginBottom: 10 }}>⚠ {serverError}</div>}
      <form onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={labelStyle}>المورد *</label>
            <select value={form.id_Amil} onChange={(e) => set("id_Amil")(e.target.value)} style={selectStyle} disabled={!!item}>
              <option value="">اختر المورد</option>
              {suppliers.map((s) => <option key={s.id_Amil} value={s.id_Amil}>{s.AmilName || `#${s.id_Amil}`}</option>)}
            </select>
            {errors.id_Amil && <div style={errStyle}>{errors.id_Amil}</div>}
          </div>
          <Input label="المبلغ (د.ع) *" type="number" value={form.Amount_DionAmil} onChange={set("Amount_DionAmil")} error={errors.Amount_DionAmil} />
          <Input label="التاريخ" type="date" value={form.Date_DionAmil} onChange={set("Date_DionAmil")} />
          <Input label="الملاحظة *" value={form.Note_DionAmil} onChange={set("Note_DionAmil")} error={errors.Note_DionAmil} style={{ gridColumn: "1/-1" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={saving}>💾 حفظ</Button>
        </div>
      </form>
    </Modal>
  );
}

function CustomerDebtModal({ item, customers, saving, serverError, onClose, onSave }) {
  const [form, setForm] = useState({
    id_Zabon: item?.id_Zabon || "",
    Amount_DionZabon: item?.Amount_DionZabon || 0,
    Date_DionZabon: item?.Date_DionZabon || today(),
    Note_DionZabon: item?.Note_DionZabon || "رصيد افتتاحي",
  });
  const [errors, setErrors] = useState({});

  const set = (k) => (v) => { setForm((p) => ({ ...p, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); };

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (!form.id_Zabon) er.id_Zabon = "الزبون مطلوب";
    if (!Number(form.Amount_DionZabon)) er.Amount_DionZabon = "المبلغ مطلوب";
    if (!form.Note_DionZabon.trim()) er.Note_DionZabon = "الملاحظة مطلوبة";
    setErrors(er);
    if (Object.keys(er).length) return;
    await onSave({
      id_Zabon: Number(form.id_Zabon),
      Amount_DionZabon: Number(form.Amount_DionZabon),
      Date_DionZabon: form.Date_DionZabon,
      Note_DionZabon: form.Note_DionZabon.trim(),
    });
  };

  return (
    <Modal title={item ? `✏ تعديل سند #${item.id_DionZabon}` : "✚ سند دين زبون"} onClose={onClose}>
      {serverError && <div className="alert alert-error" style={{ marginBottom: 10 }}>⚠ {serverError}</div>}
      <form onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ gridColumn: "1/-1" }}>
            <label style={labelStyle}>الزبون *</label>
            <select value={form.id_Zabon} onChange={(e) => set("id_Zabon")(e.target.value)} style={selectStyle} disabled={!!item}>
              <option value="">اختر الزبون</option>
              {customers.map((s) => <option key={s.id_Zabon} value={s.id_Zabon}>{s.ZabonName || `#${s.id_Zabon}`}</option>)}
            </select>
            {errors.id_Zabon && <div style={errStyle}>{errors.id_Zabon}</div>}
          </div>
          <Input label="المبلغ (د.ع) *" type="number" value={form.Amount_DionZabon} onChange={set("Amount_DionZabon")} error={errors.Amount_DionZabon} />
          <Input label="التاريخ" type="date" value={form.Date_DionZabon} onChange={set("Date_DionZabon")} />
          <Input label="الملاحظة *" value={form.Note_DionZabon} onChange={set("Note_DionZabon")} error={errors.Note_DionZabon} style={{ gridColumn: "1/-1" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={saving}>💾 حفظ</Button>
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
