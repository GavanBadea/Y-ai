// ============================================================
//  routes/fiscalYear.routes.js  →  /api/fiscal
//  محمي للمدير — عمليات الإغلاق والتصفير تتطلب كلمة مرور Yara
// ============================================================
const router = require("express").Router();
const { authenticate, onlyAdmin } = require("../middleware/auth");
const c = require("../controllers/fiscalYear.controller");

router.use(authenticate);
router.use(onlyAdmin);

router.get ("/stats",             c.getSystemStats);
router.get ("/backups",           c.listBackups);
router.post("/backups/manual",    c.manualBackup);
router.post("/backups/create",    c.createManualBackup);
router.post("/backups/upload-restore", c.uploadAndRestoreBackup);
router.get ("/backups/:filename", c.downloadBackup);
router.get ("/auto-backup",        c.getAutoBackupSettings);
router.post("/auto-backup",       c.saveAutoBackupSettings);
router.post("/auto-backup/run",   c.runAutoBackupNow);
router.get ("/preview",           c.previewYearClose);
router.post("/close-year",        c.closeYear);
router.post("/factory-reset",     c.factoryReset);
router.post("/restore",           c.switchToBackup);

module.exports = router;
