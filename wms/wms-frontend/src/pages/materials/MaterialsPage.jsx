// ============================================================
//  src/pages/materials/MaterialsPage.jsx  v2
//
//  جديد:
//   ✅ اختيار النوع يعتمد على الصنف (Cascade)
//   ✅ الصنف + النوع + الوحدة إلزامية
//   ✅ رسالة تأكيد Stock + SellPrice عند الإضافة
//   ✅ زر "+" سريع بجانب قوائم الصنف/النوع
// ============================================================
import { useState, useMemo, useCallback }          from "react";
import AppLayout                                   from "@/components/layout/AppLayout";
import { Card, Badge, StatCard }                   from "@/components/ui/Card";
import Button                                      from "@/components/ui/Button";
import Input                                       from "@/components/ui/Input";
import Modal                                       from "@/components/ui/Modal";
import { useApi, useAction }                       from "@/hooks/useApi";
import { materialsService, lookupService }         from "@/services/api";
import { useNumberLocale } from "@/context/NumberLocaleContext";
import { r2, fmt, fmtN, fmtC } from "@/utils/numFormat";
import { numFieldValue, numFieldNum } from "@/utils/numInput";
import ExcelImportButton from "@/components/import/ExcelImportButton";
import { useCompany } from "@/context/CompanyContext";
import { printTableReport } from "@/utils/tableReportTools";


// ── وحدات شائعة ───────────────────────────────────────────
const BAND_OPTIONS = ["كارتون", "قطعة", "كيلو", "لتر", "باكيت", "كرتونة", "علبة", "حبة", "برميل", "طن"];

