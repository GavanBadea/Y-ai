// ============================================================
//  routes/whatsapp.routes.js  —  /api/whatsapp
//
//  GET  /api/whatsapp/status   → حالة الاتصال (أي مستخدم)
//  GET  /api/whatsapp/qr       → QR للمسح (مدير فقط)
//  POST /api/whatsapp/connect  → بدء الاتصال (مدير فقط)
//  POST /api/whatsapp/send     → إرسال رسالة (مدير فقط)
//  POST /api/whatsapp/logout   → قطع الاتصال (مدير فقط)
// ============================================================
const router = require("express").Router();
const wa     = require("../controllers/whatsapp.controller");
const { authenticate, onlyAdmin } = require("../middleware/auth");

// الحالة: مفتوحة لأي مستخدم مسجّل
router.get("/status",  authenticate, wa.getStatus);

// باقي المسارات: للمدير فقط
router.get ("/qr",      authenticate, onlyAdmin, wa.getQR);
router.post("/connect", authenticate, onlyAdmin, wa.connect);
router.post("/send",    authenticate, onlyAdmin, wa.sendMessage);
router.post("/logout",  authenticate, onlyAdmin, wa.logout);

module.exports = router;
