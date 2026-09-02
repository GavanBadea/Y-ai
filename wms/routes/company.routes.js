// routes/company.routes.js  —  /api/company
const router = require("express").Router();
const c      = require("../controllers/company.controller");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);
router.get("/",         c.get);
router.post("/",        c.upsert);
router.post("/logo",    c.uploadLogo);
router.delete("/logo",  c.deleteLogo);

module.exports = router;
