// ============================================================
//  src/pages/parties/PartiesPage.jsx
//  إدارة الأطراف التجارية: زبائن + موردون
//  مع الرصيد الافتتاحي لكل طرف
// ============================================================
import { useState }                           from "react";
import AppLayout                              from "@/components/layout/AppLayout";
import { Card, Badge, StatCard }              from "@/components/ui/Card";
import Button                                 from "@/components/ui/Button";
import Input                                  from "@/components/ui/Input";
import Modal                                  from "@/components/ui/Modal";
import { useApi, useAction }                  from "@/hooks/useApi";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { r2, fmt, fmtN, fmtC } from "@/utils/numFormat";
import { partyService, commonService,
         documentsService }                   from "@/services/api";
import ExcelImportButton                    from "@/components/import/ExcelImportButton";
import { useCompany } from "@/context/CompanyContext";
import { printTableReport, exportTableExcel, ExportPrintBar } from "@/utils/tableReportTools";


// ══════════════════════════════════════════════════════════
export default function PartiesPage() {
  const { locale } = useNumberLocale(); // locale متاح للمكوّن الرئيسي
  // fmtC مع pos = { color, label } للتوافق مع الكود الأصلي
  const fmtCp = (n, pos) => {
    const v = Number(n || 0);
    const color = pos === undefined ? '' : v > 0 ? 'var(--danger)' : v < 0 ? 'var(--success)' : 'var(--text-muted)';
    const label = `${fmtN(Math.abs(v))} د.ع`;
    return pos === undefined ? label : { color, label };
  };

  const [tab, setTab] = useState("customers");

  return (
    <AppLayout title="الأطراف التجارية">
      {/* ── تبويبات ─────────────────────────────────────── */}
      <div style={{ display:"flex", gap:0, marginBottom:24, borderBottom:"1px solid var(--border)" }}>
        {[
          { id:"customers", label:"🧑‍💼 الزبائن" },
          { id:"suppliers", label:"🏭 الموردون" },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:"10px 22px", background:"none", border:"none",
            borderBottom:`2px solid ${tab === t.id ? "var(--accent)" : "transparent"}`,
            color: tab === t.id ? "var(--accent)" : "var(--text-secondary)",
            fontWeight: tab === t.id ? 700 : 500,
            fontSize:".9rem", cursor:"pointer", fontFamily:"var(--font-main)",
            marginBottom:-1, transition:"all var(--transition)",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "customers" ? <CustomersTab /> : <SuppliersTab />}
    </AppLayout>
  );
}

// ══════════════════════════════════════════════════════════
//  تبويب الزبائن
// ══════════════════════════════════════════════════════════
function CustomersTab() {
  const { company } = useCompany();
  const [search,    setSearch   ] = useState("");
  const [locFilter, setLocFilter] = useState("");
  const [showForm,  setShowForm ] = useState(false);
  const [editItem,  setEditItem ] = useState(null);
  const [formMsg,   setFormMsg  ] = useState("");

  const { data, loading, error, refetch } = useApi(
    () => partyService.getCustomers({ search: search || undefined, id_ZabonLocation: locFilter || undefined }),
    [search, locFilter]
  );
  const { data: locsData } = useApi(() => commonService.getLocations(), []);
  const { loading: saving, execute } = useAction();

  const customers  = data?.data   || [];
  const locations  = locsData?.data || [];

  const openCreate = () => { setEditItem(null); setFormMsg(""); setShowForm(true); };
  const openEdit   = (r) => { setEditItem(r);   setFormMsg(""); setShowForm(true); };
  const closeForm  = ()  => { setShowForm(false); setEditItem(null); setFormMsg(""); };

  const totalDebt = customers.reduce((s, c) => s + (c.NetBalance || 0), 0);

  const custHeaders = ["#", "اسم الزبون", "الهاتف", "المنطقة", "حد الائتمان", "الرصيد الحالي"];
  const custRows = customers.map((c) => [
    c.id_Zabon, c.ZabonName || "—", c.Mobail || "—", c.Location_ZabonLocation || "—",
    c.Limitation ?? 0, c.NetBalance ?? 0,
  ]);

  const handleSave = async (data) => {
    await execute(
      () => editItem
        ? partyService.updateCustomer(editItem.id_Zabon, data)
        : partyService.createCustomer(data),
      { onSuccess: () => { refetch(); closeForm(); }, onError: (e) => setFormMsg(e) }
    );
  };

  return (
    <>
      {/* ── إحصائيات ──────────────────────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:20 }}>
        <StatCard label="عدد الزبائن"    value={fmtN(customers.length)} sub="زبون نشط" />
        <StatCard label="إجمالي الديون"  value={fmtC(totalDebt)}       sub="د.ع مستحقة" variant="danger" />
        <StatCard label="زبائن بدون دين" value={fmtN(customers.filter(c => (c.NetBalance||0) <= 0).length)} sub="حساب مسوَّى" variant="success" />
      </div>

      {/* ── فلاتر ────────────────────────────────────── */}
      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
        <Input value={search} onChange={setSearch} placeholder="🔍 بحث بالاسم أو الهاتف..." style={{ flex:"1 1 180px" }} />
        <select value={locFilter} onChange={(e) => setLocFilter(e.target.value)} style={selectStyle}>
          <option value="">كل المناطق</option>
          {locations.map((l) => (
            <option key={l.id_ZabonLocation} value={l.id_ZabonLocation}>{l.Location_ZabonLocation}</option>
          ))}
        </select>
        <Button onClick={openCreate}>+ زبون جديد</Button>
        <ExcelImportButton
          endpoint="/party/customers/import"
          templateFilename="قالب_الزبائن"
          templateHeaders={["اسم_الزبون", "الموبايل", "العنوان", "المنطقة", "حد_الائتمان"]}
          exampleRows={[["أحمد علي", "07701234567", "بغداد — الكرادة", "الكرادة", "500000"]]}
          onSuccess={refetch}
        />
        <Button variant="secondary" size="sm" onClick={refetch}>↺</Button>
        <ExportPrintBar
          disabled={!customers.length}
          onPrint={() => printTableReport(company, "قائمة الزبائن", `${customers.length} زبون`, custHeaders, custRows)}
          onExcel={() => exportTableExcel("الزبائن", "الزبائن", custHeaders, custRows)}
        />
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom:14 }}>⚠ {error}</div>}

      {/* ── الجدول ────────────────────────────────────── */}
      <Card padding="0">
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:".875rem" }}>
          <thead>
            <tr style={{ borderBottom:"1px solid var(--border)" }}>
              {["#", "اسم الزبون", "الهاتف", "المنطقة", "حد الائتمان", "الرصيد الحالي", ""].map((h, i) => (
                <th key={i} style={{ padding:"10px 14px", textAlign:"right", color:"var(--text-secondary)", fontWeight:700, fontSize:".74rem", textTransform:"uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding:40, textAlign:"center" }}><span className="spinner" /></td></tr>
            ) : customers.length === 0 ? (
              <tr><td colSpan={7} style={{ padding:48, textAlign:"center", color:"var(--text-muted)" }}>لا يوجد زبائن — أضف زبوناً جديداً</td></tr>
            ) : customers.map((c) => {
              const bal   = fmtC(Math.abs(c.NetBalance || 0), c.NetBalance || 0);
              const color = (c.NetBalance || 0) > 0 ? "var(--danger)" : (c.NetBalance || 0) < 0 ? "var(--success)" : "var(--text-muted)";
              return (
                <tr key={c.id_Zabon} style={{ borderBottom:"1px solid var(--border-subtle)", transition:"background var(--transition)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}>
                  <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontSize:".74rem", color:"var(--text-muted)" }}>{c.id_Zabon}</td>
                  <td style={{ padding:"10px 14px", fontWeight:700 }}>{c.ZabonName || "—"}</td>
                  <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontSize:".84rem" }}>{c.Mobail || "—"}</td>
                  <td style={{ padding:"10px 14px" }}><Badge label={c.Location_ZabonLocation || "—"} /></td>
                  <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontSize:".82rem" }}>{fmtC(c["Credit Limit"] || c.CreditLimit || 0)}</td>
                  <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontWeight:700, color }}>
                    {(c.NetBalance || 0) === 0 ? <Badge label="مسوَّى ✓" variant="success" />
                     : <span>{(c.NetBalance||0) > 0 ? "مدين: " : "دائن: "}{bal.label}</span>}
                  </td>
                  <td style={{ padding:"10px 14px" }}>
                    <Button size="sm" variant="secondary" onClick={() => openEdit(c)}>✏ تعديل</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {showForm && (
        <CustomerModal
          item={editItem}
          locations={locations}
          saving={saving}
          serverError={formMsg}
          onClose={closeForm}
          onSave={handleSave}
        />
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════
//  تبويب الموردون
// ══════════════════════════════════════════════════════════
function SuppliersTab() {
  const { company } = useCompany();
  const [search,   setSearch  ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [formMsg,  setFormMsg ] = useState("");

  const { data, loading, error, refetch } = useApi(
    () => partyService.getSuppliers({ search: search || undefined }),
    [search]
  );
  const { loading: saving, execute } = useAction();

  const suppliers = data?.data || [];
  const totalDebt = suppliers.reduce((s, c) => s + (c.NetBalance || 0), 0);

  const supHeaders = ["#", "اسم المورد", "الهاتف", "العنوان", "إجمالي المشتريات", "المدفوع", "الرصيد"];
  const supRows = suppliers.map((s) => [
    s.id_Amil, s.AmilName || "—", s.Mobil || "—", s.Adress || "—",
    s.TotalPurchases ?? 0, s.TotalPaid ?? 0, s.NetBalance ?? 0,
  ]);

  const openCreate = () => { setEditItem(null); setFormMsg(""); setShowForm(true); };
  const openEdit   = (r) => { setEditItem(r);   setFormMsg(""); setShowForm(true); };
  const closeForm  = ()  => { setShowForm(false); setEditItem(null); setFormMsg(""); };

  const handleSave = async (data) => {
    await execute(
      () => editItem
        ? partyService.updateSupplier(editItem.id_Amil, data)
        : partyService.createSupplier(data),
      { onSuccess: () => { refetch(); closeForm(); }, onError: (e) => setFormMsg(e) }
    );
  };

  return (
    <>
      {/* ── إحصائيات ──────────────────────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:20 }}>
        <StatCard label="عدد الموردين"   value={fmtN(suppliers.length)} sub="مورد مسجّل" />
        <StatCard label="ديوننا للموردين" value={fmtC(totalDebt)}      sub="د.ع مستحقة" variant="warning" />
        <StatCard label="حسابات مسوَّاة" value={fmtN(suppliers.filter(s => (s.NetBalance||0) <= 0).length)} sub="مورد" variant="success" />
      </div>

      {/* ── فلاتر ────────────────────────────────────── */}
      <div style={{ display:"flex", gap:10, marginBottom:16, alignItems:"center" }}>
        <Input value={search} onChange={setSearch} placeholder="🔍 بحث بالاسم أو الهاتف..." style={{ flex:1 }} />
        <Button onClick={openCreate}>+ مورد جديد</Button>
        <ExcelImportButton
          endpoint="/party/suppliers/import"
          templateFilename="قالب_الموردين"
          templateHeaders={["اسم_المورد", "الموبايل", "العنوان"]}
          exampleRows={[["شركة الغذاء", "07801234567", "بغداد — الشورجة"]]}
          onSuccess={refetch}
        />
        <Button variant="secondary" size="sm" onClick={refetch}>↺</Button>
        <ExportPrintBar
          disabled={!suppliers.length}
          onPrint={() => printTableReport(company, "قائمة الموردين", `${suppliers.length} مورد`, supHeaders, supRows)}
          onExcel={() => exportTableExcel("الموردين", "الموردين", supHeaders, supRows)}
        />
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom:14 }}>⚠ {error}</div>}

      <Card padding="0">
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:".875rem" }}>
          <thead>
            <tr style={{ borderBottom:"1px solid var(--border)" }}>
              {["#", "اسم المورد", "الهاتف", "العنوان", "إجمالي المشتريات", "المدفوع", "الرصيد", ""].map((h,i) => (
                <th key={i} style={{ padding:"10px 14px", textAlign:"right", color:"var(--text-secondary)", fontWeight:700, fontSize:".74rem", textTransform:"uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding:40, textAlign:"center" }}><span className="spinner" /></td></tr>
            ) : suppliers.length === 0 ? (
              <tr><td colSpan={8} style={{ padding:48, textAlign:"center", color:"var(--text-muted)" }}>لا يوجد موردون — أضف مورداً جديداً</td></tr>
            ) : suppliers.map((s) => {
              const color = (s.NetBalance||0) > 0 ? "var(--warning)" : (s.NetBalance||0) < 0 ? "var(--success)" : "var(--text-muted)";
              return (
                <tr key={s.id_Amil} style={{ borderBottom:"1px solid var(--border-subtle)", transition:"background var(--transition)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}>
                  <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontSize:".74rem", color:"var(--text-muted)" }}>{s.id_Amil}</td>
                  <td style={{ padding:"10px 14px", fontWeight:700 }}>{s.AmilName || "—"}</td>
                  <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontSize:".84rem" }}>{s.Mobil || "—"}</td>
                  <td style={{ padding:"10px 14px", fontSize:".82rem", color:"var(--text-secondary)" }}>{s.Adress || "—"}</td>
                  <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontSize:".82rem" }}>{fmtC(s.TotalDebt || 0)}</td>
                  <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontSize:".82rem", color:"var(--success)" }}>{fmtC(s.TotalPaid || 0)}</td>
                  <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontWeight:700, color }}>
                    {(s.NetBalance||0) === 0
                      ? <Badge label="مسوَّى ✓" variant="success" />
                      : fmtC(Math.abs(s.NetBalance||0))}
                  </td>
                  <td style={{ padding:"10px 14px" }}>
                    <Button size="sm" variant="secondary" onClick={() => openEdit(s)}>✏ تعديل</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {showForm && (
        <SupplierModal
          item={editItem}
          saving={saving}
          serverError={formMsg}
          onClose={closeForm}
          onSave={handleSave}
        />
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════
//  Modal الزبون
// ══════════════════════════════════════════════════════════
function CustomerModal({ item, locations, saving, serverError, onClose, onSave }) {
  const [form, setForm] = useState({
    ZabonName       : item?.ZabonName        || "",
    Mobail          : item?.Mobail           || "",
    Adress          : item?.Adress           || "",
    id_ZabonLocation: item?.id_ZabonLocation || "",
    "Credit Limit"  : item?.["Credit Limit"] || item?.CreditLimit || 0,
  });
  const [errors, setErrors] = useState({});

  const set = (k) => (v) => { setForm((p) => ({ ...p, [k]: v })); setErrors((e) => ({ ...e, [k]:"" })); };

  const validate = () => {
    const e = {};
    if (!form.ZabonName.trim()) e.ZabonName = "الاسم مطلوب";
    if (!form.Mobail.trim())    e.Mobail    = "الهاتف مطلوب";
    if (!form.Adress.trim())    e.Adress    = "العنوان مطلوب";
    setErrors(e);
    return !Object.keys(e).length;
  };

  return (
    <Modal title={item ? `✏ تعديل: ${item.ZabonName}` : "✚ زبون جديد"} onClose={onClose}>
      {serverError && <div className="alert alert-error" style={{ marginBottom:16 }}>⚠ {serverError}</div>}

      <form onSubmit={async (ev) => {
        ev.preventDefault();
        if (!validate()) return;
        await onSave({
          ...form,
          "Credit Limit": Number(form["Credit Limit"]),
        });
      }}>
        <SectionLabel>البيانات الأساسية</SectionLabel>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
          <Input label="اسم الزبون *" value={form.ZabonName} onChange={set("ZabonName")} error={errors.ZabonName} placeholder="اسم الزبون أو الشركة" style={{ gridColumn:"1/-1" }} autoFocus />
          <Input label="رقم الهاتف *" value={form.Mobail}    onChange={set("Mobail")}    error={errors.Mobail}    placeholder="07XXXXXXXXX" />
          <Input label="العنوان *"    value={form.Adress}    onChange={set("Adress")}    error={errors.Adress}    placeholder="المنطقة — الشارع" />
          <div>
            <label style={labelStyle}>المنطقة</label>
            <select value={form.id_ZabonLocation} onChange={(e) => set("id_ZabonLocation")(e.target.value)} style={selectStyle}>
              <option value="">بدون منطقة</option>
              {locations.map((l) => (
                <option key={l.id_ZabonLocation} value={l.id_ZabonLocation}>{l.Location_ZabonLocation}</option>
              ))}
            </select>
          </div>
          <Input label="حد الائتمان (د.ع)" value={form["Credit Limit"]} onChange={set("Credit Limit")} type="number" min="0" />
        </div>

        <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={saving}>{item ? "💾 حفظ" : "✚ إضافة"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════
//  Modal المورد
// ══════════════════════════════════════════════════════════
function SupplierModal({ item, saving, serverError, onClose, onSave }) {
  const [form, setForm] = useState({
    AmilName: item?.AmilName || "",
    Mobil   : item?.Mobil    || "",
    Adress  : item?.Adress   || "",
  });
  const [errors, setErrors] = useState({});

  const set = (k) => (v) => { setForm((p) => ({ ...p, [k]: v })); setErrors((e) => ({ ...e, [k]:"" })); };

  const validate = () => {
    const e = {};
    if (!form.Mobil.trim())  e.Mobil  = "الهاتف مطلوب";
    if (!form.Adress.trim()) e.Adress = "العنوان مطلوب";
    setErrors(e);
    return !Object.keys(e).length;
  };

  return (
    <Modal title={item ? `✏ تعديل: ${item.AmilName}` : "✚ مورد جديد"} onClose={onClose}>
      {serverError && <div className="alert alert-error" style={{ marginBottom:16 }}>⚠ {serverError}</div>}

      <form onSubmit={async (ev) => {
        ev.preventDefault();
        if (!validate()) return;
        await onSave({ ...form });
      }}>
        <SectionLabel>البيانات الأساسية</SectionLabel>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
          <Input label="اسم المورد / الشركة" value={form.AmilName} onChange={set("AmilName")} placeholder="اسم المورد" style={{ gridColumn:"1/-1" }} autoFocus />
          <Input label="رقم الهاتف *" value={form.Mobil}  onChange={set("Mobil")}  error={errors.Mobil}  placeholder="07XXXXXXXXX" />
          <Input label="العنوان *"    value={form.Adress} onChange={set("Adress")} error={errors.Adress} placeholder="المدينة — المنطقة" />
        </div>

        <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="submit" loading={saving}>{item ? "💾 حفظ" : "✚ إضافة"}</Button>
        </div>
      </form>
    </Modal>
  );
}

const SectionLabel = ({ children }) => (
  <div style={{ fontSize:".74rem", fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8, marginTop:4 }}>
    {children}
  </div>
);
const labelStyle = { fontSize:".85rem", fontWeight:600, color:"var(--text-secondary)", display:"block", marginBottom:5 };
const selectStyle = {
  width:"100%", padding:"10px 12px",
  background:"var(--bg-input)", border:"1px solid var(--border)",
  borderRadius:"var(--radius-md)", color:"var(--text-primary)",
  fontFamily:"var(--font-main)", fontSize:".88rem", outline:"none", cursor:"pointer",
};
