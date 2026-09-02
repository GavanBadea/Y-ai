// ============================================================
//  src/pages/settings/FiscalYearPage.jsx
//  إدارة السنة المالية — إغلاق سنوي + تصفير كامل
//  ✅ لا يمس أي صفحة أخرى
// ============================================================
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api from "../../services/api";

const fmtN  = (n=0) => Number(n||0).toLocaleString("en-US");
const fmtMB = (n=0) => `${Number(n||0).toFixed(2)} MB`;

// ============================================================
export default function FiscalYearPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [tab,      setTab     ] = useState("overview"); // overview | close | reset | backups | auto-backup
  const [stats,    setStats   ] = useState(null);
  const [preview,  setPreview ] = useState(null);
  const [loading,  setLoading ] = useState(false);
  const [msg,      setMsg     ] = useState({ text:"", ok:true });

  const [backupDir,    setBackupDir   ] = useState("");
  const [backupList,   setBackupList  ] = useState([]);
  const [restoreFile,  setRestoreFile ] = useState(null);
  const [autoEmail,    setAutoEmail   ] = useState("");
  const [autoDrivePath,setAutoDrivePath] = useState("");
  const [autoEnabled,  setAutoEnabled ] = useState(false);
  const [autoInfo,     setAutoInfo    ] = useState(null);

  // ── حقول إغلاق السنة ─────────────────────────────────
  const [closePass,    setClosePass   ] = useState("");
  const [newYear,      setNewYear     ] = useState(new Date().getFullYear() + 1);
  const [archiveDbName, setArchiveDbName] = useState(`مستودع_${new Date().getFullYear()}.db`);
  const [workingDbName, setWorkingDbName] = useState(`مستودع_${new Date().getFullYear() + 1}.db`);
  const [closeConfirm, setCloseConfirm] = useState("");
  const [closeResult,  setCloseResult ] = useState(null);

  const onNewYearChange = (y) => {
    setNewYear(y);
    setArchiveDbName(`مستودع_${y - 1}.db`);
    setWorkingDbName(`مستودع_${y}.db`);
  };

  // ── حقول التصفير الكامل ───────────────────────────────
  const [resetPass,    setResetPass   ] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetResult,  setResetResult ] = useState(null);
  const [backupLabel,  setBackupLabel ] = useState("");

  const showMsg = (text, ok=true) => { setMsg({ text, ok }); setTimeout(()=>setMsg({text:"",ok:true}),5000); };

  // ── جلب الإحصائيات ───────────────────────────────────
  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/fiscal/stats");
      setStats(r?.stats || r?.data?.stats || null);
    } catch(e) { showMsg(`خطأ: ${e.message}`, false); }
    finally { setLoading(false); }
  }, []);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/fiscal/preview");
      setPreview(r?.preview || r?.data?.preview || null);
    } catch(e) { showMsg(`خطأ: ${e.message}`, false); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadStats();
  }, []);

  useEffect(() => {
    if (tab === "close" && !preview) loadPreview();
  }, [tab]);

  const loadBackupInfo = useCallback(async () => {
    try {
      const r = await api.get("/fiscal/backups");
      setBackupDir(r?.backupDir || "");
      setBackupList(r?.backups || []);
    } catch { /* ignore */ }
  }, []);

  const loadAutoBackup = useCallback(async () => {
    try {
      const r = await api.get("/fiscal/auto-backup");
      setAutoEmail(r?.settings?.email || "");
      setAutoDrivePath(r?.settings?.drivePath || "");
      setAutoEnabled(!!r?.settings?.enabled);
      setAutoInfo(r);
      if (r?.backupDir) setBackupDir(r.backupDir);
    } catch (e) {
      showMsg(`خطأ في تحميل إعدادات النسخ التلقائي: ${e.message}`, false);
    }
  }, []);

  useEffect(() => {
    if (tab === "backups") loadBackupInfo();
    if (tab === "auto-backup") loadAutoBackup();
  }, [tab, loadBackupInfo, loadAutoBackup]);

  // ── نسخة احتياطية يدوية ──────────────────────────────
  const doManualBackup = async () => {
    setLoading(true);
    try {
      const r = await api.post("/fiscal/backups/manual");
      const st = r?.backup?.stats;
      const extra = st
        ? ` — مواد: ${fmtN(st.materials)} · زبائن: ${fmtN(st.customers)} · موردون: ${fmtN(st.suppliers)}`
        : "";
      showMsg(`✅ ${r?.message || "تم إنشاء النسخة الاحتياطية"}${extra}`, true);
      loadStats();
    } catch(e) { showMsg(`❌ ${e.message}`, false); }
    finally { setLoading(false); }
  };

  const doCreateNamedBackup = async () => {
    if (!backupLabel.trim())
      return showMsg("يرجى إدخال تسمية للنسخة الاحتياطية", false);

    setLoading(true);
    try {
      const r = await api.post("/fiscal/backups/create", { label: backupLabel.trim() });
      const savedName = r?.backup?.filename || "";
      const savedPath = r?.backup?.path || "";
      showMsg(
        savedName
          ? `✅ تم الحفظ: ${savedName}${savedPath ? ` — ${savedPath}` : ""}`
          : `✅ ${r?.message || "تم حفظ النسخة الاحتياطية"}`,
        true
      );
      setBackupLabel("");
      loadStats();
      loadBackupInfo();
    } catch (e) {
      showMsg(`❌ ${e?.data?.message || e.message}`, false);
    } finally {
      setLoading(false);
    }
  };

  const saveAutoBackupSettings = async () => {
    setLoading(true);
    try {
      const r = await api.post("/fiscal/auto-backup", {
        email: autoEmail.trim(),
        enabled: autoEnabled,
        drivePath: autoDrivePath.trim(),
      });
      showMsg(r?.message || "تم حفظ الإعدادات", true);
      await loadAutoBackup();
    } catch (e) {
      showMsg(`❌ ${e?.data?.message || e.message}`, false);
    } finally {
      setLoading(false);
    }
  };

  const runAutoBackupNow = async () => {
    setLoading(true);
    try {
      const r = await api.post("/fiscal/auto-backup/run");
      showMsg(r?.message || "تم إنشاء النسخة", true);
      await loadAutoBackup();
      loadBackupInfo();
    } catch (e) {
      showMsg(`❌ ${e?.data?.message || e.message}`, false);
    } finally {
      setLoading(false);
    }
  };

  const doUploadRestore = async () => {
    if (!restoreFile) return showMsg("يرجى اختيار ملف .db", false);
    if (!restoreFile.name.toLowerCase().endsWith(".db")) {
      return showMsg("يجب أن يكون الملف بامتداد .db", false);
    }
    if (!confirm(`استعادة النسخة الاحتياطية:\n${restoreFile.name}\n\nسيتم استبدال قاعدة البيانات الحالية.`)) {
      return;
    }

    setLoading(true);
    try {
      const fileBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("تعذّر قراءة الملف"));
        reader.readAsDataURL(restoreFile);
      });
      const r = await api.post("/fiscal/backups/upload-restore", {
        fileBase64,
        filename: restoreFile.name,
      });
      showMsg(r?.message || "تمت الاستعادة", true);
      setRestoreFile(null);
      loadBackupInfo();
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      showMsg(`❌ ${e?.data?.message || e.message}`, false);
    } finally {
      setLoading(false);
    }
  };

  // ── إغلاق السنة ──────────────────────────────────────
  const doCloseYear = async () => {
    if (!closePass) return showMsg("يرجى إدخال كلمة المرور", false);
    if (closeConfirm !== "أوافق على إغلاق السنة المالية")
      return showMsg("يرجى كتابة نص التأكيد بدقة", false);

    setLoading(true);
    try {
      const r = await api.post("/fiscal/close-year", {
        password     : closePass,
        newYear      : Number(newYear),
        confirm      : closeConfirm,
        archiveDbName: archiveDbName.trim(),
        workingDbName: workingDbName.trim(),
      });
      setCloseResult(r?.summary || r?.data?.summary || r);
      setClosePass(""); setCloseConfirm("");
      showMsg(r?.message || "✅ تم إغلاق السنة المالية بنجاح", true);
      loadStats();
    } catch(e) {
      showMsg(`❌ ${e?.response?.data?.message || e.message}`, false);
    } finally { setLoading(false); }
  };

  // ── التصفير الكامل ────────────────────────────────────
  const doFactoryReset = async () => {
    if (!resetPass) return showMsg("يرجى إدخال كلمة المرور", false);
    if (resetConfirm !== "أوافق على حذف كافة البيانات نهائياً")
      return showMsg("يرجى كتابة نص التأكيد بدقة", false);

    setLoading(true);
    try {
      const r = await api.post("/fiscal/factory-reset", {
        password : resetPass,
        confirm  : resetConfirm,
      });
      setResetResult(r);
      setResetPass(""); setResetConfirm("");
      showMsg(r?.message || "✅ تم التصفير الكامل", true);
      logout();
      navigate("/login", { replace: true });
    } catch(e) {
      showMsg(`❌ ${e?.response?.data?.message || e.message}`, false);
    } finally { setLoading(false); }
  };

  // ============================================================
  return (
    <div style={S.page} dir="rtl">

      {/* ══ الرأس ══ */}
      <div style={S.header}>
        <div>
          <h1 style={S.h1}>⚙️ إدارة السنة المالية</h1>
          <p style={S.sub}>إغلاق السنة المالية · التصفير الكامل · النسخ الاحتياطية</p>
          <p style={{ margin: "6px 0 0", fontSize: ".78rem", color: "#fbbf24" }}>
            يفضل الاتصال بالمبرمج Gavan 0750-4505340
          </p>
        </div>
        <button onClick={doManualBackup} disabled={loading}
          style={{ padding:"8px 18px", background:"#1d4ed8", border:"none", borderRadius:8, color:"#bfdbfe", cursor:"pointer", fontWeight:700, fontFamily:"inherit" }}>
          💾 نسخة احتياطية الآن
        </button>
      </div>

      {/* رسالة الحالة */}
      {msg.text && (
        <div style={{ padding:"10px 16px", background:msg.ok?"#052e16":"#450a0a", border:`1px solid ${msg.ok?"#16a34a":"#ef4444"}`, borderRadius:8, color:msg.ok?"#4ade80":"#f87171", fontWeight:600 }}>
          {msg.text}
        </div>
      )}

      {/* ══ التبويبات + تسجيل الخروج ══ */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
        <div style={S.tabs}>
          {[
            { id:"overview", label:"📊 نظرة عامة" },
            { id:"close",    label:"📅 إغلاق السنة" },
            { id:"reset",    label:"🗑️ التصفير الكامل" },
            { id:"backups",  label:"💾 النسخ الاحتياطية" },
            { id:"auto-backup", label:"☁️ النسخ التلقائي" },
          ].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{ ...S.tab, ...(tab===t.id?S.tabActive:{}) }}>
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => { logout(); navigate("/login"); }}
          style={{
            padding:"7px 16px",
            background:"#1e293b",
            border:"1px solid #475569",
            borderRadius:8,
            color:"#fca5a5",
            cursor:"pointer",
            fontWeight:700,
            fontFamily:"inherit",
            fontSize:".84rem",
            whiteSpace:"nowrap",
          }}
        >
          🚪 تسجيل الخروج
        </button>
      </div>

      {/* ══ نظرة عامة ══ */}
      {tab==="overview" && (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

          {loading && !stats ? <Loader/> : stats && (
            <>
              {/* إحصائيات السجلات */}
              <div style={S.card}>
                <div style={S.cardTitle}>📋 إحصائيات قاعدة البيانات</div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:12 }}>
                  {[
                    { l:"المواد",           v:stats.records?.materials,     icon:"📦", c:"#3b82f6" },
                    { l:"الزبائن",          v:stats.records?.customers,     icon:"👤", c:"#10b981" },
                    { l:"الموردون",         v:stats.records?.suppliers,     icon:"🏭", c:"#f59e0b" },
                    { l:"فواتير المبيعات",  v:stats.records?.salesInvoices, icon:"🧾", c:"#8b5cf6" },
                    { l:"فواتير الشراء",   v:stats.records?.purchaseInv,   icon:"📥", c:"#06b6d4" },
                    { l:"المرتجعات",        v:stats.records?.returns,       icon:"↩️", c:"#f97316" },
                    { l:"سندات القبض",     v:stats.records?.catchDocs,     icon:"💚", c:"#4ade80" },
                    { l:"سندات الدفع",     v:stats.records?.payDocs,       icon:"💸", c:"#f87171" },
                  ].map((item,i)=>(
                    <div key={i} style={{ background:"#0f172a", border:`1px solid ${item.c}33`, borderRadius:10, padding:"12px 14px" }}>
                      <div style={{ fontSize:".72rem", color:"#64748b", marginBottom:4 }}>{item.icon} {item.l}</div>
                      <div style={{ fontFamily:"monospace", fontWeight:900, fontSize:"1.3rem", color:item.c }}>{fmtN(item.v)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* معلومات قاعدة البيانات */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                <div style={S.card}>
                  <div style={S.cardTitle}>💽 قاعدة البيانات</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {[
                      { l:"الحجم", v:fmtMB(stats.database?.sizeMB) },
                      { l:"عدد النسخ الاحتياطية", v:fmtN(stats.database?.backups) },
                      { l:"أول فاتورة", v:stats.dateRange?.first || "—" },
                      { l:"آخر فاتورة", v:stats.dateRange?.last  || "—" },
                    ].map((r,i)=>(
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid #1e293b", fontSize:".84rem" }}>
                        <span style={{ color:"#64748b" }}>{r.l}</span>
                        <span style={{ fontFamily:"monospace", color:"#e2e8f0", fontWeight:600 }}>{r.v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={S.card}>
                  <div style={S.cardTitle}>📌 تعليمات مهمة</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10, fontSize:".84rem", color:"#94a3b8" }}>
                    <div style={S.tip}>
                      <span style={{ color:"#4ade80" }}>✅</span>
                      قبل إغلاق السنة خذ نسخة احتياطية يدوية
                    </div>
                    <div style={S.tip}>
                      <span style={{ color:"#fbbf24" }}>⚠️</span>
                      إغلاق السنة يحذف الفواتير ويبقي الزبائن والموردين والمواد والمندوبين والمخزون
                    </div>
                    <div style={S.tip}>
                      <span style={{ color:"#3b82f6" }}>📁</span>
                      يُنشأ ملفان: أرشيف السنة المغلقة + قاعدة عمل للسنة الجديدة — للتبديل من «تبديل السنة المالية»
                    </div>
                    <div style={S.tip}>
                      <span style={{ color:"#f87171" }}>🔴</span>
                      التصفير الكامل لا يمكن التراجع عنه — نسخة احتياطية إجبارية
                    </div>
                    <div style={S.tip}>
                      <span style={{ color:"#3b82f6" }}>ℹ️</span>
                      كلمة مرور الإغلاق: راجع ملف .env (ADMIN_CLOSE_PASS)
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          <button onClick={loadStats} style={S.reloadBtn}>🔄 تحديث الإحصائيات</button>
        </div>
      )}

      {/* ══ إغلاق السنة ══ */}
      {tab==="close" && (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

          {/* نتيجة إغلاق سابق */}
          {closeResult && (
            <div style={{ background:"#052e16", border:"2px solid #16a34a", borderRadius:12, padding:20 }}>
              <div style={{ fontWeight:800, color:"#4ade80", fontSize:"1.1rem", marginBottom:12 }}>✅ تم إغلاق السنة بنجاح</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, fontSize:".84rem" }}>
                {[
                  { l:"قاعدة الأرشيف (السنة المغلقة)", v:closeResult.archiveDb || closeResult.backup },
                  { l:"قاعدة العمل (السنة الجديدة)",   v:closeResult.workingDb },
                  { l:"السنة الجديدة",                 v:closeResult.newYear },
                  { l:"مواد محفوظة",                   v:closeResult.materialsKept },
                  { l:"زبائن محفوظون",                v:closeResult.customersKept },
                  { l:"موردون محفوظون",               v:closeResult.suppliersKept },
                  { l:"مندوبون محفوظون",              v:closeResult.mandobsKept },
                  { l:"زبائن مرحَّلون (رصيد)",        v:closeResult.customersCarried },
                  { l:"موردون مرحَّلون (رصيد)",       v:closeResult.suppliersCarried },
                  { l:"أصناف مخزون",                  v:closeResult.stockItemsKept },
                ].map((r,i)=>(
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:"1px solid #1e3a2e" }}>
                    <span style={{ color:"#64748b" }}>{r.l}</span>
                    <span style={{ color:"#4ade80", fontFamily:"monospace", fontWeight:600 }}>{r.v}</span>
                  </div>
                ))}
              </div>
              <button onClick={()=>setCloseResult(null)} style={{ marginTop:14, ...S.reloadBtn }}>إغلاق</button>
            </div>
          )}

          {/* معاينة البيانات */}
          {loading ? <Loader/> : preview && (
            <div style={S.card}>
              <div style={S.cardTitle}>👁️ معاينة ما سيتم نقله وحذفه</div>
              <div style={{ background:"#052e16", border:"1px solid #16a34a", borderRadius:8, padding:"12px 16px", marginBottom:14 }}>
                <div style={{ color:"#4ade80", fontWeight:700, marginBottom:8 }}>✅ يبقى في البرنامج (لا يُحذف)</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:10, fontSize:".82rem", color:"#bbf7d0" }}>
                  <span>📦 مواد: <strong>{fmtN(preview.willKeep?.materials)}</strong></span>
                  <span>👤 زبائن: <strong>{fmtN(preview.willKeep?.customers)}</strong></span>
                  <span>🏭 موردون: <strong>{fmtN(preview.willKeep?.suppliers)}</strong></span>
                  <span>🚗 مندوبون: <strong>{fmtN(preview.willKeep?.mandobs)}</strong></span>
                  <span>📊 مخزون: <strong>{fmtN(preview.willKeep?.stockItems)}</strong> صنف</span>
                </div>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, marginBottom:16 }}>
                <PreviewBox title="سيُرحَّل (أرصدة الزبائن)" color="#3b82f6">
                  <p>{fmtN(preview.customers?.withBalance)} زبون برصيد غير صفري</p>
                  <p style={{ color:"#64748b", fontSize:".76rem" }}>من أصل {fmtN(preview.customers?.count)}</p>
                </PreviewBox>
                <PreviewBox title="سيُرحَّل (أرصدة الموردين)" color="#f59e0b">
                  <p>{fmtN(preview.suppliers?.withBalance)} مورد برصيد غير صفري</p>
                  <p style={{ color:"#64748b", fontSize:".76rem" }}>من أصل {fmtN(preview.suppliers?.count)}</p>
                </PreviewBox>
                <PreviewBox title="يبقى (المخزون)" color="#10b981">
                  <p>{fmtN(preview.stock?.count)} صنف</p>
                  <p style={{ color:"#64748b", fontSize:".76rem" }}>تصبح رصيد أول المدة</p>
                </PreviewBox>
              </div>

              <div style={{ background:"#450a0a", border:"1px solid #7f1d1d", borderRadius:8, padding:"12px 16px" }}>
                <div style={{ color:"#f87171", fontWeight:700, marginBottom:8 }}>🗑️ سيُحذف نهائياً</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
                  {Object.entries(preview.willDelete||{}).map(([k,v])=>(
                    <div key={k} style={{ background:"#7f1d1d", borderRadius:6, padding:"4px 10px", fontSize:".78rem", color:"#fca5a5" }}>
                      {k}: <strong>{fmtN(v)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* نموذج إغلاق السنة */}
          <div style={S.card}>
            <div style={S.cardTitle}>📅 تنفيذ إغلاق السنة المالية</div>

            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
              <Field label="السنة الجديدة (بعد الإغلاق)">
                <input type="number" value={newYear} onChange={e=>onNewYearChange(+e.target.value)}
                  min={new Date().getFullYear()} max={new Date().getFullYear()+5}
                  style={S.inp}/>
              </Field>

              <Field label="اسم قاعدة السنة المغلقة (أرشيف كامل — مثال: مستودع_2025.db)">
                <input value={archiveDbName} onChange={e=>setArchiveDbName(e.target.value)}
                  placeholder="مستودع_2025.db" style={S.inp} dir="ltr"/>
                <div style={{ fontSize:".72rem", color:"#64748b", marginTop:4 }}>
                  تُحفظ في مجلد backups — تحتوي كل فواتير وتفاصيل السنة المغلقة
                </div>
              </Field>

              <Field label="اسم قاعدة السنة الجديدة للعمل (مثال: مستودع_2026.db)">
                <input value={workingDbName} onChange={e=>setWorkingDbName(e.target.value)}
                  placeholder="مستودع_2026.db" style={S.inp} dir="ltr"/>
                <div style={{ fontSize:".72rem", color:"#64748b", marginTop:4 }}>
                  تُنشأ تلقائياً بأرصدة افتتاحية + المواد والزبائن والموردين والمندوبين
                </div>
              </Field>

              <Field label="كلمة مرور المدير">
                <input type="password" value={closePass} onChange={e=>setClosePass(e.target.value)}
                  placeholder="••••••••" style={S.inp}/>
              </Field>

              <Field label="لتأكيد العملية، اكتب بالضبط:">
                <div style={{ padding:"6px 12px", background:"#0f2744", border:"1px solid #1d4ed8", borderRadius:7, color:"#93c5fd", fontSize:".82rem", fontFamily:"monospace", marginBottom:6 }}>
                  أوافق على إغلاق السنة المالية
                </div>
                <input value={closeConfirm} onChange={e=>setCloseConfirm(e.target.value)}
                  placeholder="اكتب النص أعلاه..." style={S.inp}/>
              </Field>

              <div style={{ display:"flex", gap:10 }}>
                <button onClick={loadPreview} disabled={loading} style={S.previewBtn}>
                  👁️ معاينة قبل التنفيذ
                </button>
                <button onClick={doCloseYear} disabled={loading||closeConfirm!=="أوافق على إغلاق السنة المالية"||!archiveDbName.trim()||!workingDbName.trim()}
                  style={{ ...S.dangerBtn, opacity:(loading||closeConfirm!=="أوافق على إغلاق السنة المالية"||!archiveDbName.trim()||!workingDbName.trim())?.5:1 }}>
                  {loading?"⏳ جاري الإغلاق...":"📅 تنفيذ إغلاق السنة"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ التصفير الكامل ══ */}
      {tab==="reset" && (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

          {resetResult && (
            <div style={{ background:"#052e16", border:"2px solid #16a34a", borderRadius:12, padding:20 }}>
              <div style={{ fontWeight:800, color:"#4ade80", fontSize:"1.1rem", marginBottom:8 }}>✅ {resetResult.message}</div>
              {resetResult.warning && (
                <div style={{ color:"#f59e0b", fontSize:".8rem", marginTop:6 }}>{resetResult.warning}</div>
              )}
              <button onClick={()=>setResetResult(null)} style={{ marginTop:14, ...S.reloadBtn }}>إغلاق</button>
            </div>
          )}

          {/* تحذير */}
          <div style={{ background:"#450a0a", border:"2px solid #dc2626", borderRadius:12, padding:20 }}>
            <div style={{ fontWeight:900, color:"#ef4444", fontSize:"1.1rem", marginBottom:12 }}>⚠️ تحذير — التصفير الكامل</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, fontSize:".86rem", color:"#fca5a5" }}>
              <div>🔴 سيحذف <strong>جميع</strong> البيانات: الزبائن، الموردون، المندوبون، المواد، المخزون، الفواتير، الأصناف، المستودعات، إعدادات الشركة، المستخدمون والصلاحيات — كأن البرنامج يبدأ من الصفر</div>
              <div>ℹ️ بعد التصفير سيظهر إعداد أول مدير عند فتح البرنامج من جديد</div>
              <div>🔴 لا يمكن التراجع بعد التنفيذ</div>
              <div>🟡 النظام سيأخذ نسخة احتياطية تلقائياً قبل الحذف</div>
              <div>🟢 البرنامج سيعود كأنه جديد تماماً</div>
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardTitle}>🗑️ تنفيذ التصفير الكامل</div>
            <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

              <Field label="كلمة مرور المدير">
                <input type="password" value={resetPass} onChange={e=>setResetPass(e.target.value)}
                  placeholder="••••••••" style={S.inp}/>
              </Field>

              <Field label="لتأكيد العملية، اكتب بالضبط:">
                <div style={{ padding:"6px 12px", background:"#450a0a", border:"1px solid #dc2626", borderRadius:7, color:"#f87171", fontSize:".82rem", fontFamily:"monospace", marginBottom:6 }}>
                  أوافق على حذف كافة البيانات نهائياً
                </div>
                <input value={resetConfirm} onChange={e=>setResetConfirm(e.target.value)}
                  placeholder="اكتب النص أعلاه..." style={S.inp}/>
              </Field>

              <button onClick={doFactoryReset}
                disabled={loading || resetConfirm!=="أوافق على حذف كافة البيانات نهائياً"}
                style={{ ...S.dangerBtn, background:"#7f1d1d", borderColor:"#dc2626",
                  opacity:(loading||resetConfirm!=="أوافق على حذف كافة البيانات نهائياً")?.4:1 }}>
                {loading ? "⏳ جاري التصفير..." : "🗑️ تنفيذ التصفير الكامل"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ النسخ الاحتياطية ══ */}
      {tab==="backups" && (
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <div style={S.card}>
            <div style={S.cardTitle}>📁 مسار حفظ النسخ</div>
            <div style={{ fontSize:".78rem", color:"#94a3b8", marginBottom:8 }}>
              جميع النسخ الاحتياطية (اليدوية والتلقائية) تُحفظ في المسار التالي على هذا الجهاز:
            </div>
            <code style={{ display:"block", padding:"10px 12px", background:"#0f172a", border:"1px solid #334155", borderRadius:8, fontSize:".76rem", color:"#93c5fd", wordBreak:"break-all" }}>
              {backupDir || "جاري التحميل..."}
            </code>
          </div>

          <div style={S.card}>
            <div style={S.cardTitle}>💾 إنشاء نسخة احتياطية كاملة</div>
            <p style={{ margin:"0 0 16px", fontSize:".84rem", color:"#94a3b8", lineHeight:1.7 }}>
              تُحفظ نسخة كاملة من قاعدة البيانات — تشمل الفواتير والمرتجعات والديون والسندات والمصاريف والمواد والمخزون ومعلومات الشركة وكل البيانات.
            </p>

            <div style={{ display:"flex", flexDirection:"column", gap:14, maxWidth:480 }}>
              <Field label="تسمية النسخة الاحتياطية">
                <input
                  value={backupLabel}
                  onChange={(e) => setBackupLabel(e.target.value)}
                  placeholder="مثال: نسخة قبل التحديث"
                  style={S.inp}
                />
              </Field>

              <button
                type="button"
                onClick={doCreateNamedBackup}
                disabled={loading || !backupLabel.trim()}
                style={{
                  ...S.previewBtn,
                  alignSelf:"flex-start",
                  opacity: loading || !backupLabel.trim() ? 0.5 : 1,
                }}
              >
                {loading ? "⏳ جاري الإنشاء..." : "💾 إنشاء نسخة احتياطية"}
              </button>
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardTitle}>📥 استعادة نسخة احتياطية</div>
            <p style={{ margin:"0 0 14px", fontSize:".84rem", color:"#94a3b8", lineHeight:1.7 }}>
              عند تلف الجهاز أو التنصيب على جهاز جديد: اختر ملف <code>.db</code> من Google Drive أو من نسخة يدوية سابقة لاستعادة البيانات والعمل عليها.
            </p>
            <div style={{ display:"flex", flexDirection:"column", gap:12, maxWidth:520 }}>
              <input
                type="file"
                accept=".db"
                onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
                style={{ fontSize:".84rem", color:"#e2e8f0" }}
              />
              {restoreFile && (
                <div style={{ fontSize:".78rem", color:"#64748b" }}>
                  الملف المختار: <b>{restoreFile.name}</b> ({(restoreFile.size / 1024 / 1024).toFixed(2)} MB)
                </div>
              )}
              <button
                type="button"
                onClick={doUploadRestore}
                disabled={loading || !restoreFile}
                style={{ ...S.previewBtn, alignSelf:"flex-start", opacity: loading || !restoreFile ? 0.5 : 1 }}
              >
                {loading ? "⏳ جاري الاستعادة..." : "📥 رفع واستعادة النسخة"}
              </button>
            </div>
          </div>

          {backupList.length > 0 && (
            <div style={S.card}>
              <div style={S.cardTitle}>📋 النسخ المحفوظة محلياً</div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {backupList.slice(0, 8).map((b) => (
                  <div key={b.name} style={{ display:"flex", justifyContent:"space-between", fontSize:".8rem", padding:"6px 0", borderBottom:"1px solid #1e293b" }}>
                    <span style={{ color:"#e2e8f0" }}>{b.name}</span>
                    <span style={{ color:"#64748b", fontFamily:"monospace" }}>{fmtMB(b.size / 1024 / 1024)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab==="auto-backup" && (
        <div style={S.card}>
          <div style={S.cardTitle}>☁️ نسخة احتياطية يومية إلى Google Drive</div>
          <p style={{ margin:"0 0 16px", fontSize:".84rem", color:"#94a3b8", lineHeight:1.7 }}>
            أدخل بريد Gmail المرتبط بحساب Google Drive على هذا الجهاز.
            كل 24 ساعة يُنشئ البرنامج نسخة تلقائية ويُنسخها إلى مجلد
            <code style={{ color:"#93c5fd" }}> Y-ai-WMS-Backups </code>
            داخل Google Drive (يتطلب تثبيت Google Drive للكمبيوتر).
          </p>

          <div style={{ display:"flex", flexDirection:"column", gap:14, maxWidth:480 }}>
            <Field label="البريد الإلكتروني (Gmail / Google Drive)">
              <input
                type="email"
                value={autoEmail}
                onChange={(e) => setAutoEmail(e.target.value)}
                placeholder="example@gmail.com"
                style={S.inp}
              />
            </Field>

            <Field label="مسار Google Drive على الجهاز (اختياري)">
              <input
                type="text"
                value={autoDrivePath}
                onChange={(e) => setAutoDrivePath(e.target.value)}
                placeholder='مثل G:\My Drive أو C:\Users\اسمك\Google Drive'
                style={S.inp}
                dir="ltr"
              />
            </Field>

            <label style={{ display:"flex", alignItems:"center", gap:10, fontSize:".84rem", color:"#e2e8f0", cursor:"pointer" }}>
              <input
                type="checkbox"
                checked={autoEnabled}
                onChange={(e) => setAutoEnabled(e.target.checked)}
              />
              تفعيل النسخ الاحتياطي اليومي التلقائي (كل 24 ساعة)
            </label>

            {autoInfo?.driveRoot && (
              <div style={{ fontSize:".76rem", color:"#86efac", lineHeight:1.6 }}>
                مسار Google Drive المكتشف: <code style={{ color:"#93c5fd", wordBreak:"break-all" }}>{autoInfo.driveRoot}</code>
              </div>
            )}
            {autoInfo?.driveFolder && (
              <div style={{ fontSize:".76rem", color:"#64748b", lineHeight:1.6 }}>
                مجلد Drive: <code style={{ color:"#93c5fd", wordBreak:"break-all" }}>{autoInfo.driveFolder}</code>
              </div>
            )}
            {autoInfo?.settings?.lastRun && (
              <div style={{ fontSize:".76rem", color:"#64748b" }}>
                آخر نسخة: {new Date(autoInfo.settings.lastRun).toLocaleString("ar-IQ")}
                {autoInfo.settings.lastFile ? ` — ${autoInfo.settings.lastFile}` : ""}
              </div>
            )}
            {!autoInfo?.driveRoot && (
              <div style={{ fontSize:".76rem", color:"#fbbf24", lineHeight:1.7 }}>
                ⚠ لم يُعثر على مجلد Google Drive تلقائياً.
                <br />
                السبب الشائع: النسخة الحديثة من Google Drive تستخدم قرصاً افتراضياً (مثل <code>G:\My Drive</code>) وليس مجلداً داخل المستخدم.
                <br />
                افتح «مستكشف الملفات» → انسخ مسار Google Drive من شريط العنوان → الصقه في الحقل أعلاه ثم احفظ.
              </div>
            )}
            {autoInfo?.driveRoot && !autoInfo?.driveFolder && (
              <div style={{ fontSize:".76rem", color:"#fbbf24", lineHeight:1.6 }}>
                وُجد المسار لكن تعذّر إنشاء مجلد النسخ — تحقق من صلاحية الكتابة.
              </div>
            )}

            <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
              <button type="button" onClick={saveAutoBackupSettings} disabled={loading} style={S.previewBtn}>
                {loading ? "⏳..." : "💾 حفظ الإعدادات"}
              </button>
              <button type="button" onClick={runAutoBackupNow} disabled={loading} style={{ ...S.previewBtn, background:"#14532d", borderColor:"#16a34a", color:"#86efac" }}>
                {loading ? "⏳..." : "▶ نسخة الآن (تجربة)"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── مكونات مساعدة ──────────────────────────────────────────
const Loader = () => (
  <div style={{ display:"flex",alignItems:"center",justifyContent:"center",padding:40,gap:12,color:"#64748b" }}>
    <div style={{ width:24,height:24,border:"3px solid #1e293b",borderTopColor:"#3b82f6",borderRadius:"50%" }}/>
    جاري التحميل...
  </div>
);

const Field = ({ label, children }) => (
  <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
    <label style={{ fontSize:".76rem", color:"#64748b", fontWeight:600 }}>{label}</label>
    {children}
  </div>
);

const PreviewBox = ({ title, color, children }) => (
  <div style={{ background:"#0f172a", border:`1px solid ${color}55`, borderRadius:10, padding:14 }}>
    <div style={{ fontSize:".74rem", color, fontWeight:700, marginBottom:10 }}>{title}</div>
    <div style={{ fontSize:".9rem", color:"#e2e8f0", lineHeight:1.8 }}>{children}</div>
  </div>
);

// ── Styles ─────────────────────────────────────────────────
const S = {
  page     :{display:"flex",flexDirection:"column",gap:18,padding:24,background:"#020817",minHeight:"100vh",color:"#e2e8f0",fontFamily:"'Segoe UI',Tahoma,sans-serif"},
  header   :{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12},
  h1       :{margin:0,fontSize:"1.5rem",fontWeight:900,color:"#f1f5f9"},
  sub      :{margin:"4px 0 0",color:"#64748b",fontSize:".88rem"},
  tabs     :{display:"flex",gap:6,padding:"6px",background:"#0a0f1e",borderRadius:10,border:"1px solid #1e293b",width:"fit-content"},
  tab      :{padding:"7px 16px",borderRadius:7,background:"none",border:"none",color:"#64748b",cursor:"pointer",fontFamily:"inherit",fontSize:".84rem",fontWeight:600,whiteSpace:"nowrap"},
  tabActive:{background:"#1e293b",color:"#e2e8f0"},
  card     :{background:"#0f172a",border:"1px solid #1e293b",borderRadius:12,padding:18},
  cardTitle:{fontWeight:800,color:"#e2e8f0",marginBottom:14,fontSize:".95rem"},
  tip      :{display:"flex",gap:8,alignItems:"flex-start",padding:"6px 0",borderBottom:"1px solid #1e293b"},
  inp      :{padding:"8px 12px",background:"#0a0f1e",border:"1px solid #1e293b",borderRadius:7,color:"#e2e8f0",fontFamily:"inherit",fontSize:".88rem",outline:"none",width:"100%"},
  dangerBtn:{padding:"11px",background:"#450a0a",border:"2px solid #ef4444",borderRadius:9,color:"#f87171",fontWeight:900,fontSize:".9rem",fontFamily:"inherit",cursor:"pointer",flex:1},
  previewBtn:{padding:"10px 18px",background:"#0f2744",border:"1px solid #1d4ed8",borderRadius:8,color:"#93c5fd",fontWeight:700,cursor:"pointer",fontFamily:"inherit",fontSize:".84rem"},
  reloadBtn:{padding:"8px 16px",background:"#1e293b",border:"1px solid #334155",borderRadius:7,color:"#94a3b8",cursor:"pointer",fontFamily:"inherit",fontSize:".82rem",alignSelf:"flex-start"},
};
