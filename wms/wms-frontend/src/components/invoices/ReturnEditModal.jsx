import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import api, { partyService, materialsService } from "@/services/api";
import { numFieldValue } from "@/utils/numInput";

const r2 = (n = 0) => Math.round((+n || 0) * 100) / 100;
const fmtC = (n = 0) => `${r2(n).toLocaleString("en-US")} د.ع`;
let _lid = 0;

export default function ReturnEditModal({ returnId, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");
  const [header, setHeader] = useState(null);
  const [lines, setLines] = useState([]);
  const [parties, setParties] = useState([]);
  const [allMats, setAllMats] = useState([]);
  const [matQ, setMatQ] = useState("");
  const [matBusy, setMatBusy] = useState(false);
  const matRef = useRef(null);

  const isSupplier = header?.ReturnType === "SUPPLIER";
  const grandTotal = lines.reduce((s, l) => s + r2((+l.qty || 0) * (+l.price || 0)), 0);

  useEffect(() => {
    if (!returnId) return;
    setLoading(true);
    setErr("");
    Promise.all([
      api.get(`/returns/${returnId}/edit-data`),
      materialsService.getAll(),
    ])
      .then(async ([editRes, matsRes]) => {
        const hdr = editRes?.header;
        const lns = editRes?.lines || [];
        if (!hdr) throw new Error("تعذّر تحميل بيانات السند");
        setHeader(hdr);
        setLines(lns.map((l) => ({
          _lid: ++_lid,
          matId: l.id_Material_NoM,
          name: l.MaterialName,
          band: l.Band || "",
          barcode: l.Barcode || "",
          qty: r2(l.AmountReturn),
          price: r2(l.PriceReturn),
          reason: l.ReturnReason || "",
          stock: l.QuantityOnHand || 0,
        })));
        const partyRes = hdr.ReturnType === "SUPPLIER"
          ? await partyService.getSuppliers()
          : await partyService.getCustomers();
        const list = Array.isArray(partyRes?.data) ? partyRes.data : (partyRes?.data?.data || partyRes?.data || []);
        setParties(list);
        const mats = Array.isArray(matsRes?.data) ? matsRes.data : (matsRes?.data?.data || []);
        setAllMats(mats);
      })
      .catch((e) => setErr(e?.message || "خطأ في التحميل"))
      .finally(() => setLoading(false));
  }, [returnId]);

  const searchMat = async (val) => {
    const v = (val || "").trim();
    if (!v) return;
    setMatQ("");
    setMatBusy(true);
    try {
      let mat = null;
      try {
        const scan = await materialsService.scanBarcode(v);
        mat = scan?.data?.data;
      } catch { /* ignore */ }
      if (!mat?.id_Material_NoM && /^\d+$/.test(v)) {
        try {
          const one = await materialsService.getOne(v);
          mat = one?.data?.data;
        } catch { /* ignore */ }
      }
      if (!mat?.id_Material_NoM) {
        const listR = await materialsService.getAll({ search: v });
        const list = listR?.data?.data || [];
        if (list.length) mat = list.find((m) => m.MaterialName === v || m.Barcode === v) || list[0];
      }
      if (!mat?.id_Material_NoM) {
        setErr("المادة غير موجودة");
        return;
      }
      const price = isSupplier ? r2(mat.CostPrice || 0) : r2(mat.LastSellPrice || mat.SellPrice1 || 0);
      setLines((prev) => {
        const i = prev.findIndex((l) => l.matId === mat.id_Material_NoM);
        if (i >= 0) return prev.map((l, x) => (x === i ? { ...l, qty: r2(l.qty + 1) } : l));
        return [...prev, {
          _lid: ++_lid,
          matId: mat.id_Material_NoM,
          name: mat.MaterialName,
          band: mat.Band || "",
          barcode: mat.Barcode || "",
          qty: 1,
          price,
          reason: "",
          stock: mat.QuantityOnHand || 0,
        }];
      });
    } finally {
      setMatBusy(false);
      matRef.current?.focus();
    }
  };

  const save = async () => {
    if (!lines.length) return setErr("لا توجد أسطر للحفظ");
    if (lines.some((l) => !l.matId)) return setErr("اختر مادة لكل سطر");
    setErr("");
    setSuccess("");
    setSaving(true);
    try {
      await api.put(`/returns/${returnId}`, {
        id_Party: header.id_Party,
        Date_FRetern: header.Date_FRetern?.split("T")[0],
        Note_FRetern: header.Note_FRetern || "",
        DriverName_R: header.DriverName_R || "",
        DriverMobile_R: header.DriverMobile_R || "",
        VehicleNumber_R: header.VehicleNumber_R || "",
        lines: lines.map((l) => ({
          id_Material_NoM: Number(l.matId),
          AmountReturn: +l.qty || 1,
          PriceOUT: +l.price || 0,
          ReturnReason: l.reason || "",
        })),
      });
      setSuccess("✅ تم حفظ التعديل");
      onSaved?.(returnId);
      setTimeout(onClose, 1200);
    } catch (e) {
      setErr(e?.message || e?.data?.message || "خطأ في الحفظ");
    } finally {
      setSaving(false);
    }
  };

  if (!returnId) return null;

  const inpSt = {
    width: "100%", padding: "8px 10px",
    background: "var(--bg-input,#0d1117)",
    border: "1px solid var(--border,#334155)",
    borderRadius: 8, color: "var(--text-primary,#e2e8f0)",
    fontFamily: "inherit", fontSize: ".86rem", outline: "none",
  };

  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,.75)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div style={{
        width: "min(920px, 96vw)", maxHeight: "92vh", overflow: "auto",
        background: "var(--bg-card,#0f172a)", border: "1px solid var(--border,#334155)",
        borderRadius: 14, padding: "18px 20px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontWeight: 900, fontSize: "1rem" }}>
            🔐 تعديل {isSupplier ? "مرتجع مشتريات" : "مرتجع مبيعات"} #{returnId}
          </span>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center" }}><span className="spinner" /></div>
        ) : header ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 14 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>التاريخ</span>
                <input type="date" value={header.Date_FRetern?.split("T")[0] || ""}
                  onChange={(e) => setHeader((p) => ({ ...p, Date_FRetern: e.target.value }))} style={inpSt} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>{isSupplier ? "المورد" : "الزبون"}</span>
                <select value={header.id_Party || ""} onChange={(e) => setHeader((p) => ({ ...p, id_Party: e.target.value }))} style={inpSt}>
                  {parties.map((p) => (
                    <option key={isSupplier ? p.id_Amil : p.id_Zabon} value={isSupplier ? p.id_Amil : p.id_Zabon}>
                      {isSupplier ? p.AmilName : p.ZabonName}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>ملاحظة</span>
                <input value={header.Note_FRetern || ""} onChange={(e) => setHeader((p) => ({ ...p, Note_FRetern: e.target.value }))} style={inpSt} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>اسم السائق</span>
                <input value={header.DriverName_R || ""} onChange={(e) => setHeader((p) => ({ ...p, DriverName_R: e.target.value }))} style={inpSt} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>هاتف السائق</span>
                <input value={header.DriverMobile_R || ""} onChange={(e) => setHeader((p) => ({ ...p, DriverMobile_R: e.target.value }))} style={inpSt} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>رقم المركبة</span>
                <input value={header.VehicleNumber_R || ""} onChange={(e) => setHeader((p) => ({ ...p, VehicleNumber_R: e.target.value }))} style={inpSt} />
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <input ref={matRef} value={matQ} onChange={(e) => setMatQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") searchMat(matQ); }}
                placeholder="باركود أو اسم مادة..." style={{ ...inpSt, flex: 1, minWidth: 200 }} />
              <button type="button" disabled={matBusy} onClick={() => searchMat(matQ)}
                style={{ padding: "8px 14px", background: "var(--accent)", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {matBusy ? "..." : "إضافة"}
              </button>
              <button type="button" onClick={() => setLines((p) => [...p, {
                _lid: ++_lid, matId: null, name: "", band: "", barcode: "", qty: 1, price: 0, reason: "", stock: 0,
              }])}
                style={{ padding: "8px 14px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}>
                ＋ سطر
              </button>
            </div>

            <div style={{ overflowX: "auto", marginBottom: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
                <thead>
                  <tr style={{ background: "var(--bg-surface)", borderBottom: "2px solid var(--border)" }}>
                    {["المادة", "الكمية", "السعر", "السبب", ""].map((h) => (
                      <th key={h} style={{ padding: "8px", textAlign: "right", fontSize: ".68rem", color: "var(--text-muted)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l._lid} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={{ padding: "8px", minWidth: 180 }}>
                        <select
                          value={l.matId || ""}
                          onChange={(e) => {
                            const m = allMats.find((x) => String(x.id_Material_NoM) === String(e.target.value));
                            if (!m) return;
                            setLines((p) => p.map((x) => x._lid === l._lid ? {
                              ...x,
                              matId: m.id_Material_NoM,
                              name: m.MaterialName,
                              band: m.Band || "",
                              barcode: m.Barcode || "",
                              stock: m.QuantityOnHand || 0,
                              price: isSupplier ? r2(m.CostPrice || 0) : r2(m.LastSellPrice || m.SellPrice1 || 0),
                            } : x));
                          }}
                          style={inpSt}
                        >
                          <option value="">— اختر مادة —</option>
                          {allMats.map((m) => (
                            <option key={m.id_Material_NoM} value={m.id_Material_NoM}>
                              {m.MaterialName}{m.Barcode ? ` (${m.Barcode})` : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: "8px", width: 90 }}>
                        <input type="number" min="0.001" step="any" value={numFieldValue(l.qty)}
                          onChange={(e) => setLines((p) => p.map((x) => x._lid === l._lid ? { ...x, qty: Math.max(0.001, +e.target.value || 1) } : x))}
                          style={{ ...inpSt, width: 80 }} />
                      </td>
                      <td style={{ padding: "8px", width: 100 }}>
                        <input type="number" min="0" step="any" value={numFieldValue(l.price)}
                          onChange={(e) => setLines((p) => p.map((x) => x._lid === l._lid ? { ...x, price: Math.max(0, +e.target.value || 0) } : x))}
                          style={{ ...inpSt, width: 90 }} />
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input value={l.reason || ""} onChange={(e) => setLines((p) => p.map((x) => x._lid === l._lid ? { ...x, reason: e.target.value } : x))} style={inpSt} />
                      </td>
                      <td style={{ padding: "8px", textAlign: "center" }}>
                        <button type="button" onClick={() => setLines((p) => p.filter((x) => x._lid !== l._lid))}
                          style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer" }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ padding: "10px 8px", textAlign: "right", fontWeight: 700 }}>الإجمالي</td>
                    <td colSpan={2} style={{ padding: "10px 8px", fontFamily: "monospace", fontWeight: 900, color: "var(--accent)" }}>{fmtC(grandTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {err && <div style={{ color: "var(--danger)", marginBottom: 10, fontWeight: 600 }}>{err}</div>}
            {success && <div style={{ color: "var(--success)", marginBottom: 10, fontWeight: 600 }}>{success}</div>}

            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" disabled={saving} onClick={save}
                style={{ flex: 1, padding: 11, background: "#166534", border: "2px solid #16a34a", borderRadius: 10, color: "#4ade80", fontWeight: 900, cursor: "pointer" }}>
                {saving ? "جاري الحفظ..." : "💾 حفظ التعديل"}
              </button>
              <button type="button" onClick={onClose} style={{ padding: "11px 22px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10, cursor: "pointer" }}>
                إلغاء
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
