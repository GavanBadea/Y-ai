// ============================================================
//  routes/fout.routes.js  —  /api/invoices-out
//  فاتورة المبيعات الكاملة
//
//  ⚠️  ترتيب Express مهم:
//      المسارات الثابتة (bounds, material, customer)
//      يجب أن تكون قبل المسارات الديناميكية (/:id)
// ============================================================
const router = require("express").Router();
const c      = require("../controllers/fout.controller");
const { authenticate, onlyAdmin, authorize } = require("../middleware/auth");

router.use(authenticate);

// ══════════════════════════════════════════════════════════
//  أدوات مساعدة لشاشة الفاتورة  ⚠️ قبل /:id
// ══════════════════════════════════════════════════════════

// GET /api/invoices-out/bounds
// → أول وآخر رقم فاتورة (لأزرار الملاحة الابتدائية)
router.get("/bounds", c.getFirstLast);

// GET /api/invoices-out/material/:identifier
// identifier = id_Material_NoM (رقم) أو Barcode (نص)
// → المادة + LastSellPrice (السعر المقترح) + الأسعار الخمسة + الكمية+الوحدة
router.get("/material/:identifier", c.getMaterialForSale);

// GET /api/invoices-out/customer/:id
// → بيانات الزبون + رصيده السابق (PreviousBalance)
router.get("/customer/:id", c.getCustomerInfo);

// ══════════════════════════════════════════════════════════
//  الملاحة  ⚠️ قبل /:id
// ══════════════════════════════════════════════════════════

// GET /api/invoices-out/:id/navigate/prev  → الفاتورة السابقة
// GET /api/invoices-out/:id/navigate/next  → الفاتورة التالية
router.get("/:id/navigate/:direction", c.navigate);

// ══════════════════════════════════════════════════════════
//  CRUD الأساسي
// ══════════════════════════════════════════════════════════

// GET /api/invoices-out
// ?from= &to= &id_Zabon= &id_Mandob= &id_PayType= &page= &limit=
router.get("/", c.getAll);

// GET /api/invoices-out/:id
// رأس الفاتورة + الأسطر + الرصيد السابق للزبون
router.get("/:id", c.getOne);

// POST /api/invoices-out
// إنشاء الفاتورة:
//  - يتحقق من المورد والزبون والمواد
//  - يسمح بالبيع بالسالب مع تحذير
//  - يحدّث المخزون
//  - يضيف الدين إذا كان آجل
//  - يسجّل في AuditLog
router.post("/", onlyAdmin, c.create);

// DELETE /api/invoices-out/:id
// حذف كامل مع عكس:
//  - إرجاع الكميات للمخزون
//  - إلغاء الدين إذا كان آجل
//  - تسجيل في AuditLog
router.delete("/:id", onlyAdmin, c.remove);

// ── تعديل فاتورة المبيعات ────────────────────────────────
const edit = require("../controllers/foutEdit.controller");
router.get ("/:id/edit-data", authorize("can_add_sales"), edit.getEditData);
router.put ("/:id",           authorize("can_add_sales"), edit.update);

module.exports = router;
