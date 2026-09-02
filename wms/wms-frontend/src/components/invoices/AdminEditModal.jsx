// ============================================================
//  src/components/invoices/AdminEditModal.jsx  v1.0
//  Modal تعديل الفاتورة — للمدير فقط
//  يدعم: مبيعات | مشتريات  (مستقل عن منطق الصفحات الأخرى)
//
//  المبدأ:
//   • يستدعي /api/admin/edit/{type}/:id/data  لجلب البيانات
//   • يعرض جدولاً قابلاً للتحرير (الكميات والأسعار)
//   • يستدعي PUT /api/admin/edit/{type}/:id  لحفظ التعديلات
//   • المخزون والديون تُعكَس وتُحدَّث تلقائياً في الباك اند
// ============================================================
import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import api from "@/services/api";
import { lookupService, warehouseService, commonService, materialsService } from "@/services/api";

// ── مساعدات الحساب ─────────────────────────────────────────
const r2   = (n = 0) => Math.round((+n || 0) * 100) / 100;
const fmtN = (n = 0) => r2(n).toLocaleString("en-US");
const fmtC = (n = 0) => `${fmtN(n)} د.ع`;
let _lid = 0;

// ── تعريف أنواع الفواتير المدعومة ─────────────────────────
const TYPES = {
  sales: {
    label    : "مبيعات",
    emoji    : "📤",
    // المسارات الحقيقية الموجودة في fout.routes.js
    getUrl   : (id) => `/invoices-out/${id}/edit-data`,
    putUrl   : (id) => `/invoices-out/${id}`,
    idField  : "id_NoFOUT",
    amtField : "AmountOUT",
    prcField : "PriceOUT",
    dateField: "Date_FOUT",
    partyKey : "ZabonName",
    partyLabel: "الزبون",
    disKey   : "Dis_FOUT",
    noteKey  : "Note_FOUT",
    buildBody: (lines, discount, note, hdr) => ({
      Dis_FOUT : Math.round((+discount||0)*100)/100,
      Add_FOUT : Math.round((+hdr.addition||0)*100)/100,
      Note_FOUT: note,
      Date_FOUT: hdr.date,
      id_PayType_FOUT: hdr.payTypeId ? Number(hdr.payTypeId) : null,
      id_Zabon: hdr.partyId ? Number(hdr.partyId) : null,
      id_Mandob: hdr.mandobId ? Number(hdr.mandobId) : null,
      DriverName: hdr.driverName || "",
      DriverMobile: hdr.driverMobile || "",
      VehicleNumber: hdr.vehicleNumber || "",
      PaidAmount: Math.max(0, +hdr.paidAmount || 0),
      lines: lines.map(l => ({ id_Material_NoM: Number(l.matId), AmountOUT: l.qty, PriceOUT: l.price, gift_qty: Math.max(0, r2(l.gift || 0)) })),
    }),
    hdrFields: ["date", "payType", "party", "mandob", "driverName", "driverMobile", "vehicleNumber"],
  },
  purchases: {
    label    : "مشتريات",
    emoji    : "📥",
    // المسارات الحقيقية الموجودة في fin.routes.js
    getUrl   : (id) => `/invoices-in/${id}/edit-data`,
    putUrl   : (id) => `/invoices-in/${id}`,
    idField  : "id_NoFIN",
    amtField : "AmountIN",
    prcField : "PriceIN",
    dateField: "Date_FIN",
    partyKey : "AmilName",
    partyLabel: "المورد",
    disKey   : "Dis_FIN",
    noteKey  : "Note_FIN",
    buildBody: (lines, discount, _note, hdr) => ({
      Dis_FIN : Math.round((+discount||0)*100)/100,
      Trans: hdr.trans || 0,
      Customs: hdr.customs || 0,
      Porter: hdr.porter || 0,
      SGS: Math.max(0, +hdr.sgs || 0),
      ExportRelease: Math.max(0, +hdr.exportRelease || 0),
      VehicleManifest: Math.max(0, +hdr.vehicleManifest || 0),
      Date_FIN: hdr.date,
      id_PayType_FIN: hdr.payTypeId ? Number(hdr.payTypeId) : null,
      id_Amil: hdr.partyId ? Number(hdr.partyId) : null,
      id_Warehouse: hdr.warehouseId ? Number(hdr.warehouseId) : null,
      DriverName: hdr.driverName || "",
      DriverMobile: hdr.driverMobile || "",
      VehicleNumber: hdr.vehicleNumber || "",
      GeneralTax: Math.max(0, +hdr.generalTax || 0),
      PaidAmount: Math.max(0, +hdr.paidAmount || 0),
      lines: lines.map(l => ({
        id_Material_NoM: Number(l.matId),
        AmountIN: l.qty,
        PriceIN: l.price,
        Gift_IN: l.gift || 0,
        ExpairDate: l.expDate || null,
      })),
    }),
    hdrFields: ["date", "payType", "party", "trans", "customs", "porter", "warehouse"],
    noNote: true,
  },
};

// ── ألوان الأزرار ───────────────────────────────────────────
const btnStyles = {
  save: {
    flex: 1, padding: "11px",
    background: "linear-gradient(135deg,#166534,#15803d)",
    border: "2px solid #16a34a",
    borderRadius: 10, color: "#4ade80", fontWeight: 900,
    fontSize: ".9rem", fontFamily: "inherit", cursor: "pointer",
  },
  cancel: {
    padding: "11px 22px",
    background: "var(--bg-surface,#1e293b)",
    border: "1px solid var(--border,#334155)",
    borderRadius: 10, color: "var(--text-secondary,#94a3b8)",
    cursor: "pointer", fontFamily: "inherit",
  },
  qBtn: (danger = false) => ({
    width: 26, height: 26,
    background: danger ? "rgba(220,38,38,.15)" : "rgba(34,197,94,.12)",
    border: `1px solid ${danger ? "rgba(220,38,38,.3)" : "rgba(34,197,94,.3)"}`,
    borderRadius: 6,
    color: danger ? "#f87171" : "#4ade80",
    cursor: "pointer", fontWeight: 800, lineHeight: 1,
    display: "flex", alignItems: "center", justifyContent: "center",
  }),
};

