// ============================================================
//  controllers/users.controller.js
//
//  الجدول: UserRoles_tbl
//  أعمدة الصلاحيات الفعلية:
//    can_view_reports, can_manage_users, can_edit_stock,
//    can_view_materials, can_add_materials, can_edit_materials,
//    can_delete_materials, can_add_purchase, can_add_sales,
//    can_edit_settings, can_manage_finance
// ============================================================
const db     = require("../db");
const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");
const { hasRealUsers, generateSetupToken } = require("../middleware/auth");
const { decryptPayload, isVerifyPassword, saveAdminRecovery } = require("../utils/adminRecovery");

// ── الأعمدة الصحيحة مطابقة للجدول الفعلي ─────────────────
const ALL_PERMISSIONS = [
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

// ──────────────────────────────────────────────────────────
//  checkFirstRun — للكشف عن أول تشغيل وإرجاع setupToken
// ──────────────────────────────────────────────────────────
const checkFirstRun = async (req, res) => {
  try {
    const hasUsers = await hasRealUsers();
    if (hasUsers) {
      return res.json({ success: true, isFirstRun: false });
    }
    const setupToken = generateSetupToken();
    return res.json({ success: true, isFirstRun: true, setupToken });
  } catch (e) {
    console.error("checkFirstRun error:", e.message);
    res.status(503).json({
      success    : false,
      isFirstRun : false,
      message    : "تعذر التحقق من قاعدة البيانات — حاول إعادة تشغيل البرنامج",
    });
  }
};

// ──────────────────────────────────────────────────────────
//  login
// ──────────────────────────────────────────────────────────
const login = async (req, res) => {
  const { UserName, Password } = req.body;
  if (!UserName || !Password)
    return res.status(400).json({ success: false, message: "اسم المستخدم وكلمة المرور مطلوبان" });

  try {
    const user = await db.queryOne(
      `SELECT u.id_User, u.UserName, u.id_Roles,
              r.TypeRoles,
              r.can_view_reports,
              r.can_manage_users,
              r.can_edit_stock,
              r.can_view_materials,
              r.can_add_materials,
              r.can_edit_materials,
              r.can_delete_materials,
              r.can_add_purchase,
              r.can_add_sales,
              r.can_edit_settings,
              r.can_manage_finance,
              r.can_kiosk_scan,
              u.Password
       FROM Users_tbl u
       LEFT JOIN UserRoles_tbl r ON r.id_Roles = u.id_Roles
       WHERE u.UserName = ?`,
      [UserName]
    );
    if (!user)
      return res.status(401).json({ success: false, message: "اسم المستخدم غير موجود" });

    const ok = await bcrypt.compare(Password, user.Password);
    if (!ok)
      return res.status(401).json({ success: false, message: "كلمة المرور غير صحيحة" });

    const secret = process.env.JWT_SECRET?.trim() || (process.env.NODE_ENV === "development" ? "dev_jwt_secret_change_in_production" : "");
    if (!secret) {
      return res.status(500).json({
        success: false,
        message: "JWT_SECRET غير مضبوط — أعد تشغيل البرنامج أو راجع app\\.env",
      });
    }

    const token = jwt.sign(
      { id_User: user.id_User, UserName: user.UserName, id_Roles: user.id_Roles },
      secret,
      { expiresIn: "8h" }
    );

    // ── بناء كائن الصلاحيات (boolean صريح لكل عمود) ────────
    // المدير (id_Roles=1) يمتلك كل الصلاحيات تلقائياً
    const isAdmin = Number(user.id_Roles) === 1;
    const permissions = {};
    ALL_PERMISSIONS.forEach((col) => {
      permissions[col] = isAdmin ? true : !!user[col];
    });

    if (isAdmin) {
      try {
        await saveAdminRecovery(db, user.UserName, Password);
      } catch (e) {
        console.warn("AdminRecovery save on login:", e.message);
      }
    }

    res.json({
      success: true, isFirstRun: false,
      message: "تم تسجيل الدخول بنجاح",
      token,
      user: {
        id_User  : user.id_User,
        UserName : user.UserName,
        id_Roles : user.id_Roles,
        TypeRoles: user.TypeRoles,
        ...permissions,          // ← الصلاحيات مضمّنة في كائن المستخدم
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ──────────────────────────────────────────────────────────
//  setupAdmin — إنشاء المدير الأول
//  يدرج في UserRoles_tbl بالأعمدة الفعلية فقط
// ──────────────────────────────────────────────────────────
const setupAdmin = async (req, res) => {
  const { AdminUserName, AdminPassword } = req.body;

  if (!AdminUserName || !AdminPassword)
    return res.status(400).json({
      success: false,
      message: "مطلوب اسم المدير وكلمة المرور",
      example: { AdminUserName: "admin", AdminPassword: "P@ssword123" },
    });

  if (AdminPassword.length < 6)
    return res.status(400).json({ success: false, message: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });

  if (await hasRealUsers())
    return res.status(409).json({ success: false, message: "يوجد مدير مسجّل مسبقاً. لا يمكن تكرار الإعداد." });

  try {
    const hashedPassword = await bcrypt.hash(AdminPassword, 12);

    const permCols   = ALL_PERMISSIONS.join(", ");
    const permValues = ALL_PERMISSIONS.map(() => 1);
    const permPlaces = ALL_PERMISSIONS.map(() => "?").join(", ");

    const existingAdminRole = await db.queryOne(
      `SELECT id_Roles FROM UserRoles_tbl
       WHERE TypeRoles = 'مدير البرنامج' OR id_Roles = 1
       ORDER BY id_Roles LIMIT 1`
    );
    const adminRoleId = existingAdminRole?.id_Roles;

    const steps = adminRoleId
      ? [{
          sql: `INSERT INTO Users_tbl (UserName, Password, id_Roles) VALUES (?, ?, ?)`,
          params: [AdminUserName, hashedPassword, adminRoleId],
        }]
      : [
          {
            sql: `INSERT INTO UserRoles_tbl (id_Roles, TypeRoles, ${permCols})
                  VALUES (1, 'مدير البرنامج', ${permPlaces})`,
            params: permValues,
          },
          {
            sql: `INSERT INTO Users_tbl (UserName, Password, id_Roles) VALUES (?, ?, 1)`,
            params: [AdminUserName, hashedPassword],
          },
        ];

    await db.runTransaction(steps);

    const roleId = adminRoleId || 1;
    await saveAdminRecovery(db, AdminUserName, AdminPassword);

    res.status(201).json({
      success : true,
      message : `✅ تم إنشاء المدير وإغلاق حساب الإعداد (Yara) نهائياً`,
      admin   : { UserName: AdminUserName, role: "مدير البرنامج", id_Roles: roleId },
      nextStep: `POST /api/users/login  →  { "UserName": "${AdminUserName}", "Password": "***" }`,
    });
  } catch (e) {
    if (e.message?.includes("UNIQUE"))
      return res.status(409).json({ success: false, message: "اسم المستخدم مستخدم مسبقاً، اختر اسماً آخر" });
    res.status(500).json({ success: false, message: e.message });
  }
};

// ──────────────────────────────────────────────────────────
//  CRUD — إدارة المستخدمين (للمدير فقط)
// ──────────────────────────────────────────────────────────
const getAll = async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT u.id_User, u.UserName, u.id_Roles, r.TypeRoles
       FROM Users_tbl u
       LEFT JOIN UserRoles_tbl r ON r.id_Roles = u.id_Roles
       ORDER BY u.id_User`
    );
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(
      `SELECT u.id_User, u.UserName, u.id_Roles, r.TypeRoles
       FROM Users_tbl u
       LEFT JOIN UserRoles_tbl r ON r.id_Roles = u.id_Roles
       WHERE u.id_User = ?`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ success: false, message: "المستخدم غير موجود" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const create = async (req, res) => {
  const { UserName, Password, id_Roles } = req.body;
  if (!UserName || !Password || !id_Roles)
    return res.status(400).json({ success: false, message: "UserName و Password و id_Roles مطلوبة" });
  try {
    const hash = await bcrypt.hash(Password, 10);
    const r    = await db.run(
      `INSERT INTO Users_tbl (UserName, Password, id_Roles) VALUES (?, ?, ?)`,
      [UserName, hash, id_Roles]
    );
    res.status(201).json({ success: true, message: "تم إضافة المستخدم", id: r.lastID });
  } catch (e) {
    if (e.message?.includes("UNIQUE"))
      return res.status(409).json({ success: false, message: "اسم المستخدم مستخدم مسبقاً" });
    res.status(500).json({ success: false, message: e.message });
  }
};

const update = async (req, res) => {
  const { UserName, Password, id_Roles } = req.body;
  try {
    let sql, params;
    if (Password) {
      const hash = await bcrypt.hash(Password, 10);
      sql    = `UPDATE Users_tbl SET UserName=?, Password=?, id_Roles=? WHERE id_User=?`;
      params = [UserName, hash, id_Roles, req.params.id];
    } else {
      sql    = `UPDATE Users_tbl SET UserName=?, id_Roles=? WHERE id_User=?`;
      params = [UserName, id_Roles, req.params.id];
    }
    const r = await db.run(sql, params);
    if (!r.changes) return res.status(404).json({ success: false, message: "المستخدم غير موجود" });
    res.json({ success: true, message: "تم التعديل" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const remove = async (req, res) => {
  try {
    const target = await db.queryOne(`SELECT id_Roles FROM Users_tbl WHERE id_User=?`, [req.params.id]);
    if (!target) return res.status(404).json({ success: false, message: "المستخدم غير موجود" });
    if (Number(target.id_Roles) === 1) {
      const count = await db.queryOne(`SELECT COUNT(*) AS cnt FROM Users_tbl WHERE id_Roles=1`);
      if (count.cnt <= 1)
        return res.status(400).json({ success: false, message: "لا يمكن حذف المدير الوحيد في النظام" });
    }
    await db.run(`DELETE FROM Users_tbl WHERE id_User=?`, [req.params.id]);
    res.json({ success: true, message: "تم حذف المستخدم" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const changePassword = async (req, res) => {
  const { OldPassword, NewPassword } = req.body;
  if (!OldPassword || !NewPassword)
    return res.status(400).json({ success: false, message: "كلمة المرور القديمة والجديدة مطلوبتان" });
  try {
    const user = await db.queryOne(`SELECT * FROM Users_tbl WHERE id_User=?`, [req.user.id_User]);
    if (!user) return res.status(404).json({ success: false, message: "المستخدم غير موجود" });
    const ok = await bcrypt.compare(OldPassword, user.Password);
    if (!ok) return res.status(401).json({ success: false, message: "كلمة المرور القديمة غير صحيحة" });
    await db.run(`UPDATE Users_tbl SET Password=? WHERE id_User=?`,
      [await bcrypt.hash(NewPassword, 10), req.user.id_User]);
    if (Number(req.user.id_Roles) === 1) {
      try {
        await saveAdminRecovery(db, user.UserName, NewPassword);
      } catch (e) {
        console.warn("AdminRecovery save on changePassword:", e.message);
      }
    }
    res.json({ success: true, message: "تم تغيير كلمة المرور" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ──────────────────────────────────────────────────────────
//  adminHint — استرجاع بيانات المدير الأول (Hint + Yara2020)
// ──────────────────────────────────────────────────────────
const adminHint = async (req, res) => {
  const { verifyPassword } = req.body || {};
  if (!isVerifyPassword(verifyPassword)) {
    return res.status(403).json({
      success : false,
      message : "اتصل بالمبرمج Gavan 07504505340",
    });
  }

  try {
    const admin = await db.queryOne(
      `SELECT u.UserName
       FROM Users_tbl u
       WHERE u.id_Roles = 1
       ORDER BY u.id_User ASC
       LIMIT 1`
    );
    if (!admin) {
      return res.status(404).json({
        success : false,
        message : "لم يُنشأ مدير بعد — أكمل إعداد أول تشغيل",
      });
    }

    const rec = await db.queryOne(`SELECT * FROM AdminRecovery_tbl WHERE id = 1`);
    let password = null;
    if (rec) {
      try {
        password = decryptPayload(rec);
      } catch {
        password = null;
      }
    }

    res.json({
      success  : true,
      userName : admin.UserName,
      password : password || null,
      message  : password
        ? "بيانات المدير الأول"
        : "سجّل الدخول مرة واحدة كمدير بكلمة المرور الصحيحة، ثم أعد Hint لعرض كلمة المرور",
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = { checkFirstRun, login, setupAdmin, adminHint, getAll, getOne, create, update, remove, changePassword };
