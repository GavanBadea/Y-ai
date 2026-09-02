// ============================================================
//  controllers/reports.controller.js  —  محرك التقارير
//
//  التقارير:
//   أ- كشف الحساب التفصيلي  (Detailed Statement)
//   ب- جرد وتثمين المخزن    (Inventory & Valuation)
//   ج- الأرباح والخسائر      (P&L)
//   د- حركة المندوبين        (Sales Reps Performance)
//
//  قواعد ثابتة:
//   • كل تقرير يقبل startDate / endDate
//   • افتراضي: 01-01-{سنة_حالية} → اليوم
//   • كل رد يحتوي reportHeader (معلومات الشركة + الفترة)
// ============================================================
const db = require("../db");
const { DEFERRED_PAY_SQL, SALE_INVOICE_AMT, PURCHASE_INVOICE_AMT } = require("../utils/statementPayType");

// ──────────────────────────────────────────────────────────
//  helper — نطاق التاريخ الافتراضي
// ──────────────────────────────────────────────────────────
function resolveDateRange(startDate, endDate) {
  const now        = new Date();
  const year       = now.getFullYear();
  const today      = now.toISOString().split("T")[0];
  const yearStart  = `${year}-01-01`;

  return {
    start : startDate || yearStart,
    end   : endDate   || today,
  };
}

// ──────────────────────────────────────────────────────────
//  helper — رأس التقرير (يُضاف لكل رد)
// ──────────────────────────────────────────────────────────
async function buildReportHeader(reportName, start, end) {
  const co = await db.queryOne(`SELECT * FROM CompanyInformation_tbl LIMIT 1`);
  return {
    reportName,
    period      : { start, end, label: `من ${start} إلى ${end}` },
    generatedAt : new Date().toISOString(),
    company     : co
      ? {
          name   : co.CompanyInformation_Name,
          mobile : co.CompanyInformation_Mobile,
          address: co.CompanyInformation_Adress,
          info1  : co.CompanyInformation_Info1,
          info2  : co.CompanyInformation_Info2,
        }
      : { name: "اسم الشركة" },
  };
}

// ──────────────────────────────────────────────────────────
//  helper — تقريب آمن
// ──────────────────────────────────────────────────────────
const r2 = (n) => Math.round((n || 0) * 100) / 100;
const {
  pushCashDetailedTransactions,
  sortDetailedTransactions,
  compareStatementRows,
} = require("../utils/statementCashRows");

const TX_DT = (table, idCol, dateCol) =>
  `COALESCE(
    (SELECT al.ChangeDate || ' ' || al.ChangeTime
     FROM AuditLog_tbl al
     WHERE al.TableName = '${table}' AND al.RecordID = ${idCol}
     ORDER BY al.id_AuditLog ASC LIMIT 1),
    ${dateCol} || ' 00:00:00'
  )`;

const TX_SEQ = (table, idCol) =>
  `COALESCE(
    (SELECT MIN(al.id_AuditLog) FROM AuditLog_tbl al
     WHERE al.TableName = '${table}' AND al.RecordID = ${idCol}),
    ${idCol}
  )`;

