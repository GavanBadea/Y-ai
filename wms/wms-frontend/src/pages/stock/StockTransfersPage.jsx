// حركات النقل المخزني بين المستودعات
import { useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import Button from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useApi, useAction } from "@/hooks/useApi";
import { warehouseService, stockTransferService, materialsService } from "@/services/api";
import { fmtN } from "@/utils/numFormat";
import { useCompany } from "@/context/CompanyContext";
import { printTableReport, exportTableExcel, ExportPrintBar } from "@/utils/tableReportTools";

const today = () => new Date().toISOString().split("T")[0];
const yearStart = () => `${new Date().getFullYear()}-01-01`;

let _lid = 0;
const emptyLine = () => ({ _lid: ++_lid, id_Material_NoM: "", MaterialName: "", Quantity: 1, available: null });

function printTransfer(printData, company) {
  if (!printData) return;
  const rows = (printData.lines || []).map((l, i) => [
    String(i + 1), l.MaterialName, l.Band || "—", fmtN(l.qty),
  ]);
  const note = printData.note ? ` | ملاحظة: ${printData.note}` : "";
  printTableReport(
    company,
    `إذن نقل مخزني #${printData.transferId}`,
    `التاريخ: ${printData.date} | من: ${printData.fromName} → إلى: ${printData.toName}${note}`,
    ["#", "المادة", "الوحدة", "الكمية"],
    rows
  );
}

const LIST_HEADERS = ["#", "رقم النقل", "التاريخ", "من", "إلى", "أسطر", "كمية", "ملاحظة"];

function mapTransferListRows(transfers) {
  return transfers.map((t, i) => [
    i + 1,
    t.id,
    t.date,
    t.fromName,
    t.toName,
    t.lineCount,
    fmtN(t.totalQty),
    t.note || "—",
  ]);
}

