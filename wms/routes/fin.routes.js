// ============================================================
//  routes/fin.routes.js  —  /api/invoices-in
//  فواتير المشتريات الكاملة مع Landed Cost
// ============================================================
const router = require("express").Router();
const fin    = require("../controllers/fin.controller");
const { authenticate, onlyAdmin, authorize } = require("../middleware/auth");

router.use(authenticate);

// ══════════════════════════════════════════════════════════
//  الملاحة والأدوات  ⚠️ قبل /:id لتجنب تعارض Express
// ══════════════════════════════════════════════════════════

// GET /api/invoices-in/bounds
// → يُرجع id أول فاتورة وآخر فاتورة (للملاحة الابتدائية)
router.get("/bounds", fin.getFirstLast);

// POST /api/invoices-in/preview-landed-cost
// → معاينة توزيع المصاريف قبل الحفظ (بدون تأثير على DB)
router.post("/preview-landed-cost", fin.previewLandedCost);

// GET /api/invoices-in/:id/navigate/:direction
// direction = prev | next
// → يُرجع الفاتورة السابقة أو التالية كاملةً بأسطرها
router.get("/:id/navigate/:direction", fin.navigate);

// ══════════════════════════════════════════════════════════
//  CRUD الأساسي
// ══════════════════════════════════════════════════════════

// GET /api/invoices-in
// ?from= &to= &id_Amil= &id_PayType= &page= &limit=
router.get("/", fin.getAll);

// GET /api/invoices-in/:id
// رأس الفاتورة + الأسطر + Landed Cost محسوب لكل سطر
router.get("/:id", fin.getOne);

// POST /api/invoices-in
// ينشئ الفاتورة ويوزع Landed Cost ويحدّث المخزون والتكلفة
router.post("/", onlyAdmin, fin.create);

// DELETE /api/invoices-in/:id
// يحذف الفاتورة ويعكس جميع تأثيراتها (مخزون + ديون)
router.delete("/:id", onlyAdmin, fin.remove);

// ── تعديل فاتورة الشراء ─────────────────────────────────
const edit = require("../controllers/finEdit.controller");
router.get("/:id/edit-data", authorize("can_add_purchase"), edit.getEditData);
router.put("/:id",           authorize("can_add_purchase"), edit.update);

module.exports = router;
