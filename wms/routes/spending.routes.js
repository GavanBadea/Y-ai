// routes/spending.routes.js
const router = require("express").Router();
const c      = require("../controllers/spending.controller");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);
router.get("/",           c.getAll);
router.get("/gl-accounts", c.listGlAccounts);
router.get("/:id",        c.getOne);
router.post("/",       c.create);
router.put("/:id",   c.update);
router.delete("/:id",c.remove);

module.exports = router;
