// ============================================================
//  routes/fRetern.routes.js  —  /api/returns
//  نظام المرتجعات — نوعان:
//   • CUSTOMER : مرتجع زبون  (↑ مخزون، ↓ دين الزبون)
//   • SUPPLIER : مرتجع مورد  (↓ مخزون، ↓ ديننا للمورد)
// ============================================================
const router = require("express").Router();
const c      = require("../controllers/fRetern.controller");
const { authenticate, onlyAdmin } = require("../middleware/auth");

router.use(authenticate);

// ══════════════════════════════════════════════════════════
//  أدوات مساعدة  ⚠️ قبل /:id
// ══════════════════════════════════════════════════════════

// GET /api/returns/bounds
// → أول وآخر رقم سند (للملاحة الابتدائية)
router.get("/bounds", c.getBounds);

// GET /api/returns/price-default
// ?type=CUSTOMER|SUPPLIER &id_Material_NoM= &id_Party=
// → السعر الافتراضي للمرتجع مع إمكانية Override
router.get("/price-default", c.getPriceDefault);

// ══════════════════════════════════════════════════════════
//  الملاحة  ⚠️ قبل /:id
// ══════════════════════════════════════════════════════════

// GET /api/returns/:id/navigate/prev  → السند السابق
// GET /api/returns/:id/navigate/next  → السند التالي
router.get("/:id/navigate/:direction", c.navigate);

// ══════════════════════════════════════════════════════════
//  CRUD الأساسي
// ══════════════════════════════════════════════════════════

// GET /api/returns
// ?type=CUSTOMER|SUPPLIER &id_Party= &from= &to= &page= &limit=
router.get("/", c.getAll);

// GET /api/returns/:id
// → سند كامل مع الأسطر والتأثيرات
router.get("/:id/edit-data", onlyAdmin, c.getEditData);
router.get("/:id", c.getOne);

// POST /api/returns
// → ينشئ السند ويطبّق التأثيرات تلقائياً:
//   CUSTOMER: زيادة مخزون + خصم دين الزبون
//   SUPPLIER: نقصان مخزون + خصم ديننا للمورد
// السعر يُجلب تلقائياً ويمكن Override عبر PriceOUT في كل سطر
router.post("/", c.create);        // الصلاحية تُفحص داخل الـ Controller بناءً على ReturnType
router.put("/:id", onlyAdmin, c.update);
router.delete("/:id", onlyAdmin, c.remove);

module.exports = router;
