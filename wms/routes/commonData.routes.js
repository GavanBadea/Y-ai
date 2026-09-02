// ============================================================
//  routes/commonData.routes.js
//
//  مسارات جداول البيانات المرجعية — كلها في ملف واحد:
//
//   /api/common/locations   → Zabon_Location
//   /api/common/mandob      → Mandob_tbl
//   /api/common/pay-types   → PayType_Tbl
//   /api/common/categories  → Catiguary_tbl
//   /api/common/types       → Type_tbl
//
//  الحماية:
//   • GET  → أي مستخدم مُسجَّل (authenticate)
//   • POST / PUT / DELETE → المدير فقط (onlyAdmin)
// ============================================================
const router  = require("express").Router();
const c       = require("../controllers/commonData.controller");
const imp     = require("../controllers/dataImport.controller");
const { authenticate, onlyAdmin } = require("../middleware/auth");

// كل المسارات تحتاج توكن
router.use(authenticate);

// ── دالة مساعدة لتسجيل مجموعة CRUD على prefix ─────────────
function mountCRUD(prefix, handlers) {
  router.get   (`${prefix}`,     handlers.getAll);
  router.get   (`${prefix}/:id`, handlers.getOne);
  router.post  (`${prefix}`,     onlyAdmin, handlers.create);
  router.put   (`${prefix}/:id`, onlyAdmin, handlers.update);
  router.delete(`${prefix}/:id`, onlyAdmin, handlers.remove);
}

// ── استيراد Excel (قبل مسارات :id) ───────────────────────
router.post("/locations/import",  onlyAdmin, imp.importLocations);
router.post("/categories/import", onlyAdmin, imp.importCategories);
router.post("/types/import",      onlyAdmin, imp.importTypes);

// ── تسجيل الجداول الخمسة ─────────────────────────────────
mountCRUD("/locations",  c.zabonLocation);  // أماكن الزبائن
mountCRUD("/mandob",     c.mandob);         // المندوبون
mountCRUD("/pay-types",  c.payType);        // طرق الدفع
mountCRUD("/categories", c.catiguary);      // أصناف المواد
mountCRUD("/types",      c.type);           // أنواع المواد
mountCRUD("/cash-boxes", c.cashBox);        // الصناديق النقدية

module.exports = router;
