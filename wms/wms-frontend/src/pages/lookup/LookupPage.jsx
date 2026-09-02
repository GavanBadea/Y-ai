// src/pages/lookup/LookupPage.jsx  v2
// ✅ تبويب المندوبين: زر "إرسال رسالة ترحيب" عبر واتساب
import { useState }       from "react";
import AppLayout          from "@/components/layout/AppLayout";
import { WarehousesTab }  from "@/pages/settings/WarehousesSettings";
import { Card, Badge }    from "@/components/ui/Card";
import Button             from "@/components/ui/Button";
import Input              from "@/components/ui/Input";
import { useApi, useAction } from "@/hooks/useApi";
import { lookupService }  from "@/services/api";
import api                from "@/services/api";
import ExcelImportButton  from "@/components/import/ExcelImportButton";

const TABS = [
  { id:"categories", label:"📦 الأصناف"     },
  { id:"types",      label:"🏷 الأنواع"     },
  { id:"locations",  label:"📍 المناطق"     },
  { id:"paytypes",   label:"💳 طرق الدفع"  },
  { id:"cashboxes",  label:"💰 الصناديق"   },
  { id:"warehouses", label:"🏭 المستودعات"  },
  { id:"mandobs",    label:"👤 المندوبون"   },
];

const CONFIGS = {
  categories: {
    title:"الأصناف", hint:"تُصنّف المواد — مثال: مواد غذائية، مستلزمات",
    fetchFn:()=>lookupService.getCategories(), createFn:(v)=>lookupService.createCategory({CatiguaryName:v}),
    updateFn:(id,v)=>lookupService.updateCategory(id,{CatiguaryName:v}), deleteFn:(id)=>lookupService.deleteCategory(id),
    pkField:"id_Catiguary", labelField:"CatiguaryName", placeholder:"مثال: مواد غذائية", variant:"accent",
    importConfig: {
      endpoint: "/common/categories/import",
      templateFilename: "قالب_الاصناف",
      templateHeaders: ["اسم_الصنف"],
      exampleRows: [["مواد غذائية"], ["مستلزمات"]],
    },
  },
  types: {
    title:"الأنواع", hint:"تُفصّل نوع المادة — مثال: طازج، معلّب",
    fetchFn:()=>lookupService.getTypes(), createFn:(v)=>lookupService.createType({TypeName:v}),
    updateFn:(id,v)=>lookupService.updateType(id,{TypeName:v}), deleteFn:(id)=>lookupService.deleteType(id),
    pkField:"id_Type", labelField:"TypeName", placeholder:"مثال: معلّب، طازج", variant:"info",
    importConfig: {
      endpoint: "/common/types/import",
      templateFilename: "قالب_الانواع",
      templateHeaders: ["اسم_النوع"],
      exampleRows: [["معلّب"], ["طازج"]],
    },
  },
  locations: {
    title:"مناطق الزبائن", hint:"تُستخدم عند إضافة زبون — مثال: الكرادة، المنصور",
    fetchFn:()=>lookupService.getLocations(), createFn:(v)=>lookupService.createLocation({Location_ZabonLocation:v}),
    updateFn:(id,v)=>lookupService.updateLocation(id,{Location_ZabonLocation:v}), deleteFn:(id)=>lookupService.deleteLocation(id),
    pkField:"id_ZabonLocation", labelField:"Location_ZabonLocation", placeholder:"مثال: الكرادة", variant:"success",
    importConfig: {
      endpoint: "/common/locations/import",
      templateFilename: "قالب_المناطق",
      templateHeaders: ["اسم_المنطقة"],
      exampleRows: [["الكرادة"], ["المنصور"]],
    },
  },
  paytypes: {
    title:"طرق الدفع", hint:"تُستخدم في الفواتير — مثال: نقدي، آجل",
    fetchFn:()=>lookupService.getPayTypes(), createFn:(v)=>lookupService.createPayType({PayTypeName:v}),
    updateFn:(id,v)=>lookupService.updatePayType(id,{PayTypeName:v}), deleteFn:(id)=>lookupService.deletePayType(id),
    pkField:"id_PayType", labelField:"PayTypeName", placeholder:"مثال: نقدي، آجل، شيك", variant:"warning",
  },
  cashboxes: {
    title:"الصناديق", hint:"تظهر في سندات القبض والدفع وكشوفات الحسابات",
    fetchFn:()=>lookupService.getCashBoxes(), createFn:(v)=>lookupService.createCashBox({CashBoxName:v}),
    updateFn:(id,v)=>lookupService.updateCashBox(id,{CashBoxName:v}), deleteFn:(id)=>lookupService.deleteCashBox(id),
    pkField:"id_CashBox", labelField:"CashBoxName", placeholder:"مثال: صندوق الرئيسي", variant:"accent",
  },
};