// ══════════════════════════════════════════════════════════
//  أ- كشف الحساب التفصيلي
//  GET /api/reports/statement
//  ?partyType=CUSTOMER|SUPPLIER &id_Party= &startDate= &endDate=
// ══════════════════════════════════════════════════════════
const detailedStatement = async (req, res) => {
  const { partyType, id_Party, startDate, endDate } = req.query;

  if (!id_Party || !partyType)
    return res.status(400).json({
      success : false,
      message : "partyType (CUSTOMER|SUPPLIER) و id_Party مطلوبان",
    });
  if (!["CUSTOMER", "SUPPLIER"].includes(partyType))
    return res.status(400).json({ success: false, message: "partyType: CUSTOMER أو SUPPLIER" });

  const { start, end } = resolveDateRange(startDate, endDate);

  try {
    // ── بيانات الطرف ──────────────────────────────────────
    let party;
    if (partyType === "CUSTOMER") {
      party = await db.queryOne(
        `SELECT z.*, zl.Location_ZabonLocation
         FROM Zabon_tbl z
         LEFT JOIN Zabon_Location zl ON zl.id_ZabonLocation = z.id_ZabonLocation
         WHERE z.id_Zabon = ?`, [id_Party]
      );
      if (!party) return res.status(404).json({ success: false, message: "الزبون غير موجود" });
    } else {
      party = await db.queryOne(`SELECT * FROM Amil_tbl WHERE id_Amil = ?`, [id_Party]);
      if (!party) return res.status(404).json({ success: false, message: "المورد غير موجود" });
    }

    // ── الرصيد المدور (Balance Brought Forward)
    //    = مجموع كل الحركات قبل startDate
    // ──────────────────────────────────────────────────────
    let balanceBroughtForward = 0;

    if (partyType === "CUSTOMER") {
      // ديون متراكمة قبل الفترة
      const [debts, catches, retursAdj, salesBefore] = await Promise.all([
        db.queryOne(
          `SELECT COALESCE(SUM(Amount_DionZabon),0) AS t
           FROM DionZabon_tbl
           WHERE id_Zabon=? AND Date_DionZabon < ?
             AND Note_DionZabon NOT LIKE 'فاتورة مبيعات رقم%'
             AND Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'`,
          [id_Party, start]
        ),
        db.queryOne(
          `SELECT COALESCE(SUM(Amount_CatchDoc),0) AS t
           FROM CatchDoc_tbl WHERE id_Zabon=? AND Date_CatchDoc < ?`,
          [id_Party, start]
        ),
        // مرتجعات قبل الفترة تُخصم من الدين
        db.queryOne(
          `SELECT COALESCE(SUM(d.AmountOUT * d.PriceOUT),0) AS t
           FROM DetailsRetern_tbl d
           JOIN FRetern_tbl r ON r.id_NoFRetern = d.id_NoFRetern
           WHERE r.ReturnType='CUSTOMER' AND r.id_Party=? AND r.Date_FRetern < ?`,
          [id_Party, start]
        ),
        db.queryOne(
          `SELECT COALESCE(SUM(${SALE_INVOICE_AMT}),0) AS t
           FROM FOUT_tbl f
           LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
           WHERE f.id_Zabon=? AND f.Date_FOUT < ? AND ${DEFERRED_PAY_SQL}`,
          [id_Party, start]
        ),
      ]);
      balanceBroughtForward = r2(debts.t - catches.t - retursAdj.t + salesBefore.t);
    } else {
      const [debts, pays, purchasesBefore] = await Promise.all([
        db.queryOne(
          `SELECT COALESCE(SUM(Amount_DionAmil),0) AS t
           FROM DionAmil_tbl
           WHERE id_Amil=? AND Date_DionAmil < ?
             AND Note_DionAmil NOT LIKE 'فاتورة مشتريات رقم%'
             AND Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'`,
          [id_Party, start]
        ),
        db.queryOne(
          `SELECT COALESCE(SUM(Amount_PayDoc),0) AS t
           FROM PayDoc_tbl WHERE id_Amil=? AND Date_PayDoc < ?`,
          [id_Party, start]
        ),
        db.queryOne(
          `SELECT COALESCE(SUM(${PURCHASE_INVOICE_AMT}),0) AS t
           FROM FIN_tbl f
           LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FIN
           WHERE f.id_Amil=? AND f.Date_FIN < ? AND ${DEFERRED_PAY_SQL}`,
          [id_Party, start]
        ),
      ]);
      balanceBroughtForward = r2(debts.t - pays.t + purchasesBefore.t);
    }

    // ── جمع الحركات خلال الفترة ──────────────────────────
    const transactions = [];

    if (partyType === "CUSTOMER") {
      // فواتير المبيعات — آجل يؤثر على الرصيد | نقدي للعرض فقط
      const sales = await db.query(
        `SELECT
           f.id_NoFOUT AS docNo,
           f.Date_FOUT AS date,
           'فاتورة مبيعات' AS type,
           pt.PayTypeName AS note,
           ${SALE_INVOICE_AMT} AS amount,
           CASE WHEN ${DEFERRED_PAY_SQL} THEN 1 ELSE 0 END AS isDeferred
         FROM FOUT_tbl f
         LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
         WHERE f.id_Zabon=? AND f.Date_FOUT BETWEEN ? AND ?`,
        [id_Party, start, end]
      );

      // مرتجعات الزبون (تُقلّل الدين)
      const returns = await db.query(
        `SELECT
           r.id_NoFRetern AS docNo,
           r.Date_FRetern AS date,
           'مرتجع مبيعات' AS type,
           'credit' AS side,
           SUM(d.AmountOUT * d.PriceOUT) AS amount,
           r.Note_FRetern AS note
         FROM FRetern_tbl r
         LEFT JOIN DetailsRetern_tbl d ON d.id_NoFRetern = r.id_NoFRetern
         WHERE r.ReturnType='CUSTOMER' AND r.id_Party=?
           AND r.Date_FRetern BETWEEN ? AND ?
         GROUP BY r.id_NoFRetern`,
        [id_Party, start, end]
      );

      // سندات القبض
      const catches = await db.query(
        `SELECT
           id_CatchDoc AS docNo,
           Date_CatchDoc AS date,
           'سند قبض' AS type,
           'credit' AS side,
           Amount_CatchDoc AS amount,
           Note_CatchDoc AS note
         FROM CatchDoc_tbl
         WHERE id_Zabon=? AND Date_CatchDoc BETWEEN ? AND ?`,
        [id_Party, start, end]
      );

      // أي قيد دين مباشر (آجل من الفواتير)
      const debtEntries = await db.query(
        `SELECT
           id_DionZabon AS docNo,
           Date_DionZabon AS date,
           CASE WHEN Amount_DionZabon > 0 THEN 'قيد مدين' ELSE 'قيد خصم' END AS type,
           CASE WHEN Amount_DionZabon > 0 THEN 'debit' ELSE 'credit' END AS side,
           ABS(Amount_DionZabon) AS amount,
           Note_DionZabon AS note
         FROM DionZabon_tbl
         WHERE id_Zabon=? AND Date_DionZabon BETWEEN ? AND ?
           AND Note_DionZabon NOT LIKE 'تسوية سند قبض%'
           AND Note_DionZabon NOT LIKE 'فاتورة مبيعات رقم%'
           AND Note_DionZabon NOT LIKE 'مرتجع%'`,
        [id_Party, start, end]
      );

      for (const s of sales) {
        const amt = r2(s.amount);
        if (s.isDeferred) {
          transactions.push({ ...s, side: "debit", amount: amt, balanceDelta: amt });
        } else {
          pushCashDetailedTransactions(transactions, s, "CUSTOMER");
        }
      }
      transactions.push(...returns, ...catches, ...debtEntries);
    } else {
      // فواتير الشراء — آجل يؤثر على الرصيد | نقدي للعرض فقط
      const purchases = await db.query(
        `SELECT
           f.id_NoFIN AS docNo,
           f.Date_FIN AS date,
           'فاتورة شراء' AS type,
           pt.PayTypeName AS note,
           ${PURCHASE_INVOICE_AMT} AS amount,
           CASE WHEN ${DEFERRED_PAY_SQL} THEN 1 ELSE 0 END AS isDeferred
         FROM FIN_tbl f
         LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FIN
         WHERE f.id_Amil=? AND f.Date_FIN BETWEEN ? AND ?`,
        [id_Party, start, end]
      );

      // مرتجعات المورد
      const returns = await db.query(
        `SELECT
           r.id_NoFRetern AS docNo,
           r.Date_FRetern AS date,
           'مرتجع مشتريات' AS type,
           'credit' AS side,
           SUM(d.AmountOUT * d.PriceOUT) AS amount,
           r.Note_FRetern AS note
         FROM FRetern_tbl r
         LEFT JOIN DetailsRetern_tbl d ON d.id_NoFRetern = r.id_NoFRetern
         WHERE r.ReturnType='SUPPLIER' AND r.id_Party=?
           AND r.Date_FRetern BETWEEN ? AND ?
         GROUP BY r.id_NoFRetern`,
        [id_Party, start, end]
      );

      // سندات الدفع
      const pays = await db.query(
        `SELECT
           id_PayDoc AS docNo,
           Date_PayDoc AS date,
           'سند دفع' AS type,
           'credit' AS side,
           Amount_PayDoc AS amount,
           Note_PayDoc AS note
         FROM PayDoc_tbl
         WHERE id_Amil=? AND Date_PayDoc BETWEEN ? AND ?`,
        [id_Party, start, end]
      );

      for (const p of purchases) {
        const amt = r2(p.amount);
        if (p.isDeferred) {
          transactions.push({ ...p, side: "debit", amount: amt, balanceDelta: amt });
        } else {
          pushCashDetailedTransactions(transactions, p, "SUPPLIER");
        }
      }
      transactions.push(...returns, ...pays);
    }

    // ── ترتيب بالتاريخ + حساب الرصيد المتراكم ────────────
    sortDetailedTransactions(transactions);

    let runningBalance = balanceBroughtForward;
    const ledger = transactions.map((tx) => {
      const amt   = r2(Number(tx.amount));
      const delta = tx.balanceDelta != null
        ? tx.balanceDelta
        : (tx.side === "debit" ? amt : -amt);
      runningBalance = r2(runningBalance + delta);
      return {
        docNo          : tx.docNo,
        date           : tx.date,
        type           : tx.type,
        side           : tx.side,
        sideLabel      : tx.side === "debit" ? "مدين" : "دائن",
        amount         : amt,
        note           : tx.note || "",
        runningBalance,
      };
    });

    // ── ملخص الفترة ───────────────────────────────────────
    const totalDebit  = r2(ledger.filter((t) => t.side === "debit" ).reduce((s, t) => s + t.amount, 0));
    const totalCredit = r2(ledger.filter((t) => t.side === "credit").reduce((s, t) => s + t.amount, 0));
    const closingBalance = r2(balanceBroughtForward + totalDebit - totalCredit);

    const header = await buildReportHeader("كشف الحساب التفصيلي", start, end);

    res.json({
      success      : true,
      reportHeader : header,
      party        : {
        id       : id_Party,
        type     : partyType,
        name     : partyType === "CUSTOMER"
          ? party.ZabonName
          : party.AmilName,
      },
      summary : {
        balanceBroughtForward,
        totalDebit,
        totalCredit,
        closingBalance,
        closingLabel : closingBalance > 0
          ? `متبقي على ${partyType === "CUSTOMER" ? "الزبون" : "المورد"}: ${closingBalance}`
          : closingBalance < 0
            ? `رصيد دائن: ${Math.abs(closingBalance)}`
            : "الحساب مسوَّى ✓",
      },
      transactions : ledger,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  ب- جرد وتثمين المخزن
//  GET /api/reports/inventory
//  ?startDate= &endDate= &id_Catiguary= &lowStock=
// ══════════════════════════════════════════════════════════
const inventoryReport = async (req, res) => {
  const { startDate, endDate, id_Catiguary, lowStock } = req.query;
  const { start, end } = resolveDateRange(startDate, endDate);

  try {
    // ── قائمة المواد مع المخزون الحالي والقيمة ───────────
    let matSql = `
      SELECT
        m.id_Material_NoM,
        m.MaterialName,
        m.Barcode,
        m.Band,
        m."Cost Price"                           AS CostPrice,
        c.CatiguaryName,
        t.TypeName,
        COALESCE(s.QuantityOnHand,  0)           AS QuantityOnHand,
        COALESCE(s.QuantityIN,      0)           AS TotalIN,
        COALESCE(s.QuantityOUT,     0)           AS TotalOUT,
        COALESCE(s.QuantityReturn,  0)           AS TotalReturn,
        COALESCE(sp.LastSellPrice,  0)           AS LastSellPrice,
        -- قيمة المخزون بسعر التكلفة
        COALESCE(s.QuantityOnHand, 0) * m."Cost Price" AS StockValueAtCost,
        -- قيمة المخزون بسعر البيع
        COALESCE(s.QuantityOnHand, 0) * COALESCE(sp.LastSellPrice, 0) AS StockValueAtSell
      FROM Materials_tbl m
      LEFT JOIN Catiguary_tbl         c  ON c.id_Catiguary    = m.id_Catiguary
      LEFT JOIN Type_tbl              t  ON t.id_Type          = m.id_Type
      LEFT JOIN Stock_tbl             s  ON s.id_Material_NoM  = m.id_Material_NoM
      LEFT JOIN SellPrice_tbl sp ON sp.id_Material_NoM = m.id_Material_NoM
      WHERE 1=1`;
    const p = [];
    if (id_Catiguary) { matSql += " AND m.id_Catiguary = ?"; p.push(id_Catiguary); }
    if (lowStock)     { matSql += " AND COALESCE(s.QuantityOnHand,0) <= ?"; p.push(Number(lowStock)); }
    matSql += " ORDER BY c.CatiguaryName, m.MaterialName";

    const materials = await db.query(matSql, p);

    // ── حركة الأصناف خلال الفترة ─────────────────────────
    const movements = await db.query(
      `SELECT
         m.id_Material_NoM,
         COALESCE(SUM(di.AmountIN),  0)  AS PeriodIN,
         COALESCE(SUM(di.Gift_IN),   0)  AS PeriodGift
       FROM Materials_tbl m
       LEFT JOIN DetailsIN_tbl di ON di.id_Material_NoM = m.id_Material_NoM
       LEFT JOIN FIN_tbl        fi ON fi.id_NoFIN        = di.id_NoFIN
                                   AND fi.Date_FIN BETWEEN ? AND ?
       GROUP BY m.id_Material_NoM`,
      [start, end]
    );
    const movOUT = await db.query(
      `SELECT
         m.id_Material_NoM,
         COALESCE(SUM(do_.AmountOUT), 0) AS PeriodOUT
       FROM Materials_tbl m
       LEFT JOIN DetailsOUT_tbl do_ ON do_.id_Material_NoM = m.id_Material_NoM
       LEFT JOIN FOUT_tbl         fo ON fo.id_NoFOUT        = do_.id_NoFOUT
                                     AND fo.Date_FOUT BETWEEN ? AND ?
       GROUP BY m.id_Material_NoM`,
      [start, end]
    );

    // دمج الحركة مع المواد
    const movMap    = Object.fromEntries(movements.map((m) => [m.id_Material_NoM, m]));
    const movOUTMap = Object.fromEntries(movOUT.map((m) => [m.id_Material_NoM, m]));

    const enriched = materials.map((mat) => {
      const mov  = movMap[mat.id_Material_NoM]    || {};
      const movo = movOUTMap[mat.id_Material_NoM] || {};
      return {
        ...mat,
        StockValueAtCost : r2(mat.StockValueAtCost),
        StockValueAtSell : r2(mat.StockValueAtSell),
        PotentialProfit  : r2(mat.StockValueAtSell - mat.StockValueAtCost),
        period           : {
          IN   : mov.PeriodIN   || 0,
          Gift : mov.PeriodGift || 0,
          OUT  : movo.PeriodOUT || 0,
        },
      };
    });

    // ── المجاميع الإجمالية ────────────────────────────────
    const totals = {
      totalItems          : enriched.length,
      totalUnitsOnHand    : enriched.reduce((s, m) => s + m.QuantityOnHand, 0),
      totalValueAtCost    : r2(enriched.reduce((s, m) => s + m.StockValueAtCost, 0)),
      totalValueAtSell    : r2(enriched.reduce((s, m) => s + m.StockValueAtSell, 0)),
      totalPotentialProfit: r2(enriched.reduce((s, m) => s + m.PotentialProfit, 0)),
      periodTotalIN       : enriched.reduce((s, m) => s + m.period.IN, 0),
      periodTotalOUT      : enriched.reduce((s, m) => s + m.period.OUT, 0),
      outOfStockItems     : enriched.filter((m) => m.QuantityOnHand <= 0).length,
    };

    // تجميع حسب الصنف
    const byCategory = {};
    enriched.forEach((mat) => {
      const cat = mat.CatiguaryName || "غير مصنّف";
      if (!byCategory[cat]) {
        byCategory[cat] = { items: 0, totalValueAtCost: 0, totalUnits: 0 };
      }
      byCategory[cat].items++;
      byCategory[cat].totalValueAtCost = r2(byCategory[cat].totalValueAtCost + mat.StockValueAtCost);
      byCategory[cat].totalUnits       += mat.QuantityOnHand;
    });

    const header = await buildReportHeader("جرد وتثمين المخزن", start, end);

    res.json({
      success      : true,
      reportHeader : header,
      totals,
      byCategory,
      materials    : enriched,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  ج- الأرباح والخسائر (P&L)
//  GET /api/reports/profit-loss
//  ?startDate= &endDate=
// ══════════════════════════════════════════════════════════
const profitAndLoss = async (req, res) => {
  const { startDate, endDate } = req.query;
  const { start, end }         = resolveDateRange(startDate, endDate);

  try {
    // ── إجمالي المبيعات ───────────────────────────────────
    const salesRow = await db.queryOne(
      `SELECT
         COUNT(DISTINCT f.id_NoFOUT)                       AS invoiceCount,
         COALESCE(SUM(d.AmountOUT * d.PriceOUT), 0)        AS grossRevenue,
         COALESCE(SUM(f.Dis_FOUT), 0)                      AS totalDiscount
       FROM FOUT_tbl f
       LEFT JOIN DetailsOUT_tbl d ON d.id_NoFOUT = f.id_NoFOUT
       WHERE f.Date_FOUT BETWEEN ? AND ?`,
      [start, end]
    );
    const netRevenue = r2(salesRow.grossRevenue - salesRow.totalDiscount);

    // ── مرتجعات المبيعات (تُخصم من الإيراد) ─────────────
    const salesReturnsRow = await db.queryOne(
      `SELECT COALESCE(SUM(d.AmountOUT * d.PriceOUT), 0) AS t
       FROM DetailsRetern_tbl d
       JOIN FRetern_tbl r ON r.id_NoFRetern = d.id_NoFRetern
       WHERE r.ReturnType = 'CUSTOMER' AND r.Date_FRetern BETWEEN ? AND ?`,
      [start, end]
    );
    const salesReturns = r2(salesReturnsRow.t);

    // الإيراد الصافي بعد المرتجعات
    const netRevenueAfterReturns = r2(netRevenue - salesReturns);

    // ── تكلفة البضاعة المباعة (COGS)
    //    COGS = Σ (الكمية المباعة × تكلفة المادة وقت البيع)
    //    نستخدم "Cost Price" الحالي كتقريب
    // ──────────────────────────────────────────────────────
    const cogsRow = await db.queryOne(
      `SELECT COALESCE(SUM(d.AmountOUT * m."Cost Price"), 0) AS t
       FROM DetailsOUT_tbl d
       JOIN FOUT_tbl         f ON f.id_NoFOUT        = d.id_NoFOUT
       JOIN Materials_tbl    m ON m.id_Material_NoM  = d.id_Material_NoM
       WHERE f.Date_FOUT BETWEEN ? AND ?`,
      [start, end]
    );
    const cogs = r2(cogsRow.t);

    // ── إجمالي الربح (Gross Profit) ───────────────────────
    const grossProfit = r2(netRevenueAfterReturns - cogs);

    // ── المصاريف التشغيلية (من SpendingDetails_tbl) ──────
    const spendingRow = await db.queryOne(
      `SELECT COALESCE(SUM(sd.Price_SpendingDetails), 0) AS t
       FROM SpendingDetails_tbl sd
       WHERE sd.Date_SpendingDetails BETWEEN ? AND ?`,
      [start, end]
    );
    const totalSpending = r2(spendingRow.t);

    // تفصيل المصاريف حسب النوع
    const spendingByType = await db.query(
      `SELECT
         s.NamePersonFor_Spending AS spendingType,
         COALESCE(SUM(sd.Price_SpendingDetails), 0) AS amount
       FROM SpendingDetails_tbl sd
       LEFT JOIN Spending_tbl s ON s.id_Spending = sd.id_Spending
       WHERE sd.Date_SpendingDetails BETWEEN ? AND ?
       GROUP BY sd.id_Spending
       ORDER BY amount DESC`,
      [start, end]
    );

    // ── صافي الربح (Net Profit) ───────────────────────────
    const netProfit = r2(grossProfit - totalSpending);

    // ── مؤشرات الأداء ────────────────────────────────────
    const grossMarginPct = netRevenueAfterReturns > 0
      ? r2((grossProfit / netRevenueAfterReturns) * 100) : 0;
    const netMarginPct   = netRevenueAfterReturns > 0
      ? r2((netProfit   / netRevenueAfterReturns) * 100) : 0;

    // ── إجمالي المشتريات (للمقارنة) ─────────────────────
    const purchasesRow = await db.queryOne(
      `SELECT
         COUNT(DISTINCT f.id_NoFIN)                        AS invoiceCount,
         COALESCE(SUM(d.AmountIN * d.PriceIN), 0)          AS grossCost,
         COALESCE(SUM(f.Trans + f.Customs + f.Porter), 0)  AS totalExtras,
         COALESCE(SUM(f.Dis_FIN), 0)                       AS totalDiscount
       FROM FIN_tbl f
       LEFT JOIN DetailsIN_tbl d ON d.id_NoFIN = f.id_NoFIN
       WHERE f.Date_FIN BETWEEN ? AND ?`,
      [start, end]
    );
    const netPurchases = r2(
      purchasesRow.grossCost
      + purchasesRow.totalExtras
      - purchasesRow.totalDiscount
    );

    const header = await buildReportHeader("تقرير الأرباح والخسائر", start, end);

    res.json({
      success      : true,
      reportHeader : header,

      // ── الإيرادات ─────────────────────────────────────
      revenue : {
        label             : "الإيرادات",
        grossRevenue      : r2(salesRow.grossRevenue),
        totalDiscount     : r2(salesRow.totalDiscount),
        netRevenue,
        salesReturns,
        netRevenueAfterReturns,
        invoiceCount      : salesRow.invoiceCount,
      },

      // ── التكاليف ──────────────────────────────────────
      costs : {
        label       : "تكلفة البضاعة المباعة (COGS)",
        cogs,
        grossProfit,
        grossMarginPct: `${grossMarginPct}%`,
      },

      // ── المصاريف ──────────────────────────────────────
      expenses : {
        label           : "المصاريف التشغيلية",
        totalSpending,
        breakdown       : spendingByType.map((s) => ({
          type   : s.spendingType,
          amount : r2(s.amount),
        })),
      },

      // ── الربح الصافي ──────────────────────────────────
      netProfit : {
        label         : "صافي الربح (الخسارة)",
        value         : netProfit,
        netMarginPct  : `${netMarginPct}%`,
        status        : netProfit > 0 ? "ربح ✓" : netProfit < 0 ? "خسارة ✗" : "تعادل",
      },

      // ── المشتريات (للمقارنة) ──────────────────────────
      purchases : {
        label        : "إجمالي المشتريات",
        netPurchases,
        invoiceCount : purchasesRow.invoiceCount,
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  د- تقرير حركة المندوبين
//  GET /api/reports/sales-reps
//  ?startDate= &endDate= &commissionRate=
// ══════════════════════════════════════════════════════════
const salesRepsReport = async (req, res) => {
  const { startDate, endDate, commissionRate = 2 } = req.query;
  const { start, end } = resolveDateRange(startDate, endDate);
  const rate           = Number(commissionRate) / 100;

  try {
    // ── مبيعات كل مندوب ──────────────────────────────────
    const repsData = await db.query(
      `SELECT
         m.id_Mandob,
         m.MandobName,
         COUNT(DISTINCT f.id_NoFOUT)                       AS invoiceCount,
         COUNT(DISTINCT f.id_Zabon)                        AS customerCount,
         COALESCE(SUM(d.AmountOUT * d.PriceOUT), 0)        AS grossSales,
         COALESCE(SUM(f.Dis_FOUT), 0)                      AS totalDiscount,
         COALESCE(SUM(d.AmountOUT * d.PriceOUT)
                  - SUM(f.Dis_FOUT), 0)                    AS netSales,
         COALESCE(SUM(d.AmountOUT), 0)                     AS totalUnits
       FROM Mandob_tbl m
       LEFT JOIN FOUT_tbl f ON f.id_Mandob = m.id_Mandob
                            AND f.Date_FOUT BETWEEN ? AND ?
       LEFT JOIN DetailsOUT_tbl d ON d.id_NoFOUT = f.id_NoFOUT
       GROUP BY m.id_Mandob
       ORDER BY netSales DESC`,
      [start, end]
    );

    // ── الإجماليات الكلية ─────────────────────────────────
    const totalNet = repsData.reduce((s, r) => s + r.netSales, 0);

    const enriched = repsData.map((rep) => {
      const net        = r2(rep.netSales);
      const commission = r2(net * rate);
      const sharePct   = totalNet > 0 ? r2((net / totalNet) * 100) : 0;

      // أكثر زبائن اشترى من هذا المندوب
      return {
        id_Mandob    : rep.id_Mandob,
        MandobName   : rep.MandobName,
        invoiceCount : rep.invoiceCount,
        customerCount: rep.customerCount,
        totalUnits   : rep.totalUnits,
        grossSales   : r2(rep.grossSales),
        totalDiscount: r2(rep.totalDiscount),
        netSales     : net,
        commission   : {
          rate      : `${commissionRate}%`,
          amount    : commission,
        },
        shareOfTotal : `${sharePct}%`,
      };
    });

    // مبيعات بدون مندوب
    const noRepRow = await db.queryOne(
      `SELECT
         COUNT(DISTINCT f.id_NoFOUT)                 AS invoiceCount,
         COALESCE(SUM(d.AmountOUT * d.PriceOUT)
                  - SUM(f.Dis_FOUT), 0)              AS netSales
       FROM FOUT_tbl f
       LEFT JOIN DetailsOUT_tbl d ON d.id_NoFOUT = f.id_NoFOUT
       WHERE f.id_Mandob IS NULL AND f.Date_FOUT BETWEEN ? AND ?`,
      [start, end]
    );

    const header = await buildReportHeader("تقرير حركة المندوبين", start, end);

    res.json({
      success      : true,
      reportHeader : header,
      commissionRate: `${commissionRate}%`,
      summary      : {
        totalReps            : enriched.length,
        totalNetSales        : r2(totalNet),
        totalCommissions     : r2(enriched.reduce((s, r) => s + r.commission.amount, 0)),
        unassignedInvoices   : noRepRow.invoiceCount,
        unassignedNetSales   : r2(noRepRow.netSales),
      },
      reps         : enriched,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  هـ- ملخص لوحة القيادة (Dashboard Summary)
//  GET /api/reports/dashboard
//  مسار سريع للواجهة الرئيسية
// ══════════════════════════════════════════════════════════
const dashboard = async (req, res) => {
  const { startDate, endDate } = req.query;
  const { start, end }         = resolveDateRange(startDate, endDate);

  try {
    const [
      salesGrossRow, salesDiscRow, salesAddRow, salesRetRow,
      purchasesRow, stockRow,
      customersDebt, suppliersDebt,
      spendingRow, returnsRow,
      cogsRow, cogsRetRow,
    ] = await Promise.all([
      db.queryOne(
        `SELECT COUNT(DISTINCT f.id_NoFOUT) AS cnt,
                COALESCE(SUM(d.AmountOUT * d.PriceOUT), 0) AS total
         FROM FOUT_tbl f
         JOIN DetailsOUT_tbl d ON d.id_NoFOUT = f.id_NoFOUT
         WHERE f.Date_FOUT BETWEEN ? AND ?`, [start, end]
      ),
      db.queryOne(
        `SELECT COALESCE(SUM(Dis_FOUT), 0) AS total
         FROM FOUT_tbl WHERE Date_FOUT BETWEEN ? AND ?`, [start, end]
      ),
      db.queryOne(
        `SELECT COALESCE(SUM(COALESCE(Add_FOUT, 0)), 0) AS total
         FROM FOUT_tbl WHERE Date_FOUT BETWEEN ? AND ?`, [start, end]
      ),
      db.queryOne(
        `SELECT COALESCE(SUM(dr.AmountOUT * dr.PriceOUT), 0) AS total
         FROM DetailsRetern_tbl dr
         JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
         WHERE fr.ReturnType = 'CUSTOMER' AND fr.Date_FRetern BETWEEN ? AND ?`,
        [start, end]
      ),
      // مشتريات الفترة — نفس معادلة الفاتورة (كل حقول LC، بدون تكرار JOIN)
      db.queryOne(
        `SELECT COUNT(*) AS cnt,
                COALESCE(SUM(
                  COALESCE((
                    SELECT SUM(d.AmountIN * d.PriceIN)
                    FROM DetailsIN_tbl d WHERE d.id_NoFIN = f.id_NoFIN
                  ), 0)
                  + f.Trans + f.Customs + f.Porter
                  + COALESCE(f.SGS, 0) + COALESCE(f.ExportRelease, 0) + COALESCE(f.VehicleManifest, 0)
                  - f.Dis_FIN
                ), 0) AS total
         FROM FIN_tbl f
         WHERE f.Date_FIN BETWEEN ? AND ?`, [start, end]
      ),
      // قيمة المخزون الحالية
      db.queryOne(
        `SELECT COALESCE(SUM(s.QuantityOnHand * m."Cost Price"),0) AS value,
                COUNT(*) AS items,
                SUM(CASE WHEN s.QuantityOnHand<=0 THEN 1 ELSE 0 END) AS outOfStock
         FROM Stock_tbl s JOIN Materials_tbl m ON m.id_Material_NoM=s.id_Material_NoM`
      ),
      // إجمالي ديون الزبائن — بدون قيود التسوية (نفس منطق getZabonBalance)
      db.queryOne(
        `SELECT COALESCE((
           SELECT SUM(Amount_DionZabon) FROM DionZabon_tbl
           WHERE Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'
             AND Note_DionZabon NOT LIKE 'سماح سند قبض رقم%'
         ), 0)
         - COALESCE((SELECT SUM(Amount_CatchDoc) FROM CatchDoc_tbl), 0)
         - COALESCE((SELECT SUM(AllowanceAmount) FROM CatchDoc_tbl), 0) AS t`
      ),
      // إجمالي ديوننا للموردين — بدون قيود التسوية (نفس منطق getAmilBalance)
      db.queryOne(
        `SELECT COALESCE((
           SELECT SUM(Amount_DionAmil) FROM DionAmil_tbl
           WHERE Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'
         ), 0)
         - COALESCE((SELECT SUM(Amount_PayDoc) FROM PayDoc_tbl), 0) AS t`
      ),
      // مصاريف الفترة
      db.queryOne(
        `SELECT COALESCE(SUM(Price_SpendingDetails),0) AS t
         FROM SpendingDetails_tbl WHERE Date_SpendingDetails BETWEEN ? AND ?`,
        [start, end]
      ),
      // مرتجعات الفترة
      db.queryOne(
        `SELECT COUNT(*) AS cnt FROM FRetern_tbl WHERE Date_FRetern BETWEEN ? AND ?`,
        [start, end]
      ),
      // ✅ تكلفة البضاعة المباعة (COGS) — الكمية المباعة × سعر التكلفة الحالي
      // المعادلة الصحيحة: COGS = Σ (AmountOUT × "Cost Price")
      // ملاحظة: "Cost Price" في Materials_tbl هو المعدل المرجح المحدَّث تلقائياً
      db.queryOne(
        `SELECT COALESCE(SUM(d.AmountOUT * m."Cost Price"), 0) AS total
         FROM DetailsOUT_tbl d
         JOIN FOUT_tbl f       ON f.id_NoFOUT        = d.id_NoFOUT
         JOIN Materials_tbl m  ON m.id_Material_NoM  = d.id_Material_NoM
         WHERE f.Date_FOUT BETWEEN ? AND ?`,
        [start, end]
      ),
      db.queryOne(
        `SELECT COALESCE(SUM(dr.AmountOUT * m."Cost Price"), 0) AS total
         FROM DetailsRetern_tbl dr
         JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
         JOIN Materials_tbl m ON m.id_Material_NoM = dr.id_Material_NoM
         WHERE fr.ReturnType = 'CUSTOMER' AND fr.Date_FRetern BETWEEN ? AND ?`,
        [start, end]
      ),
    ]);

    const netSales = r2(
      salesGrossRow.total + salesAddRow.total - salesDiscRow.total - salesRetRow.total
    );
    const netCOGS = r2(cogsRow.total - cogsRetRow.total);
    // هامش الربح = نفس منطق تقرير الربح الحقيقي وربحية المواد (قبل المصاريف)
    const grossProfit = r2(netSales - netCOGS);

    const header = await buildReportHeader("لوحة القيادة", start, end);

    res.json({
      success      : true,
      reportHeader : header,
      cards        : {
        sales      : { label: "إجمالي المبيعات", value: netSales,
                       count: salesGrossRow.cnt },
        purchases  : { label: "إجمالي المشتريات", value: r2(purchasesRow.total), count: purchasesRow.cnt },
        grossProfit: { label: "هامش الربح", value: grossProfit,
                       status: grossProfit >= 0 ? "ربح" : "خسارة" },
        spending   : { label: "المصاريف", value: r2(spendingRow.t) },
        stock      : { label: "قيمة المخزون", value: r2(stockRow.value),
                       items: stockRow.items, outOfStock: stockRow.outOfStock },
        customers  : { label: "إجمالي ديون الزبائن",  value: r2(customersDebt.t) },
        suppliers  : { label: "إجمالي ديوننا للموردين", value: r2(suppliersDebt.t) },
        returns    : { label: "المرتجعات", count: returnsRow.cnt },
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  و- حركة الصندوق (Cash Flow)
//  GET /api/reports/cash-flow
//  ?startDate= &endDate=
// ══════════════════════════════════════════════════════════
const cashFlow = async (req, res) => {
  const { startDate, endDate } = req.query;
  const { start, end } = resolveDateRange(startDate, endDate);
  try {
    const [cashIn, cashOut, supplierPay, spending] = await Promise.all([
      // قبض نقدي من زبائن
      db.queryOne(
        `SELECT COALESCE(SUM(Amount_CatchDoc),0) AS t
         FROM CatchDoc_tbl WHERE Date_CatchDoc BETWEEN ? AND ?`,
        [start, end]
      ),
      // مبيعات نقدية (كل ما ليس آجل)
      db.queryOne(
        `SELECT COALESCE(SUM(d.AmountOUT*d.PriceOUT)-SUM(f.Dis_FOUT),0) AS t
         FROM FOUT_tbl f
         LEFT JOIN DetailsOUT_tbl d ON d.id_NoFOUT=f.id_NoFOUT
         LEFT JOIN PayType_Tbl pt ON pt.id_PayType=f.id_PayType_FOUT
         WHERE pt.PayTypeName NOT IN ('اجل','آجل') AND f.Date_FOUT BETWEEN ? AND ?`,
        [start, end]
      ),
      // دفع لموردين
      db.queryOne(
        `SELECT COALESCE(SUM(Amount_PayDoc),0) AS t
         FROM PayDoc_tbl WHERE Date_PayDoc BETWEEN ? AND ?`,
        [start, end]
      ),
      // مصاريف
      db.queryOne(
        `SELECT COALESCE(SUM(Price_SpendingDetails),0) AS t
         FROM SpendingDetails_tbl WHERE Date_SpendingDetails BETWEEN ? AND ?`,
        [start, end]
      ),
    ]);

    const totalIn  = r2(cashIn.t + cashOut.t);
    const totalOut = r2(supplierPay.t + spending.t);
    const balance  = r2(totalIn - totalOut);
    const header   = await buildReportHeader("حركة الصندوق", start, end);

    res.json({
      success: true, reportHeader: header,
      cashFlow: {
        in:  { label:"المدخلات", total: totalIn,
               details: { customerReceipts: r2(cashIn.t), cashSales: r2(cashOut.t) } },
        out: { label:"المخرجات", total: totalOut,
               details: { supplierPayments: r2(supplierPay.t), spending: r2(spending.t) } },
        balance: { value: balance, status: balance >= 0 ? "رصيد موجب" : "عجز" },
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  ز- حركة المواد (المشتراة / المباعة / المتبقية)
//  GET /api/reports/stock-movement
//  ?startDate= &endDate= &q=
// ══════════════════════════════════════════════════════════
const stockMovement = async (req, res) => {
  const { startDate, endDate, q = "" } = req.query;
  const { start, end } = resolveDateRange(startDate, endDate);
  const like = `%${q}%`;
  try {
    const rows = await db.query(
      `SELECT
         m.id_Material_NoM, m.MaterialName, m.Barcode, m.Band,
         c.CatiguaryName,
         COALESCE(s.QuantityOnHand, 0)                   AS currentStock,
         m."Cost Price"                                   AS CostPrice,
         COALESCE(sp.LastSellPrice, 0)                    AS SellPrice,
         -- مشتريات الفترة
         COALESCE((
           SELECT SUM(di.AmountIN)
           FROM DetailsIN_tbl di JOIN FIN_tbl fi ON fi.id_NoFIN=di.id_NoFIN
           WHERE di.id_Material_NoM=m.id_Material_NoM
             AND fi.Date_FIN BETWEEN ? AND ?
         ),0) AS periodBought,
         -- مبيعات الفترة
         COALESCE((
           SELECT SUM(do_.AmountOUT)
           FROM DetailsOUT_tbl do_ JOIN FOUT_tbl fo ON fo.id_NoFOUT=do_.id_NoFOUT
           WHERE do_.id_Material_NoM=m.id_Material_NoM
             AND fo.Date_FOUT BETWEEN ? AND ?
         ),0) AS periodSold,
         -- مرتجعات الفترة
         COALESCE((
           SELECT SUM(dr.AmountOUT)
           FROM DetailsRetern_tbl dr JOIN FRetern_tbl fr ON fr.id_NoFRetern=dr.id_NoFRetern
           WHERE dr.id_Material_NoM=m.id_Material_NoM
             AND fr.Date_FRetern BETWEEN ? AND ?
         ),0) AS periodReturned
       FROM Materials_tbl m
       LEFT JOIN Catiguary_tbl c  ON c.id_Catiguary    = m.id_Catiguary
       LEFT JOIN Stock_tbl     s  ON s.id_Material_NoM  = m.id_Material_NoM
       LEFT JOIN SellPrice_tbl sp ON sp.id_Material_NoM = m.id_Material_NoM
       WHERE m.MaterialName LIKE ? OR CAST(m.Barcode AS TEXT) LIKE ?
       ORDER BY periodSold DESC, m.MaterialName`,
      [start, end, start, end, start, end, like, like]
    );

    const enriched = rows.map(r => ({
      ...r,
      periodBought  : r2(r.periodBought),
      periodSold    : r2(r.periodSold),
      periodReturned: r2(r.periodReturned),
      netSold       : r2(r.periodSold - r.periodReturned),
      salesRevenue  : r2(r.periodSold * r.SellPrice),
      salesCost     : r2(r.periodSold * r.CostPrice),
      profit        : r2((r.periodSold - r.periodReturned) * (r.SellPrice - r.CostPrice)),
    }));

    const header = await buildReportHeader("حركة المواد", start, end);
    res.json({
      success: true, reportHeader: header,
      totals: {
        totalBought : r2(enriched.reduce((s,r)=>s+r.periodBought,0)),
        totalSold   : r2(enriched.reduce((s,r)=>s+r.netSold,0)),
        totalRevenue: r2(enriched.reduce((s,r)=>s+r.salesRevenue,0)),
        totalProfit : r2(enriched.reduce((s,r)=>s+r.profit,0)),
      },
      items: enriched,
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ══════════════════════════════════════════════════════════
//  ح- التحليل المقارن (الفترة الحالية مقابل السابقة)
//  GET /api/reports/comparison
//  ?startDate= &endDate=
// ══════════════════════════════════════════════════════════
const comparison = async (req, res) => {
  const { startDate, endDate } = req.query;
  const { start, end } = resolveDateRange(startDate, endDate);

  // حساب الفترة السابقة بنفس المدة
  const ms   = new Date(end) - new Date(start);
  const prevEnd   = new Date(new Date(start) - 86400000).toISOString().split("T")[0];
  const prevStart = new Date(new Date(prevEnd) - ms).toISOString().split("T")[0];

  const getSales = async (s, e) => db.queryOne(
    `SELECT COALESCE(SUM(d.AmountOUT*d.PriceOUT)-SUM(f.Dis_FOUT),0) AS t,
            COUNT(DISTINCT f.id_NoFOUT) AS cnt
     FROM FOUT_tbl f LEFT JOIN DetailsOUT_tbl d ON d.id_NoFOUT=f.id_NoFOUT
     WHERE f.Date_FOUT BETWEEN ? AND ?`, [s, e]
  );

  try {
    const [cur, prev] = await Promise.all([getSales(start, end), getSales(prevStart, prevEnd)]);
    const diff    = r2(cur.t - prev.t);
    const pct     = prev.t > 0 ? r2((diff / prev.t) * 100) : 0;
    const header  = await buildReportHeader("التحليل المقارن", start, end);

    res.json({
      success: true, reportHeader: header,
      current : { period:`${start} → ${end}`,   sales:r2(cur.t),  invoices:cur.cnt },
      previous: { period:`${prevStart} → ${prevEnd}`, sales:r2(prev.t), invoices:prev.cnt },
      change  : { amount:diff, percent:`${pct}%`,
                  direction: diff>0?"ارتفاع ▲":diff<0?"انخفاض ▼":"ثابت ◆",
                  label: diff>0?`مبيعاتك ارتفعت ${pct}% عن الفترة السابقة`
                              : diff<0?`مبيعاتك انخفضت ${Math.abs(pct)}% عن الفترة السابقة`
                              : "مبيعاتك مستقرة مقارنة بالفترة السابقة" },
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = {
  detailedStatement,
  inventoryReport,
  profitAndLoss,
  salesRepsReport,
  dashboard,
  cashFlow,
  stockMovement,
  comparison,
};

// ══════════════════════════════════════════════════════════
//  1- تقرير حركة المخزون التفصيلي
//  GET /api/reports/stock-movement-analytics
//  ?startDate= &endDate= &id_Material= &id_Catiguary=
// ══════════════════════════════════════════════════════════
const stockMovementAnalytics = async (req, res) => {
  const { startDate, endDate, id_Material, id_Catiguary } = req.query;
  const { start, end } = resolveDateRange(startDate, endDate);
  try {
    let where = "WHERE 1=1";
    // ترتيب المعاملات: افتتاحي (قبل start) ×2 ثم BETWEEN لكل حركة ×6
    const p = [start, start, start, end, start, end, start, end, start, end, start, end, start, end];
    if (id_Material)  { where += " AND m.id_Material_NoM = ?"; p.push(id_Material); }
    if (id_Catiguary) { where += " AND m.id_Catiguary = ?";    p.push(id_Catiguary); }

    const rows = await db.query(`
      SELECT
        m.id_Material_NoM, m.MaterialName, m.Band, m."Cost Price" AS CostPrice,
        c.CatiguaryName,
        -- الرصيد الافتتاحي (ما قبل الفترة)
        COALESCE((
          SELECT SUM(di2.AmountIN + COALESCE(di2.Gift_IN, 0)) FROM DetailsIN_tbl di2
          JOIN FIN_tbl fi2 ON fi2.id_NoFIN=di2.id_NoFIN
          WHERE di2.id_Material_NoM=m.id_Material_NoM AND fi2.Date_FIN < ?
        ),0) -
        COALESCE((
          SELECT SUM(do2.AmountOUT + COALESCE(do2.gift_qty, 0)) FROM DetailsOUT_tbl do2
          JOIN FOUT_tbl fo2 ON fo2.id_NoFOUT=do2.id_NoFOUT
          WHERE do2.id_Material_NoM=m.id_Material_NoM AND fo2.Date_FOUT < ?
        ),0) AS openingBalance,
        -- وارد: كمية الشراء (بدون الهدية)
        COALESCE((
          SELECT SUM(di.AmountIN) FROM DetailsIN_tbl di
          JOIN FIN_tbl fi ON fi.id_NoFIN=di.id_NoFIN
          WHERE di.id_Material_NoM=m.id_Material_NoM AND fi.Date_FIN BETWEEN ? AND ?
        ),0) AS purchaseQty,
        -- وارد: هدايا الشراء
        COALESCE((
          SELECT SUM(COALESCE(di.Gift_IN, 0)) FROM DetailsIN_tbl di
          JOIN FIN_tbl fi ON fi.id_NoFIN=di.id_NoFIN
          WHERE di.id_Material_NoM=m.id_Material_NoM AND fi.Date_FIN BETWEEN ? AND ?
        ),0) AS purchaseGiftQty,
        -- وارد: مرتجعات مبيعات
        COALESCE((
          SELECT SUM(dr.AmountOUT) FROM DetailsRetern_tbl dr
          JOIN FRetern_tbl fr ON fr.id_NoFRetern=dr.id_NoFRetern
          WHERE dr.id_Material_NoM=m.id_Material_NoM AND fr.ReturnType='CUSTOMER'
            AND fr.Date_FRetern BETWEEN ? AND ?
        ),0) AS salesReturnQty,
        -- صادر: كمية المبيعات (بدون الهدية)
        COALESCE((
          SELECT SUM(do_.AmountOUT) FROM DetailsOUT_tbl do_
          JOIN FOUT_tbl fo ON fo.id_NoFOUT=do_.id_NoFOUT
          WHERE do_.id_Material_NoM=m.id_Material_NoM AND fo.Date_FOUT BETWEEN ? AND ?
        ),0) AS soldQty,
        -- صادر: هدايا المبيعات
        COALESCE((
          SELECT SUM(COALESCE(do_.gift_qty, 0)) FROM DetailsOUT_tbl do_
          JOIN FOUT_tbl fo ON fo.id_NoFOUT=do_.id_NoFOUT
          WHERE do_.id_Material_NoM=m.id_Material_NoM AND fo.Date_FOUT BETWEEN ? AND ?
        ),0) AS salesGiftQty,
        -- صادر: مرتجعات مشتريات
        COALESCE((
          SELECT SUM(dr2.AmountOUT) FROM DetailsRetern_tbl dr2
          JOIN FRetern_tbl fr2 ON fr2.id_NoFRetern=dr2.id_NoFRetern
          WHERE dr2.id_Material_NoM=m.id_Material_NoM AND fr2.ReturnType='SUPPLIER'
            AND fr2.Date_FRetern BETWEEN ? AND ?
        ),0) AS purchaseReturnQty,
        COALESCE(s.QuantityOnHand,0) AS currentStock
      FROM Materials_tbl m
      LEFT JOIN Catiguary_tbl c ON c.id_Catiguary=m.id_Catiguary
      LEFT JOIN Stock_tbl s ON s.id_Material_NoM=m.id_Material_NoM
      ${where}
      ORDER BY m.MaterialName
    `, p);

    const enriched = rows.map(r => {
      const periodIn  = r2(+r.purchaseQty + +r.purchaseGiftQty - +r.purchaseReturnQty);
      const periodOut = r2(+r.soldQty + +r.salesGiftQty - +r.salesReturnQty);
      const closing   = r2(+r.openingBalance + periodIn - periodOut);
      return { ...r, periodIn, periodOut, closingBalance: closing,
               closingValue: r2(closing * r.CostPrice) };
    });

    const header = await buildReportHeader("حركة المخزون التفصيلي", start, end);
    res.json({ success:true, reportHeader:header,
      totals:{ totalItems:enriched.length,
        totalClosingValue: r2(enriched.reduce((s,r)=>s+r.closingValue,0)) },
      items: enriched });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════
//  2- تحليل ABC (الراكد والنشط)
//  GET /api/reports/abc-analysis
//  ?startDate= &endDate=
// ══════════════════════════════════════════════════════════
const abcAnalysis = async (req, res) => {
  const { startDate, endDate } = req.query;
  const { start, end } = resolveDateRange(startDate, endDate);
  try {
    const rows = await db.query(`
      SELECT
        m.id_Material_NoM, m.MaterialName, m.Band, m."Cost Price" AS CostPrice,
        c.CatiguaryName,
        COALESCE(s.QuantityOnHand,0) AS currentStock,
        COALESCE((
          SELECT SUM(do_.AmountOUT) FROM DetailsOUT_tbl do_
          JOIN FOUT_tbl fo ON fo.id_NoFOUT=do_.id_NoFOUT
          WHERE do_.id_Material_NoM=m.id_Material_NoM AND fo.Date_FOUT BETWEEN ? AND ?
        ),0) AS soldQty,
        COALESCE((
          SELECT SUM(do_.AmountOUT * do_.PriceOUT) FROM DetailsOUT_tbl do_
          JOIN FOUT_tbl fo ON fo.id_NoFOUT=do_.id_NoFOUT
          WHERE do_.id_Material_NoM=m.id_Material_NoM AND fo.Date_FOUT BETWEEN ? AND ?
        ),0) AS salesRevenue,
        COALESCE((
          SELECT SUM(di.AmountIN) FROM DetailsIN_tbl di
          JOIN FIN_tbl fi ON fi.id_NoFIN=di.id_NoFIN
          WHERE di.id_Material_NoM=m.id_Material_NoM AND fi.Date_FIN BETWEEN ? AND ?
        ),0) AS purchasedQty
      FROM Materials_tbl m
      LEFT JOIN Catiguary_tbl c ON c.id_Catiguary=m.id_Catiguary
      LEFT JOIN Stock_tbl s ON s.id_Material_NoM=m.id_Material_NoM
      ORDER BY salesRevenue DESC
    `, [start,end, start,end, start,end]);

    const totalRevenue = rows.reduce((s,r)=>s+r.salesRevenue,0);
    let cumulative = 0;
    const enriched = rows.map(r => {
      cumulative += r.salesRevenue;
      const cumPct = totalRevenue>0 ? r2((cumulative/totalRevenue)*100) : 0;
      const revPct = totalRevenue>0 ? r2((r.salesRevenue/totalRevenue)*100) : 0;
      let abcClass = "C"; // راكد
      if (cumPct <= 70) abcClass = "A";       // سريع الحركة
      else if (cumPct <= 90) abcClass = "B"; // متوسط
      const turnoverDays = r.soldQty > 0 && r.purchasedQty > 0
        ? Math.round(r.currentStock / (r.soldQty / 90)) : null;
      return { ...r, salesRevenue:r2(r.salesRevenue), revPct, cumPct, abcClass, turnoverDays };
    });

    const summary = { A: enriched.filter(r=>r.abcClass==="A").length,
                      B: enriched.filter(r=>r.abcClass==="B").length,
                      C: enriched.filter(r=>r.abcClass==="C").length };
    const header = await buildReportHeader("تحليل ABC للمخزون", start, end);
    res.json({ success:true, reportHeader:header, summary, totalRevenue:r2(totalRevenue), items:enriched });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════
//  3- تقرير أعمار المخزون والصلاحية
//  GET /api/reports/aging-expiry
// ══════════════════════════════════════════════════════════
const agingExpiry = async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  try {
    const rows = await db.query(`
      SELECT
        m.id_Material_NoM, m.MaterialName, m.Band, m."Cost Price" AS CostPrice,
        c.CatiguaryName,
        COALESCE(s.QuantityOnHand,0) AS currentStock,
        di.ExpairDate,
        fi.Date_FIN AS purchaseDate,
        di.AmountIN AS purchasedQty,
        di.PriceIN  AS purchasePrice,
        fi.id_NoFIN AS invoiceNo
      FROM DetailsIN_tbl di
      JOIN FIN_tbl fi ON fi.id_NoFIN=di.id_NoFIN
      JOIN Materials_tbl m ON m.id_Material_NoM=di.id_Material_NoM
      LEFT JOIN Catiguary_tbl c ON c.id_Catiguary=m.id_Catiguary
      LEFT JOIN Stock_tbl s ON s.id_Material_NoM=m.id_Material_NoM
      WHERE di.ExpairDate IS NOT NULL AND di.ExpairDate != ''
      ORDER BY di.ExpairDate ASC
    `);

    const enriched = rows.map(r => {
      const expDate = new Date(r.ExpairDate);
      const todayDate = new Date(today);
      const daysLeft = Math.ceil((expDate - todayDate) / 86400000);
      let status = "ok", statusLabel = "جيد";
      if (daysLeft < 0)   { status = "expired"; statusLabel = "منتهي الصلاحية"; }
      else if (daysLeft <= 30)  { status = "critical"; statusLabel = "حرج (أقل من 30 يوم)"; }
      else if (daysLeft <= 90)  { status = "warning";  statusLabel = "تحذير (أقل من 90 يوم)"; }
      return { ...r, daysLeft, status, statusLabel,
               stockValue: r2(r.currentStock * r.CostPrice) };
    });

    const summary = {
      expired:  enriched.filter(r=>r.status==="expired").length,
      critical: enriched.filter(r=>r.status==="critical").length,
      warning:  enriched.filter(r=>r.status==="warning").length,
      ok:       enriched.filter(r=>r.status==="ok").length,
    };
    const header = await buildReportHeader("تقرير الصلاحية والأعمار", today, today);
    res.json({ success:true, reportHeader:header, summary, today, items:enriched });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════
//  4- تقرير ربحية المبيعات
//  GET /api/reports/sales-profitability
//  ?startDate= &endDate= &groupBy=item|customer
// ══════════════════════════════════════════════════════════
const salesProfitability = async (req, res) => {
  const { startDate, endDate, groupBy="item" } = req.query;
  const { start, end } = resolveDateRange(startDate, endDate);
  try {
    let rows;
    if (groupBy === "customer") {
      rows = await db.query(`
        SELECT
          z.id_Zabon AS id, z.ZabonName AS name,
          SUM(d.AmountOUT) AS totalQty,
          SUM(d.AmountOUT * d.PriceOUT) AS lineRevenue,
          COALESCE((
            SELECT SUM(COALESCE(f2.Dis_FOUT, 0)) FROM FOUT_tbl f2
            WHERE f2.id_Zabon = z.id_Zabon AND f2.Date_FOUT BETWEEN ? AND ?
          ), 0) AS totalDiscount,
          COALESCE((
            SELECT SUM(COALESCE(f2.Add_FOUT, 0)) FROM FOUT_tbl f2
            WHERE f2.id_Zabon = z.id_Zabon AND f2.Date_FOUT BETWEEN ? AND ?
          ), 0) AS totalAdditions,
          SUM(d.AmountOUT * m."Cost Price") AS totalCost,
          COALESCE((
            SELECT SUM(dr.AmountOUT * dr.PriceOUT) FROM DetailsRetern_tbl dr
            JOIN FRetern_tbl fr ON fr.id_NoFRetern=dr.id_NoFRetern
            WHERE fr.ReturnType='CUSTOMER' AND fr.id_Party=z.id_Zabon
              AND fr.Date_FRetern BETWEEN ? AND ?
          ),0) AS returnValue,
          COALESCE((
            SELECT SUM(dr.AmountOUT) FROM DetailsRetern_tbl dr
            JOIN FRetern_tbl fr ON fr.id_NoFRetern=dr.id_NoFRetern
            WHERE fr.ReturnType='CUSTOMER' AND fr.id_Party=z.id_Zabon
              AND fr.Date_FRetern BETWEEN ? AND ?
          ),0) AS returnQty,
          COALESCE((
            SELECT SUM(dr.AmountOUT * mt."Cost Price") FROM DetailsRetern_tbl dr
            JOIN FRetern_tbl fr ON fr.id_NoFRetern=dr.id_NoFRetern
            JOIN Materials_tbl mt ON mt.id_Material_NoM=dr.id_Material_NoM
            WHERE fr.ReturnType='CUSTOMER' AND fr.id_Party=z.id_Zabon
              AND fr.Date_FRetern BETWEEN ? AND ?
          ),0) AS returnCost
        FROM FOUT_tbl f
        JOIN DetailsOUT_tbl d ON d.id_NoFOUT=f.id_NoFOUT
        JOIN Materials_tbl m ON m.id_Material_NoM=d.id_Material_NoM
        JOIN Zabon_tbl z ON z.id_Zabon=f.id_Zabon
        WHERE f.Date_FOUT BETWEEN ? AND ?
        GROUP BY z.id_Zabon
        ORDER BY lineRevenue DESC
      `, [start,end, start,end, start,end, start,end, start,end, start,end, start,end]);
    } else {
      rows = await db.query(`
        SELECT
          m.id_Material_NoM AS id, m.MaterialName AS name, m.Band,
          c.CatiguaryName,
          SUM(d.AmountOUT) AS totalQty,
          SUM(d.AmountOUT * d.PriceOUT) AS lineRevenue,
          SUM(
            CASE WHEN inv.tot > 0
              THEN (d.AmountOUT * d.PriceOUT) * 1.0 / inv.tot * COALESCE(f.Dis_FOUT, 0)
              ELSE 0
            END
          ) AS totalDiscount,
          SUM(
            CASE WHEN inv.tot > 0
              THEN (d.AmountOUT * d.PriceOUT) * 1.0 / inv.tot * COALESCE(f.Add_FOUT, 0)
              ELSE 0
            END
          ) AS totalAdditions,
          SUM(d.AmountOUT * m."Cost Price") AS totalCost,
          COALESCE((
            SELECT SUM(dr.AmountOUT*dr.PriceOUT) FROM DetailsRetern_tbl dr
            JOIN FRetern_tbl fr ON fr.id_NoFRetern=dr.id_NoFRetern
            WHERE dr.id_Material_NoM=m.id_Material_NoM AND fr.ReturnType='CUSTOMER'
              AND fr.Date_FRetern BETWEEN ? AND ?
          ),0) AS returnValue,
          COALESCE((
            SELECT SUM(dr.AmountOUT) FROM DetailsRetern_tbl dr
            JOIN FRetern_tbl fr ON fr.id_NoFRetern=dr.id_NoFRetern
            WHERE dr.id_Material_NoM=m.id_Material_NoM AND fr.ReturnType='CUSTOMER'
              AND fr.Date_FRetern BETWEEN ? AND ?
          ),0) AS returnQty,
          COALESCE((
            SELECT SUM(dr.AmountOUT * mt."Cost Price") FROM DetailsRetern_tbl dr
            JOIN FRetern_tbl fr ON fr.id_NoFRetern=dr.id_NoFRetern
            JOIN Materials_tbl mt ON mt.id_Material_NoM=dr.id_Material_NoM
            WHERE dr.id_Material_NoM=m.id_Material_NoM AND fr.ReturnType='CUSTOMER'
              AND fr.Date_FRetern BETWEEN ? AND ?
          ),0) AS returnCost
        FROM DetailsOUT_tbl d
        JOIN FOUT_tbl f ON f.id_NoFOUT=d.id_NoFOUT
        JOIN Materials_tbl m ON m.id_Material_NoM=d.id_Material_NoM
        LEFT JOIN Catiguary_tbl c ON c.id_Catiguary=m.id_Catiguary
        JOIN (
          SELECT id_NoFOUT, SUM(AmountOUT * PriceOUT) AS tot
          FROM DetailsOUT_tbl
          GROUP BY id_NoFOUT
        ) inv ON inv.id_NoFOUT = f.id_NoFOUT
        WHERE f.Date_FOUT BETWEEN ? AND ?
        GROUP BY m.id_Material_NoM
        ORDER BY lineRevenue DESC
      `, [start,end, start,end, start,end, start,end]);
    }

    const enriched = rows.map(r => {
      const lineRevenue  = r2(r.lineRevenue);
      const additions    = r2(r.totalAdditions || 0);
      const discounts    = r2(r.totalDiscount || 0);
      const salesReturns = r2(r.returnValue || 0);
      const grossRevenue = r2(lineRevenue + additions);
      const netRevenue   = r2(grossRevenue - discounts - salesReturns);
      const grossCost    = r2(r.totalCost);
      const returnCost   = r2(r.returnCost || 0);
      const netCost      = r2(grossCost - returnCost);
      const profit       = r2(netRevenue - netCost);
      const margin       = netRevenue > 0 ? r2((profit / netRevenue) * 100) : 0;
      const grossQty     = r2(r.totalQty || 0);
      const returnQty    = r2(r.returnQty || 0);
      return {
        ...r,
        salesCount  : grossQty,
        returnCount : returnQty,
        lineRevenue,
        totalAdditions: additions,
        totalDiscount : discounts,
        grossRevenue,
        netRevenue,
        grossCost,
        returnCost,
        netCost,
        profit,
        margin,
        totalCost   : grossCost,
        returnValue : salesReturns,
      };
    });

    const header = await buildReportHeader("تقرير ربحية المبيعات", start, end);
    res.json({ success:true, reportHeader:header, groupBy,
      totals:{
        grossRevenue : r2(enriched.reduce((s,r)=>s+r.grossRevenue,0)),
        totalDiscount: r2(enriched.reduce((s,r)=>s+r.totalDiscount,0)),
        totalReturns : r2(enriched.reduce((s,r)=>s+r.returnValue,0)),
        netRevenue   : r2(enriched.reduce((s,r)=>s+r.netRevenue,0)),
        totalCost    : r2(enriched.reduce((s,r)=>s+r.netCost,0)),
        totalProfit  : r2(enriched.reduce((s,r)=>s+r.profit,0)),
        salesCount   : enriched.reduce((s,r)=>s+(r.totalQty||0),0),
        returnCount  : enriched.reduce((s,r)=>s+(r.returnCount||0),0),
      },
      items: enriched });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════
//  5- ميزان المراجعة (المستحقات والمديونيات)
//  GET /api/reports/aging-receivables
// ══════════════════════════════════════════════════════════
const agingReceivables = async (req, res) => {
  try {
    // ── الزبائن ─────────────────────────────────────────
    // إجمالي الزبون = Σ(مجموع السطور − الخصم + الإضافة) من فواتير المبيعات + الديون اليدوية
    const customers = await db.query(`
      SELECT *
      FROM (
        SELECT
          z.id_Zabon, z.ZabonName, z.Mobail AS mobile,
          (
            COALESCE((
              SELECT SUM(${SALE_INVOICE_AMT})
              FROM FOUT_tbl f
              WHERE f.id_Zabon = z.id_Zabon
            ), 0)
            + COALESCE((
              SELECT SUM(dz.Amount_DionZabon)
              FROM DionZabon_tbl dz
              WHERE dz.id_Zabon = z.id_Zabon
                AND dz.Note_DionZabon NOT LIKE 'فاتورة مبيعات رقم%'
                AND dz.Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'
                AND dz.Note_DionZabon NOT LIKE 'مرتجع مبيعات رقم%'
                AND dz.Note_DionZabon NOT LIKE 'سماح سند قبض رقم%'
            ), 0)
          ) AS totalDebt,
          COALESCE((SELECT SUM(cd.Amount_CatchDoc) FROM CatchDoc_tbl cd WHERE cd.id_Zabon=z.id_Zabon),0) AS totalPaid,
          COALESCE((SELECT SUM(cd.AllowanceAmount) FROM CatchDoc_tbl cd WHERE cd.id_Zabon=z.id_Zabon),0) AS totalAllowance,
          COALESCE((SELECT SUM(dr.AmountOUT*dr.PriceOUT) FROM DetailsRetern_tbl dr
                    JOIN FRetern_tbl fr ON fr.id_NoFRetern=dr.id_NoFRetern
                    WHERE fr.ReturnType='CUSTOMER' AND fr.id_Party=z.id_Zabon),0) AS totalReturns
        FROM Zabon_tbl z
      )
      WHERE (totalDebt - totalPaid - totalReturns - totalAllowance) != 0
      ORDER BY (totalDebt - totalPaid - totalReturns - totalAllowance) DESC
    `);

    // ── الموردون ─────────────────────────────────────────
    const suppliers = await db.query(`
      SELECT
        a.id_Amil, a.AmilName, a.Mobil AS mobile,
        COALESCE(SUM(da.Amount_DionAmil),0) AS totalDebt,
        COALESCE((SELECT SUM(pd.Amount_PayDoc) FROM PayDoc_tbl pd WHERE pd.id_Amil=a.id_Amil),0) AS totalPaid,
        COALESCE((SELECT SUM(dr.AmountOUT*dr.PriceOUT) FROM DetailsRetern_tbl dr
                  JOIN FRetern_tbl fr ON fr.id_NoFRetern=dr.id_NoFRetern
                  WHERE fr.ReturnType='SUPPLIER' AND fr.id_Party=a.id_Amil),0) AS totalReturns
      FROM Amil_tbl a
      LEFT JOIN DionAmil_tbl da ON da.id_Amil=a.id_Amil
        AND da.Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'
        AND da.Note_DionAmil NOT LIKE 'مرتجع مشتريات رقم%'
      GROUP BY a.id_Amil
      HAVING (totalDebt - totalPaid - totalReturns) != 0
      ORDER BY (totalDebt - totalPaid - totalReturns) DESC
    `);

    const enrichedCust = customers.map(r => {
      const allowance = r2(r.totalAllowance || 0);
      const net = r2(r.totalDebt - r.totalPaid - r.totalReturns - allowance);
      return { ...r, totalDebt:r2(r.totalDebt), totalPaid:r2(r.totalPaid),
               totalAllowance: allowance, totalReturns:r2(r.totalReturns), netBalance:net };
    });
    const enrichedSupp = suppliers.map(r => {
      const net = r2(r.totalDebt - r.totalPaid - r.totalReturns);
      return { ...r, totalDebt:r2(r.totalDebt), totalPaid:r2(r.totalPaid),
               totalReturns:r2(r.totalReturns), netBalance:net };
    });

    const today = new Date().toISOString().split("T")[0];
    const header = await buildReportHeader("ميزان مراجعة المستحقات والمديونيات", today, today);
    res.json({ success:true, reportHeader:header,
      summary:{
        totalReceivables: r2(enrichedCust.reduce((s,r)=>s+r.netBalance,0)),
        totalPayables:    r2(enrichedSupp.reduce((s,r)=>s+r.netBalance,0)),
        customersCount:   enrichedCust.length,
        suppliersCount:   enrichedSupp.length,
      },
      customers: enrichedCust,
      suppliers: enrichedSupp });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ── تصدير الوظائف الجديدة ─────────────────────────────────
Object.assign(module.exports, {
  stockMovementAnalytics,
  abcAnalysis,
  agingExpiry,
  salesProfitability,
  agingReceivables,
});

// ══════════════════════════════════════════════════════════
//  T1- الملخص العام (Sales & Purchases Summary)
//  GET /api/reports/summary-report
//  ?startDate= &endDate= &id_Catiguary=
// ══════════════════════════════════════════════════════════
const summaryReport = async (req, res) => {
  const { startDate, endDate, id_Catiguary } = req.query;
  const { start, end } = resolveDateRange(startDate, endDate);
  try {
    let catFilter = ""; const catP = [];
    if (id_Catiguary) { catFilter = "AND m.id_Catiguary = ?"; catP.push(id_Catiguary); }

    const rows = await db.query(`
      SELECT
        m.id_Material_NoM, m.MaterialName, m.Band, m."Cost Price" AS CostPrice,
        c.CatiguaryName,
        COALESCE(s.QuantityOnHand, 0) AS currentStock,
        -- ── مشتريات الفترة ──────────────────────────
        COALESCE((
          SELECT SUM(di.AmountIN) FROM DetailsIN_tbl di
          JOIN FIN_tbl fi ON fi.id_NoFIN = di.id_NoFIN
          WHERE di.id_Material_NoM = m.id_Material_NoM AND fi.Date_FIN BETWEEN ? AND ?
        ), 0) AS purchaseQty,
        COALESCE((
          SELECT SUM(di.AmountIN * di.PriceIN) FROM DetailsIN_tbl di
          JOIN FIN_tbl fi ON fi.id_NoFIN = di.id_NoFIN
          WHERE di.id_Material_NoM = m.id_Material_NoM AND fi.Date_FIN BETWEEN ? AND ?
        ), 0) AS purchaseValue,
        COALESCE((
          SELECT SUM(COALESCE(di.Gift_IN, 0)) FROM DetailsIN_tbl di
          JOIN FIN_tbl fi ON fi.id_NoFIN = di.id_NoFIN
          WHERE di.id_Material_NoM = m.id_Material_NoM AND fi.Date_FIN BETWEEN ? AND ?
        ), 0) AS purchaseGiftQty,
        -- ── مرتجعات المشتريات ───────────────────────
        COALESCE((
          SELECT SUM(dr.AmountOUT) FROM DetailsRetern_tbl dr
          JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
          WHERE dr.id_Material_NoM = m.id_Material_NoM AND fr.ReturnType = 'SUPPLIER'
            AND fr.Date_FRetern BETWEEN ? AND ?
        ), 0) AS purchaseRetQty,
        COALESCE((
          SELECT SUM(dr.AmountOUT * dr.PriceOUT) FROM DetailsRetern_tbl dr
          JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
          WHERE dr.id_Material_NoM = m.id_Material_NoM AND fr.ReturnType = 'SUPPLIER'
            AND fr.Date_FRetern BETWEEN ? AND ?
        ), 0) AS purchaseRetValue,
        -- ── مبيعات الفترة ───────────────────────────
        COALESCE((
          SELECT SUM(do_.AmountOUT) FROM DetailsOUT_tbl do_
          JOIN FOUT_tbl fo ON fo.id_NoFOUT = do_.id_NoFOUT
          WHERE do_.id_Material_NoM = m.id_Material_NoM AND fo.Date_FOUT BETWEEN ? AND ?
        ), 0) AS salesQty,
        COALESCE((
          SELECT SUM(do_.AmountOUT * do_.PriceOUT) FROM DetailsOUT_tbl do_
          JOIN FOUT_tbl fo ON fo.id_NoFOUT = do_.id_NoFOUT
          WHERE do_.id_Material_NoM = m.id_Material_NoM AND fo.Date_FOUT BETWEEN ? AND ?
        ), 0) AS salesValue,
        COALESCE((
          SELECT SUM(COALESCE(do_.gift_qty, 0)) FROM DetailsOUT_tbl do_
          JOIN FOUT_tbl fo ON fo.id_NoFOUT = do_.id_NoFOUT
          WHERE do_.id_Material_NoM = m.id_Material_NoM AND fo.Date_FOUT BETWEEN ? AND ?
        ), 0) AS salesGiftQty,
        -- ── مرتجعات المبيعات ───────────────────────
        COALESCE((
          SELECT SUM(dr.AmountOUT) FROM DetailsRetern_tbl dr
          JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
          WHERE dr.id_Material_NoM = m.id_Material_NoM AND fr.ReturnType = 'CUSTOMER'
            AND fr.Date_FRetern BETWEEN ? AND ?
        ), 0) AS salesRetQty,
        COALESCE((
          SELECT SUM(dr.AmountOUT * dr.PriceOUT) FROM DetailsRetern_tbl dr
          JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
          WHERE dr.id_Material_NoM = m.id_Material_NoM AND fr.ReturnType = 'CUSTOMER'
            AND fr.Date_FRetern BETWEEN ? AND ?
        ), 0) AS salesRetValue,
        -- مخزون مدفوع (بدون وحدات الهدية المتبقية)
        CASE WHEN (
          COALESCE(s.QuantityOnHand, 0)
          - COALESCE((
              SELECT SUM(COALESCE(di.Gift_IN, 0)) FROM DetailsIN_tbl di
              WHERE di.id_Material_NoM = m.id_Material_NoM
            ), 0)
          + COALESCE((
              SELECT SUM(COALESCE(do_.gift_qty, 0)) FROM DetailsOUT_tbl do_
              WHERE do_.id_Material_NoM = m.id_Material_NoM
            ), 0)
        ) < 0 THEN 0 ELSE (
          COALESCE(s.QuantityOnHand, 0)
          - COALESCE((
              SELECT SUM(COALESCE(di.Gift_IN, 0)) FROM DetailsIN_tbl di
              WHERE di.id_Material_NoM = m.id_Material_NoM
            ), 0)
          + COALESCE((
              SELECT SUM(COALESCE(do_.gift_qty, 0)) FROM DetailsOUT_tbl do_
              WHERE do_.id_Material_NoM = m.id_Material_NoM
            ), 0)
        ) END AS stockWithoutGifts
      FROM Materials_tbl m
      LEFT JOIN Catiguary_tbl c ON c.id_Catiguary = m.id_Catiguary
      LEFT JOIN Stock_tbl s ON s.id_Material_NoM = m.id_Material_NoM
      WHERE 1=1 ${catFilter}
      ORDER BY salesValue DESC, m.MaterialName
    `, [
      start, end, start, end, start, end, start, end, start, end,
      start, end, start, end, start, end, start, end, start, end,
      ...catP,
    ]);

    const enriched = rows.map(r => {
      const netPurchaseQty = r2(r.purchaseQty - r.purchaseRetQty);
      const netSalesQty    = r2(r.salesQty - r.salesRetQty);
      const purchaseUnit   = r.purchaseQty > 0 ? r.purchaseValue / r.purchaseQty : 0;
      const returnUnit     = r.purchaseRetQty > 0 ? r.purchaseRetValue / r.purchaseRetQty : 0;
      const salesUnit      = r.salesQty > 0 ? r.salesValue / r.salesQty : 0;
      const salesRetUnit   = r.salesRetQty > 0 ? r.salesRetValue / r.salesRetQty : 0;
      const netPurchaseVal = r2((r.purchaseQty * purchaseUnit) - (r.purchaseRetQty * returnUnit));
      const netSalesVal    = r2((r.salesQty * salesUnit) - (r.salesRetQty * salesRetUnit));
      return {
        ...r,
        purchaseQty: r2(r.purchaseQty),
        purchaseRetQty: r2(r.purchaseRetQty),
        salesQty: r2(r.salesQty),
        salesRetQty: r2(r.salesRetQty),
        netPurchaseQty,
        netPurchaseVal,
        netSalesQty,
        netSalesVal,
        stockWithoutGifts: r2(r.stockWithoutGifts),
      };
    }).filter(r => r.purchaseQty>0 || r.purchaseGiftQty>0 || r.salesQty>0 || r.salesGiftQty>0);

    const totals = {
      items:            enriched.length,
      totalNetPurchase: r2(enriched.reduce((s,r)=>s+r.netPurchaseVal,0)),
      totalNetSales:    r2(enriched.reduce((s,r)=>s+r.netSalesVal,0)),
    };

    const header = await buildReportHeader("الملخص العام للمشتريات والمبيعات", start, end);
    res.json({ success:true, reportHeader:header, totals, items:enriched });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════
//  T2- تقرير الكيانات (Entity Report)
//  GET /api/reports/entity-report
//  ?partyType=CUSTOMER|SUPPLIER &id_Party= &startDate= &endDate=
// ══════════════════════════════════════════════════════════
const entityReport = async (req, res) => {
  const { partyType, id_Party, startDate, endDate } = req.query;
  if (!partyType || !id_Party)
    return res.status(400).json({ success:false, message:"partyType و id_Party مطلوبان" });
  const { start, end } = resolveDateRange(startDate, endDate);
  try {
    let partyInfo, transactions = [];

    if (partyType === "CUSTOMER") {
      partyInfo = await db.queryOne(
        `SELECT z.ZabonName AS name, z.Mobail AS mobile,
                COALESCE((
                  SELECT SUM(Amount_DionZabon) FROM DionZabon_tbl
                  WHERE id_Zabon = z.id_Zabon
                    AND Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'
                    AND Note_DionZabon NOT LIKE 'سماح سند قبض رقم%'
                ), 0) -
                COALESCE((
                  SELECT SUM(Amount_CatchDoc) FROM CatchDoc_tbl WHERE id_Zabon = z.id_Zabon
                ), 0) -
                COALESCE((
                  SELECT SUM(AllowanceAmount) FROM CatchDoc_tbl WHERE id_Zabon = z.id_Zabon
                ), 0) AS netBalance
         FROM Zabon_tbl z WHERE z.id_Zabon = ?`, [id_Party]
      );
      const sales = await db.query(`
        SELECT f.id_NoFOUT AS docNo, f.Date_FOUT AS date,
               ${TX_DT("FOUT_tbl", "f.id_NoFOUT", "f.Date_FOUT")} AS dateTime,
               ${TX_SEQ("FOUT_tbl", "f.id_NoFOUT")} AS txSeq,
               'فاتورة مبيعات' AS type, 'FOUT' AS docType,
               ${SALE_INVOICE_AMT} AS total,
               pt.PayTypeName AS payType, COUNT(d.id_DetailsOUT) AS itemCount
        FROM FOUT_tbl f
        LEFT JOIN DetailsOUT_tbl d ON d.id_NoFOUT = f.id_NoFOUT
        LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
        WHERE f.id_Zabon = ? AND f.Date_FOUT BETWEEN ? AND ?
        GROUP BY f.id_NoFOUT
      `, [id_Party, start, end]);
      const returns = await db.query(`
        SELECT r.id_NoFRetern AS docNo, r.Date_FRetern AS date,
               ${TX_DT("FRetern_tbl", "r.id_NoFRetern", "r.Date_FRetern")} AS dateTime,
               ${TX_SEQ("FRetern_tbl", "r.id_NoFRetern")} AS txSeq,
               'مرتجع مبيعات' AS type, 'RETERN_C' AS docType,
               -ROUND(COALESCE(SUM(d.AmountOUT * d.PriceOUT), 0), 0) AS total,
               NULL AS payType, COUNT(d.id_DetailsRetern) AS itemCount
        FROM FRetern_tbl r
        LEFT JOIN DetailsRetern_tbl d ON d.id_NoFRetern = r.id_NoFRetern
        WHERE r.ReturnType = 'CUSTOMER' AND r.id_Party = ? AND r.Date_FRetern BETWEEN ? AND ?
        GROUP BY r.id_NoFRetern
      `, [id_Party, start, end]);
      const catches = await db.query(`
        SELECT c.id_CatchDoc AS docNo, c.Date_CatchDoc AS date,
               ${TX_DT("CatchDoc_tbl", "c.id_CatchDoc", "c.Date_CatchDoc")} AS dateTime,
               ${TX_SEQ("CatchDoc_tbl", "c.id_CatchDoc")} AS txSeq,
               'سند قبض' AS type, 'CATCH' AS docType,
               c.Amount_CatchDoc AS total, NULL AS payType, 0 AS itemCount
        FROM CatchDoc_tbl c
        WHERE c.id_Zabon = ? AND c.Date_CatchDoc BETWEEN ? AND ?
      `, [id_Party, start, end]);
      const allowances = await db.query(`
        SELECT c.id_CatchDoc AS docNo, c.Date_CatchDoc AS date,
               ${TX_DT("CatchDoc_tbl", "c.id_CatchDoc", "c.Date_CatchDoc")} AS dateTime,
               ${TX_SEQ("CatchDoc_tbl", "c.id_CatchDoc")} AS txSeq,
               'سماح' AS type, 'ALLOW' AS docType,
               COALESCE(c.AllowanceAmount, 0) AS total, NULL AS payType, 0 AS itemCount
        FROM CatchDoc_tbl c
        WHERE c.id_Zabon = ? AND c.Date_CatchDoc BETWEEN ? AND ?
          AND COALESCE(c.AllowanceAmount, 0) > 0
      `, [id_Party, start, end]);
      const debts = await db.query(`
        SELECT dz.id_DionZabon AS docNo, dz.Date_DionZabon AS date,
               ${TX_DT("DionZabon_tbl", "dz.id_DionZabon", "dz.Date_DionZabon")} AS dateTime,
               dz.id_DionZabon AS txSeq,
               'دين سابق' AS type, 'DEBT' AS docType,
               dz.Amount_DionZabon AS total, NULL AS payType, 0 AS itemCount
        FROM DionZabon_tbl dz
        WHERE dz.id_Zabon = ?
          AND dz.Note_DionZabon NOT LIKE 'فاتورة مبيعات رقم%'
          AND dz.Note_DionZabon NOT LIKE 'مرتجع مبيعات رقم%'
          AND dz.Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'
          AND dz.Note_DionZabon NOT LIKE 'سماح سند قبض رقم%'
          AND dz.Date_DionZabon BETWEEN ? AND ?
      `, [id_Party, start, end]);
      transactions = [...sales, ...returns, ...catches, ...allowances, ...debts];
    } else {
      partyInfo = await db.queryOne(
        `SELECT a.AmilName AS name, a.Mobil AS mobile,
                COALESCE((
                  SELECT SUM(Amount_DionAmil) FROM DionAmil_tbl
                  WHERE id_Amil = a.id_Amil
                    AND Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'
                ), 0) -
                COALESCE((
                  SELECT SUM(Amount_PayDoc) FROM PayDoc_tbl WHERE id_Amil = a.id_Amil
                ), 0) AS netBalance
         FROM Amil_tbl a WHERE a.id_Amil = ?`, [id_Party]
      );
      const purchases = await db.query(`
        SELECT f.id_NoFIN AS docNo, f.Date_FIN AS date,
               ${TX_DT("FIN_tbl", "f.id_NoFIN", "f.Date_FIN")} AS dateTime,
               ${TX_SEQ("FIN_tbl", "f.id_NoFIN")} AS txSeq,
               'فاتورة شراء' AS type, 'FIN' AS docType,
               ${PURCHASE_INVOICE_AMT} AS total,
               pt.PayTypeName AS payType, COUNT(d.id_DetailsIN) AS itemCount
        FROM FIN_tbl f
        LEFT JOIN DetailsIN_tbl d ON d.id_NoFIN = f.id_NoFIN
        LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FIN
        WHERE f.id_Amil = ? AND f.Date_FIN BETWEEN ? AND ?
        GROUP BY f.id_NoFIN
      `, [id_Party, start, end]);
      const returns = await db.query(`
        SELECT r.id_NoFRetern AS docNo, r.Date_FRetern AS date,
               ${TX_DT("FRetern_tbl", "r.id_NoFRetern", "r.Date_FRetern")} AS dateTime,
               ${TX_SEQ("FRetern_tbl", "r.id_NoFRetern")} AS txSeq,
               'مرتجع مشتريات' AS type, 'RETERN_S' AS docType,
               -ROUND(COALESCE(SUM(d.AmountOUT * d.PriceOUT), 0), 0) AS total,
               NULL AS payType, COUNT(d.id_DetailsRetern) AS itemCount
        FROM FRetern_tbl r
        LEFT JOIN DetailsRetern_tbl d ON d.id_NoFRetern = r.id_NoFRetern
        WHERE r.ReturnType = 'SUPPLIER' AND r.id_Party = ? AND r.Date_FRetern BETWEEN ? AND ?
        GROUP BY r.id_NoFRetern
      `, [id_Party, start, end]);
      const pays = await db.query(`
        SELECT p.id_PayDoc AS docNo, p.Date_PayDoc AS date,
               ${TX_DT("PayDoc_tbl", "p.id_PayDoc", "p.Date_PayDoc")} AS dateTime,
               ${TX_SEQ("PayDoc_tbl", "p.id_PayDoc")} AS txSeq,
               'سند دفع' AS type, 'PAY' AS docType,
               p.Amount_PayDoc AS total, NULL AS payType, 0 AS itemCount
        FROM PayDoc_tbl p
        WHERE p.id_Amil = ? AND p.Date_PayDoc BETWEEN ? AND ?
      `, [id_Party, start, end]);
      const debts = await db.query(`
        SELECT da.id_DionAmil AS docNo, da.Date_DionAmil AS date,
               ${TX_DT("DionAmil_tbl", "da.id_DionAmil", "da.Date_DionAmil")} AS dateTime,
               da.id_DionAmil AS txSeq,
               'دين سابق' AS type, 'DEBT' AS docType,
               da.Amount_DionAmil AS total, NULL AS payType, 0 AS itemCount
        FROM DionAmil_tbl da
        WHERE da.id_Amil = ?
          AND da.Note_DionAmil NOT LIKE 'فاتورة مشتريات رقم%'
          AND da.Note_DionAmil NOT LIKE 'مرتجع مشتريات رقم%'
          AND da.Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'
          AND da.Date_DionAmil BETWEEN ? AND ?
      `, [id_Party, start, end]);
      transactions = [...purchases, ...returns, ...pays, ...debts];
    }

    transactions.sort(compareStatementRows);
    const txEnriched = transactions.map((t) => ({ ...t, total: r2(t.total) }));

    const debitTypes = partyType === "CUSTOMER"
      ? ["فاتورة مبيعات", "دين سابق"]
      : ["مرتجع مشتريات", "سند دفع"];
    const creditTypes = partyType === "CUSTOMER"
      ? ["مرتجع مبيعات", "سند قبض", "سماح"]
      : ["فاتورة شراء", "دين سابق"];

    const summary = {
      totalDebit:  r2(txEnriched.filter((t) => debitTypes.includes(t.type)).reduce((s, t) => s + t.total, 0)),
      totalCredit: r2(txEnriched.filter((t) => creditTypes.includes(t.type)).reduce((s, t) => s + t.total, 0)),
      txCount: txEnriched.length,
    };

    if (partyInfo) partyInfo.netBalance = r2(partyInfo.netBalance);

    const header = await buildReportHeader(`كشف حساب — ${partyInfo?.name||""}`, start, end);
    res.json({ success:true, reportHeader:header, partyInfo, summary, transactions:txEnriched });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ── جلب تفاصيل فاتورة واحدة للـ Modal
const entityInvoiceDetail = async (req, res) => {
  const { docType, docNo } = req.params;
  try {
    let data;
    if (docType === "FOUT") {
      const hdr = await db.queryOne(
        `SELECT f.*, z.ZabonName, pt.PayTypeName FROM FOUT_tbl f
         LEFT JOIN Zabon_tbl z ON z.id_Zabon=f.id_Zabon
         LEFT JOIN PayType_Tbl pt ON pt.id_PayType=f.id_PayType_FOUT
         WHERE f.id_NoFOUT=?`, [docNo]);
      const lines = await db.query(
        `SELECT d.*, m.MaterialName, m.Band FROM DetailsOUT_tbl d
         JOIN Materials_tbl m ON m.id_Material_NoM=d.id_Material_NoM
         WHERE d.id_NoFOUT=?`, [docNo]);
      data = { ...hdr, lines };
    } else if (docType === "FIN") {
      const hdr = await db.queryOne(
        `SELECT f.*, a.AmilName, pt.PayTypeName FROM FIN_tbl f
         LEFT JOIN Amil_tbl a ON a.id_Amil=f.id_Amil
         LEFT JOIN PayType_Tbl pt ON pt.id_PayType=f.id_PayType_FIN
         WHERE f.id_NoFIN=?`, [docNo]);
      const lines = await db.query(
        `SELECT d.*, m.MaterialName, m.Band FROM DetailsIN_tbl d
         JOIN Materials_tbl m ON m.id_Material_NoM=d.id_Material_NoM
         WHERE d.id_NoFIN=?`, [docNo]);
      data = { ...hdr, lines };
    } else {
      const hdr = await db.queryOne(
        `SELECT r.*, CASE r.ReturnType WHEN 'CUSTOMER' THEN z.ZabonName ELSE a.AmilName END AS partyName
         FROM FRetern_tbl r
         LEFT JOIN Zabon_tbl z ON z.id_Zabon=r.id_Party AND r.ReturnType='CUSTOMER'
         LEFT JOIN Amil_tbl a ON a.id_Amil=r.id_Party AND r.ReturnType='SUPPLIER'
         WHERE r.id_NoFRetern=?`, [docNo]);
      const lines = await db.query(
        `SELECT d.*, m.MaterialName, m.Band FROM DetailsRetern_tbl d
         JOIN Materials_tbl m ON m.id_Material_NoM=d.id_Material_NoM
         WHERE d.id_NoFRetern=?`, [docNo]);
      data = { ...hdr, lines };
    }
    res.json({ success:true, data });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════
//  T3- تحليل المواد المخصص
//  GET /api/reports/material-analysis
//  ?startDate= &endDate= &id_Material= &id_Catiguary=
// ══════════════════════════════════════════════════════════
const materialAnalysis = async (req, res) => {
  const { startDate, endDate, id_Material, id_Catiguary } = req.query;
  const { start, end } = resolveDateRange(startDate, endDate);
  try {
    let filter = "WHERE 1=1";
    const p = [
      start, end, start, end, start, end, start, end, start, end,
      start, end, start, end, start, end, start, end, start, end,
    ];
    if (id_Material)  { filter += " AND m.id_Material_NoM=?"; p.push(id_Material); }
    if (id_Catiguary) { filter += " AND m.id_Catiguary=?";    p.push(id_Catiguary); }

    const rows = await db.query(`
      SELECT m.id_Material_NoM, m.MaterialName, m.Band, m."Cost Price" AS CostPrice,
             m.Barcode, c.CatiguaryName,
             COALESCE(s.QuantityOnHand,0) AS currentStock,
             COALESCE(sp.LastSellPrice,0) AS lastSellPrice,
             COALESCE(sp.SellPrice1,0) AS SellPrice1,
             COALESCE((
               SELECT SUM(di.AmountIN*di.PriceIN)/NULLIF(SUM(di.AmountIN),0)
               FROM DetailsIN_tbl di JOIN FIN_tbl fi ON fi.id_NoFIN=di.id_NoFIN
               WHERE di.id_Material_NoM=m.id_Material_NoM AND fi.Date_FIN BETWEEN ? AND ?
             ),m."Cost Price") AS avgPurchasePrice,
             COALESCE((
               SELECT SUM(di.AmountIN) FROM DetailsIN_tbl di
               JOIN FIN_tbl fi ON fi.id_NoFIN=di.id_NoFIN
               WHERE di.id_Material_NoM=m.id_Material_NoM AND fi.Date_FIN BETWEEN ? AND ?
             ),0) AS totalPurchasedQty,
             COALESCE((
               SELECT SUM(do_.AmountOUT*do_.PriceOUT) FROM DetailsOUT_tbl do_
               JOIN FOUT_tbl fo ON fo.id_NoFOUT=do_.id_NoFOUT
               WHERE do_.id_Material_NoM=m.id_Material_NoM AND fo.Date_FOUT BETWEEN ? AND ?
             ),0) AS totalSalesValue,
             COALESCE((
               SELECT SUM(do_.AmountOUT) FROM DetailsOUT_tbl do_
               JOIN FOUT_tbl fo ON fo.id_NoFOUT=do_.id_NoFOUT
               WHERE do_.id_Material_NoM=m.id_Material_NoM AND fo.Date_FOUT BETWEEN ? AND ?
             ),0) AS totalSalesQty,
             COALESCE((
               SELECT SUM(do_.AmountOUT * m2."Cost Price") FROM DetailsOUT_tbl do_
               JOIN FOUT_tbl fo ON fo.id_NoFOUT=do_.id_NoFOUT
               JOIN Materials_tbl m2 ON m2.id_Material_NoM=do_.id_Material_NoM
               WHERE do_.id_Material_NoM=m.id_Material_NoM AND fo.Date_FOUT BETWEEN ? AND ?
             ),0) AS totalSalesCost,
             COALESCE((
               SELECT SUM(
                 (do_.AmountOUT * do_.PriceOUT) * 1.0 / NULLIF(inv.tot, 0) * COALESCE(fo.Dis_FOUT, 0)
               )
               FROM DetailsOUT_tbl do_
               JOIN FOUT_tbl fo ON fo.id_NoFOUT = do_.id_NoFOUT
               JOIN (
                 SELECT id_NoFOUT, SUM(AmountOUT * PriceOUT) AS tot
                 FROM DetailsOUT_tbl GROUP BY id_NoFOUT
               ) inv ON inv.id_NoFOUT = fo.id_NoFOUT
               WHERE do_.id_Material_NoM = m.id_Material_NoM AND fo.Date_FOUT BETWEEN ? AND ?
             ),0) AS allocatedDiscount,
             COALESCE((
               SELECT SUM(
                 (do_.AmountOUT * do_.PriceOUT) * 1.0 / NULLIF(inv.tot, 0) * COALESCE(fo.Add_FOUT, 0)
               )
               FROM DetailsOUT_tbl do_
               JOIN FOUT_tbl fo ON fo.id_NoFOUT = do_.id_NoFOUT
               JOIN (
                 SELECT id_NoFOUT, SUM(AmountOUT * PriceOUT) AS tot
                 FROM DetailsOUT_tbl GROUP BY id_NoFOUT
               ) inv ON inv.id_NoFOUT = fo.id_NoFOUT
               WHERE do_.id_Material_NoM = m.id_Material_NoM AND fo.Date_FOUT BETWEEN ? AND ?
             ),0) AS allocatedAdditions,
             COALESCE((
               SELECT SUM(dr.AmountOUT*dr.PriceOUT) FROM DetailsRetern_tbl dr
               JOIN FRetern_tbl fr ON fr.id_NoFRetern=dr.id_NoFRetern
               WHERE dr.id_Material_NoM=m.id_Material_NoM
                 AND fr.ReturnType='CUSTOMER' AND fr.Date_FRetern BETWEEN ? AND ?
             ),0) AS salesReturnsValue,
             COALESCE((
               SELECT SUM(dr.AmountOUT * m3."Cost Price") FROM DetailsRetern_tbl dr
               JOIN FRetern_tbl fr ON fr.id_NoFRetern=dr.id_NoFRetern
               JOIN Materials_tbl m3 ON m3.id_Material_NoM=dr.id_Material_NoM
               WHERE dr.id_Material_NoM=m.id_Material_NoM
                 AND fr.ReturnType='CUSTOMER' AND fr.Date_FRetern BETWEEN ? AND ?
             ),0) AS salesReturnsCost,
             COALESCE((
               SELECT SUM(dr.AmountOUT) FROM DetailsRetern_tbl dr
               JOIN FRetern_tbl fr ON fr.id_NoFRetern=dr.id_NoFRetern
               WHERE dr.id_Material_NoM=m.id_Material_NoM
                 AND fr.ReturnType='CUSTOMER' AND fr.Date_FRetern BETWEEN ? AND ?
             ),0) AS salesReturnsQty
      FROM Materials_tbl m
      LEFT JOIN Catiguary_tbl c ON c.id_Catiguary=m.id_Catiguary
      LEFT JOIN Stock_tbl s ON s.id_Material_NoM=m.id_Material_NoM
      LEFT JOIN SellPrice_tbl sp ON sp.id_Material_NoM=m.id_Material_NoM
      ${filter}
      ORDER BY totalSalesValue DESC
    `, p);

    const enriched = rows.map(r => {
      const lineSalesValue    = r2(r.totalSalesValue || 0);
      const allocatedDiscount = r2(r.allocatedDiscount || 0);
      const allocatedAdditions = r2(r.allocatedAdditions || 0);
      const salesReturnsValue = r2(r.salesReturnsValue || 0);
      const salesReturnsCost  = r2(r.salesReturnsCost || 0);
      const salesReturnsQty   = r2(r.salesReturnsQty || 0);
      const grossRevenue      = r2(lineSalesValue + allocatedAdditions);
      const netRevenue        = r2(grossRevenue - allocatedDiscount - salesReturnsValue);
      const totalCost         = r2((r.totalSalesCost || 0) - salesReturnsCost);
      const grossSalesQty     = r2(r.totalSalesQty || 0);
      const netSalesQty       = r2(Math.max(0, grossSalesQty - salesReturnsQty));
      const grossProfit       = r2(netRevenue - totalCost);
      const margin            = netRevenue > 0 ? r2((grossProfit / netRevenue) * 100) : 0;
      const avgSellPrice      = grossSalesQty > 0
        ? r2(lineSalesValue / grossSalesQty)
        : r2(r.SellPrice1 || r.lastSellPrice || 0);
      return {
        ...r,
        lastSellPrice: avgSellPrice,
        avgPurchasePrice: r2(r.avgPurchasePrice),
        grossSalesValue : grossRevenue,
        allocatedDiscount,
        allocatedAdditions,
        totalSalesQty   : netSalesQty,
        totalSalesValue : netRevenue,
        netRevenue,
        salesReturnsValue,
        salesReturnsCost,
        salesReturnsQty,
        totalCost,
        grossProfit,
        margin,
        stockValue: r2(r.currentStock * r.CostPrice),
      };
    });

    // تحليل موردي هذه المادة
    const suppliers = id_Material ? await db.query(`
      SELECT a.AmilName, COUNT(DISTINCT fi.id_NoFIN) AS invoiceCount,
             SUM(di.AmountIN) AS totalQty, AVG(di.PriceIN) AS avgPrice
      FROM DetailsIN_tbl di JOIN FIN_tbl fi ON fi.id_NoFIN=di.id_NoFIN
      JOIN Amil_tbl a ON a.id_Amil=fi.id_Amil
      WHERE di.id_Material_NoM=? AND fi.Date_FIN BETWEEN ? AND ?
      GROUP BY fi.id_Amil ORDER BY totalQty DESC
    `, [id_Material, start, end]) : [];

    // أفضل الزبائن شراءً لهذه المادة
    const topCustomers = id_Material ? await db.query(`
      SELECT z.ZabonName, SUM(do_.AmountOUT) AS totalQty,
             SUM(do_.AmountOUT*do_.PriceOUT) AS totalValue
      FROM DetailsOUT_tbl do_ JOIN FOUT_tbl fo ON fo.id_NoFOUT=do_.id_NoFOUT
      JOIN Zabon_tbl z ON z.id_Zabon=fo.id_Zabon
      WHERE do_.id_Material_NoM=? AND fo.Date_FOUT BETWEEN ? AND ?
      GROUP BY fo.id_Zabon ORDER BY totalValue DESC LIMIT 5
    `, [id_Material, start, end]) : [];

    const header = await buildReportHeader("تحليل المواد المخصص", start, end);
    res.json({ success:true, reportHeader:header, items:enriched, suppliers, topCustomers,
      totals:{ items:enriched.length,
        totalSalesValue:r2(enriched.reduce((s,r)=>s+r.netRevenue,0)),
        totalGrossProfit:r2(enriched.reduce((s,r)=>s+r.grossProfit,0)) } });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════
//  T4- أداء المناديب مع العمولة ونسبة التحصيل
//  GET /api/reports/salesmen-performance
//  ?startDate= &endDate= &commissionRate=
// ══════════════════════════════════════════════════════════
const salesmenPerformance = async (req, res) => {
  const { startDate, endDate, commissionRate = 2, collectionCommissionRate = 0 } = req.query;
  const { start, end } = resolveDateRange(startDate, endDate);
  const salesRate      = Number(commissionRate) / 100;
  const collectionRate = Number(collectionCommissionRate) / 100;
  try {
    const reps = await db.query(`
      SELECT m.id_Mandob, m.MandobName,
        COUNT(DISTINCT f.id_NoFOUT) AS invoiceCount,
        COUNT(DISTINCT f.id_Zabon)  AS customerCount,
        COALESCE(SUM(d.AmountOUT*d.PriceOUT),0) AS grossSales,
        COALESCE((
          SELECT SUM(COALESCE(f2.Dis_FOUT,0)) FROM FOUT_tbl f2
          WHERE f2.id_Mandob=m.id_Mandob AND f2.Date_FOUT BETWEEN ? AND ?
        ),0) AS totalDiscount,
        COALESCE((
          SELECT SUM(COALESCE(f2.Add_FOUT,0)) FROM FOUT_tbl f2
          WHERE f2.id_Mandob=m.id_Mandob AND f2.Date_FOUT BETWEEN ? AND ?
        ),0) AS totalAdditions,
        COALESCE((
          SELECT SUM(dr.AmountOUT*dr.PriceOUT) FROM DetailsRetern_tbl dr
          JOIN FRetern_tbl fr ON fr.id_NoFRetern=dr.id_NoFRetern
          WHERE fr.ReturnType='CUSTOMER' AND fr.id_Party IN (
            SELECT DISTINCT id_Zabon FROM FOUT_tbl WHERE id_Mandob=m.id_Mandob
          ) AND fr.Date_FRetern BETWEEN ? AND ?
        ),0) AS returnValue,
        COALESCE((
          SELECT SUM(cd.Amount_CatchDoc) FROM CatchDoc_tbl cd
          WHERE cd.id_Zabon IN (
            SELECT DISTINCT id_Zabon FROM FOUT_tbl WHERE id_Mandob=m.id_Mandob
          ) AND cd.Date_CatchDoc BETWEEN ? AND ?
        ),0) AS collected
      FROM Mandob_tbl m
      LEFT JOIN FOUT_tbl f ON f.id_Mandob=m.id_Mandob AND f.Date_FOUT BETWEEN ? AND ?
      LEFT JOIN DetailsOUT_tbl d ON d.id_NoFOUT=f.id_NoFOUT
      GROUP BY m.id_Mandob ORDER BY grossSales DESC
    `, [start,end, start,end, start,end, start,end, start,end]);

    const totalNet = reps.reduce((s,r)=>s+r2(r.grossSales - r.totalDiscount + r.totalAdditions),0);
    const enriched = reps.map(r => {
      const gross       = r2(r.grossSales);
      const discount    = r2(r.totalDiscount);
      const additions   = r2(r.totalAdditions);
      const netSales    = r2(gross - discount + additions);
      const returns     = r2(r.returnValue);
      const netAfter    = r2(netSales - returns);
      const collected   = r2(r.collected);
      const salesCommission      = r2(netAfter * salesRate);
      const collectionCommission = r2(collected * collectionRate);
      const totalCommission      = r2(salesCommission + collectionCommission);
      const sharePct    = totalNet>0 ? r2((netSales/totalNet)*100) : 0;
      const collRate    = netAfter>0 ? r2((collected/netAfter)*100) : 0;
      return {
        ...r,
        grossSales:gross, totalDiscount:discount, totalAdditions:additions,
        netSales, returnValue:returns,
        netAfterReturns:netAfter,
        salesCommission, collectionCommission, totalCommission,
        commission: totalCommission,
        salesCommissionRate:`${commissionRate}%`,
        collectionCommissionRate:`${collectionCommissionRate}%`,
        collected, collectionRate:`${collRate}%`, sharePct:`${sharePct}%`,
      };
    });

    const header = await buildReportHeader("أداء المناديب والعمولات", start, end);
    res.json({ success:true, reportHeader:header,
      salesCommissionRate:`${commissionRate}%`,
      collectionCommissionRate:`${collectionCommissionRate}%`,
      summary:{ totalReps:enriched.length, totalNet:r2(totalNet),
        totalSalesCommission:r2(enriched.reduce((s,r)=>s+r.salesCommission,0)),
        totalCollectionCommission:r2(enriched.reduce((s,r)=>s+r.collectionCommission,0)),
        totalCommission:r2(enriched.reduce((s,r)=>s+r.totalCommission,0)),
        totalCollected:r2(enriched.reduce((s,r)=>s+r.collected,0)) },
      reps: enriched });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════
//  T5- حركة الصندوق التفصيلية مع الرصيد الجاري
//  GET /api/reports/cash-flow-detailed
//  ?startDate= &endDate=
// ══════════════════════════════════════════════════════════
const cashFlowDetailed = async (req, res) => {
  const { startDate, endDate } = req.query;
  const { start, end } = resolveDateRange(startDate, endDate);
  try {
    // الرصيد الافتتاحي = رأس المال + كل المقبوضات + مبيعات نقدية - المدفوعات - المصاريف قبل start
    const [prevCatch, prevPay, prevSpend, capitalRow, prevCashSales] = await Promise.all([
      db.queryOne(`SELECT COALESCE(SUM(Amount_CatchDoc),0) AS t FROM CatchDoc_tbl WHERE Date_CatchDoc < ?`, [start]),
      db.queryOne(`SELECT COALESCE(SUM(Amount_PayDoc),0) AS t FROM PayDoc_tbl WHERE Date_PayDoc < ?`, [start]),
      db.queryOne(`SELECT COALESCE(SUM(Price_SpendingDetails),0) AS t FROM SpendingDetails_tbl WHERE Date_SpendingDetails < ?`, [start]),
      db.queryOne(`SELECT COALESCE(SUM(CapitalAmount),0) AS cap FROM ProjectCapital_tbl`),
      db.queryOne(`
        SELECT COALESCE(SUM(d.AmountOUT * d.PriceOUT) - COALESCE(SUM(f.Dis_FOUT),0), 0) AS t
        FROM FOUT_tbl f
        LEFT JOIN DetailsOUT_tbl d ON d.id_NoFOUT = f.id_NoFOUT
        LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
        WHERE pt.PayTypeName NOT IN ('اجل','آجل') AND f.Date_FOUT < ?`, [start]),
    ]);
    const capital        = r2(capitalRow?.cap || 0);
    const openingBalance = r2(capital + prevCatch.t + (prevCashSales?.t||0) - prevPay.t - prevSpend.t);

    // حركات الفترة
    const catches = await db.query(`
      SELECT cd.Date_CatchDoc AS date, 'مقبوض من زبون' AS type, 'IN' AS dir,
             cd.Amount_CatchDoc AS amount, z.ZabonName AS party, cd.Note_CatchDoc AS note
      FROM CatchDoc_tbl cd LEFT JOIN Zabon_tbl z ON z.id_Zabon=cd.id_Zabon
      WHERE cd.Date_CatchDoc BETWEEN ? AND ?
    `, [start, end]);

    // ── مبيعات نقدية (كل ما ليس آجل) ────────────────────────
    const cashSales = await db.query(`
      SELECT f.Date_FOUT AS date,
             'مبيعات نقدية' AS type,
             'IN' AS dir,
             COALESCE(SUM(d.AmountOUT * d.PriceOUT) - f.Dis_FOUT, 0) AS amount,
             COALESCE(z.ZabonName, 'زبون نقدي') AS party,
             f.Note_FOUT AS note
      FROM FOUT_tbl f
      LEFT JOIN DetailsOUT_tbl d ON d.id_NoFOUT = f.id_NoFOUT
      LEFT JOIN Zabon_tbl z      ON z.id_Zabon   = f.id_Zabon
      LEFT JOIN PayType_Tbl pt   ON pt.id_PayType = f.id_PayType_FOUT
      WHERE pt.PayTypeName NOT IN ('اجل','آجل')
        AND f.Date_FOUT BETWEEN ? AND ?
      GROUP BY f.id_NoFOUT
    `, [start, end]);

    const pays = await db.query(`
      SELECT pd.Date_PayDoc AS date, 'مدفوع لمورد' AS type, 'OUT' AS dir,
             pd.Amount_PayDoc AS amount, a.AmilName AS party, pd.Note_PayDoc AS note
      FROM PayDoc_tbl pd LEFT JOIN Amil_tbl a ON a.id_Amil=pd.id_Amil
      WHERE pd.Date_PayDoc BETWEEN ? AND ?
    `, [start, end]);

    const spending = await db.query(`
      SELECT sd.Date_SpendingDetails AS date, COALESCE(s.NamePersonFor_Spending,'مصروف') AS type,
             'OUT' AS dir, sd.Price_SpendingDetails AS amount, '' AS party, sd.Note_SpendingDetails AS note
      FROM SpendingDetails_tbl sd LEFT JOIN Spending_tbl s ON s.id_Spending=sd.id_Spending
      WHERE sd.Date_SpendingDetails BETWEEN ? AND ?
    `, [start, end]);

    const all = [...catches, ...cashSales, ...pays, ...spending]
      .sort((a,b) => new Date(a.date)-new Date(b.date));

    let running = openingBalance;
    const ledger = all.map(t => {
      const amt = r2(t.amount);
      running = r2(running + (t.dir==="IN" ? amt : -amt));
      return { ...t, amount:amt, balance:running };
    });

    const totalIn  = r2(ledger.filter(t=>t.dir==="IN" ).reduce((s,t)=>s+t.amount,0));
    const totalOut = r2(ledger.filter(t=>t.dir==="OUT").reduce((s,t)=>s+t.amount,0));

    const header = await buildReportHeader("حركة الصندوق التفصيلية", start, end);
    res.json({ success:true, reportHeader:header,
      summary:{ openingBalance, totalIn, totalOut,
        closingBalance:r2(openingBalance+totalIn-totalOut),
        txCount:ledger.length },
      transactions: ledger });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════
//  T6- تقرير صافي الربح الحقيقي
//  GET /api/reports/profit-report
//  ?startDate= &endDate=
// ══════════════════════════════════════════════════════════
const profitReport = async (req, res) => {
  const { startDate, endDate } = req.query;
  const { start, end } = resolveDateRange(startDate, endDate);
  try {
    const [salesRow, discRow, addRow, salesRetRow, cogsRow, cogsRetRow, spendRow, expiredRow] = await Promise.all([
      db.queryOne(`SELECT COALESCE(SUM(d.AmountOUT*d.PriceOUT),0) AS t, COUNT(DISTINCT f.id_NoFOUT) AS cnt
        FROM FOUT_tbl f JOIN DetailsOUT_tbl d ON d.id_NoFOUT=f.id_NoFOUT
        WHERE f.Date_FOUT BETWEEN ? AND ?`, [start,end]),
      db.queryOne(`SELECT COALESCE(SUM(Dis_FOUT),0) AS t FROM FOUT_tbl WHERE Date_FOUT BETWEEN ? AND ?`, [start,end]),
      db.queryOne(`SELECT COALESCE(SUM(COALESCE(Add_FOUT,0)),0) AS t FROM FOUT_tbl WHERE Date_FOUT BETWEEN ? AND ?`, [start,end]),
      db.queryOne(`SELECT COALESCE(SUM(dr.AmountOUT*dr.PriceOUT),0) AS t FROM DetailsRetern_tbl dr
        JOIN FRetern_tbl fr ON fr.id_NoFRetern=dr.id_NoFRetern
        WHERE fr.ReturnType='CUSTOMER' AND fr.Date_FRetern BETWEEN ? AND ?`, [start,end]),
      db.queryOne(`SELECT COALESCE(SUM(d.AmountOUT*m."Cost Price"),0) AS t FROM DetailsOUT_tbl d
        JOIN FOUT_tbl f ON f.id_NoFOUT=d.id_NoFOUT JOIN Materials_tbl m ON m.id_Material_NoM=d.id_Material_NoM
        WHERE f.Date_FOUT BETWEEN ? AND ?`, [start,end]),
      db.queryOne(`SELECT COALESCE(SUM(dr.AmountOUT*m."Cost Price"),0) AS t FROM DetailsRetern_tbl dr
        JOIN FRetern_tbl fr ON fr.id_NoFRetern=dr.id_NoFRetern
        JOIN Materials_tbl m ON m.id_Material_NoM=dr.id_Material_NoM
        WHERE fr.ReturnType='CUSTOMER' AND fr.Date_FRetern BETWEEN ? AND ?`, [start,end]),
      db.queryOne(`SELECT COALESCE(SUM(Price_SpendingDetails),0) AS t FROM SpendingDetails_tbl WHERE Date_SpendingDetails BETWEEN ? AND ?`, [start,end]),
      db.queryOne(`SELECT COALESCE(SUM(TotalLoss),0) AS t FROM ExpiredStock_tbl WHERE ProcessedDate BETWEEN ? AND ?`, [start,end]),
    ]);

    const grossRevenue   = r2(salesRow.t + addRow.t);
    const discounts      = r2(discRow.t);
    const salesReturns   = r2(salesRetRow.t);
    const netRevenue     = r2(grossRevenue - discounts - salesReturns);
    const cogs           = r2(cogsRow.t);
    const cogsReturns    = r2(cogsRetRow.t);
    const totalCOGS      = r2(cogs - cogsReturns);
    const grossProfit    = r2(netRevenue - totalCOGS);
    const expenses       = r2(spendRow.t);
    const expiredLoss    = r2(expiredRow.t);
    const netProfit      = r2(grossProfit - expenses - expiredLoss);
    const grossMargin    = netRevenue>0 ? r2((grossProfit/netRevenue)*100) : 0;
    const netMargin      = netRevenue>0 ? r2((netProfit/netRevenue)*100)   : 0;

    const spendBreakdown = await db.query(`
      SELECT COALESCE(s.NamePersonFor_Spending,'عام') AS cat,
             COALESCE(SUM(sd.Price_SpendingDetails),0) AS amount
      FROM SpendingDetails_tbl sd LEFT JOIN Spending_tbl s ON s.id_Spending=sd.id_Spending
      WHERE sd.Date_SpendingDetails BETWEEN ? AND ?
      GROUP BY sd.id_Spending ORDER BY amount DESC
    `, [start,end]);

    const cogsDetails = await db.query(`
      SELECT
        m.id_Material_NoM,
        m.MaterialName,
        m.Band,
        m."Cost Price" AS costPrice,
        COALESCE(sold.soldQty, 0) AS soldQty,
        COALESCE(sold.soldCost, 0) AS soldCost,
        COALESCE(ret.returnQty, 0) AS returnQty,
        COALESCE(ret.returnCost, 0) AS returnCost
      FROM Materials_tbl m
      LEFT JOIN (
        SELECT d.id_Material_NoM,
               SUM(d.AmountOUT) AS soldQty,
               SUM(d.AmountOUT * mt."Cost Price") AS soldCost
        FROM DetailsOUT_tbl d
        JOIN FOUT_tbl f ON f.id_NoFOUT = d.id_NoFOUT
        JOIN Materials_tbl mt ON mt.id_Material_NoM = d.id_Material_NoM
        WHERE f.Date_FOUT BETWEEN ? AND ?
        GROUP BY d.id_Material_NoM
      ) sold ON sold.id_Material_NoM = m.id_Material_NoM
      LEFT JOIN (
        SELECT dr.id_Material_NoM,
               SUM(dr.AmountOUT) AS returnQty,
               SUM(dr.AmountOUT * mt."Cost Price") AS returnCost
        FROM DetailsRetern_tbl dr
        JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
        JOIN Materials_tbl mt ON mt.id_Material_NoM = dr.id_Material_NoM
        WHERE fr.ReturnType = 'CUSTOMER' AND fr.Date_FRetern BETWEEN ? AND ?
        GROUP BY dr.id_Material_NoM
      ) ret ON ret.id_Material_NoM = m.id_Material_NoM
      WHERE COALESCE(sold.soldQty, 0) <> 0 OR COALESCE(ret.returnQty, 0) <> 0
      ORDER BY m.MaterialName
    `, [start,end, start,end]);

    const header = await buildReportHeader("تقرير صافي الربح", start, end);
    res.json({ success:true, reportHeader:header,
      invoiceCount: salesRow.cnt,
      revenue:  { grossRevenue, discounts, salesReturns, netRevenue, additions: r2(addRow.t) },
      costs:    {
        cogs, cogsReturns, totalCOGS, grossProfit, grossMargin,
        details: cogsDetails.map(r => ({
          ...r,
          costPrice: r2(r.costPrice),
          soldQty: r2(r.soldQty),
          soldCost: r2(r.soldCost),
          returnQty: r2(r.returnQty),
          returnCost: r2(r.returnCost),
          netCost: r2((+r.soldCost || 0) - (+r.returnCost || 0)),
        })),
      },
      expenses: { total:expenses, breakdown:spendBreakdown.map(s=>({...s,amount:r2(s.amount)})) },
      expiredLoss: { total: expiredLoss },
      netProfit:{ value:netProfit, netMargin, status:netProfit>0?"ربح ✓":netProfit<0?"خسارة ✗":"تعادل ◆" },
    });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════
//  T7- تنبيه المخزون (أصناف تحت مستوى الطلب)
//  GET /api/reports/reorder-alert
//  ?threshold=0  (الأصناف التي وصلت لهذا المستوى أو أدناه)
// ══════════════════════════════════════════════════════════
const reorderAlert = async (req, res) => {
  const { threshold = 0 } = req.query;
  try {
    const items = await db.query(`
      SELECT m.id_Material_NoM, m.MaterialName, m.Band, m.Barcode,
             m."Cost Price" AS CostPrice, c.CatiguaryName,
             COALESCE(s.QuantityOnHand,0) AS currentStock,
             COALESCE(s.LastUpdateDate,'—') AS lastMovement,
             -- آخر مورد اشترينا منه
             (SELECT a.AmilName FROM FIN_tbl fi
              JOIN DetailsIN_tbl di ON di.id_NoFIN=fi.id_NoFIN
              JOIN Amil_tbl a ON a.id_Amil=fi.id_Amil
              WHERE di.id_Material_NoM=m.id_Material_NoM
              ORDER BY fi.Date_FIN DESC LIMIT 1) AS lastSupplier,
             -- آخر سعر شراء
             (SELECT di.PriceIN FROM DetailsIN_tbl di
              JOIN FIN_tbl fi ON fi.id_NoFIN=di.id_NoFIN
              WHERE di.id_Material_NoM=m.id_Material_NoM
              ORDER BY fi.Date_FIN DESC LIMIT 1) AS lastPurchasePrice,
             -- متوسط مبيعات آخر 30 يوم
             COALESCE((
               SELECT SUM(do_.AmountOUT)/30.0 FROM DetailsOUT_tbl do_
               JOIN FOUT_tbl fo ON fo.id_NoFOUT=do_.id_NoFOUT
               WHERE do_.id_Material_NoM=m.id_Material_NoM
                 AND fo.Date_FOUT >= date('now','-30 days')
             ),0) AS avgDailySales
      FROM Materials_tbl m
      LEFT JOIN Catiguary_tbl c ON c.id_Catiguary=m.id_Catiguary
      LEFT JOIN Stock_tbl s ON s.id_Material_NoM=m.id_Material_NoM
      WHERE COALESCE(s.QuantityOnHand,0) < ?
      ORDER BY COALESCE(s.QuantityOnHand,0) ASC, m.MaterialName
    `, [Number(threshold)]);

    const enriched = items.map(r => ({
      ...r,
      lastPurchasePrice: r2(r.lastPurchasePrice||0),
      avgDailySales    : r2(r.avgDailySales),
      daysOfStock      : r.avgDailySales>0 ? Math.ceil(r.currentStock/r.avgDailySales) : null,
      urgency          : r.currentStock<=0 ? "نفد" : r.currentStock<=2 ? "حرج" : "منخفض",
    }));

    const today = new Date().toISOString().split("T")[0];
    const header = await buildReportHeader("تنبيه المخزون المنخفض", today, today);
    res.json({ success:true, reportHeader:header, threshold:Number(threshold),
      summary:{ total:enriched.length,
        outOfStock:enriched.filter(r=>r.currentStock<=0).length,
        critical:enriched.filter(r=>r.currentStock>0&&r.currentStock<=2).length },
      items: enriched });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
};

// ══════════════════════════════════════════════════════════
//  نقل مخزني بين المستودعات (بين تاريخين)
//  GET /api/reports/warehouse-transfers?startDate=&endDate=
// ══════════════════════════════════════════════════════════
const warehouseTransfers = async (req, res) => {
  const { startDate, endDate } = req.query;
  const { start, end } = resolveDateRange(startDate, endDate);
  try {
    const transfers = await db.query(
      `SELECT t.id_Transfer AS id, t.Date_Transfer AS date, t.Note_Transfer AS note,
              wf.WarehouseName AS fromName, wt.WarehouseName AS toName,
              l.id_Material_NoM, m.MaterialName, m.Band, l.Quantity AS qty
       FROM Stock_Transfer_tbl t
       JOIN Warehouses_tbl wf ON wf.id_Warehouse = t.id_Warehouse_From
       JOIN Warehouses_tbl wt ON wt.id_Warehouse = t.id_Warehouse_To
       JOIN Stock_Transfer_Lines_tbl l ON l.id_Transfer = t.id_Transfer
       JOIN Materials_tbl m ON m.id_Material_NoM = l.id_Material_NoM
       WHERE t.Date_Transfer BETWEEN ? AND ?
       ORDER BY t.Date_Transfer DESC, t.id_Transfer DESC, l.id_TransferLine`,
      [start, end]
    );

    const summary = {
      transferCount: new Set(transfers.map((r) => r.id)).size,
      lineCount:     transfers.length,
      totalQty:      r2(transfers.reduce((s, r) => s + (+r.qty || 0), 0)),
    };

    const header = await buildReportHeader("نقل مخزني بين المستودعات", start, end);
    res.json({ success: true, reportHeader: header, summary, items: transfers });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ══════════════════════════════════════════════════════════
//  فواتير مبيعات — مستحقة التسديد (نطاق تاريخ + طريقة دفع اختيارية)
//  GET /api/reports/overdue-sales-invoices?startDate=&endDate=&id_PayType=
// ══════════════════════════════════════════════════════════
const overdueSalesInvoices = async (req, res) => {
  const { start, end } = resolveDateRange(req.query.startDate, req.query.endDate);
  const idPayType = req.query.id_PayType ? Number(req.query.id_PayType) : null;

  try {
    let sql = `
      SELECT
         f.id_NoFOUT,
         f.Date_FOUT,
         z.ZabonName,
         m.MandobName,
         pt.PayTypeName,
         f.id_PayType_FOUT,
         ${SALE_INVOICE_AMT} AS invoiceTotal,
         CAST(julianday('now') - julianday(f.Date_FOUT) AS INTEGER) AS daysPassed
       FROM FOUT_tbl f
       JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
       LEFT JOIN Zabon_tbl z ON z.id_Zabon = f.id_Zabon
       LEFT JOIN Mandob_tbl m ON m.id_Mandob = f.id_Mandob
       WHERE f.Date_FOUT BETWEEN ? AND ?`;
    const params = [start, end];
    if (idPayType) {
      sql += ` AND f.id_PayType_FOUT = ?`;
      params.push(idPayType);
    }
    sql += ` ORDER BY f.Date_FOUT DESC, f.id_NoFOUT DESC`;

    const items = await db.query(sql, params);

    const byMandob = {};
    for (const row of items) {
      const key = row.MandobName || "بدون مندوب";
      if (!byMandob[key]) byMandob[key] = { mandobName: key, count: 0, total: 0 };
      byMandob[key].count += 1;
      byMandob[key].total += row.invoiceTotal || 0;
    }

    const header = await buildReportHeader(
      "فواتير مبيعات مستحقة التسديد",
      start,
      end
    );

    res.json({
      success: true,
      reportHeader: header,
      summary: {
        invoiceCount: items.length,
        totalValue: items.reduce((s, r) => s + (r.invoiceTotal || 0), 0),
        mandobCount: Object.keys(byMandob).length,
      },
      byMandob: Object.values(byMandob).sort((a, b) => b.total - a.total),
      items,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

Object.assign(module.exports, {
  summaryReport, entityReport, entityInvoiceDetail,
  materialAnalysis, salesmenPerformance,
  cashFlowDetailed, profitReport, reorderAlert,
  warehouseTransfers,
  overdueSalesInvoices,
});
