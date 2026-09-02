// routes/userRoles.routes.js  —  /api/roles
// ⚠️  جميع المسارات محمية بـ onlyAdmin — المدير فقط
const router = require("express").Router();
const c      = require("../controllers/userRoles.controller");
const { authenticate, onlyAdmin } = require("../middleware/auth");

router.use(authenticate);  // توكن صالح أولاً
router.use(onlyAdmin);     // ثم مدير فقط

router.get("/",              c.getAll);       // جميع الأدوار مع الصلاحيات
router.get("/:id",           c.getOne);       // دور واحد + عدد مستخدميه
router.post("/",             c.create);       // إضافة دور جديد (مندوب، محاسب...)
router.put("/:id",           c.update);       // تعديل اسم أو صلاحيات دور
router.delete("/:id",        c.remove);       // حذف دور (إذا لا يوجد مستخدمون)
router.post("/assign",       c.assignRole);   // تعيين دور لمستخدم

module.exports = router;
