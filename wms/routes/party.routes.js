// ============================================================
//  routes/party.routes.js
//
//   /api/party/customers  → Zabon_tbl
//   /api/party/suppliers  → Amil_tbl
//
//  الحماية:
//   • GET  → أي مستخدم مُسجَّل
//   • POST / PUT / DELETE → المدير فقط (onlyAdmin)
//   (يمكن لاحقاً تخفيف القيد وإضافة authorize لأدوار أخرى)
// ============================================================
const router = require("express").Router();
const c      = require("../controllers/party.controller");
const imp    = require("../controllers/dataImport.controller");
const { authenticate, onlyAdmin } = require("../middleware/auth");

router.use(authenticate);

// ── الزبائن ───────────────────────────────────────────────
router.post  ("/customers/import", onlyAdmin, imp.importCustomers);
router.post  ("/suppliers/import", onlyAdmin, imp.importSuppliers);

// GET  /api/party/customers?search=&id_ZabonLocation=
router.get   ("/customers",     c.getAllZabon);
// GET  /api/party/customers/:id
router.get   ("/customers/:id", c.getOneZabon);
// POST /api/party/customers  → يتحقق من id_ZabonLocation
router.post  ("/customers",     onlyAdmin, c.createZabon);
// PUT  /api/party/customers/:id
router.put   ("/customers/:id", onlyAdmin, c.updateZabon);
// DELETE /api/party/customers/:id  → يمنع الحذف إذا توجد فواتير
router.delete("/customers/:id", onlyAdmin, c.removeZabon);

// ── الموردون ──────────────────────────────────────────────
// GET  /api/party/suppliers?search=
router.get   ("/suppliers",     c.getAllAmil);
// GET  /api/party/suppliers/:id
router.get   ("/suppliers/:id", c.getOneAmil);
// POST /api/party/suppliers
router.post  ("/suppliers",     onlyAdmin, c.createAmil);
// PUT  /api/party/suppliers/:id
router.put   ("/suppliers/:id", onlyAdmin, c.updateAmil);
// DELETE /api/party/suppliers/:id → يمنع الحذف إذا توجد فواتير
router.delete("/suppliers/:id", onlyAdmin, c.removeAmil);

module.exports = router;
