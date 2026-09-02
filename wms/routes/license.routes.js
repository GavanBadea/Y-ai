// routes/license.routes.js  —  /api/license
"use strict";

const router = require("express").Router();
const c      = require("../controllers/license.controller");

// مسارات عامة — لا تحتاج توكن (يجب أن تعمل قبل التفعيل)
router.get ("/status",   c.getStatus);
router.post("/activate", c.activateLicense);

module.exports = router;