// ══════════════════════════════════════════════════════════
export default function LookupPage() {
  const [tab, setTab] = useState("categories");
  return (
    <AppLayout title="الجداول المرجعية">
      <div style={{ padding:"10px 16px", background:"var(--info-bg)", border:"1px solid var(--info)", borderRadius:"var(--radius-md)", fontSize:".83rem", color:"var(--info)", marginBottom:20 }}>
        ℹ هذه الجداول تُغذّي قوائم الاختيار في جميع أنحاء النظام.
      </div>
      <div style={{ display:"flex", gap:4, marginBottom:24, borderBottom:"1px solid var(--border)", flexWrap:"wrap" }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:"10px 18px", background:"none", border:"none",
            borderBottom:`2px solid ${tab===t.id?"var(--accent)":"transparent"}`,
            color:tab===t.id?"var(--accent)":"var(--text-secondary)",
            fontWeight:tab===t.id?700:500, fontSize:".88rem", cursor:"pointer",
            fontFamily:"var(--font-main)", marginBottom:-1, transition:"all var(--transition)", whiteSpace:"nowrap",
          }}>{t.label}</button>
        ))}
      </div>
      {tab === "mandobs"
        ? <MandobsTab key="mandobs" />
        : tab === "warehouses"
          ? <WarehousesTab key="warehouses" />
          : <LookupTab  key={tab} config={CONFIGS[tab]} />}
    </AppLayout>
  );
}

