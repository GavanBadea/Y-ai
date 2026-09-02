// routes/expiredStock.routes.js
const router = require("express").Router();
const c      = require("../controllers/expiredStock.controller");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

router.get("/summary",         c.getSummary);   // قبل /:id
router.get("/pending",         c.getPending);
router.get("/",                c.getAll);
router.post("/process",        c.processAll);
router.post("/process/:detailsInId", c.processOne);

module.exports = router;
