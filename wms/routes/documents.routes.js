// ============================================================
//  routes/documents.routes.js  —  /api/documents
//  سندات القبض (catch) + سندات الدفع (pay) + محرك الطباعة
//
//  ⚠️  ترتيب Express: المسارات الثابتة قبل الديناميكية
// ============================================================
const router = require("express").Router();
const c      = require("../controllers/documents.controller");
const { authenticate, onlyAdmin } = require("../middleware/auth");

router.use(authenticate);

// GET /api/documents/cash-flow-summary?from=&to=
router.get("/cash-flow-summary", c.getCashFlowSummary);

// POST /api/documents/direct-catch-pay
// Body: { id_Zabon, id_Amil, Amount_CatchDoc, Date_CatchDoc?, Note_CatchDoc? }
router.post("/direct-catch-pay", onlyAdmin, c.createDirectCatchPay);

// ══════════════════════════════════════════════════════════
//  محرك الطباعة  ⚠️ أولاً (قبل /:id)
// ══════════════════════════════════════════════════════════

// GET /api/documents/print/:docType/:id
// docType = catch | pay
// → كائن printData كامل: شركة + سند + رصيد قبل/بعد + توقيعات
router.get("/print/:docType/:id", c.getPrintData);

// GET /api/documents/bounds/:docType
// → أول وآخر رقم سند (للملاحة)
router.get("/bounds/:docType", c.getBounds);

// GET /api/documents/navigate/:docType/:id/:direction
// docType = catch | pay  /  direction = prev | next
// → السند السابق أو التالي مع printData كامل
router.get("/navigate/:docType/:id/:direction", c.navigate);

// ══════════════════════════════════════════════════════════
//  سندات القبض  —  /api/documents/catch
// ══════════════════════════════════════════════════════════

// GET /api/documents/catch
// ?id_Zabon= &from= &to= &page= &limit=
router.get("/catch",     c.getAllCatch);

// GET /api/documents/catch/customer-profit/:zabonId
router.get("/catch/customer-profit/:zabonId", c.customerProfit);

// GET /api/documents/catch/:id
router.get("/catch/:id", c.getOneCatch);

// POST /api/documents/catch
// Body: { id_Zabon, Amount_CatchDoc, Date_CatchDoc?, Note_CatchDoc? }
// → يسجّل السند + قيد خصم في DionZabon_tbl + يرجع printData
router.post("/catch", onlyAdmin, c.createCatch);

// PUT /api/documents/catch/:id — تعديل مع الإبقاء على تاريخ التسجيل
router.put("/catch/:id", onlyAdmin, c.updateCatch);

// DELETE /api/documents/catch/:id
// → يحذف السند + يعكس قيد الخصم من DionZabon_tbl
router.delete("/catch/:id", onlyAdmin, c.removeCatch);

// ══════════════════════════════════════════════════════════
//  سندات الدفع  —  /api/documents/pay
// ══════════════════════════════════════════════════════════

// GET /api/documents/pay
// ?id_Amil= &from= &to= &page= &limit=
router.get("/pay",     c.getAllPay);

// GET /api/documents/pay/:id
router.get("/pay/:id", c.getOnePay);

// POST /api/documents/pay
// Body: { id_Amil, Amount_PayDoc, Date_PayDoc?, Note_PayDoc? }
// → يسجّل السند + قيد خصم في DionAmil_tbl + يرجع printData
router.post("/pay", onlyAdmin, c.createPay);

// PUT /api/documents/pay/:id — تعديل مع الإبقاء على تاريخ التسجيل
router.put("/pay/:id", onlyAdmin, c.updatePay);

// DELETE /api/documents/pay/:id
// → يحذف السند + يعكس قيد الخصم من DionAmil_tbl
router.delete("/pay/:id", onlyAdmin, c.removePay);

module.exports = router;
