import { useState, useCallback } from "react";
import { ModalOverlay } from "@/components/ui/Modal";
import AppLayout from "@/components/layout/AppLayout";
import Button from "@/components/ui/Button";
import { useApi } from "@/hooks/useApi";
import { useLanguage } from "@/context/LanguageContext";
import { auditService } from "@/services/api";

const inp = {
  padding: "8px 10px",
  background: "var(--bg-input)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-main)",
  fontSize: ".85rem",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

function parseMaterials(notes = "") {
  const text = String(notes || "");
  const chunk = text.includes("مواد:")
    ? text.split("مواد:")[1]
    : text.includes(" | ")
      ? text
      : "";
  if (!chunk) return [];
  return chunk
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.+?):\s*([\d.]+)\s*(.*)$/);
      if (!m) return { name: part, qty: "", unit: "" };
      return { name: m[1].trim(), qty: m[2], unit: (m[3] || "").trim() };
    });
}

function actionLabel(row, t) {
  const f = String(row.FieldName || "").toUpperCase();
  const n = String(row.Notes || "");
  if (f.includes("CREATE") || n.includes("إنشاء") || n.includes("CREATE")) return t("audit.actionCreate");
  if (f.includes("DELETE") || n.includes("حذف") || n.includes("DELETE")) return t("audit.actionDelete");
  return t("audit.actionUpdate");
}

