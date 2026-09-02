// routes/reports.routes.js  —  /api/reports
const router = require("express").Router();
const c      = require("../controllers/reports.controller");
const { authenticate } = require("../middleware/auth");

router.use(authenticate);

// ── التقارير الأصلية ───────────────────────────────────────
router.get("/dashboard",      c.dashboard);
router.get("/statement",      c.detailedStatement);
router.get("/inventory",      c.inventoryReport);
router.get("/profit-loss",    c.profitAndLoss);
router.get("/sales-reps",     c.salesRepsReport);
router.get("/cash-flow",      c.cashFlow);
router.get("/stock-movement", c.stockMovement);
router.get("/comparison",     c.comparison);

// ── الدفعة الأولى الجديدة ──────────────────────────────────
router.get("/stock-movement-analytics", c.stockMovementAnalytics);
router.get("/abc-analysis",             c.abcAnalysis);
router.get("/aging-expiry",             c.agingExpiry);
router.get("/sales-profitability",      c.salesProfitability);
router.get("/aging-receivables",        c.agingReceivables);

// ── الدفعة الثانية الجديدة ─────────────────────────────────
router.get("/summary-report",           c.summaryReport);
router.get("/entity-report",            c.entityReport);
router.get("/entity-invoice/:docType/:docNo", c.entityInvoiceDetail);
router.get("/material-analysis",        c.materialAnalysis);
router.get("/salesmen-performance",     c.salesmenPerformance);
router.get("/cash-flow-detailed",       c.cashFlowDetailed);
router.get("/profit-report",            c.profitReport);
router.get("/reorder-alert",            c.reorderAlert);
router.get("/warehouse-transfers",      c.warehouseTransfers);
router.get("/overdue-sales-invoices",   c.overdueSalesInvoices);

module.exports = router;
