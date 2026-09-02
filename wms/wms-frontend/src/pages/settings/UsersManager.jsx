// src/pages/settings/UsersManager.jsx
// إدارة المستخدمين والصلاحيات — للمدير فقط
import { useState }  from "react";
import AppLayout      from "@/components/layout/AppLayout";
import { Card }       from "@/components/ui/Card";
import { Badge }      from "@/components/ui/Card";
import Button         from "@/components/ui/Button";
import Input          from "@/components/ui/Input";
import Modal          from "@/components/ui/Modal";
import { useApi, useAction } from "@/hooks/useApi";
import api            from "@/services/api";

// ── وصف الصلاحيات بالعربي ──────────────────────────────────
const PERM_LABELS = {
  can_view_reports    : "عرض التقارير",
  can_manage_users    : "إدارة المستخدمين",
  can_edit_stock      : "تعديل المخزون",
  can_view_materials  : "عرض المواد",
  can_add_materials   : "إضافة مواد",
  can_edit_materials  : "تعديل مواد",
  can_delete_materials: "حذف مواد",
  can_add_purchase    : "إضافة مشتريات",
  can_add_sales       : "إضافة مبيعات",
  can_edit_settings   : "تعديل الإعدادات",
  can_manage_finance  : "إدارة المالية",
  can_kiosk_scan      : "شاشة فحص الأسعار (كiosk)",
};
const PERM_KEYS = Object.keys(PERM_LABELS);

