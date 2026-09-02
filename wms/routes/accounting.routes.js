// ============================================================
//  routes/accounting.routes.js  —  /api/accounting
// ============================================================
const router = require("express").Router();
const ctrl = require("../controllers/accounting.controller");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

router.get("/chart", ctrl.getChart);
router.get("/income-statement", ctrl.getIncomeStatement);
router.get("/general-tax-details", ctrl.getGeneralTaxDetails);
router.get("/account-details", ctrl.getAccountDetails);
router.get("/balance-sheet", ctrl.getBalanceSheet);
router.get("/gl-accounts", ctrl.listGlAccounts);
router.get("/gl-parents", ctrl.listGlParents);
router.post("/gl-accounts", ctrl.createGlAccount);
router.get("/fixed-assets", ctrl.listAssets);
router.post("/fixed-assets", ctrl.createAsset);
router.put("/fixed-assets/:id", ctrl.updateAsset);
router.delete("/fixed-assets/:id", ctrl.removeAsset);
router.get("/depreciation", ctrl.listDepreciation);
router.post("/depreciation", ctrl.createDepreciation);
router.delete("/depreciation/:id", ctrl.removeDepreciation);

module.exports = router;