export default function StockTransfersPage() {
  const { company } = useCompany();
  const [mode, setMode] = useState("new");
  const [listFilter, setListFilter] = useState({ from: yearStart(), to: today() });
  const [hdr, setHdr] = useState({
    Date_Transfer: today(),
    id_Warehouse_From: "",
    id_Warehouse_To: "",
    Note_Transfer: "",
  });
  const [lines, setLines] = useState([emptyLine()]);
  const [saveErr, setSaveErr] = useState("");

  const { data: whData } = useApi(() => warehouseService.listActive(), []);
  const { data: matData, loading: loadingMats } = useApi(
    () => materialsService.getAll({ limit: 2000 }),
    []
  );
  const warehouses = whData?.data || [];
  const materials = Array.isArray(matData) ? matData : (matData?.data || []);

  const { data: listData, loading: listLoad, refetch: refetchList } = useApi(
    () => (mode === "list" ? stockTransferService.list(listFilter) : Promise.resolve({ data: [] })),
    [mode, listFilter]
  );
  const transfers = listData?.data || [];

  const { loading: saving, execute } = useAction();

  const pickMaterial = async (idx, matId) => {
    const mat = materials.find((m) => String(m.id_Material_NoM) === String(matId));
    if (!mat) return;
    let available = null;
    if (hdr.id_Warehouse_From) {
      try {
        const r = await warehouseService.getQty(hdr.id_Warehouse_From, matId);
        available = r?.qty ?? 0;
      } catch { available = 0; }
    }
    setLines((p) => p.map((l, i) => i === idx ? {
      ...l,
      id_Material_NoM: mat.id_Material_NoM,
      MaterialName: mat.MaterialName,
      Band: mat.Band,
      available,
    } : l));
  };

  const handleSave = async () => {
    setSaveErr("");
    if (!hdr.id_Warehouse_From || !hdr.id_Warehouse_To)
      return setSaveErr("اختر المستودع المصدر والوجهة");
    const valid = lines.filter((l) => l.id_Material_NoM && (+l.Quantity || 0) > 0);
    if (!valid.length) return setSaveErr("أضف مادة واحدة على الأقل");
    await execute(
      () => stockTransferService.create({
        ...hdr,
        lines: valid.map((l) => ({ id_Material_NoM: l.id_Material_NoM, Quantity: +l.Quantity })),
      }),
      {
        onSuccess: (res) => {
          printTransfer(res.printData, company);
          setHdr({ Date_Transfer: today(), id_Warehouse_From: "", id_Warehouse_To: "", Note_Transfer: "" });
          setLines([emptyLine()]);
          refetchList();
        },
        onError: (e) => setSaveErr(e),
      }
    );
  };

  const selSt = {
    width: "100%", padding: "10px 12px", background: "var(--bg-input)",
    border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
    color: "var(--text-primary)", fontFamily: "var(--font-main)", fontSize: ".88rem",
  };

  return (
    <AppLayout title="حركات النقل المخزني">
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <Button variant={mode === "new" ? "primary" : "secondary"} onClick={() => setMode("new")}>✚ حركة نقل جديدة</Button>
        <Button variant={mode === "list" ? "primary" : "secondary"} onClick={() => setMode("list")}>📋 السجل</Button>
      </div>

      {mode === "new" ? (
        <Card>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: ".72rem", color: "var(--text-muted)", fontWeight: 700 }}>التاريخ</span>
              <input type="date" value={hdr.Date_Transfer} onChange={(e) => setHdr((p) => ({ ...p, Date_Transfer: e.target.value }))} style={selSt} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: ".72rem", color: "var(--text-muted)", fontWeight: 700 }}>المستودع المصدر *</span>
              <select value={hdr.id_Warehouse_From} onChange={(e) => setHdr((p) => ({ ...p, id_Warehouse_From: e.target.value }))} style={selSt}>
                <option value="">— اختر —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: ".72rem", color: "var(--text-muted)", fontWeight: 700 }}>المستودع الوجهة *</span>
              <select value={hdr.id_Warehouse_To} onChange={(e) => setHdr((p) => ({ ...p, id_Warehouse_To: e.target.value }))} style={selSt}>
                <option value="">— اختر —</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, gridColumn: "1 / -1" }}>
              <span style={{ fontSize: ".72rem", color: "var(--text-muted)", fontWeight: 700 }}>ملاحظة</span>
              <input type="text" value={hdr.Note_Transfer} onChange={(e) => setHdr((p) => ({ ...p, Note_Transfer: e.target.value }))} style={selSt} placeholder="اختياري" />
            </label>
          </div>

          {!warehouses.length && (
            <div style={{ padding: 12, marginBottom: 12, background: "var(--warning-bg)", borderRadius: 8, fontSize: ".85rem" }}>
              ⚠ لا توجد مستودعات نشطة. أنشئ مستودعاً من الإعدادات → إدارة المستودعات.
            </div>
          )}

          <div style={{ overflowX: "auto", marginBottom: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
              <thead>
                <tr style={{ background: "var(--bg-surface)" }}>
                  {["#", "المادة", "متاح بالمصدر", "الكمية", ""].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "right", fontSize: ".7rem", color: "var(--text-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={line._lid} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: 8 }}>{idx + 1}</td>
                    <td style={{ padding: 8, minWidth: 200 }}>
                      <select value={line.id_Material_NoM || ""} onChange={(e) => pickMaterial(idx, e.target.value)} style={selSt}>
                        <option value="">{loadingMats ? "..." : "— اختر مادة —"}</option>
                        {materials.map((m) => (
                          <option key={m.id_Material_NoM} value={m.id_Material_NoM}>{m.MaterialName}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: 8, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                      {line.available != null ? fmtN(line.available) : "—"}
                    </td>
                    <td style={{ padding: 8 }}>
                      <input type="number" min="0.001" step="any" value={line.Quantity}
                        onChange={(e) => setLines((p) => p.map((l, i) => i === idx ? { ...l, Quantity: e.target.value } : l))}
                        style={{ ...selSt, width: 90 }} />
                    </td>
                    <td style={{ padding: 8 }}>
                      <button type="button" onClick={() => setLines((p) => p.filter((_, i) => i !== idx).length ? p.filter((_, i) => i !== idx) : [emptyLine()])}
                        style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer" }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="secondary" onClick={() => setLines((p) => [...p, emptyLine()])}>＋ سطر</Button>
            <Button onClick={handleSave} loading={saving}>💾 حفظ وطباعة إذن النقل</Button>
          </div>
          {saveErr && <div style={{ marginTop: 12, color: "var(--danger)", fontWeight: 600 }}>⚠ {saveErr}</div>}
        </Card>
      ) : (
        <Card>
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>من</span>
              <input type="date" value={listFilter.from} onChange={(e) => setListFilter((p) => ({ ...p, from: e.target.value }))} style={selSt} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: ".72rem", color: "var(--text-muted)" }}>إلى</span>
              <input type="date" value={listFilter.to} onChange={(e) => setListFilter((p) => ({ ...p, to: e.target.value }))} style={selSt} />
            </label>
            <Button variant="secondary" onClick={refetchList}>🔍 عرض</Button>
            <ExportPrintBar
              disabled={listLoad || transfers.length === 0}
              onPrint={() =>
                printTableReport(
                  company,
                  "سجل النقل المخزني",
                  `الفترة: ${listFilter.from} → ${listFilter.to} | ${transfers.length} حركة`,
                  LIST_HEADERS,
                  mapTransferListRows(transfers)
                )
              }
              onExcel={() =>
                exportTableExcel(
                  `سجل_النقل_${listFilter.from}_${listFilter.to}`,
                  "سجل النقل",
                  LIST_HEADERS,
                  mapTransferListRows(transfers)
                )
              }
            />
          </div>
          {listLoad ? <div style={{ padding: 20, textAlign: "center" }}>جاري التحميل...</div> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem" }}>
              <thead>
                <tr style={{ background: "var(--bg-surface)" }}>
                  {["#", "التاريخ", "من", "إلى", "أسطر", "كمية", "طباعة"].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "right", fontSize: ".7rem", color: "var(--text-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transfers.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>لا توجد حركات</td></tr>
                ) : transfers.map((t) => (
                  <tr key={t.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: 8 }}>{t.id}</td>
                    <td style={{ padding: 8 }}>{t.date}</td>
                    <td style={{ padding: 8 }}>{t.fromName}</td>
                    <td style={{ padding: 8 }}>{t.toName}</td>
                    <td style={{ padding: 8 }}>{t.lineCount}</td>
                    <td style={{ padding: 8, fontFamily: "var(--font-mono)" }}>{fmtN(t.totalQty)}</td>
                    <td style={{ padding: 8 }}>
                      <Button size="sm" variant="ghost" onClick={async () => {
                        const r = await stockTransferService.getOne(t.id);
                        const d = r.data;
                        printTransfer({
                          transferId: d.id_Transfer,
                          date: d.Date_Transfer,
                          fromName: d.fromName,
                          toName: d.toName,
                          note: d.Note_Transfer,
                          lines: (d.lines || []).map((l) => ({
                            MaterialName: l.MaterialName,
                            Band: l.Band,
                            qty: l.Quantity,
                          })),
                        }, company);
                      }}>🖨</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </AppLayout>
  );
}
