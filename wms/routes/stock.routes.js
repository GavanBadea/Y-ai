// routes/stock.routes.js  —  /api/stock
const router = require("express").Router();
const c      = require("../controllers/stock.controller");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);
router.get("/",                              c.getAll);        // ?search=&low=10&id_Catiguary=
router.get("/summary",                       c.getSummary);   // إجمالي المخزون (للداشبورد)
router.get("/:materialId",                   c.getOne);       // مخزون مادة واحدة
router.get("/:materialId/movement",          c.getMovement);  // كل حركات المادة
router.patch("/adjust",                      c.manualAdjust); // تعديل يدوي (جرد)

module.exports = router;