// ══════════════════════════════════════════════════════════
//  تبويب المندوبين — مع زر إرسال رسالة واتساب
// ══════════════════════════════════════════════════════════
function MandobsTab() {
  const { data, loading, error, refetch } = useApi(() => lookupService.getMandobs(), []);
  const { loading: saving, execute }      = useAction();
  const rows = data?.data || [];

  const [newVal,  setNewVal   ] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newErr,  setNewErr   ] = useState("");
  const [editId,  setEditId   ] = useState(null);
  const [editVal, setEditVal  ] = useState("");
  const [editPhone, setEditPhone] = useState("");

  // حالة إرسال واتساب لكل مندوب
  const [sending,    setSending  ] = useState({});  // { [id]: "sending"|"ok"|"err" }
  const [sendResult, setSendResult] = useState({}); // { [id]: "نص" }

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newVal.trim()) { setNewErr("الاسم لا يمكن أن يكون فارغاً"); return; }
    await execute(() => lookupService.createMandob({ MandobName: newVal.trim(), Mobile: newPhone.trim() || undefined }), {
      onSuccess: () => { refetch(); setNewVal(""); setNewPhone(""); setNewErr(""); },
      onError  : (e) => setNewErr(e),
    });
  };

  const handleEdit = async (id) => {
    if (!editVal.trim()) return;
    await execute(() => lookupService.updateMandob(id, { MandobName: editVal.trim(), Mobile: editPhone.trim() || undefined }), {
      onSuccess: () => { refetch(); setEditId(null); },
    });
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`حذف "${name}"؟`)) return;
    await execute(() => lookupService.deleteMandob(id), {
      onSuccess: refetch,
      onError  : (e) => alert(`لا يمكن الحذف: ${e}`),
    });
  };

  // ── إرسال رسالة ترحيب ────────────────────────────────────
  const handleSendWelcome = async (mandob) => {
    const phone = mandob.Mobile || mandob.Phone || mandob.MandobPhone;
    if (!phone) {
      alert("لا يوجد رقم هاتف لهذا المندوب — عدّله أولاً");
      return;
    }
    setSending((p) => ({ ...p, [mandob.id_Mandob]: "sending" }));
    setSendResult((p) => ({ ...p, [mandob.id_Mandob]: "" }));
    try {
      await api.post("/whatsapp/send", {
        phone  : phone,
        message: `مرحباً ${mandob.MandobName}، تم ربطك بنظام Y-ai بنجاح 🎉\nيمكنك متابعة مبيعاتك وتقاريرك من خلال النظام.`,
      });
      setSending((p) => ({ ...p, [mandob.id_Mandob]: "ok" }));
      setSendResult((p) => ({ ...p, [mandob.id_Mandob]: "✅ أُرسلت" }));
    } catch (err) {
      setSending((p) => ({ ...p, [mandob.id_Mandob]: "err" }));
      setSendResult((p) => ({ ...p, [mandob.id_Mandob]: `❌ ${err.message || "فشل"}` }));
    }
    // مسح بعد 4 ثوانٍ
    setTimeout(() => {
      setSending   ((p) => { const n={...p}; delete n[mandob.id_Mandob]; return n; });
      setSendResult((p) => { const n={...p}; delete n[mandob.id_Mandob]; return n; });
    }, 4000);
  };

  return (
    <div style={{ maxWidth:680, margin:"0 auto" }}>
      <div style={{ marginBottom:18 }}>
        <h2 style={{ fontSize:"1.05rem", fontWeight:800, color:"var(--text-primary)", marginBottom:4 }}>المندوبون</h2>
        <p style={{ fontSize:".84rem", color:"var(--text-secondary)" }}>مندوبو المبيعات — يُختار المندوب عند إصدار فاتورة. أضف رقم الهاتف لتمكين إرسال التنبيهات عبر واتساب.</p>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom:14 }}>⚠ {error}</div>}

      {/* ── إضافة سريعة ──────────────────────────────────── */}
      <Card style={{ marginBottom:20 }}>
        <form onSubmit={handleAdd} style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:10, alignItems:"flex-end" }}>
          <Input label="اسم المندوب *" value={newVal} onChange={(v)=>{setNewVal(v);setNewErr("");}}
            placeholder="مثال: أحمد محمد" error={newErr} />
          <Input label="رقم الهاتف (للواتساب)" value={newPhone} onChange={setNewPhone}
            placeholder="964XXXXXXXXXX" />
          <Button type="submit" loading={saving} style={{ marginBottom: newErr ? 22 : 0 }}>✚ إضافة</Button>
        </form>
      </Card>

      {/* ── القائمة ───────────────────────────────────────── */}
      <Card padding="0">
        <div style={{ padding:"10px 16px", borderBottom:"1px solid var(--border-subtle)", display:"flex", justifyContent:"space-between" }}>
          <span style={{ fontSize:".82rem", color:"var(--text-secondary)" }}>
            {loading ? "جاري التحميل..." : `${rows.length} مندوب`}
          </span>
          <Button variant="ghost" size="sm" onClick={refetch}>↺</Button>
        </div>

        {loading ? <div style={{ padding:40, textAlign:"center" }}><span className="spinner"/></div>
        : rows.length === 0 ? (
          <div style={{ padding:40, textAlign:"center", color:"var(--text-muted)", fontSize:".88rem" }}>
            لا يوجد مندوبون — أضف الأول أعلاه
          </div>
        ) : rows.map((row, i) => {
          const id    = row.id_Mandob;
          const name  = row.MandobName;
          const phone = row.Mobile || row.Phone || row.MandobPhone;
          const isEditing = editId === id;
          const st    = sending[id];
          const res   = sendResult[id];

          return (
            <div key={id} style={{
              display:"flex", alignItems:"center", gap:10, padding:"12px 16px",
              borderBottom: i < rows.length-1 ? "1px solid var(--border-subtle)" : "none",
              flexWrap:"wrap", transition:"background var(--transition)",
            }}
              onMouseEnter={(e)=>{e.currentTarget.style.background="var(--bg-hover)";}}
              onMouseLeave={(e)=>{e.currentTarget.style.background="";}}>

              {/* رقم */}
              <span style={{ fontFamily:"var(--font-mono)", fontSize:".72rem", color:"var(--text-muted)", width:24, flexShrink:0, textAlign:"center" }}>{id}</span>

              {/* محتوى */}
              {isEditing ? (
                <div style={{ display:"flex", gap:8, flex:1, flexWrap:"wrap" }}>
                  <input autoFocus value={editVal} onChange={(e)=>setEditVal(e.target.value)}
                    onKeyDown={(e)=>{if(e.key==="Enter")handleEdit(id);if(e.key==="Escape"){setEditId(null);}}}
                    placeholder="الاسم"
                    style={{ flex:1, minWidth:120, padding:"7px 10px", background:"var(--bg-input)", border:"1px solid var(--border-focus)", borderRadius:"var(--radius-sm)", color:"var(--text-primary)", fontFamily:"var(--font-main)", fontSize:".88rem", outline:"none" }}
                  />
                  <input value={editPhone} onChange={(e)=>setEditPhone(e.target.value)}
                    placeholder="رقم الهاتف"
                    style={{ flex:1, minWidth:140, padding:"7px 10px", background:"var(--bg-input)", border:"1px solid var(--border)", borderRadius:"var(--radius-sm)", color:"var(--text-primary)", fontFamily:"var(--font-mono)", fontSize:".85rem", outline:"none" }}
                  />
                </div>
              ) : (
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:600, fontSize:".9rem" }}>{name}</div>
                  {phone ? (
                    <div style={{ fontSize:".76rem", color:"var(--text-muted)", fontFamily:"var(--font-mono)", marginTop:2 }}>📞 {phone}</div>
                  ) : (
                    <div style={{ fontSize:".74rem", color:"var(--text-muted)", marginTop:2 }}>لا يوجد رقم هاتف</div>
                  )}
                </div>
              )}

              {/* أزرار */}
              <div style={{ display:"flex", gap:6, flexShrink:0, alignItems:"center" }}>
                {isEditing ? (
                  <>
                    <Button size="sm" onClick={()=>handleEdit(id)} loading={saving}>✔ حفظ</Button>
                    <Button size="sm" variant="ghost" onClick={()=>setEditId(null)}>✕</Button>
                  </>
                ) : (
                  <>
                    {/* ── زر الواتساب ─────────────────────── */}
                    <button
                      onClick={() => handleSendWelcome(row)}
                      disabled={st === "sending" || !phone}
                      title={phone ? "إرسال رسالة ترحيب عبر واتساب" : "أضف رقم الهاتف أولاً"}
                      style={{
                        display:"flex", alignItems:"center", gap:5,
                        padding:"6px 10px", borderRadius:"var(--radius-md)",
                        border:`1px solid ${st==="ok"?"var(--success)":st==="err"?"var(--danger)":phone?"#25D366":"var(--border)"}`,
                        background: st==="ok"?"var(--success-bg)":st==="err"?"var(--danger-bg)":phone?"rgba(37,211,102,.1)":"var(--bg-hover)",
                        color: st==="ok"?"var(--success)":st==="err"?"var(--danger)":phone?"#25D366":"var(--text-muted)",
                        cursor: phone&&st!=="sending" ? "pointer" : "not-allowed",
                        fontSize:".78rem", fontFamily:"var(--font-main)", fontWeight:600,
                        transition:"all var(--transition)", opacity: !phone ? .5 : 1,
                      }}
                    >
                      {st === "sending" ? <span className="spinner" style={{ width:14, height:14 }}/> : "📱"}
                      <span>
                        {res || (st === "sending" ? "جاري..." : "ترحيب")}
                      </span>
                    </button>

                    <Button size="sm" variant="secondary"
                      onClick={() => { setEditId(id); setEditVal(name); setEditPhone(phone||""); }}>✏</Button>
                    <Button size="sm" variant="danger"
                      onClick={() => handleDelete(id, name)}>🗑</Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </Card>

      <div style={{ marginTop:14, padding:"10px 14px", background:"var(--bg-hover)", borderRadius:"var(--radius-md)", fontSize:".78rem", color:"var(--text-muted)" }}>
        💡 <strong>ملاحظة:</strong> لاستخدام زر "ترحيب"، يجب أن تكون قد ربطت واتساب من صفحة <strong>إعدادات ← واتساب</strong>.
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  LookupTab العامة (الأصناف / الأنواع / المناطق / طرق الدفع)
// ══════════════════════════════════════════════════════════
function LookupTab({ config }) {
  const { title, hint, fetchFn, createFn, updateFn, deleteFn,
          pkField, labelField, placeholder, variant, importConfig } = config;

  const { data, loading, error, refetch } = useApi(fetchFn, []);
  const { loading: saving, execute }      = useAction();
  const rows = data?.data || [];

  const [newVal, setNewVal] = useState("");
  const [newErr, setNewErr] = useState("");
  const [editId, setEditId] = useState(null);
  const [editVal, setEditVal] = useState("");

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newVal.trim()) { setNewErr("الحقل لا يمكن أن يكون فارغاً"); return; }
    await execute(() => createFn(newVal.trim()), {
      onSuccess: () => { refetch(); setNewVal(""); setNewErr(""); },
      onError  : (e) => setNewErr(e),
    });
  };

  const handleEdit = async (id) => {
    if (!editVal.trim()) return;
    await execute(() => updateFn(id, editVal.trim()), {
      onSuccess: () => { refetch(); setEditId(null); setEditVal(""); },
    });
  };

  const handleDelete = async (id, label) => {
    if (!confirm(`حذف "${label}"؟\nتأكد أنه غير مستخدم في بيانات أخرى.`)) return;
    await execute(() => deleteFn(id), {
      onSuccess: refetch,
      onError  : (e) => alert(`لا يمكن الحذف: ${e}`),
    });
  };

  return (
    <div style={{ maxWidth:640, margin:"0 auto" }}>
      <div style={{ marginBottom:18 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12, flexWrap:"wrap" }}>
          <div>
            <h2 style={{ fontSize:"1.05rem", fontWeight:800, color:"var(--text-primary)", marginBottom:4 }}>{title}</h2>
            <p style={{ fontSize:".84rem", color:"var(--text-secondary)" }}>{hint}</p>
          </div>
          {importConfig && (
            <ExcelImportButton
              endpoint={importConfig.endpoint}
              templateFilename={importConfig.templateFilename}
              templateHeaders={importConfig.templateHeaders}
              exampleRows={importConfig.exampleRows}
              onSuccess={refetch}
            />
          )}
        </div>
      </div>
      {error && <div className="alert alert-error" style={{ marginBottom:14 }}>⚠ {error}</div>}

      <Card style={{ marginBottom:20 }}>
        <form onSubmit={handleAdd} style={{ display:"flex", gap:10, alignItems:"flex-end" }}>
          <Input label={`إضافة ${title} جديد`} value={newVal}
            onChange={(v)=>{setNewVal(v);setNewErr("");}} placeholder={placeholder} error={newErr} style={{ flex:1 }} />
          <Button type="submit" loading={saving} style={{ marginBottom: newErr ? 22 : 0 }}>✚ إضافة</Button>
        </form>
      </Card>

      <Card padding="0">
        <div style={{ padding:"10px 16px", borderBottom:"1px solid var(--border-subtle)", display:"flex", justifyContent:"space-between" }}>
          <span style={{ fontSize:".82rem", color:"var(--text-secondary)" }}>
            {loading ? "جاري التحميل..." : `${rows.length} ${title}`}
          </span>
          <Button variant="ghost" size="sm" onClick={refetch}>↺</Button>
        </div>

        {loading ? <div style={{ padding:40, textAlign:"center" }}><span className="spinner"/></div>
        : rows.length === 0 ? (
          <div style={{ padding:40, textAlign:"center", color:"var(--text-muted)", fontSize:".88rem" }}>
            لا توجد عناصر — أضف العنصر الأول أعلاه
          </div>
        ) : rows.map((row, i) => {
          const id    = row[pkField];
          const label = row[labelField];
          const isEditing = editId === id;
          return (
            <div key={id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px",
              borderBottom:i<rows.length-1?"1px solid var(--border-subtle)":"none", transition:"background var(--transition)" }}
              onMouseEnter={(e)=>{e.currentTarget.style.background="var(--bg-hover)";}}
              onMouseLeave={(e)=>{e.currentTarget.style.background="";}}>
              <span style={{ fontFamily:"var(--font-mono)", fontSize:".72rem", color:"var(--text-muted)", width:24, flexShrink:0, textAlign:"center" }}>{id}</span>
              {isEditing ? (
                <input autoFocus value={editVal} onChange={(e)=>setEditVal(e.target.value)}
                  onKeyDown={(e)=>{if(e.key==="Enter")handleEdit(id);if(e.key==="Escape"){setEditId(null);}}}
                  style={{ flex:1, padding:"7px 10px", background:"var(--bg-input)", border:"1px solid var(--border-focus)", borderRadius:"var(--radius-sm)", color:"var(--text-primary)", fontFamily:"var(--font-main)", fontSize:".9rem", outline:"none" }}/>
              ) : (
                <span style={{ flex:1 }}><Badge label={label} variant={variant}/></span>
              )}
              <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                {isEditing ? (
                  <>
                    <Button size="sm" onClick={()=>handleEdit(id)} loading={saving}>✔ حفظ</Button>
                    <Button size="sm" variant="ghost" onClick={()=>{setEditId(null);setEditVal("");}}>✕</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="secondary" onClick={()=>{setEditId(id);setEditVal(label);}}>✏</Button>
                    <Button size="sm" variant="danger"    onClick={()=>handleDelete(id,label)}>🗑</Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
