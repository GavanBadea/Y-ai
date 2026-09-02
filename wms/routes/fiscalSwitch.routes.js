// routes/fiscalSwitch.routes.js  →  /api/fiscal-switch
const router = require("express").Router();
const { authenticate, onlyAdmin } = require("../middleware/auth");
const c = require("../controllers/fiscalYear.controller");

router.use(authenticate);

router.get("/current", c.getCurrentFiscalInfo);

router.use(onlyAdmin);   // تبديل السنة المالية — للمدير فقط

router.get("/backups", c.getActiveBackup);
router.post("/switch", c.switchToBackup);

module.exports = router;
