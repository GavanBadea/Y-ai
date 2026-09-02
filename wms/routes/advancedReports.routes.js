// ============================================================
//  routes/advancedReports.routes.js
//  /api/advanced-reports/*  —  التقارير التفصيلية (وحدة مستقلة)
// ============================================================
const router = require("express").Router();
const ctrl   = require("../controllers/advancedReports.controller");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

// ── قوائم الاختيار ────────────────────────────────────────
router.get("/lists/customers",  ctrl.getCustomersList);
router.get("/lists/suppliers",  ctrl.getSuppliersList);
router.get("/lists/materials",  ctrl.getMaterialsList);

// ── كشوفات الحساب (مع رصيد افتتاحي) ─────────────────────
router.get("/statement/customer",  ctrl.getCustomerStatement);
router.get("/statement/supplier",  ctrl.getSupplierStatement);

// ── تفاصيل الحركات (أسطر الفواتير) ──────────────────────
router.get("/activity/customer",   ctrl.getCustomerActivity);
router.get("/activity/supplier",   ctrl.getSupplierActivity);

// ── تتبع حركة صنف ─────────────────────────────────────────
router.get("/tracking",            ctrl.getItemTracking);
router.get("/returns",             ctrl.getReturnsReport);

module.exports = router;
