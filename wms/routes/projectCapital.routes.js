// ============================================================
//  routes/projectCapital.routes.js  —  مسارات رأس المال
// ============================================================
const router = require("express").Router();
const c      = require("../controllers/projectCapital.controller");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

router.get("/summary", c.getSummary);   // ← يجب قبل /:id
router.get("/history", c.getHistory);
router.put("/history/:id",    c.updateDeposit);
router.delete("/history/:id", c.deleteDeposit);
router.get("/",        c.getCapital);
router.post("/",       c.setCapital);

module.exports = router;
