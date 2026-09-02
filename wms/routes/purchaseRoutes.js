// routes/purchaseRoutes.js  —  /api/purchases
const router = require("express").Router();
const c      = require("../controllers/PurchaseController");
const { authenticate, onlyAdmin } = require("../middleware/auth");

router.use(authenticate);

// ── ثابت ⚠️ قبل /:id ─────────────────────────────────────
router.get ("/bounds",                c.getBounds);
router.post("/preview-lc",            c.previewLC);
router.get ("/supplier/:id/balance",  c.getSupplierBalance);
router.get ("/:id/navigate/:direction", c.navigate);

// ── CRUD ──────────────────────────────────────────────────
router.get   ("/",    c.getAll);
router.get   ("/:id", c.getOne);
router.post  ("/",    onlyAdmin, c.create);
router.delete("/:id", onlyAdmin, c.deleteInvoice);

module.exports = router;
