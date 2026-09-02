const router = require("express").Router();
const ctrl   = require("../controllers/warehouse.controller");
const { authenticate, onlyAdmin } = require("../middleware/auth");

router.use(authenticate);

router.get("/", ctrl.listActive);
router.get("/all", onlyAdmin, ctrl.listAll);
router.get("/:id/stock/:materialId", ctrl.getMaterialQty);
router.post("/", onlyAdmin, ctrl.create);
router.put("/:id", onlyAdmin, ctrl.update);
router.delete("/:id", onlyAdmin, ctrl.remove);

module.exports = router;
