// routes/auditLog.routes.js  —  /api/audit
const router = require("express").Router();
const c      = require("../controllers/auditLog.controller");
const { authenticate, onlyAdmin } = require("../middleware/auth");

router.use(authenticate, onlyAdmin);
router.get("/meta/tables", c.getTables);
router.get("/meta/users",  c.getUsers);
router.get("/",            c.getAll);
router.get("/:id",         c.getOne);

module.exports = router;