export default function AuditLogPage() {
  const { t } = useLanguage();
  const [filters, setFilters] = useState({
    q: "",
    id_User: "",
    TableName: "",
    action: "",
    from: "",
    to: "",
    limit: 200,
  });
  const [applied, setApplied] = useState(filters);
  const [detail, setDetail] = useState(null);

  const { data: metaTables } = useApi(() => auditService.getTables(), []);
  const { data: metaUsers } = useApi(() => auditService.getUsers(), []);

  const { data, loading, error, refetch } = useApi(
    () => auditService.getAll(applied),
    [applied]
  );

  const rows = data?.data || [];
  const tables = metaTables?.data || [];
  const users = metaUsers?.data || [];

  const apply = useCallback(() => setApplied({ ...filters }), [filters]);

  return (
    <AppLayout title={t("pages.auditLog")}>
      <p style={{ color: "var(--text-secondary)", fontSize: ".88rem", marginBottom: 10 }}>
        {t("audit.subtitle")} — {t("audit.enableHint")}
      </p>
      <div
        style={{
          marginBottom: 16,
          padding: "12px 14px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          fontSize: ".82rem",
          color: "var(--text-secondary)",
          lineHeight: 1.65,
        }}
      >
        <strong style={{ color: "var(--text-primary)" }}>كيف يعمل السجل؟</strong>
        <br />
        يُسجَّل تلقائياً عند إنشاء أو حذف فواتير المشتريات/المبيعات وتعديل المخزون والتكلفة (من حساب المدير).
        كل سطر = عملية واحدة: المستخدم، الجدول، رقم السجل، نوع الحقل، القيمة القديمة/الجديدة.
        <br />
        <span style={{ color: "var(--text-muted)" }}>
          إذا كان الجدول فارغاً: نفّذ عملية جديدة بعد إعادة تشغيل الخادم، أو امسح فلاتر التاريخ والبحث.
          الصفحة للمدير فقط (id_Roles = 1).
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
          marginBottom: 14,
          padding: 14,
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
        }}
      >
        <div style={{ gridColumn: "1 / -1" }}>
          <input
            type="search"
            value={filters.q}
            onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            placeholder={t("audit.searchPlaceholder")}
            style={inp}
          />
        </div>
        <select
          value={filters.id_User}
          onChange={(e) => setFilters((p) => ({ ...p, id_User: e.target.value }))}
          style={inp}
        >
          <option value="">{t("audit.filterUser")} — {t("common.all")}</option>
          {users.map((u) => (
            <option key={u.id_User} value={u.id_User}>
              {u.UserName}
            </option>
          ))}
        </select>
        <select
          value={filters.TableName}
          onChange={(e) => setFilters((p) => ({ ...p, TableName: e.target.value }))}
          style={inp}
        >
          <option value="">{t("audit.filterTable")} — {t("common.all")}</option>
          {tables.map((tb) => (
            <option key={tb} value={tb}>
              {tb}
            </option>
          ))}
        </select>
        <select
          value={filters.action}
          onChange={(e) => setFilters((p) => ({ ...p, action: e.target.value }))}
          style={inp}
        >
          <option value="">{t("audit.actionAll")}</option>
          <option value="CREATE">{t("audit.actionCreate")}</option>
          <option value="UPDATE">{t("audit.actionUpdate")}</option>
          <option value="DELETE">{t("audit.actionDelete")}</option>
        </select>
        <input
          type="date"
          value={filters.from}
          onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))}
          style={inp}
          title={t("common.from")}
        />
        <input
          type="date"
          value={filters.to}
          onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))}
          style={inp}
          title={t("common.to")}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button size="sm" onClick={apply}>
            🔍 {t("common.search")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const cleared = { q: "", id_User: "", TableName: "", action: "", from: "", to: "", limit: 200 };
              setFilters(cleared);
              setApplied(cleared);
            }}
          >
            {t("common.clear")}
          </Button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: 12 }}>
          ⚠ {error}
        </div>
      )}

      <div style={{ fontSize: ".8rem", color: "var(--text-muted)", marginBottom: 8 }}>
        {rows.length} {t("audit.results")}
      </div>

      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          overflow: "auto",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
          <thead>
            <tr style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
              {[t("common.date"), t("common.time"), t("common.user"), t("common.table"), t("common.action"), t("common.record"), ""].map(
                (h, i) => (
                  <th
                    key={i}
                    style={{
                      padding: "10px 12px",
                      textAlign: "right",
                      color: "var(--text-muted)",
                      fontWeight: 700,
                      fontSize: ".68rem",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ padding: 40, textAlign: "center" }}>
                  <span className="spinner" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                  {t("common.noData")}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id_AuditLog}
                  style={{ borderBottom: "1px solid var(--border-subtle)", cursor: "pointer" }}
                  onClick={async () => {
                    try {
                      const full = await auditService.getOne(r.id_AuditLog);
                      setDetail(full?.data || r);
                    } catch {
                      setDetail(r);
                    }
                  }}
                >
                  <td style={{ padding: "9px 12px" }}>{r.ChangeDate}</td>
                  <td style={{ padding: "9px 12px", fontFamily: "var(--font-mono)" }}>{r.ChangeTime}</td>
                  <td style={{ padding: "9px 12px", fontWeight: 600 }}>{r.UserName}</td>
                  <td style={{ padding: "9px 12px", fontFamily: "var(--font-mono)", fontSize: ".78rem" }}>{r.TableName}</td>
                  <td style={{ padding: "9px 12px" }}>{actionLabel(r, t)}</td>
                  <td style={{ padding: "9px 12px", fontFamily: "var(--font-mono)" }}>{r.RecordID}</td>
                  <td style={{ padding: "9px 12px", color: "var(--accent)", fontSize: ".76rem" }}>{t("audit.viewDetails")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <ModalOverlay onClose={() => setDetail(null)} zIndex={200}>
          <div
            role="dialog"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: 20,
              maxWidth: 520,
              width: "100%",
              maxHeight: "80vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 14px", fontSize: "1rem" }}>{t("audit.viewDetails")}</h3>
            {[
              [t("common.user"), detail.UserName],
              [t("common.date"), `${detail.ChangeDate} ${detail.ChangeTime}`],
              [t("common.table"), detail.TableName],
              [t("common.field"), detail.FieldName],
              [t("common.record"), detail.RecordID],
              [t("common.action"), actionLabel(detail, t)],
              [t("common.oldValue"), detail.OldValue || "—"],
              [t("common.newValue"), detail.NewValue || "—"],
              [t("common.notes"), detail.Notes || "—"],
            ].map(([k, v]) => (
              <div key={k} style={{ marginBottom: 10, fontSize: ".85rem" }}>
                <div style={{ color: "var(--text-muted)", fontSize: ".72rem", marginBottom: 3 }}>{k}</div>
                <div style={{ wordBreak: "break-word" }}>{v}</div>
              </div>
            ))}
            {(() => {
              const mats =
                detail.materials?.length > 0
                  ? detail.materials
                  : parseMaterials(detail.Notes).length > 0
                    ? parseMaterials(detail.Notes)
                    : parseMaterials(detail.OldValue);
              return mats.length > 0 ? (
              <div style={{ marginBottom: 12 }}>
                <div style={{ color: "var(--text-muted)", fontSize: ".72rem", marginBottom: 6 }}>
                  المواد والكميات
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
                  <thead>
                    <tr style={{ background: "var(--bg-surface)" }}>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>المادة</th>
                      <th style={{ padding: "6px 8px", textAlign: "left" }}>الكمية</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>الوحدة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mats.map((m, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ padding: "6px 8px" }}>{m.name}</td>
                        <td style={{ padding: "6px 8px", fontFamily: "var(--font-mono)", textAlign: "left" }}>{m.qty}</td>
                        <td style={{ padding: "6px 8px", color: "var(--text-muted)" }}>{m.unit || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              ) : null;
            })()}
            <Button variant="secondary" size="sm" onClick={() => setDetail(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        </ModalOverlay>
      )}
    </AppLayout>
  );
}
