import { useEffect, useState } from "react";
import AppLayout from "@/components/layout/AppLayout";
import { Card } from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { fiscalSwitchService } from "@/services/api";

function formatDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("ar-IQ");
  } catch {
    return String(d);
  }
}

function formatSize(bytes) {
  if (!bytes) return "—";
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

export default function FiscalYearSwitchPage() {
  const [backups, setBackups] = useState([]);
  const [backupDir, setBackupDir] = useState("");
  const [active, setActive] = useState(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fiscalSwitchService.getBackups();
      const list = res?.backups || [];
      setBackups(list);
      setBackupDir(res?.backupDir || "");
      setActive(res?.active || null);
      if (!selected && list.length) setSelected(list[0].name);
    } catch (e) {
      setError(e.message || "تعذّر تحميل النسخ الاحتياطية");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const onSwitch = async () => {
    if (!selected) {
      setError("يرجى اختيار نسخة احتياطية");
      return;
    }
    if (!confirm(`تبديل قاعدة البيانات إلى:\n${selected}`)) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      await fiscalSwitchService.switchBackup({ filename: selected });
      window.location.reload();
    } catch (e) {
      setError(e.message || "فشل التبديل");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout title="تبديل السنة المالية">
      <Card style={{ maxWidth: 640, margin: "0 auto" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 800, marginBottom: 8 }}>
          تبديل السنة المالية
        </h2>
        <p style={{ fontSize: ".86rem", color: "var(--text-secondary)", lineHeight: 1.65, marginBottom: 18 }}>
          اختر نسخة احتياطية للاطلاع على بيانات سنة سابقة.
        </p>

        {backupDir && (
          <div
            style={{
              marginBottom: 14,
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-input)",
              border: "1px solid var(--border)",
              fontSize: ".78rem",
              color: "var(--text-muted)",
              lineHeight: 1.6,
              wordBreak: "break-all",
            }}
          >
            <div style={{ marginBottom: 4, color: "var(--text-secondary)" }}>مجلد النسخ على هذا الجهاز:</div>
            <code style={{ color: "var(--text-primary)", fontSize: ".76rem" }}>{backupDir}</code>
          </div>
        )}

        {active?.filename && (
          <div
            className="alert alert-success"
            style={{ marginBottom: 14, fontSize: ".84rem" }}
          >
            النسخة النشطة حالياً: <strong>{active.filename}</strong>
            {active.switchedAt ? ` — ${formatDate(active.switchedAt)}` : ""}
          </div>
        )}

        {error && (
          <div className="alert alert-error" style={{ marginBottom: 14 }}>
            ⚠ {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <span className="spinner" />
          </div>
        ) : backups.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>
            لا توجد نسخ احتياطية — أنشئ نسخة من قسم السنة المالية أولاً
          </div>
        ) : (
          <>
            <label style={{ display: "block", fontSize: ".8rem", color: "var(--text-secondary)", marginBottom: 6 }}>
              النسخ الاحتياطية المتاحة
            </label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                marginBottom: 10,
                background: "var(--bg-input)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                color: "var(--text-primary)",
                fontFamily: "var(--font-main)",
                fontSize: ".9rem",
              }}
            >
              {backups.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name} — {formatDate(b.date)} — {formatSize(b.size)}
                  {b.folder ? ` [${b.folder}]` : ""}
                </option>
              ))}
            </select>

            {selected && (() => {
              const b = backups.find((x) => x.name === selected);
              if (!b) return null;
              return (
                <div style={{ fontSize: ".8rem", color: "var(--text-muted)", marginBottom: 16 }}>
                  المسار: {b.path || backupDir} · الحجم: {formatSize(b.size)} · التاريخ: {formatDate(b.date)}
                </div>
              );
            })()}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button onClick={onSwitch} loading={saving}>
                تنفيذ التبديل
              </Button>
              <Button variant="secondary" onClick={load} disabled={saving}>
                تحديث القائمة
              </Button>
            </div>
          </>
        )}
      </Card>
    </AppLayout>
  );
}