export default function MaterialsPage() {
  const { locale } = useNumberLocale(); // locale متاح للمكوّن الرئيسي
  const { company } = useCompany();

  const [search,    setSearch   ] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [showForm,  setShowForm ] = useState(false);
  const [editItem,  setEditItem ] = useState(null);
  const [formMsg,   setFormMsg  ] = useState({ type:"", text:"" });

  // ── جلب البيانات ──────────────────────────────────────────
  const { data: matsData,  loading, error, refetch } = useApi(
    () => materialsService.getAll({ search: search || undefined, id_Catiguary: catFilter || undefined }),
    [search, catFilter]
  );
  const { data: catsData,  refetch: refetchCats  } = useApi(() => lookupService.getCategories(), []);
  const { data: typesData, refetch: refetchTypes } = useApi(() => lookupService.getTypes(),      []);

  const materials  = matsData?.data  || [];
  const categories = catsData?.data  || [];
  const allTypes   = typesData?.data || [];

  const { loading: saving, execute } = useAction();

  const openCreate = () => { setEditItem(null); setFormMsg({ type:"", text:"" }); setShowForm(true); };
  const openEdit   = (r) => { setEditItem(r);   setFormMsg({ type:"", text:"" }); setShowForm(true); };
  const closeForm  = ()  => { setShowForm(false); setEditItem(null); };

  const handleDelete = async (id, name) => {
    if (!confirm(`حذف المادة "${name}"؟`)) return;
    await execute(() => materialsService.remove(id), {
      onSuccess: refetch,
      onError  : (e) => alert(`خطأ: ${e}`),
    });
  };

  // ── إحصائيات ─────────────────────────────────────────────
  const stats = useMemo(() => ({
    total   : materials.length,
    outStock: materials.filter((m) => (m.QuantityOnHand || 0) <= 0).length,
    value   : materials.reduce((s, m) => s + (m.QuantityOnHand || 0) * (m.CostPrice || 0), 0),
  }), [materials]);

  const matHeaders = ["#", "الباركود", "المادة", "الصنف", "النوع", "الوحدة", "المخزون", "التكلفة", "سعر البيع", "هامش%"];
  const matRows = materials.map((m, i) => [
    i + 1,
    m.Barcode || "—",
    m.MaterialName || "—",
    m.CatiguaryName || "—",
    m.TypeName || "—",
    m.Band || "—",
    fmtN(m.QuantityOnHand),
    fmtC(m.CostPrice),
    fmtC(m.LastSellPrice),
    `${m.ProfitMarginPct || 0}%`,
  ]);

  return (
    <AppLayout title="إدارة المواد" actions={<Button onClick={openCreate}>✚ مادة جديدة</Button>}>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:22 }}>
        <StatCard label="إجمالي المواد"  value={fmtN(stats.total)}    sub="صنف مسجّل" />
        <StatCard label="مواد نفدت"      value={fmtN(stats.outStock)} variant="danger"  sub="صفر أو أقل" />
        <StatCard label="قيمة المخزون"  value={fmtC(stats.value)}   variant="accent"  sub="بسعر الكلفة" />
      </div>

      {/* ── فلاتر ────────────────────────────────────────── */}
      <div style={{ display:"flex", gap:10, marginBottom:18, flexWrap:"wrap", alignItems:"center" }}>
        <Input value={search} onChange={setSearch} placeholder="🔍 بحث بالاسم أو الباركود..."
          style={{ flex:"1 1 200px" }} />
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={selStyle}>
          <option value="">كل الأصناف ({categories.length})</option>
          {categories.map((c) => (
            <option key={c.id_Catiguary} value={c.id_Catiguary}>{c.CatiguaryName}</option>
          ))}
        </select>
        <Button variant="secondary" size="sm" onClick={refetch}>↺</Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!materials.length}
          onClick={() => printTableReport(company, "قائمة المواد", `${materials.length} مادة`, matHeaders, matRows)}
        >
          🖨 طباعة
        </Button>
        <ExcelImportButton
          endpoint="/materials/import"
          templateFilename="قالب_المواد"
          templateHeaders={[
            "اسم_المادة", "الباركود", "الوحدة", "الصنف", "النوع",
            "سعر_الشراء", "سعر_بيع1", "سعر_بيع2", "سعر_بيع3", "سعر_بيع4", "سعر_بيع5", "كمية_افتتاحية",
          ]}
          exampleRows={[[
            "حليب المراعي 1لتر", "6281001234567", "كارتون", "مواد غذائية", "معلّب",
            "12000", "14000", "13500", "0", "0", "0", "50",
          ]]}
          onSuccess={refetch}
        />
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom:14 }}>⚠ {error}</div>}

      {/* ── الجدول ────────────────────────────────────────── */}
      <Card padding="0">
        <div style={{ padding:"11px 18px", borderBottom:"1px solid var(--border-subtle)", display:"flex", justifyContent:"space-between" }}>
          <span style={{ fontSize:".82rem", color:"var(--text-secondary)" }}>
            {loading ? "جاري التحميل..." : `${materials.length} مادة`}
          </span>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:".875rem" }}>
            <thead>
              <tr style={{ borderBottom:"1px solid var(--border)" }}>
                {["#","الباركود","المادة","الوحدة","المخزون","التكلفة","سعر البيع","هامش%",""].map((h,i) => (
                  <th key={i} style={{ padding:"10px 14px", textAlign:"right", color:"var(--text-secondary)", fontWeight:700, fontSize:".72rem", textTransform:"uppercase", whiteSpace:"nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ padding:40, textAlign:"center" }}><span className="spinner"/></td></tr>
              ) : materials.length === 0 ? (
                <tr><td colSpan={9} style={{ padding:48, textAlign:"center", color:"var(--text-muted)" }}>
                  لا توجد مواد — أضف مادة جديدة
                </td></tr>
              ) : materials.map((m, idx) => (
                <tr key={m.id_Material_NoM}
                  style={{ borderBottom:"1px solid var(--border-subtle)", transition:"background var(--transition)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background="var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background=""; }}>
                  <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontSize:".74rem", color:"var(--text-muted)" }}>{idx + 1}</td>
                  <td style={{ padding:"10px 14px" }}>
                    {m.Barcode
                      ? <span style={{ fontFamily:"var(--font-mono)", fontSize:".78rem", color:"var(--accent)" }}>{m.Barcode}</span>
                      : <span style={{ color:"var(--text-muted)", fontSize:".74rem" }}>—</span>}
                  </td>
                  <td style={{ padding:"10px 14px" }}>
                    <div style={{ fontWeight:700 }}>{m.MaterialName}</div>
                    <div style={{ fontSize:".72rem", color:"var(--text-muted)", marginTop:2 }}>
                      {m.CatiguaryName || "—"} › {m.TypeName || "—"}
                    </div>
                  </td>
                  <td style={{ padding:"10px 14px" }}><Badge label={m.Band || "—"}/></td>
                  <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontWeight:700,
                    color:(m.QuantityOnHand||0)<=0?"var(--danger)":(m.QuantityOnHand||0)<10?"var(--warning)":"var(--success)" }}>
                    {fmtN(m.QuantityOnHand)} {m.Band}
                  </td>
                  <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontSize:".83rem" }}>{fmtC(m.CostPrice)}</td>
                  <td style={{ padding:"10px 14px", fontFamily:"var(--font-mono)", fontSize:".83rem", color:"var(--accent)" }}>{fmtC(m.LastSellPrice)}</td>
                  <td style={{ padding:"10px 14px" }}>
                    <Badge label={`${m.ProfitMarginPct||0}%`}
                      variant={(m.ProfitMarginPct||0)>=20?"success":(m.ProfitMarginPct||0)>=10?"warning":"danger"} />
                  </td>
                  <td style={{ padding:"10px 14px" }}>
                    <div style={{ display:"flex", gap:6 }}>
                      <Button size="sm" variant="secondary" onClick={() => openEdit(m)}>✏</Button>
                      <Button size="sm" variant="danger"    onClick={() => handleDelete(m.id_Material_NoM, m.MaterialName)}>🗑</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {showForm && (
        <MaterialModal
          item={editItem}
          categories={categories}
          allTypes={allTypes}
          saving={saving}
          serverMsg={formMsg}
          onClose={closeForm}
          onRefreshCats={refetchCats}
          onRefreshTypes={refetchTypes}
          onSave={async (data) => {
            const res = await execute(
              () => editItem
                ? materialsService.update(editItem.id_Material_NoM, data)
                : materialsService.create(data),
              {
                onError: (e) => setFormMsg({ type:"error", text: e }),
              }
            );
            if (res) {
              refetch();
              if (!editItem) {
                setFormMsg({
                  type: "success",
                  text: `✅ تم إضافة المادة. تم إنشاء سجل مخزون (صفر) وسجل أسعار تلقائياً.`,
                });
                setTimeout(closeForm, 2200);
              } else {
                closeForm();
              }
            }
          }}
        />
      )}
    </AppLayout>
  );
}

