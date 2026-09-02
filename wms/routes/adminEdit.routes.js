// ============================================================
//  routes/adminEdit.routes.js
//  مسارات التعديل الإداري — محمية بـ onlyAdmin حصراً
//  مستقلة تماماً عن المسارات الأصلية (لا تعارض)
//
//  المسارات:
//    GET  /api/admin/edit/sales/:id/data      → بيانات فاتورة مبيعات للتعديل
//    PUT  /api/admin/edit/sales/:id           → حفظ تعديل فاتورة مبيعات
//    GET  /api/admin/edit/purchases/:id/data  → بيانات فاتورة مشتريات للتعديل
//    PUT  /api/admin/edit/purchases/:id       → حفظ تعديل فاتورة مشتريات
// ============================================================
const router   = require("express").Router();
const { authenticate, onlyAdmin } = require("../middleware/auth");

// ── تحميل أدوات التحكم الموجودة ──────────────────────────
const foutEdit = require("../controllers/foutEdit.controller");
const finEdit  = require("../controllers/finEdit.controller");

// ── تطبيق الحراسة على جميع مسارات هذا الملف ────────────
// authenticate : يتحقق من التوكن
// onlyAdmin    : يتحقق أن id_Roles = 1
router.use(authenticate, onlyAdmin);

// ══════════════════════════════════════════════════════════
//  فواتير المبيعات
// ══════════════════════════════════════════════════════════

// GET /api/admin/edit/sales/:id/data
// يرجع رأس الفاتورة + الأسطر القابلة للتعديل
router.get("/sales/:id/data", (req, res, next) => {
  // إعادة توجيه params للمتحكم الموجود
  req.params.id = req.params.id;
  foutEdit.getEditData(req, res, next);
});

// PUT /api/admin/edit/sales/:id
// تعديل ذكي: عكس المخزون القديم + تطبيق الجديد + تحديث الديون
router.put("/sales/:id", (req, res, next) => {
  foutEdit.update(req, res, next);
});

// ══════════════════════════════════════════════════════════
//  فواتير المشتريات
// ══════════════════════════════════════════════════════════

// GET /api/admin/edit/purchases/:id/data
router.get("/purchases/:id/data", (req, res, next) => {
  finEdit.getEditData(req, res, next);
});

// PUT /api/admin/edit/purchases/:id
// تعديل ذكي: عكس المخزون + تحديث Cost Price + تحديث ديون المورد
router.put("/purchases/:id", (req, res, next) => {
  finEdit.update(req, res, next);
});

module.exports = router;
