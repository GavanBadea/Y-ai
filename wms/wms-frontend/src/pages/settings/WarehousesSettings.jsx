// إدارة المستودعات — للمدير فقط
import { useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { useApi, useAction } from "@/hooks/useApi";
import { warehouseService } from "@/services/api";

const emptyForm = { name: "", location: "", manager: "" };

export function WarehousesTab() {
  const { data, loading, refetch } = useApi(() => warehouseService.listAll(), []);
  const warehouses = data?.data || [];

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [err, setErr] = useState("");
  const { loading: saving, execute } = useAction();

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm);
    setErr("");
    setShowForm(true);
  };

  const openEdit = (w) => {
    setEditId(w.id);
    setForm({
      name: w.name || "",
      location: w.location || "",
      manager: w.manager || "",
    });
    setErr("");
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm);
    setErr("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!form.name.trim()) return setErr("اسم المستودع مطلوب");

    const payload = {
      name: form.name.trim(),
      location: form.location.trim(),
      manager: form.manager.trim(),
    };

    await execute(
      () => editId
        ? warehouseService.update(editId, payload)
        : warehouseService.create({ ...payload, isActive: 1 }),
      {
        onSuccess: () => {
          closeForm();
          refetch();
        },
        onError: (e) => setErr(e),
      }
    );
  };

  const toggleActive = async (w) => {
    await execute(
      () => warehouseService.update(w.id, { isActive: w.isActive ? 0 : 1 }),
      { onSuccess: refetch }
    );
  };

  const handleDelete = async (w) => {
    if (!confirm(`حذف المستودع "${w.name}"؟\nلن يُحذف إذا كان مرتبطاً بفواتير أو مخزون.`)) return;
    await execute(
      () => warehouseService.remove(w.id),
      {
        onSuccess: refetch,
        onError: (e) => alert(`لا يمكن الحذف: ${e}`),
      }
    );
  };

  return (
      <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 800 }}>المستودعات</h2>
              <p style={{ margin: "6px 0 0", fontSize: ".82rem", color: "var(--text-muted)" }}>
                إضافة مستودعات جديدة وربط فواتير الشراء بمستودع محدد
              </p>
            </div>
            <Button onClick={() => (showForm && !editId ? closeForm() : openCreate())}>
              {showForm && !editId ? "إلغاء" : "✚ إضافة مستودع جديد"}
            </Button>
          </div>

          {showForm && (
            <form onSubmit={handleSubmit} style={{
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
              padding: 16, marginBottom: 16, background: "var(--bg-surface)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
            }}>
              <div style={{ gridColumn: "1/-1", fontWeight: 700, fontSize: ".88rem", color: "var(--text-secondary)" }}>
                {editId ? "✏ تعديل المستودع" : "✚ مستودع جديد"}
              </div>
              {err && <div style={{ gridColumn: "1/-1", color: "var(--danger)", fontSize: ".85rem" }}>⚠ {err}</div>}
              <Input label="اسم المستودع *" value={form.name} onChange={(v) => setForm((p) => ({ ...p, name: v }))} />
              <Input label="العنوان / الموقع" value={form.location} onChange={(v) => setForm((p) => ({ ...p, location: v }))} />
              <Input label="الشخص المسؤول" value={form.manager} onChange={(v) => setForm((p) => ({ ...p, manager: v }))} style={{ gridColumn: "1/-1" }} />
              <div style={{ gridColumn: "1/-1", display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <Button type="button" variant="ghost" onClick={closeForm}>إلغاء</Button>
                <Button type="submit" loading={saving}>
                  {editId ? "💾 حفظ التعديل" : "💾 حفظ المستودع"}
                </Button>
              </div>
            </form>
          )}

          {loading ? (
            <div style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>جاري التحميل...</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".88rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)" }}>
                  {["#", "الاسم", "الموقع", "المسؤول", "الحالة", ""].map((h) => (
                    <th key={h} style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-muted)", fontSize: ".72rem" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {warehouses.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>لا توجد مستودعات بعد</td></tr>
                ) : warehouses.map((w) => (
                  <tr key={w.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)" }}>{w.id}</td>
                    <td style={{ padding: "10px 12px", fontWeight: 700 }}>{w.name}</td>
                    <td style={{ padding: "10px 12px" }}>{w.location || "—"}</td>
                    <td style={{ padding: "10px 12px" }}>{w.manager || "—"}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <button
                        type="button"
                        onClick={() => toggleActive(w)}
                        title={w.isActive ? "اضغط للتعطيل" : "اضغط للتفعيل"}
                        style={{
                          padding: "2px 10px", borderRadius: 20, fontSize: ".75rem", fontWeight: 700,
                          border: "none", cursor: "pointer", fontFamily: "inherit",
                          background: w.isActive ? "var(--success-bg)" : "var(--danger-bg)",
                          color: w.isActive ? "var(--success)" : "var(--danger)",
                        }}
                      >
                        {w.isActive ? "نشط" : "معطل"}
                      </button>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <Button size="sm" variant="secondary" onClick={() => openEdit(w)}>✏</Button>
                        <Button size="sm" variant="danger" onClick={() => handleDelete(w)}>🗑</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
  );
}
