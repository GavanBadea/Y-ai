// ============================================================
//  middleware/auth.js
//
//  نظام المصادقة بدون حسابات مُدمجة
//  أول تشغيل: يُكشف عبر checkFirstRun → setupToken مؤقت
// ============================================================
const jwt = require("jsonwebtoken");
const db  = require("../db");

// ── السر المستخدم لتوكن الإعداد الأوّلي ─────────────────────
function getSetupSecret() {
  return (process.env.JWT_SECRET || "default_secret") + "_setup_v2";
}

async function hasRealUsers() {
  const row = await db.queryOne("SELECT COUNT(*) AS cnt FROM Users_tbl");
  return Number(row?.cnt || 0) > 0;
}

// ── authenticate — middleware عام ─────────────────────────
async function authenticate(req, res, next) {
  const token = (req.headers["authorization"] || "").split(" ")[1];
  if (!token)
    return res.status(401).json({ success: false, message: "مطلوب توكن للوصول" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // جلب المستخدم مع كافة أعمدة الصلاحيات الفعلية
    const user = await db.queryOne(
      `SELECT
         u.id_User,
         u.UserName,
         u.id_Roles,
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
         r.can_kiosk_scan
       FROM Users_tbl u
       LEFT JOIN UserRoles_tbl r ON r.id_Roles = u.id_Roles
       WHERE u.id_User = ?`,
      [decoded.id_User]
    );
    if (!user)
      return res.status(401).json({ success: false, message: "المستخدم لم يعد موجوداً" });

    req.user = user;
    next();
  } catch {
    res.status(403).json({ success: false, message: "توكن غير صالح أو منتهي الصلاحية" });
  }
}

// ── onlyBootstrap — يحمي مسار setup-admin (توكن الإعداد المؤقت) ──
async function onlyBootstrap(req, res, next) {
  const token = (req.headers["authorization"] || "").split(" ")[1];
  if (!token)
    return res.status(401).json({ success: false, message: "مطلوب توكن الإعداد" });

  try {
    const decoded = jwt.verify(token, getSetupSecret());
    if (!decoded.isSetup)
      return res.status(403).json({
        success: false,
        message: "توكن الإعداد غير صالح",
      });
    if (await hasRealUsers())
      return res.status(403).json({
        success: false,
        message: "تم إنشاء المدير مسبقاً. مسار الإعداد مُغلق نهائياً.",
      });
    req.user = { isSetup: true };
    next();
  } catch {
    res.status(403).json({ success: false, message: "توكن الإعداد غير صالح أو منتهي" });
  }
}

// ── onlyOwner — محجوز للتوافق (لم يعد يُستخدم) ─────────────
function onlyOwner(req, res, next) {
  return res.status(403).json({
    success: false,
    message: "هذا المسار غير مفعّل في هذا الإصدار",
  });
}

// ── onlyAdmin — id_Roles = 1 فقط ──────────────────────────
function onlyAdmin(req, res, next) {
  if (!req.user)
    return res.status(403).json({ success: false, message: "غير مصرح لهذا المستخدم" });
  if (Number(req.user.id_Roles) !== 1)
    return res.status(403).json({
      success: false,
      message: "هذا الإجراء يتطلب صلاحية (مدير البرنامج)",
    });
  next();
}

// ── authorize — فحص عمود صلاحية بعينه ────────────────────
function authorize(permissionColumn) {
  return (req, res, next) => {
    if (!req.user)
      return res.status(403).json({ success: false, message: "غير مصرح" });
    // المدير (id_Roles=1) له كل الصلاحيات دائماً
    if (Number(req.user.id_Roles) === 1) return next();
    if (!req.user[permissionColumn])
      return res.status(403).json({
        success: false,
        message: `ليس لديك صلاحية: ${permissionColumn}`,
      });
    next();
  };
}

// ── authorizeRoles — فحص قائمة أدوار (id_Roles) ──────────
function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user)
      return res.status(403).json({ success: false, message: "غير مصرح" });
    if (!roles.includes(Number(req.user.id_Roles)))
      return res.status(403).json({ success: false, message: "ليس لديك صلاحية هذا الإجراء" });
    next();
  };
}

// ── generateSetupToken — لإنشاء توكن إعداد أوّلي مؤقت ─────
function generateSetupToken() {
  return jwt.sign(
    { isSetup: true, ts: Date.now() },
    getSetupSecret(),
    { expiresIn: "30m" }
  );
}

module.exports = {
  authenticate,
  onlyBootstrap,
  onlyOwner,
  onlyAdmin,
  authorize,
  authorizeRoles,
  hasRealUsers,
  generateSetupToken,
};