// ══════════════════════════════════════════════════════════
export default function UsersManager() {
  const [tab, setTab] = useState("users"); // "users" | "roles"

  return (
    <AppLayout title="إدارة المستخدمين والصلاحيات">
      {/* ── التبويبات ──────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {[
          { id: "users", label: "👤 المستخدمون" },
          { id: "roles", label: "🔑 الأدوار والصلاحيات" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding     : "10px 20px",
              background  : "none",
              border      : "none",
              borderBottom: `2px solid ${tab === t.id ? "var(--accent)" : "transparent"}`,
              color       : tab === t.id ? "var(--accent)" : "var(--text-secondary)",
              fontWeight  : tab === t.id ? 700 : 500,
              fontSize    : ".9rem",
              cursor      : "pointer",
              fontFamily  : "var(--font-main)",
              marginBottom: -1,
              transition  : "all var(--transition)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "users" ? <UsersTab /> : <RolesTab />}
    </AppLayout>
  );
}

// ══════════════════════════════════════════════════════════
//  تبويب المستخدمين
// ══════════════════════════════════════════════════════════
function UsersTab() {
  const [showForm, setShowForm]   = useState(false);
  const [editUser, setEditUser]   = useState(null);
  const [formMsg,  setFormMsg]    = useState("");

  const { data: usersData, loading, error, refetch } = useApi(() => api.get("/users"));
  const { data: rolesData }                          = useApi(() => api.get("/roles"));
  const { loading: saving, execute }                 = useAction();

  const users = usersData?.data || [];
  const roles = rolesData?.data || [];

  const openCreate = () => { setEditUser(null); setFormMsg(""); setShowForm(true); };
  const openEdit   = (u)  => { setEditUser(u);  setFormMsg(""); setShowForm(true); };
  const closeForm  = ()   => { setShowForm(false); setEditUser(null); setFormMsg(""); };

  const handleDelete = async (id, name) => {
    if (!confirm(`حذف المستخدم "${name}"؟`)) return;
    await execute(() => api.delete(`/users/${id}`), {
      onSuccess: refetch,
      onError  : (e) => alert(`خطأ: ${e}`),
    });
  };

  const handleSave = async (data) => {
    await execute(
      () => editUser
        ? api.put(`/users/${editUser.id_User}`, data)
        : api.post("/users", data),
      {
        onSuccess: () => { refetch(); closeForm(); },
        onError  : (e) => setFormMsg(e),
      }
    );
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <Button onClick={openCreate}>+ إضافة مستخدم</Button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>⚠ {error}</div>}

      <Card padding="0">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".88rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["#", "اسم المستخدم", "الدور", "إجراءات"].map((h, i) => (
                <th key={i} style={{ padding: "11px 16px", textAlign: "right", color: "var(--text-secondary)", fontWeight: 700, fontSize: ".76rem", textTransform: "uppercase" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={{ textAlign: "center", padding: 40 }}><span className="spinner" /></td></tr>
            ) : users.map((u) => (
              <tr key={u.id_User} style={{ borderBottom: "1px solid var(--border-subtle)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}>
                <td style={{ padding: "11px 16px", fontFamily: "var(--font-mono)", fontSize: ".78rem", color: "var(--text-muted)" }}>{u.id_User}</td>
                <td style={{ padding: "11px 16px", fontWeight: 700 }}>{u.UserName}</td>
                <td style={{ padding: "11px 16px" }}>
                  <Badge
                    label={u.TypeRoles || "—"}
                    variant={u.id_Roles === 1 ? "accent" : "default"}
                  />
                </td>
                <td style={{ padding: "11px 16px" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button size="sm" variant="secondary" onClick={() => openEdit(u)}>تعديل</Button>
                    {u.id_Roles !== 1 && (
                      <Button size="sm" variant="danger" onClick={() => handleDelete(u.id_User, u.UserName)}>حذف</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {showForm && (
        <UserFormModal
          user={editUser}
          roles={roles}
          onClose={closeForm}
          onSave={handleSave}
          saving={saving}
          serverError={formMsg}
        />
      )}
    </>
  );
}

function UserFormModal({ user, roles, onClose, onSave, saving, serverError }) {
  const [form, setForm] = useState({
    UserName: user?.UserName || "",
    Password: "",
    id_Roles: user?.id_Roles || "",
  });
  const [err, setErr] = useState({});

  const validate = () => {
    const e = {};
    if (!form.UserName.trim()) e.UserName = "الاسم مطلوب";
    if (!user && !form.Password) e.Password = "كلمة المرور مطلوبة";
    if (form.Password && form.Password.length < 6) e.Password = "6 أحرف على الأقل";
    if (!form.id_Roles) e.id_Roles = "الدور مطلوب";
    setErr(e);
    return !Object.keys(e).length;
  };

  return (
    <Modal
      title={user ? "تعديل المستخدم" : "إضافة مستخدم جديد"}
      onClose={onClose}
      width="min(460px,95vw)"
    >
        {serverError && <div className="alert alert-error" style={{ marginBottom: 16 }}>⚠ {serverError}</div>}

        <form onSubmit={(e) => { e.preventDefault(); if (validate()) onSave(form); }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Input label="اسم المستخدم *" value={form.UserName}
              onChange={(v) => setForm((p) => ({ ...p, UserName: v }))}
              error={err.UserName} autoFocus />
            <Input
              label={user ? "كلمة المرور الجديدة (اتركها فارغة للإبقاء على القديمة)" : "كلمة المرور *"}
              type="password" value={form.Password}
              onChange={(v) => setForm((p) => ({ ...p, Password: v }))}
              error={err.Password} placeholder="6 أحرف على الأقل" />

            <div>
              <label style={{ fontSize: ".88rem", fontWeight: 600, color: err.id_Roles ? "var(--danger)" : "var(--text-secondary)", display: "block", marginBottom: 6 }}>
                الدور *
              </label>
              <select
                value={form.id_Roles}
                onChange={(e) => setForm((p) => ({ ...p, id_Roles: e.target.value }))}
                style={{ width: "100%", background: "var(--bg-input)", border: `1px solid ${err.id_Roles ? "var(--danger)" : "var(--border)"}`, borderRadius: "var(--radius-md)", color: "var(--text-primary)", padding: "10px 14px", fontFamily: "var(--font-main)", fontSize: ".9rem" }}
              >
                <option value="">اختر دوراً</option>
                {roles.filter((r) => r.id_Roles !== 1).map((r) => (
                  <option key={r.id_Roles} value={r.id_Roles}>{r.TypeRoles}</option>
                ))}
              </select>
              {err.id_Roles && <span style={{ fontSize: ".8rem", color: "var(--danger)" }}>{err.id_Roles}</span>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 24 }}>
            <Button variant="secondary" onClick={onClose}>إلغاء</Button>
            <Button type="submit" loading={saving}>{user ? "حفظ التعديلات" : "إضافة"}</Button>
          </div>
        </form>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════
//  تبويب الأدوار والصلاحيات
// ══════════════════════════════════════════════════════════
function RolesTab() {
  const [showForm, setShowForm] = useState(false);
  const [editRole, setEditRole] = useState(null);
  const [formMsg,  setFormMsg ] = useState("");

  const { data: rolesData, loading, error, refetch } = useApi(() => api.get("/roles"));
  const { loading: saving, execute }                 = useAction();

  const roles = rolesData?.data || [];

  const openCreate = () => { setEditRole(null); setFormMsg(""); setShowForm(true); };
  const openEdit   = (r) => { setEditRole(r);   setFormMsg(""); setShowForm(true); };
  const closeForm  = ()  => { setShowForm(false); setEditRole(null); };

  const handleDelete = async (id, name) => {
    if (!confirm(`حذف الدور "${name}"؟`)) return;
    await execute(() => api.delete(`/roles/${id}`), {
      onSuccess: refetch,
      onError  : (e) => alert(`خطأ: ${e}`),
    });
  };

  const handleSave = async (data) => {
    await execute(
      () => editRole
        ? api.put(`/roles/${editRole.id_Roles}`, data)
        : api.post("/roles", data),
      { onSuccess: () => { refetch(); closeForm(); }, onError: (e) => setFormMsg(e) }
    );
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <Button onClick={openCreate}>+ إضافة دور جديد</Button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>⚠ {error}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 40 }}><span className="spinner" /></div>
        ) : roles.map((role) => (
          <Card key={role.id_Roles}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Badge label={role.id_Roles === 1 ? "مدير البرنامج" : role.TypeRoles}
                  variant={role.id_Roles === 1 ? "accent" : "default"} />
                <span style={{ fontSize: ".78rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  #{role.id_Roles}
                </span>
              </div>
              {role.id_Roles !== 1 && (
                <div style={{ display: "flex", gap: 8 }}>
                  <Button size="sm" variant="secondary" onClick={() => openEdit(role)}>تعديل</Button>
                  <Button size="sm" variant="danger"    onClick={() => handleDelete(role.id_Roles, role.TypeRoles)}>حذف</Button>
                </div>
              )}
            </div>

            {/* شبكة الصلاحيات */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 8 }}>
              {PERM_KEYS.map((key) => (
                <div key={key} style={{
                  display    : "flex", alignItems: "center", gap: 7,
                  padding    : "6px 10px",
                  background : role[key] ? "var(--success-bg)" : "var(--bg-hover)",
                  border     : `1px solid ${role[key] ? "var(--success)" : "var(--border)"}`,
                  borderRadius: "var(--radius-sm)",
                }}>
                  <span style={{ fontSize: ".8rem", color: role[key] ? "var(--success)" : "var(--text-muted)" }}>
                    {role[key] ? "✓" : "✗"}
                  </span>
                  <span style={{ fontSize: ".78rem", color: role[key] ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {PERM_LABELS[key]}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {showForm && (
        <RoleFormModal
          role={editRole}
          onClose={closeForm}
          onSave={handleSave}
          saving={saving}
          serverError={formMsg}
        />
      )}
    </>
  );
}

function RoleFormModal({ role, onClose, onSave, saving, serverError }) {
  const initPerms = Object.fromEntries(PERM_KEYS.map((k) => [k, role ? !!role[k] : false]));
  const [TypeRoles, setTypeName] = useState(role?.TypeRoles || "");
  const [perms, setPerms]        = useState(initPerms);
  const [nameErr, setNameErr]    = useState("");

  const toggleAll = (val) => setPerms(Object.fromEntries(PERM_KEYS.map((k) => [k, val])));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!TypeRoles.trim()) { setNameErr("اسم الدور مطلوب"); return; }
    onSave({ TypeRoles, ...Object.fromEntries(Object.entries(perms).map(([k, v]) => [k, v ? 1 : 0])) });
  };

  return (
    <Modal
      title={role ? "تعديل الدور" : "إضافة دور جديد"}
      onClose={onClose}
      width="min(560px,95vw)"
    >
        {serverError && <div className="alert alert-error" style={{ marginBottom: 16 }}>⚠ {serverError}</div>}

        <form onSubmit={handleSubmit}>
          <Input label="اسم الدور *" value={TypeRoles}
            onChange={(v) => { setTypeName(v); setNameErr(""); }}
            error={nameErr} placeholder="مثال: محاسب، مندوب..." autoFocus
            style={{ marginBottom: 20 }} />

          {/* شبكة الصلاحيات */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: ".85rem", fontWeight: 700, color: "var(--text-secondary)" }}>الصلاحيات</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => toggleAll(true)}
                  style={{ fontSize: ".75rem", color: "var(--success)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-main)" }}>
                  تحديد الكل
                </button>
                <button type="button" onClick={() => toggleAll(false)}
                  style={{ fontSize: ".75rem", color: "var(--danger)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-main)" }}>
                  إلغاء الكل
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {PERM_KEYS.map((key) => (
                <label key={key} style={{
                  display    : "flex", alignItems: "center", gap: 10,
                  padding    : "9px 12px",
                  background : perms[key] ? "var(--success-bg)" : "var(--bg-hover)",
                  border     : `1px solid ${perms[key] ? "var(--success)" : "var(--border)"}`,
                  borderRadius: "var(--radius-sm)",
                  cursor     : "pointer", transition: "all var(--transition)",
                }}>
                  <input
                    type="checkbox"
                    checked={perms[key]}
                    onChange={(e) => setPerms((p) => ({ ...p, [key]: e.target.checked }))}
                    style={{ accentColor: "var(--success)", width: 15, height: 15 }}
                  />
                  <span style={{ fontSize: ".82rem", color: perms[key] ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {PERM_LABELS[key]}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={onClose}>إلغاء</Button>
            <Button type="submit" loading={saving}>{role ? "حفظ التعديلات" : "إضافة الدور"}</Button>
          </div>
        </form>
    </Modal>
  );
}
