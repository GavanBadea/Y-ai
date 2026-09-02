// ============================================================
//  controllers/userRoles.controller.js
//  جدول: UserRoles_tbl
//
//  الأعمدة الفعلية في قاعدة البيانات:
//    id_Roles, TypeRoles,
//    can_view_reports, can_manage_users, can_edit_stock,
//    can_view_materials, can_add_materials, can_edit_materials,
//    can_delete_materials, can_add_purchase, can_add_sales,
//    can_edit_settings, can_manage_finance
//
//  ⚠️  جميع العمليات محمية بـ onlyAdmin في الـ Route
// ============================================================
const db = require("../db");

// ── الأعمدة الصحيحة مطابقة للجدول الفعلي ─────────────────
const PERMISSION_COLUMNS = [
  "can_view_reports",
  "can_manage_users",
  "can_edit_stock",
  "can_view_materials",
  "can_add_materials",
  "can_edit_materials",
  "can_delete_materials",
  "can_add_purchase",
  "can_add_sales",
  "can_edit_settings",
  "can_manage_finance",
  "can_kiosk_scan",
];

// ── getAll ─────────────────────────────────────────────────
const getAll = async (_req, res) => {
  try {
    const rows = await db.query(`SELECT * FROM UserRoles_tbl ORDER BY id_Roles`);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── getOne ─────────────────────────────────────────────────
const getOne = async (req, res) => {
  try {
    const role = await db.queryOne(
      `SELECT * FROM UserRoles_tbl WHERE id_Roles = ?`, [req.params.id]
    );
    if (!role) return res.status(404).json({ success: false, message: "الدور غير موجود" });
    const { cnt } = await db.queryOne(
      `SELECT COUNT(*) AS cnt FROM Users_tbl WHERE id_Roles = ?`, [req.params.id]
    );
    res.json({ success: true, data: { ...role, usersCount: cnt } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── create ─────────────────────────────────────────────────
const create = async (req, res) => {
  const { TypeRoles, ...perms } = req.body;
  if (!TypeRoles)
    return res.status(400).json({ success: false, message: "اسم الدور (TypeRoles) مطلوب" });

  const permValues = PERMISSION_COLUMNS.map((col) => (perms[col] ? 1 : 0));
  const colNames   = PERMISSION_COLUMNS.join(", ");
  const colPlaces  = PERMISSION_COLUMNS.map(() => "?").join(", ");

  try {
    const r = await db.run(
      `INSERT INTO UserRoles_tbl (TypeRoles, ${colNames}) VALUES (?, ${colPlaces})`,
      [TypeRoles, ...permValues]
    );
    res.status(201).json({ success: true, message: "تم إضافة الدور", id: r.lastID });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── update ─────────────────────────────────────────────────
const update = async (req, res) => {
  if (Number(req.params.id) === 1)
    return res.status(400).json({ success: false, message: "لا يمكن تعديل دور مدير البرنامج" });

  const { TypeRoles, ...perms } = req.body;
  const setClauses = [];
  const values     = [];

  if (TypeRoles) { setClauses.push("TypeRoles = ?"); values.push(TypeRoles); }

  PERMISSION_COLUMNS.forEach((col) => {
    if (perms[col] !== undefined) {
      setClauses.push(`${col} = ?`);
      values.push(perms[col] ? 1 : 0);
    }
  });

  if (!setClauses.length)
    return res.status(400).json({ success: false, message: "لم يُرسَل أي حقل للتعديل" });

  values.push(req.params.id);
  try {
    const r = await db.run(
      `UPDATE UserRoles_tbl SET ${setClauses.join(", ")} WHERE id_Roles = ?`, values
    );
    if (!r.changes) return res.status(404).json({ success: false, message: "الدور غير موجود" });
    res.json({ success: true, message: "تم تعديل الدور" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── remove ─────────────────────────────────────────────────
const remove = async (req, res) => {
  if (Number(req.params.id) === 1)
    return res.status(400).json({ success: false, message: "لا يمكن حذف دور مدير البرنامج" });
  try {
    const { cnt } = await db.queryOne(
      `SELECT COUNT(*) AS cnt FROM Users_tbl WHERE id_Roles = ?`, [req.params.id]
    );
    if (cnt > 0)
      return res.status(400).json({
        success: false,
        message: `لا يمكن الحذف. يوجد ${cnt} مستخدم مرتبط بهذا الدور.`,
      });
    const r = await db.run(`DELETE FROM UserRoles_tbl WHERE id_Roles = ?`, [req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "الدور غير موجود" });
    res.json({ success: true, message: "تم حذف الدور" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── assignRole ─────────────────────────────────────────────
const assignRole = async (req, res) => {
  const { id_User, id_Roles } = req.body;
  if (!id_User || !id_Roles)
    return res.status(400).json({ success: false, message: "id_User و id_Roles مطلوبان" });
  if (Number(id_Roles) === 1)
    return res.status(400).json({ success: false, message: "لا يمكن تعيين دور مدير البرنامج عبر هذا المسار" });
  try {
    const r = await db.run(
      `UPDATE Users_tbl SET id_Roles = ? WHERE id_User = ?`, [id_Roles, id_User]
    );
    if (!r.changes) return res.status(404).json({ success: false, message: "المستخدم غير موجود" });
    res.json({ success: true, message: "تم تعيين الدور للمستخدم" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── getPermissionsList — قائمة الصلاحيات المتاحة ──────────
const getPermissionsList = (_req, res) => {
  const labels = {
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
  res.json({
    success: true,
    data   : PERMISSION_COLUMNS.map((col) => ({ column: col, label: labels[col] || col })),
  });
};

module.exports = { getAll, getOne, create, update, remove, assignRole, getPermissionsList };
