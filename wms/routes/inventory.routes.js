// ============================================================
//  routes/inventory.routes.js
// ============================================================
const router = require("express").Router();
const { authenticate } = require("../middleware/auth");
const {
  getKPIs,
  getTopSelling,
  getByCategory,
  getLowStock,
  getAllStock,
  getByWarehouse,
  getWarehouseMovements,
} = require("../controllers/inventory.controller");

router.use(authenticate);

router.get("/kpis",          getKPIs);
router.get("/top-selling",   getTopSelling);
router.get("/by-category",   getByCategory);
router.get("/low-stock",     getLowStock);
router.get("/stock",               getAllStock);
router.get("/by-warehouse",        getByWarehouse);
router.get("/warehouse-movements", getWarehouseMovements);

module.exports = router;
