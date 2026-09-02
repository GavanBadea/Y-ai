// ============================================================
//  routes/pos.routes.js  —  /api/pos
//  نقطة البيع السريعة — الأداء أولوية
//
//  ⚠️  ترتيب Express مهم:
//      المسارات الثابتة (init, bounds, material, customer)
//      قبل الديناميكية (/:id)
// ============================================================
const router = require("express").Router();
const c      = require("../controllers/pos.controller");
const { authenticate } = require("../middleware/auth");

// جميع مسارات POS تحتاج توكن — لا تحتاج onlyAdmin
// (الكاشير يملك توكناً ولكن ليس بالضرورة دور المدير)
router.use(authenticate);

// ══════════════════════════════════════════════════════════
//  تحميل البيانات الأولية  ⚠️ أولاً
// ══════════════════════════════════════════════════════════

// GET /api/pos/init
// → يُرجع: categories + payTypes + mandobs + customers (مع أرصدتهم)
// يُستدعى مرة واحدة عند فتح شاشة POS
router.get("/init", c.init);

// GET /api/pos/bounds
// → أول وآخر رقم فاتورة POS (لأزرار الملاحة الابتدائية)
router.get("/bounds", c.getBounds);

// ══════════════════════════════════════════════════════════
//  المواد  ⚠️ قبل الملاحة
// ══════════════════════════════════════════════════════════

// GET /api/pos/categories/:id/materials
// ?inStockOnly=1  → فقط المواد المتوفرة
// → مواد الصنف مع السعر المقترح (LastSellPrice) والأسعار الخمسة والكمية+الوحدة
router.get("/categories/:id/materials", c.getMaterialsByCategory);

// GET /api/pos/material/:identifier
// identifier = رقم المادة أو Barcode أو جزء من الاسم
// → نتيجة واحدة (باركود) أو قائمة (بحث نصي)
router.get("/material/:identifier", c.searchMaterial);

// ══════════════════════════════════════════════════════════
//  السلة والفاتورة
// ══════════════════════════════════════════════════════════

// POST /api/pos/cart-preview
// → معاينة السلة + المجاميع + التحذيرات (بدون حفظ)
// Body: { id_Zabon, Dis_FOUT, items: [{id_Material_NoM, AmountOUT, PriceOUT}] }
router.post("/cart-preview", c.cartPreview);

// POST /api/pos/checkout
// → حفظ الفاتورة السريعة (الحد الأدنى: id_Zabon + id_PayType_FOUT + items)
// البيع بالسالب مسموح مع تحذيرات
// الديون المالية تُعالَج تلقائياً حسب نوع الدفع
router.post("/checkout", c.checkout);

// ══════════════════════════════════════════════════════════
//  الملاحة في فواتير POS
// ══════════════════════════════════════════════════════════

// GET /api/pos/navigate/:id/prev  → الفاتورة السابقة
// GET /api/pos/navigate/:id/next  → الفاتورة التالية
router.get("/navigate/:id/:direction", c.navigate);

module.exports = router;
