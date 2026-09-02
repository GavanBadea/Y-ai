// routes/sellPrice.routes.js  —  /api/sell-prices
const router = require("express").Router();
const c      = require("../controllers/sellPrice.controller");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);
router.get("/",                      c.getAll);               // أسعار جميع المواد
router.get("/:materialId",           c.getOne);               // أسعار مادة واحدة
router.put("/:materialId",           c.update);               // تعديل الأسعار الخمسة

module.exports = router;
