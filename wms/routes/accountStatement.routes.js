// ============================================================
//  routes/accountStatement.routes.js
//  /api/statements/*  —  كشوفات الحسابات (وحدة مستقلة)
// ============================================================
const router  = require("express").Router();
const ctrl    = require("../controllers/accountStatement.controller");
const { authenticate } = require("../middleware/auth");

// كل المسارات تتطلب توثيق JWT
router.use(authenticate);

// ── قوائم الاختيار (Dropdowns) ──────────────────────────────
// GET /api/statements/customers-list
router.get("/customers-list", ctrl.getCustomersList);

// GET /api/statements/suppliers-list
router.get("/suppliers-list", ctrl.getSuppliersList);

// GET /api/statements/mandobs-list
router.get("/mandobs-list", ctrl.getMandobsList);

// ── كشوفات الحسابات ──────────────────────────────────────────
// GET /api/statements/customer?id_Zabon=&from=&to=
router.get("/customer", ctrl.getCustomerStatement);

// GET /api/statements/supplier?id_Amil=&from=&to=
router.get("/supplier", ctrl.getSupplierStatement);

// GET /api/statements/mandob?id_Mandob=&from=&to=
router.get("/mandob", ctrl.getMandobStatement);

// GET /api/statements/cash-box?id_CashBox=&from=&to=
router.get("/cash-box", ctrl.getCashBoxStatement);

// POST /api/statements/send-whatsapp  — إرسال PDF كشف الحساب عبر واتساب
router.post("/send-whatsapp", ctrl.sendStatementWhatsApp);

module.exports = router;
