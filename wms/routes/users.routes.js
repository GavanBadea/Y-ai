// routes/users.routes.js  —  /api/users
const router  = require("express").Router();
const c       = require("../controllers/users.controller");
const { authenticate, onlyBootstrap, onlyAdmin } = require("../middleware/auth");

// ── مسارات عامة — لا تحتاج توكن ───────────────────────────
router.get ("/check-first-run", c.checkFirstRun);   // ← كشف أول تشغيل
router.post("/login",           c.login);
router.post("/admin-hint",      c.adminHint);         // ← Hint + كلمة تحقيق المبرمج

// ── إعداد النظام — حصرياً بتوكن الإعداد المؤقت ────────────
router.post("/setup-admin", onlyBootstrap, c.setupAdmin);

// ── مسارات محمية — يحتاج توكن صالح ───────────────────────
router.use(authenticate);

router.patch("/change-password", c.changePassword);

// ── مسارات إدارة المستخدمين — للمدير فقط ──────────────────
router.get("/",       onlyAdmin, c.getAll);
router.get("/:id",    onlyAdmin, c.getOne);
router.post("/",      onlyAdmin, c.create);
router.put("/:id",    onlyAdmin, c.update);
router.delete("/:id", onlyAdmin, c.remove);

module.exports = router;
