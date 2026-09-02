const router = require("express").Router();
const ctrl   = require("../controllers/stockTransfer.controller");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

router.get("/", ctrl.list);
router.get("/:id", ctrl.getOne);
router.post("/", ctrl.create);

module.exports = router;