// ══════════════════════════════════════════════════════════
//  المكوّن الرئيسي
// ══════════════════════════════════════════════════════════
export default function AdminEditModal({
  invoiceId,          // رقم الفاتورة
  invoiceType,        // "sales" | "purchases"
  onClose,            // دالة الإغلاق
  onSaved,            // تُستدعى بعد الحفظ الناجح (لإعادة تحميل البيانات)
}) {
  const cfg = TYPES[invoiceType];
  if (!cfg) return null;

  const [loading,  setLoading ] = useState(true);
  const [saving,   setSaving  ] = useState(false);
  const [err,      setErr     ] = useState("");
  const [success,  setSuccess ] = useState("");
  const [header,   setHeader  ] = useState(null);
  const [lines,    setLines   ] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [note,     setNote    ] = useState("");
  const [hdrExtra, setHdrExtra] = useState({});
  const [payTypes, setPayTypes] = useState([]);
  const [parties,  setParties ] = useState([]);
  const [mandobs,  setMandobs ] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [matQ,       setMatQ      ] = useState("");
  const [matBusy,    setMatBusy   ] = useState(false);
  const [allMats,    setAllMats   ] = useState([]);
  const [matOpen,    setMatOpen   ] = useState(false);
  const matRef = useRef(null);

  const inpSt = {
    width: "100%", padding: "8px 10px",
    background: "var(--bg-input,#0d1117)",
    border: "1px solid var(--border,#334155)",
    borderRadius: 8, color: "var(--text-primary,#e2e8f0)",
    fontFamily: "inherit", fontSize: ".86rem", outline: "none",
  };

  // مجاميع
  const linesTotal = lines.reduce((s, l) => s + r2(l.qty * l.price), 0);
  const newTotal   = invoiceType === "purchases"
    ? r2(linesTotal - +discount + +(hdrExtra.trans || 0) + +(hdrExtra.customs || 0) + +(hdrExtra.porter || 0)
      + +(hdrExtra.sgs || 0) + +(hdrExtra.exportRelease || 0) + +(hdrExtra.vehicleManifest || 0))
    : r2(linesTotal - +discount + +(hdrExtra.addition || 0));
  const oldTotal   = header
    ? r2(
        (header.oldLines || []).reduce(
          (s, l) => s + l[cfg.amtField] * l[cfg.prcField],
          0
        )
        - (header[cfg.disKey] || 0)
        + (invoiceType === "purchases"
          ? (+header.Trans || 0) + (+header.Customs || 0) + (+header.Porter || 0)
            + (+header.SGS || 0) + (+header.ExportRelease || 0) + (+header.VehicleManifest || 0)
          : (+header.Add_FOUT || 0))
      )
    : 0;
  const diff = r2(newTotal - oldTotal);

  // ── جلب بيانات التعديل ───────────────────────────────────
  useEffect(() => {
    if (!invoiceId) return;
    setLoading(true); setErr("");
    api
      .get(cfg.getUrl(invoiceId))
      .then((r) => {
        const hdr  = r?.data?.header || r?.header || r?.data;
        const lns  = r?.data?.lines  || r?.lines  || [];
        setHeader({ ...hdr, oldLines: lns });
        setDiscount(hdr?.[cfg.disKey] || 0);
        setNote(hdr?.[cfg.noteKey] || "");
        setHdrExtra(
          invoiceType === "sales"
            ? {
                date: (hdr?.Date_FOUT || "").split("T")[0],
                payTypeId: hdr?.id_PayType_FOUT,
                partyId: hdr?.id_Zabon,
                mandobId: hdr?.id_Mandob,
                driverName: hdr?.DriverName || "",
                driverMobile: hdr?.DriverMobile || "",
                vehicleNumber: hdr?.VehicleNumber || "",
                addition: hdr?.Add_FOUT || 0,
                paidAmount: hdr?.paidAmount || 0,
              }
            : {
                date: (hdr?.Date_FIN || "").split("T")[0],
                payTypeId: hdr?.id_PayType_FIN,
                partyId: hdr?.id_Amil,
                trans: hdr?.Trans || 0,
                customs: hdr?.Customs || 0,
                porter: hdr?.Porter || 0,
                sgs: hdr?.SGS || 0,
                exportRelease: hdr?.ExportRelease || 0,
                vehicleManifest: hdr?.VehicleManifest || 0,
                warehouseId: hdr?.id_Warehouse,
                driverName: hdr?.DriverName || "",
                driverMobile: hdr?.DriverMobile || "",
                vehicleNumber: hdr?.VehicleNumber || "",
                paidAmount: hdr?.paidAmount || 0,
                generalTax: hdr?.GeneralTax || 0,
              }
        );
        setLines(
          lns.map((l) => ({
            _lid : ++_lid,
            matId: l.id_Material_NoM,
            name : l.MaterialName,
            band : l.Band || "",
            barcode: l.Barcode || "",
            qty  : r2(l[cfg.amtField]),
            price: r2(l[cfg.prcField]),
            gift : r2(invoiceType === "sales" ? (l.gift_qty || 0) : (l.Gift_IN || 0)),
            expDate: invoiceType === "purchases" ? (l.ExpairDate || "").split("T")[0] : "",
            WeightKg: +l.WeightKg || 0,
          }))
        );
      })
      .catch((e) => setErr(e?.message || e?.data?.message || "خطأ في جلب البيانات"))
      .finally(() => setLoading(false));
  }, [invoiceId]);

  useEffect(() => {
    lookupService.getPayTypes().then((r) => setPayTypes(r?.data || [])).catch(() => {});
    materialsService.getAll().then((r) => {
      const list = Array.isArray(r?.data) ? r.data : (Array.isArray(r) ? r : []);
      setAllMats(list);
    }).catch(() => {});
    if (invoiceType === "sales") {
      api.get("/party/customers", { params: { limit: 500 } }).then((r) => setParties(r?.data || [])).catch(() => {});
      commonService.getMandobs().then((r) => setMandobs(r?.data || [])).catch(() => {});
    } else {
      api.get("/party/suppliers", { params: { limit: 500 } }).then((r) => setParties(r?.data || [])).catch(() => {});
      warehouseService.listActive().then((r) => setWarehouses(r?.data || [])).catch(() => {});
    }
  }, [invoiceType]);

  const setHdr = (k) => (v) => setHdrExtra((p) => ({ ...p, [k]: v }));

  // ── تحديث الكمية / السعر ─────────────────────────────────
  const updQty   = (lid, v) =>
    setLines((p) => p.map((l) => l._lid === lid ? { ...l, qty: Math.max(0.001, r2(+v || 1)) } : l));
  const updPrice = (lid, v) =>
    setLines((p) => p.map((l) => l._lid === lid ? { ...l, price: Math.max(0, r2(+v || 0)) } : l));
  const updExpDate = (lid, v) =>
    setLines((p) => p.map((l) => l._lid === lid ? { ...l, expDate: v } : l));
  const updGift  = (lid, v) =>
    setLines((p) => p.map((l) => l._lid === lid ? { ...l, gift: Math.max(0, r2(+v || 0)) } : l));
  const delLine  = (lid) => setLines((p) => p.filter((l) => l._lid !== lid));

  const qNorm = (s) => String(s || "").trim().toLowerCase();
  const filteredMats = useMemo(() => {
    const q = qNorm(matQ);
    if (!q) return allMats.slice(0, 40);
    return allMats.filter((m) =>
      qNorm(m.MaterialName).includes(q) ||
      qNorm(m.Barcode).includes(q) ||
      String(m.id_Material_NoM) === q
    ).slice(0, 40);
  }, [allMats, matQ]);

  const unwrapMat = (r) => {
    if (!r) return null;
    if (r.id_Material_NoM) return r;
    if (r.data?.id_Material_NoM) return r.data;
    if (r.data?.data?.id_Material_NoM) return r.data.data;
    if (Array.isArray(r.data) && r.data[0]?.id_Material_NoM) return r.data[0];
    return null;
  };

  const addMatToLines = (mat) => {
    if (!mat?.id_Material_NoM) return;
    setErr("");
    const price = invoiceType === "sales"
      ? r2(mat.LastSellPrice || mat.SellPrice || mat.DefaultPrice || mat.PriceOUT || 0)
      : r2(mat.CostPrice || mat["Cost Price"] || mat.PriceIN || 0);
    setLines((prev) => {
      const i = prev.findIndex((l) => String(l.matId) === String(mat.id_Material_NoM));
      if (i >= 0) {
        return prev.map((l, x) => (x === i ? { ...l, qty: r2(l.qty + 1) } : l));
      }
      return [...prev, {
        _lid : ++_lid,
        matId: mat.id_Material_NoM,
        name : mat.MaterialName,
        band : mat.Band || "",
        barcode: mat.Barcode || "",
        qty  : 1,
        price,
        gift : 0,
        expDate: "",
        WeightKg: +mat.WeightKg || 0,
      }];
    });
    setMatQ("");
    setMatOpen(false);
  };

  const searchMat = async (val) => {
    const v = (val || "").trim();
    if (!v) return;
    setMatBusy(true);
    setErr("");
    try {
      const localHit = allMats.find((m) =>
        String(m.Barcode) === v ||
        String(m.id_Material_NoM) === v ||
        String(m.MaterialName).trim() === v
      ) || (filteredMats.length === 1 ? filteredMats[0] : null);
      if (localHit?.id_Material_NoM) {
        addMatToLines(localHit);
        return;
      }

      let mat = null;
      if (invoiceType === "sales") {
        try {
          const r = await api.get(`/invoices-out/material/${encodeURIComponent(v)}`);
          mat = unwrapMat(r);
        } catch { /* جرّب البحث بالاسم */ }
      } else {
        try {
          mat = unwrapMat(await materialsService.scanBarcode(v));
        } catch { /* ليس باركوداً مطابقاً */ }
        if (!mat?.id_Material_NoM && /^\d+$/.test(v)) {
          try { mat = unwrapMat(await materialsService.getOne(v)); } catch { /* ignore */ }
        }
      }
      if (!mat?.id_Material_NoM) {
        const listR = await materialsService.getAll({ search: v });
        const list = Array.isArray(listR?.data) ? listR.data : (Array.isArray(listR) ? listR : []);
        mat = list.find((m) => m.MaterialName === v || String(m.Barcode) === v) || list[0] || null;
      }
      if (!mat?.id_Material_NoM) {
        setErr("المادة غير موجودة — اكتب الاسم واختر من القائمة أو أدخل الباركود ثم Enter");
        setMatOpen(true);
        return;
      }
      addMatToLines(mat);
    } catch {
      setErr("المادة غير موجودة — اكتب الاسم واختر من القائمة أو أدخل الباركود ثم Enter");
      setMatOpen(true);
    } finally {
      setMatBusy(false);
      matRef.current?.focus();
    }
  };

  // ── حفظ التعديل ──────────────────────────────────────────
  const save = async () => {
    if (!lines.length) return setErr("لا توجد أسطر للحفظ");
    setErr(""); setSuccess(""); setSaving(true);
    try {
      const body = cfg.buildBody(lines, discount, note, hdrExtra);
      await api.put(cfg.putUrl(invoiceId), body);
      setSuccess("✅ تم حفظ التعديل بنجاح — تم تحديث المخزون والديون");
      onSaved?.(invoiceId);
      setTimeout(() => { onClose(); }, 1500);
    } catch (e) {
      setErr(e?.message || e?.data?.message || "خطأ في الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const grossLc = invoiceType === "purchases"
    ? r2(+(hdrExtra.trans || 0) + +(hdrExtra.customs || 0) + +(hdrExtra.porter || 0)
      + +(hdrExtra.sgs || 0) + +(hdrExtra.exportRelease || 0) + +(hdrExtra.vehicleManifest || 0))
    : 0;

  // ── Overlay ───────────────────────────────────────────────
  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,.75)",
        backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(1000px,100%)",
          maxHeight: "90vh",
          background: "var(--bg-surface,#1e293b)",
          border: "1px solid var(--border,#334155)",
          borderRadius: 16,
          display: "flex", flexDirection: "column",
          boxShadow: "0 24px 64px rgba(0,0,0,.7)",
          overflow: "hidden",
          direction: "rtl",
        }}
      >
        {/* ── Header ──────────────────────────────────────── */}
        <div
          style={{
            padding: "14px 20px",
            background: "linear-gradient(135deg,var(--bg-card,#1c2333),var(--bg-surface,#1e293b))",
            borderBottom: "1px solid var(--border,#334155)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontWeight: 800, fontSize: "1rem", color: "var(--text-primary,#e2e8f0)" }}>
              {cfg.emoji} تعديل فاتورة {cfg.label} #{invoiceId}
            </div>
            {header && (
              <div style={{ fontSize: ".74rem", color: "var(--text-muted,#64748b)", marginTop: 3 }}>
                {header[cfg.partyKey]} — {(header[cfg.dateField] || "").split("T")[0]}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* شارة Admin فقط */}
            <span
              style={{
                padding: "3px 10px",
                background: "rgba(59,130,246,.12)",
                border: "1px solid rgba(59,130,246,.3)",
                borderRadius: 20, color: "#93c5fd",
                fontSize: ".68rem", fontWeight: 700,
              }}
            >
              ✏️ تعديل كامل للفاتورة
            </span>
            <button
              onClick={onClose}
              style={{
                background: "none", border: "none",
                color: "var(--text-muted,#64748b)",
                cursor: "pointer", fontSize: "1.1rem",
                padding: "2px 6px", borderRadius: 6,
              }}
            >✕</button>
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>

          {loading ? (
            <div style={{ textAlign: "center", padding: 48, color: "var(--text-muted,#64748b)" }}>
              <div className="spinner" style={{ width: 32, height: 32, margin: "0 auto 12px" }} />
              جاري تحميل بيانات الفاتورة...
            </div>
          ) : (
            <>
              {/* حقول الرأس */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, padding: 12, background: "var(--bg-card,#0f172a)", border: "1px solid var(--border,#1e293b)", borderRadius: 10 }}>
                <div>
                  <label style={{ fontSize: ".68rem", color: "var(--text-muted,#64748b)", display: "block", marginBottom: 4 }}>التاريخ</label>
                  <input type="date" value={hdrExtra.date || ""} onChange={(e) => setHdr("date")(e.target.value)} style={inpSt} />
                </div>
                <div>
                  <label style={{ fontSize: ".68rem", color: "var(--text-muted,#64748b)", display: "block", marginBottom: 4 }}>طريقة الدفع</label>
                  <select value={hdrExtra.payTypeId || ""} onChange={(e) => setHdr("payTypeId")(e.target.value)} style={inpSt}>
                    <option value="">—</option>
                    {payTypes.map((p) => (
                      <option key={p.id_PayType} value={p.id_PayType}>{p.PayTypeName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: ".68rem", color: "var(--text-muted,#64748b)", display: "block", marginBottom: 4 }}>{cfg.partyLabel}</label>
                  <select value={hdrExtra.partyId || ""} onChange={(e) => setHdr("partyId")(e.target.value)} style={inpSt}>
                    <option value="">—</option>
                    {parties.map((p) => (
                      <option key={p.id_Zabon || p.id_Amil} value={p.id_Zabon || p.id_Amil}>
                        {p.ZabonName || p.AmilName}
                      </option>
                    ))}
                  </select>
                </div>
                {invoiceType === "sales" && (
                  <>
                    <div>
                      <label style={{ fontSize: ".68rem", color: "var(--text-muted,#64748b)", display: "block", marginBottom: 4 }}>المندوب</label>
                      <select value={hdrExtra.mandobId || ""} onChange={(e) => setHdr("mandobId")(e.target.value)} style={inpSt}>
                        <option value="">بدون مندوب</option>
                        {mandobs.map((m) => (
                          <option key={m.id_Mandob} value={m.id_Mandob}>{m.MandobName}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: ".68rem", color: "var(--text-muted,#64748b)", display: "block", marginBottom: 4 }}>اسم السائق</label>
                      <input value={hdrExtra.driverName || ""} onChange={(e) => setHdr("driverName")(e.target.value)} style={inpSt} />
                    </div>
                    <div>
                      <label style={{ fontSize: ".68rem", color: "var(--text-muted,#64748b)", display: "block", marginBottom: 4 }}>هاتف السائق</label>
                      <input value={hdrExtra.driverMobile || ""} onChange={(e) => setHdr("driverMobile")(e.target.value)} style={inpSt} />
                    </div>
                    <div>
                      <label style={{ fontSize: ".68rem", color: "var(--text-muted,#64748b)", display: "block", marginBottom: 4 }}>رقم المركبة</label>
                      <input value={hdrExtra.vehicleNumber || ""} onChange={(e) => setHdr("vehicleNumber")(e.target.value)} style={inpSt} />
                    </div>
                  </>
                )}
                {invoiceType === "purchases" && (
                  <>
                    {["trans", "customs", "porter", "sgs", "exportRelease", "vehicleManifest"].map((k, i) => (
                      <div key={k}>
                        <label style={{ fontSize: ".68rem", color: "var(--text-muted,#64748b)", display: "block", marginBottom: 4 }}>
                          {["نقل", "جمارك", "حمالة", "SGS", "الاخراجي", "منفيست مركبة"][i]}
                        </label>
                        <input type="number" min="0" value={hdrExtra[k] || 0} onChange={(e) => setHdr(k)(e.target.value)} style={inpSt} />
                      </div>
                    ))}
                    <div>
                      <label style={{ fontSize: ".68rem", color: "var(--text-muted,#64748b)", display: "block", marginBottom: 4 }}>المستودع</label>
                      <select value={hdrExtra.warehouseId || ""} onChange={(e) => setHdr("warehouseId")(e.target.value)} style={inpSt}>
                        <option value="">—</option>
                        {warehouses.map((w) => (
                          <option key={w.id || w.id_Warehouse} value={w.id || w.id_Warehouse}>
                            {w.name || w.WarehouseName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: ".68rem", color: "var(--text-muted,#64748b)", display: "block", marginBottom: 4 }}>اسم السائق</label>
                      <input value={hdrExtra.driverName || ""} onChange={(e) => setHdr("driverName")(e.target.value)} style={inpSt} />
                    </div>
                    <div>
                      <label style={{ fontSize: ".68rem", color: "var(--text-muted,#64748b)", display: "block", marginBottom: 4 }}>هاتف السائق</label>
                      <input value={hdrExtra.driverMobile || ""} onChange={(e) => setHdr("driverMobile")(e.target.value)} style={inpSt} />
                    </div>
                    <div>
                      <label style={{ fontSize: ".68rem", color: "var(--text-muted,#64748b)", display: "block", marginBottom: 4 }}>رقم المركبة</label>
                      <input value={hdrExtra.vehicleNumber || ""} onChange={(e) => setHdr("vehicleNumber")(e.target.value)} style={inpSt} />
                    </div>
                    <div>
                      <label style={{ fontSize: ".68rem", color: "var(--text-muted,#64748b)", display: "block", marginBottom: 4 }}>ظريبة عامة</label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={hdrExtra.generalTax ?? 0}
                        onChange={(e) => setHdr("generalTax")(e.target.value)}
                        title="مبلغ إعلامي — لا يدخل في إجمالي الفاتورة"
                        style={inpSt}
                      />
                      <div style={{ fontSize: ".58rem", color: "var(--text-muted,#64748b)", marginTop: 4, lineHeight: 1.35 }}>
                        لا تدخل في حساب الفاتورة — تظهر في قائمة الدخل
                      </div>
                    </div>
                  </>
                )}
                <div>
                  <label style={{ fontSize: ".68rem", color: "var(--text-muted,#64748b)", display: "block", marginBottom: 4 }}>المبلغ المدفوع</label>
                  <input type="number" min="0" value={hdrExtra.paidAmount ?? 0} onChange={(e) => setHdr("paidAmount")(e.target.value)} style={inpSt} />
                </div>
              </div>

              {/* إضافة مواد */}
              <div style={{ position: "relative" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    ref={matRef}
                    value={matQ}
                    onChange={(e) => { setMatQ(e.target.value); setMatOpen(true); setErr(""); }}
                    onFocus={() => setMatOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        searchMat(matQ);
                      }
                      if (e.key === "Escape") setMatOpen(false);
                    }}
                    placeholder="📦 أضف مادة جديدة — اكتب الاسم أو الباركود ثم Enter"
                    style={inpSt}
                  />
                  <button
                    type="button"
                    onClick={() => searchMat(matQ)}
                    disabled={matBusy || !String(matQ).trim()}
                    style={{
                      flexShrink: 0, padding: "8px 14px",
                      background: "rgba(34,197,94,.15)",
                      border: "1px solid rgba(34,197,94,.4)",
                      borderRadius: 8, color: "#4ade80",
                      fontWeight: 800, cursor: matBusy ? "wait" : "pointer",
                      fontFamily: "inherit", fontSize: ".84rem",
                      opacity: !String(matQ).trim() ? 0.5 : 1,
                    }}
                  >
                    {matBusy ? "…" : "إضافة"}
                  </button>
                </div>
                {matOpen && filteredMats.length > 0 && (
                  <div
                    style={{
                      position: "absolute", top: "100%", right: 0, left: 0, zIndex: 20,
                      marginTop: 4, maxHeight: 220, overflowY: "auto",
                      background: "var(--bg-card,#0f172a)",
                      border: "1px solid var(--border,#334155)",
                      borderRadius: 10,
                      boxShadow: "0 12px 32px rgba(0,0,0,.45)",
                    }}
                  >
                    {filteredMats.map((m) => (
                      <button
                        key={m.id_Material_NoM}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addMatToLines(m)}
                        style={{
                          display: "block", width: "100%", textAlign: "right",
                          padding: "8px 12px", background: "none", border: "none",
                          borderBottom: "1px solid var(--border-subtle,#1e293b)",
                          color: "var(--text-primary,#e2e8f0)", cursor: "pointer",
                          fontFamily: "inherit", fontSize: ".84rem",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover,#1e293b)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                      >
                        <div style={{ fontWeight: 700 }}>{m.MaterialName}</div>
                        <div style={{ fontSize: ".72rem", color: "var(--text-muted,#64748b)", marginTop: 2 }}>
                          {m.Barcode ? `باركود: ${m.Barcode}` : `#${m.id_Material_NoM}`}
                          {m.Band ? ` · ${m.Band}` : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* أسطر الفاتورة */}
              {invoiceType === "purchases" ? (
                <PurchaseEditLines
                  lines={lines}
                  linesTotal={linesTotal}
                  grossLc={grossLc}
                  discount={discount}
                  updQty={updQty}
                  updPrice={updPrice}
                  updGift={updGift}
                  updExpDate={updExpDate}
                  delLine={delLine}
                  inpSt={inpSt}
                  btnStyles={btnStyles}
                />
              ) : (
                <SalesEditLines
                  lines={lines}
                  linesTotal={linesTotal}
                  updQty={updQty}
                  updPrice={updPrice}
                  updGift={updGift}
                  delLine={delLine}
                  inpSt={inpSt}
                  btnStyles={btnStyles}
                />
              )}

              {/* خصم وإضافة وملاحظة */}
              <div style={{ display: "grid", gridTemplateColumns: invoiceType === "sales" ? "1fr 1fr 1fr" : "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: ".72rem", fontWeight: 700, color: "var(--text-muted,#64748b)", marginBottom: 5 }}>
                    الخصم (د.ع)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    style={{
                      width: "100%", padding: "8px 12px",
                      background: "var(--bg-input,#0d1117)",
                      border: "1px solid var(--border,#334155)",
                      borderRadius: 8,
                      color: "var(--text-primary,#e2e8f0)",
                      fontFamily: "inherit", outline: "none",
                    }}
                  />
                </div>
                {invoiceType === "sales" && (
                  <div>
                    <label style={{ display: "block", fontSize: ".72rem", fontWeight: 700, color: "var(--text-muted,#64748b)", marginBottom: 5 }}>
                      الإضافة (د.ع)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={hdrExtra.addition ?? 0}
                      onChange={(e) => setHdr("addition")(e.target.value)}
                      style={{
                        width: "100%", padding: "8px 12px",
                        background: "var(--bg-input,#0d1117)",
                        border: "1px solid var(--border,#334155)",
                        borderRadius: 8,
                        color: "var(--text-primary,#e2e8f0)",
                        fontFamily: "inherit", outline: "none",
                      }}
                    />
                  </div>
                )}
                {!cfg.noNote && (
                  <div>
                    <label style={{ display: "block", fontSize: ".72rem", fontWeight: 700, color: "var(--text-muted,#64748b)", marginBottom: 5 }}>
                      ملاحظة
                    </label>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      style={{
                        width: "100%", padding: "8px 12px",
                        background: "var(--bg-input,#0d1117)",
                        border: "1px solid var(--border,#334155)",
                        borderRadius: 8,
                        color: "var(--text-primary,#e2e8f0)",
                        fontFamily: "inherit", outline: "none",
                      }}
                    />
                  </div>
                )}
              </div>

              {/* مقارنة المبالغ */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {[
                  { l: "المبلغ القديم", v: oldTotal, c: "var(--text-secondary,#94a3b8)" },
                  { l: "المبلغ الجديد", v: newTotal, c: "var(--info,#93c5fd)" },
                  {
                    l: "الفارق",
                    v: Math.abs(diff),
                    c: diff > 0 ? "var(--danger,#f87171)" : diff < 0 ? "var(--success,#4ade80)" : "var(--text-muted,#64748b)",
                    note: diff > 0 ? "↑ سيزداد الدين" : diff < 0 ? "↓ سينخفض الدين" : "لا تغيير",
                  },
                ].map((x, i) => (
                  <div
                    key={i}
                    style={{
                      background: "var(--bg-card,#0f172a)",
                      border: "1px solid var(--border,#1e293b)",
                      borderRadius: 10,
                      padding: "10px 14px",
                    }}
                  >
                    <div style={{ fontSize: ".68rem", color: "var(--text-muted,#64748b)", marginBottom: 4 }}>{x.l}</div>
                    <div style={{ fontFamily: "var(--font-mono,monospace)", fontWeight: 900, color: x.c, fontSize: ".95rem" }}>
                      {fmtC(x.v)}
                    </div>
                    {x.note && (
                      <div style={{ fontSize: ".66rem", color: x.c, marginTop: 3 }}>{x.note}</div>
                    )}
                  </div>
                ))}
              </div>

              {/* رسائل الحالة */}
              {err && (
                <div style={{ padding: "8px 12px", background: "var(--danger-bg,rgba(248,81,73,.12))", border: "1px solid var(--danger,#ef4444)", borderRadius: 8, color: "var(--danger,#f87171)", fontWeight: 600 }}>
                  ⚠ {err}
                </div>
              )}
              {success && (
                <div style={{ padding: "8px 12px", background: "var(--success-bg,rgba(63,185,80,.12))", border: "1px solid var(--success,#3fb950)", borderRadius: 8, color: "var(--success,#4ade80)", fontWeight: 600 }}>
                  {success}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────── */}
        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--border,#1e293b)",
            display: "flex", gap: 10,
            background: "var(--bg-card,#0f172a)",
          }}
        >
          <button
            onClick={save}
            disabled={saving || loading || !lines.length}
            style={{
              ...btnStyles.save,
              opacity: saving || loading || !lines.length ? 0.5 : 1,
              cursor: saving || loading || !lines.length ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "⏳ جاري الحفظ والمعالجة..." : "✅ حفظ التعديل"}
          </button>
          <button onClick={onClose} style={btnStyles.cancel}>إلغاء</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── بطاقات أسطر المشتريات (تعديل المدير) ───────────────────
const purchaseLineLbl = {
  fontSize: ".65rem",
  fontWeight: 700,
  color: "var(--text-muted,#64748b)",
  textTransform: "uppercase",
  letterSpacing: ".03em",
  marginBottom: 5,
};

function PurchaseEditLines({ lines, linesTotal, grossLc, discount, updQty, updPrice, updGift, updExpDate, delLine, inpSt, btnStyles }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: ".7rem", fontWeight: 700, color: "var(--text-muted,#64748b)", textTransform: "uppercase", letterSpacing: ".04em" }}>
        أسطر الفاتورة ({lines.length} {lines.length === 1 ? "صنف" : "أصناف"})
      </div>

      {lines.map((l, idx) => {
        const lineValue = r2(l.qty * l.price);
        const lcShare = linesTotal > 0 ? r2((lineValue / linesTotal) * grossLc) : 0;
        const discShare = linesTotal > 0 ? r2((lineValue / linesTotal) * (+discount || 0)) : 0;
        const totalLineCost = r2(lineValue + lcShare - discShare);
        const totalUnits = (l.qty || 0) + (l.gift || 0);
        const landedPerUnit = totalUnits > 0 ? r2(totalLineCost / totalUnits) : r2(l.price);
        const inventoryValue = r2(landedPerUnit * l.qty);
        return (
          <div
            key={l._lid}
            style={{
              border: "1px solid var(--border,#334155)",
              borderRadius: 10,
              background: "var(--bg-card,#0f172a)",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "stretch", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--border-subtle,#1e293b)" }}>
              <div style={{
                width: 32, height: 32, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                background: "var(--bg-surface,#1e293b)", border: "1px solid var(--border,#334155)", borderRadius: 8,
                fontFamily: "var(--font-mono,monospace)", fontWeight: 800, fontSize: ".82rem", color: "var(--text-muted,#64748b)",
              }}>
                {idx + 1}
              </div>

              <div style={{
                flex: 1, minWidth: 0, padding: "8px 12px",
                background: "rgba(59,130,246,.08)", border: "1px solid rgba(59,130,246,.35)", borderRadius: 8,
              }}>
                <div style={{ fontWeight: 800, fontSize: ".92rem", color: "var(--text-primary,#e2e8f0)", lineHeight: 1.35 }}>
                  {l.name}
                </div>
                {l.band && (
                  <div style={{ fontSize: ".72rem", color: "var(--text-muted,#64748b)", marginTop: 4 }}>🏷 {l.band}</div>
                )}
              </div>

              <button
                type="button"
                onClick={() => delLine(l._lid)}
                title="حذف السطر"
                style={{
                  flexShrink: 0, width: 34, height: 34, alignSelf: "center",
                  background: "none", border: "1px solid var(--border,#334155)", borderRadius: 8,
                  color: "var(--danger,#ef4444)", cursor: "pointer", fontSize: "1rem",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(248,81,73,.12)"; e.currentTarget.style.borderColor = "var(--danger,#ef4444)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "var(--border,#334155)"; }}
              >
                ✕
              </button>
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 14,
              padding: "14px 14px 14px 56px",
              background: "var(--bg-surface,#1e293b)",
            }}>
              <div>
                <div style={purchaseLineLbl}>الكمية</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button type="button" style={btnStyles.qBtn(true)} onClick={() => updQty(l._lid, l.qty - 1)}>−</button>
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    value={l.qty}
                    onChange={(e) => updQty(l._lid, e.target.value)}
                    style={{
                      ...inpSt,
                      width: 72,
                      textAlign: "center",
                      fontFamily: "var(--font-mono,monospace)",
                      fontSize: ".9rem",
                      fontWeight: 700,
                    }}
                  />
                  <button type="button" style={btnStyles.qBtn(false)} onClick={() => updQty(l._lid, l.qty + 1)}>+</button>
                </div>
              </div>

              <div>
                <div style={purchaseLineLbl}>سعر الشراء (د.ع)</div>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={l.price}
                  onChange={(e) => updPrice(l._lid, e.target.value)}
                  style={{
                    ...inpSt,
                    width: "100%",
                    boxSizing: "border-box",
                    textAlign: "left",
                    color: "#fbbf24",
                    fontFamily: "var(--font-mono,monospace)",
                    fontSize: ".9rem",
                    fontWeight: 700,
                  }}
                />
              </div>

              <div>
                <div style={purchaseLineLbl}>الهدية</div>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={l.gift ?? 0}
                  onChange={(e) => updGift(l._lid, e.target.value)}
                  style={{
                    ...inpSt,
                    width: "100%",
                    boxSizing: "border-box",
                    textAlign: "center",
                    fontFamily: "var(--font-mono,monospace)",
                    fontSize: ".9rem",
                    fontWeight: 700,
                    color: (l.gift || 0) > 0 ? "#4ade80" : undefined,
                  }}
                />
              </div>

              <div>
                <div style={purchaseLineLbl}>حصة LC (د.ع)</div>
                <div style={{
                  padding: "8px 12px", borderRadius: 8,
                  background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.35)",
                  fontFamily: "var(--font-mono,monospace)", fontWeight: 700, textAlign: "left",
                  color: lcShare > 0 ? "#fbbf24" : "var(--text-muted,#64748b)", fontSize: ".88rem",
                }}>
                  {lcShare > 0 ? `+${fmtC(lcShare)}` : "—"}
                </div>
              </div>

              <div>
                <div style={purchaseLineLbl}>حصة الخصم (د.ع)</div>
                <div style={{
                  padding: "8px 12px", borderRadius: 8,
                  background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)",
                  fontFamily: "var(--font-mono,monospace)", fontWeight: 700, textAlign: "left",
                  color: discShare > 0 ? "#f87171" : "var(--text-muted,#64748b)", fontSize: ".88rem",
                }}>
                  {discShare > 0 ? `−${fmtC(discShare)}` : "—"}
                </div>
              </div>

              <div>
                <div style={purchaseLineLbl}>سعر بعد LC</div>
                <div style={{
                  padding: "8px 12px", borderRadius: 8,
                  background: "rgba(34,197,94,.08)", border: "1px solid rgba(34,197,94,.25)",
                  fontFamily: "var(--font-mono,monospace)", fontWeight: 800, textAlign: "left",
                  color: "#4ade80", fontSize: ".88rem",
                }}>
                  {fmtC(landedPerUnit)}
                </div>
              </div>

              <div>
                <div style={purchaseLineLbl}>قيمة المخزون</div>
                <div style={{
                  padding: "8px 12px", borderRadius: 8,
                  background: "rgba(59,130,246,.1)", border: "1px solid rgba(59,130,246,.35)",
                  fontFamily: "var(--font-mono,monospace)", fontWeight: 900, textAlign: "left",
                  color: "var(--info,#93c5fd)", fontSize: "1rem",
                }}>
                  {fmtC(inventoryValue)}
                </div>
              </div>

              <div>
                <div style={purchaseLineLbl}>تاريخ النفاذ</div>
                <input
                  type="date"
                  value={l.expDate || ""}
                  onChange={(e) => updExpDate(l._lid, e.target.value)}
                  style={{ ...inpSt, width: "100%", boxSizing: "border-box", fontSize: ".88rem", cursor: "pointer" }}
                />
              </div>
            </div>
          </div>
        );
      })}

      {lines.length > 0 && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "12px 14px", background: "var(--bg-card,#0f172a)",
          border: "2px solid var(--border,#334155)", borderRadius: 10,
        }}>
          <span style={{ fontWeight: 700, color: "var(--text-secondary,#94a3b8)", fontSize: ".84rem" }}>
            إجمالي السطور ({lines.length} {lines.length === 1 ? "صنف" : "أصناف"})
          </span>
          <span style={{ fontFamily: "var(--font-mono,monospace)", fontWeight: 900, color: "var(--info,#93c5fd)", fontSize: "1.05rem" }}>
            {fmtC(linesTotal)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── بطاقات أسطر المبيعات (تعديل المدير) ─────────────────────
function SalesEditLines({ lines, linesTotal, updQty, updPrice, updGift, delLine, inpSt, btnStyles }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: ".7rem", fontWeight: 700, color: "var(--text-muted,#64748b)", textTransform: "uppercase", letterSpacing: ".04em" }}>
        أسطر الفاتورة ({lines.length} {lines.length === 1 ? "صنف" : "أصناف"})
      </div>

      {lines.map((l, idx) => {
        const lineTotal = r2(l.qty * l.price);
        return (
          <div
            key={l._lid}
            style={{
              border: "1px solid var(--border,#334155)",
              borderRadius: 10,
              background: "var(--bg-card,#0f172a)",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "stretch", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--border-subtle,#1e293b)" }}>
              <div style={{
                width: 32, height: 32, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                background: "var(--bg-surface,#1e293b)", border: "1px solid var(--border,#334155)", borderRadius: 8,
                fontFamily: "var(--font-mono,monospace)", fontWeight: 800, fontSize: ".82rem", color: "var(--text-muted,#64748b)",
              }}>
                {idx + 1}
              </div>

              <div style={{
                flex: 1, minWidth: 0, padding: "8px 12px",
                background: "rgba(34,197,94,.08)", border: "1px solid rgba(34,197,94,.35)", borderRadius: 8,
              }}>
                <div style={{ fontWeight: 800, fontSize: ".92rem", color: "var(--text-primary,#e2e8f0)", lineHeight: 1.35 }}>
                  {l.name}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 4, fontSize: ".72rem", color: "var(--text-muted,#64748b)" }}>
                  {l.band && <span>🏷 {l.band}</span>}
                  {l.barcode && <span style={{ fontFamily: "var(--font-mono,monospace)" }}>📊 {l.barcode}</span>}
                </div>
              </div>

              <button
                type="button"
                onClick={() => delLine(l._lid)}
                title="حذف السطر"
                style={{
                  flexShrink: 0, width: 34, height: 34, alignSelf: "center",
                  background: "none", border: "1px solid var(--border,#334155)", borderRadius: 8,
                  color: "var(--danger,#ef4444)", cursor: "pointer", fontSize: "1rem",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(248,81,73,.12)"; e.currentTarget.style.borderColor = "var(--danger,#ef4444)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "var(--border,#334155)"; }}
              >
                ✕
              </button>
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 14,
              padding: "14px 14px 14px 56px",
              background: "var(--bg-surface,#1e293b)",
            }}>
              <div>
                <div style={purchaseLineLbl}>الكمية</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button type="button" style={btnStyles.qBtn(true)} onClick={() => updQty(l._lid, l.qty - 1)}>−</button>
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    value={l.qty}
                    onChange={(e) => updQty(l._lid, e.target.value)}
                    style={{
                      ...inpSt,
                      width: 72,
                      textAlign: "center",
                      fontFamily: "var(--font-mono,monospace)",
                      fontSize: ".9rem",
                      fontWeight: 700,
                    }}
                  />
                  <button type="button" style={btnStyles.qBtn(false)} onClick={() => updQty(l._lid, l.qty + 1)}>+</button>
                </div>
              </div>

              <div>
                <div style={purchaseLineLbl}>سعر البيع (د.ع)</div>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={l.price}
                  onChange={(e) => updPrice(l._lid, e.target.value)}
                  style={{
                    ...inpSt,
                    width: "100%",
                    boxSizing: "border-box",
                    textAlign: "left",
                    color: "#fbbf24",
                    fontFamily: "var(--font-mono,monospace)",
                    fontSize: ".9rem",
                    fontWeight: 700,
                  }}
                />
              </div>

              <div>
                <div style={purchaseLineLbl}>الهدية</div>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={l.gift ?? 0}
                  onChange={(e) => updGift(l._lid, e.target.value)}
                  style={{
                    ...inpSt,
                    width: "100%",
                    boxSizing: "border-box",
                    textAlign: "center",
                    fontFamily: "var(--font-mono,monospace)",
                    fontSize: ".9rem",
                    fontWeight: 700,
                    color: (l.gift || 0) > 0 ? "#4ade80" : undefined,
                  }}
                />
              </div>

              <div>
                <div style={purchaseLineLbl}>إجمالي السطر</div>
                <div style={{
                  padding: "8px 12px", borderRadius: 8,
                  background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.35)",
                  fontFamily: "var(--font-mono,monospace)", fontWeight: 900, textAlign: "left",
                  color: "var(--success,#4ade80)", fontSize: "1rem",
                }}>
                  {fmtC(lineTotal)}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {lines.length > 0 && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "12px 14px", background: "var(--bg-card,#0f172a)",
          border: "2px solid var(--border,#334155)", borderRadius: 10,
        }}>
          <span style={{ fontWeight: 700, color: "var(--text-secondary,#94a3b8)", fontSize: ".84rem" }}>
            إجمالي السطور ({lines.length} {lines.length === 1 ? "صنف" : "أصناف"})
          </span>
          <span style={{ fontFamily: "var(--font-mono,monospace)", fontWeight: 900, color: "var(--success,#4ade80)", fontSize: "1.05rem" }}>
            {fmtC(linesTotal)}
          </span>
        </div>
      )}
    </div>
  );
}
