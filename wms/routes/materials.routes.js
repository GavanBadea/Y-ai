// ============================================================
//  routes/materials.routes.js  —  /api/materials
//
//  ⚠️  ترتيب المسارات مهم جداً في Express:
//      /scan/:barcode يجب أن يُسجَّل قبل /:id
//      لأن Express يطابق المسارات بالترتيب
// ============================================================
const router = require("express").Router();
const c      = require("../controllers/materials.controller");
const imp    = require("../controllers/dataImport.controller");
const { authenticate, onlyAdmin } = require("../middleware/auth");

// كل المسارات تحتاج توكن صالح
router.use(authenticate);

// ── GET /api/materials
// ?search= &id_Catiguary= &id_Type= &lowStock= &barcode=
router.get("/", c.getAll);

// ── GET /api/materials/scan/:barcode  ⚠️ قبل /:id
// مسح الباركود → يُرجع بيانات المادة كاملة + الأسعار + الكمية+الوحدة
// مثال: GET /api/materials/scan/MAT123456789042
router.get("/scan/:barcode", c.scanBarcode);

router.post("/import", onlyAdmin, imp.importMaterials);

// ── GET /api/materials/:id
// مادة واحدة بكامل بياناتها (JOIN: صنف + نوع + مخزون + أسعار)
router.get("/:id", c.getOne);

// ── POST /api/materials  (مدير فقط)
// إذا لم يُرسَل Barcode → يُولَّد تلقائياً
// إذا لم يُرسَل Band → الافتراضي "كارتون"
router.post("/", onlyAdmin, c.create);

// ── PUT /api/materials/:id  (مدير فقط)
// يعدّل: MaterialName, Barcode, Band, id_Catiguary, id_Type, CostPrice, SellPrices
router.put("/:id", onlyAdmin, c.update);

// ── PATCH /api/materials/:id/prices  (مدير فقط)
// تعديل الأسعار الخمسة فقط → يحفظ في PriceHistory_tbl تلقائياً
router.patch("/:id/prices", onlyAdmin, c.updatePrices);

// ── DELETE /api/materials/:id  (مدير فقط)
// يمنع الحذف إذا وجدت حركات شراء أو بيع أو إرجاع
router.delete("/:id", onlyAdmin, c.remove);

module.exports = router;