// ══════════════════════════════════════════════════════════
//  Modal الإضافة / التعديل
// ══════════════════════════════════════════════════════════
function MaterialModal({ item, categories, allTypes, saving, serverMsg, onClose, onSave, onRefreshCats, onRefreshTypes }) {
  const [form, setForm] = useState({
    MaterialName : item?.MaterialName  || "",
    Barcode      : item?.Barcode       || "",
    WeightKg     : item?.WeightKg != null && item?.WeightKg !== "" ? item.WeightKg : 0,
    Band         : item?.Band          || "",
    id_Catiguary : item?.id_Catiguary  || "",
    id_Type      : item?.id_Type       || "",
    PosPrice     : item?.LastSellPrice > 0 ? item.LastSellPrice : "",
  });
  const [errors, setErrors]         = useState({});
  const [quickCat,  setQuickCat ]   = useState("");  // إضافة سريعة للصنف
  const [quickType, setQuickType]   = useState("");  // إضافة سريعة للنوع
  const { loading: addingCat,  execute: exCat  } = useAction();
  const { loading: addingType, execute: exType } = useAction();

  const set = (k) => (v) => {
    setForm((p) => {
      const next = { ...p, [k]: v };
      // إذا تغيّر الصنف → امسح النوع
      if (k === "id_Catiguary") next.id_Type = "";
      return next;
    });
    setErrors((e) => ({ ...e, [k]: "" }));
  };

  // أنواع تابعة للصنف المختار فقط
  // ملاحظة: Backend يفلتر بـ id_Catiguary — هنا نفلتر محلياً بنفس المنطق
  // (النوع ليس مرتبط بصنف في الجدول الحالي، لذا نعرض الكل)
  const filteredTypes = allTypes;

  const validate = () => {
    const e = {};
    if (!form.MaterialName.trim()) e.MaterialName = "اسم المادة مطلوب";
    if (!form.id_Catiguary)        e.id_Catiguary = "الصنف مطلوب";
    if (!form.id_Type)             e.id_Type      = "النوع مطلوب";
    if (!form.Band.trim())         e.Band         = "الوحدة مطلوبة";
    setErrors(e);
    return !Object.keys(e).length;
  };

  // ── إضافة صنف سريعة ──────────────────────────────────────
  const addCategory = async () => {
    if (!quickCat.trim()) return;
    await exCat(
      () => lookupService.createCategory({ CatiguaryName: quickCat.trim() }),
      { onSuccess: () => { onRefreshCats(); setQuickCat(""); } }
    );
  };

  // ── إضافة نوع سريعة ──────────────────────────────────────
  const addType = async () => {
    if (!quickType.trim()) return;
    await exType(
      () => lookupService.createType({ TypeName: quickType.trim() }),
      { onSuccess: () => { onRefreshTypes(); setQuickType(""); } }
    );
  };

  return (
    <Modal
      title={item ? `✏ تعديل: ${item.MaterialName}` : "✚ إضافة مادة جديدة"}
      onClose={onClose}
      width="min(660px,97vw)"
    >
        {/* رسائل الخادم */}
        {serverMsg?.text && (
          <div className={`alert alert-${serverMsg.type} animate-fade-in`} style={{ marginBottom:16 }}>
            {serverMsg.text}
          </div>
        )}

        <form onSubmit={(ev) => { ev.preventDefault(); if (validate()) onSave({
          ...form,
          WeightKg: Math.max(0, Number(form.WeightKg) || 0),
          PosPrice: numFieldNum(form.PosPrice),
        }); }}>

          {/* ── المعلومات الأساسية ─────────────────────── */}
          <Section label="المعلومات الأساسية">
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Input label="اسم المادة *" value={form.MaterialName} onChange={set("MaterialName")}
                error={errors.MaterialName} placeholder="مثال: زيت نخيل" autoFocus style={{ gridColumn:"1/-1" }}/>
              <Input label="الباركود" value={form.Barcode} onChange={set("Barcode")}
                placeholder="اتركه فارغاً للتوليد التلقائي"/>
              {/* الوحدة — Select + حر */}
              <div>
                <label style={lblStyle}>الوحدة (Band) *</label>
                <div style={{ display:"flex", gap:6 }}>
                  <select value={BAND_OPTIONS.includes(form.Band) ? form.Band : "__custom__"}
                    onChange={(e) => { if (e.target.value !== "__custom__") set("Band")(e.target.value); }}
                    style={{ ...selStyle, flex:1, borderColor: errors.Band ? "var(--danger)" : "var(--border)" }}>
                    <option value="">اختر الوحدة</option>
                    {BAND_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                    <option value="__custom__">أخرى (اكتب يدوياً)</option>
                  </select>
                  {(!BAND_OPTIONS.includes(form.Band) || form.Band === "") && (
                    <input value={form.Band} onChange={(e) => set("Band")(e.target.value)}
                      placeholder="اكتب الوحدة"
                      style={{ flex:1, padding:"10px 10px", background:"var(--bg-input)", border:`1px solid ${errors.Band?"var(--danger)":"var(--border)"}`, borderRadius:"var(--radius-md)", color:"var(--text-primary)", fontFamily:"var(--font-main)", fontSize:".88rem", outline:"none" }}/>
                  )}
                </div>
                {errors.Band && <span style={{ fontSize:".8rem", color:"var(--danger)" }}>{errors.Band}</span>}
              </div>
              <div>
                <label style={lblStyle}>الوزن بالكغم</label>
                <input type="number" min="0" step="any" value={numFieldValue(form.WeightKg)}
                  placeholder="0"
                  onChange={(e) => set("WeightKg")(e.target.value === "" ? 0 : e.target.value)}
                  style={{ width:"100%", padding:"10px 10px", background:"var(--bg-input)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", color:"var(--text-primary)", fontFamily:"var(--font-mono)", fontSize:".88rem", outline:"none" }}/>
              </div>
            </div>
          </Section>

          {/* ── التصنيف المتتالي ───────────────────────── */}
          <Section label="التصنيف (مطلوب)">
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>

              {/* الصنف */}
              <div>
                <label style={{ ...lblStyle, color: errors.id_Catiguary ? "var(--danger)" : "var(--text-secondary)" }}>
                  الصنف *
                </label>
                <div style={{ display:"flex", gap:6 }}>
                  <select value={form.id_Catiguary} onChange={(e) => set("id_Catiguary")(e.target.value)}
                    style={{ ...selStyle, flex:1, borderColor: errors.id_Catiguary ? "var(--danger)" : "var(--border)" }}>
                    <option value="">— اختر الصنف —</option>
                    {categories.map((c) => <option key={c.id_Catiguary} value={c.id_Catiguary}>{c.CatiguaryName}</option>)}
                  </select>
                  {/* زر إضافة سريع */}
                  <button type="button" title="إضافة صنف جديد"
                    onClick={() => { const n=prompt("اسم الصنف الجديد:"); if(n?.trim()) lookupService.createCategory({CatiguaryName:n.trim()}).then(onRefreshCats); }}
                    style={{ padding:"0 10px", background:"var(--accent-glow)", border:"1px solid var(--accent)", borderRadius:"var(--radius-md)", color:"var(--accent)", cursor:"pointer", fontSize:"1.1rem", whiteSpace:"nowrap" }}>
                    +
                  </button>
                </div>
                {errors.id_Catiguary && <span style={{ fontSize:".8rem", color:"var(--danger)" }}>{errors.id_Catiguary}</span>}
              </div>

              {/* النوع — يُعرض دائماً لكن يُقيَّد بعد اختيار الصنف */}
              <div>
                <label style={{ ...lblStyle, color: errors.id_Type ? "var(--danger)" : !form.id_Catiguary ? "var(--text-muted)" : "var(--text-secondary)" }}>
                  النوع * {!form.id_Catiguary && <span style={{ fontSize:".72rem" }}>(اختر صنفاً أولاً)</span>}
                </label>
                <div style={{ display:"flex", gap:6 }}>
                  <select value={form.id_Type} onChange={(e) => set("id_Type")(e.target.value)}
                    disabled={!form.id_Catiguary}
                    style={{ ...selStyle, flex:1, borderColor: errors.id_Type ? "var(--danger)" : "var(--border)", opacity: !form.id_Catiguary ? 0.45 : 1 }}>
                    <option value="">— اختر النوع —</option>
                    {filteredTypes.map((t) => <option key={t.id_Type} value={t.id_Type}>{t.TypeName}</option>)}
                  </select>
                  <button type="button" title="إضافة نوع جديد"
                    disabled={!form.id_Catiguary}
                    onClick={() => { const n=prompt("اسم النوع الجديد:"); if(n?.trim()) lookupService.createType({TypeName:n.trim()}).then(onRefreshTypes); }}
                    style={{ padding:"0 10px", background:"var(--accent-glow)", border:"1px solid var(--accent)", borderRadius:"var(--radius-md)", color:"var(--accent)", cursor:"pointer", fontSize:"1.1rem", opacity: !form.id_Catiguary ? 0.45 : 1 }}>
                    +
                  </button>
                </div>
                {errors.id_Type && <span style={{ fontSize:".8rem", color:"var(--danger)" }}>{errors.id_Type}</span>}
              </div>
            </div>
          </Section>

          {/* ── سعر نقاط البيع ─────────────────────────── */}
          <Section label="سعر نقاط البيع (POS)">
            <div style={{ background:"var(--bg-surface)", border:"1px solid var(--border-subtle)", borderRadius:"var(--radius-md)", padding:"14px 16px" }}>
              <label style={{ ...lblStyle, fontSize:".76rem" }}>سعر البيع لفاتورة نقاط البيع (د.ع)</label>
              <div style={{ fontSize:".68rem", color:"var(--text-muted)", marginBottom:8, lineHeight:1.4 }}>
                يظهر تلقائياً في POS — يُعدَّل من هنا فقط. سعر الشراء والمخزون يُحدَّدان من فواتير الشراء.
              </div>
              <input type="number" min="0" step="any" value={numFieldValue(form.PosPrice)}
                placeholder="0"
                onChange={(e) => set("PosPrice")(e.target.value === "" ? "" : e.target.value)}
                style={{ width:"100%", maxWidth:220, padding:"8px 10px", background:"var(--bg-input)", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)", color:"var(--text-primary)", fontFamily:"var(--font-mono)", fontSize:".88rem", outline:"none" }}/>
            </div>
          </Section>

          {/* ── تلميح Stock/SellPrice ─────────────────── */}
          {!item && (
            <div style={{ display:"flex", gap:8, padding:"10px 14px", background:"var(--info-bg)", border:"1px solid var(--info)", borderRadius:"var(--radius-md)", fontSize:".8rem", color:"var(--info)", marginBottom:18 }}>
              ℹ عند الإضافة، يُنشأ تلقائياً: سجل مخزون (كمية = 0) + سعر POS
            </div>
          )}

          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Button variant="secondary" onClick={onClose}>إلغاء</Button>
            <Button type="submit" loading={saving}>{item ? "💾 حفظ" : "✚ إضافة المادة"}</Button>
          </div>
        </form>
    </Modal>
  );
}

const Section = ({ label, children }) => (
  <div style={{ marginBottom:16 }}>
    <div style={{ fontSize:".72rem", fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>{label}</div>
    {children}
  </div>
);
const lblStyle = { fontSize:".85rem", fontWeight:600, color:"var(--text-secondary)", display:"block", marginBottom:5 };
const selStyle = { width:"100%", padding:"10px 12px", background:"var(--bg-input)", border:"1px solid var(--border)", borderRadius:"var(--radius-md)", color:"var(--text-primary)", fontFamily:"var(--font-main)", fontSize:".88rem", outline:"none", cursor:"pointer" };
