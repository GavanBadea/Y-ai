// routes/priceHistory.routes.js  —  /api/price-history
const router = require("express").Router();
const c      = require("../controllers/priceHistory.controller");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);
router.get("/",                      c.getAll);            // ?isCurrentPrice=1
router.get("/:materialId",           c.getByMaterial);    // تاريخ أسعار مادة بعينها
router.post("/",                     c.create);            // تسجيل سعر جديد

module.exports = router;
