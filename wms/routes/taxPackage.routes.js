// ============================================================
//  routes/taxPackage.routes.js  —  /api/tax-package
//  حزمة المحاسب الضريبية — وحدة مستقلة
// ============================================================
const router = require("express").Router();
const ctrl   = require("../controllers/taxPackage.controller");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

// GET /api/tax-package?year=2025
router.get("/", ctrl.getPackage);

module.exports = router;
