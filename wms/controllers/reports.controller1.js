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
      const [debts, catches, retursAdj] = await Promise.all([
        db.queryOne(
          `SELECT COALESCE(SUM(Amount_DionZabon),0) AS t
           FROM DionZabon_tbl WHERE id_Zabon=? AND Date_DionZabon < ?`,
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
      ]);
      balanceBroughtForward = r2(debts.t - catches.t - retursAdj.t);
    } else {
      const [debts, pays] = await Promise.all([
        db.queryOne(
          `SELECT COALESCE(SUM(Amount_DionAmil),0) AS t
           FROM DionAmil_tbl WHERE id_Amil=? AND Date_DionAmil < ?`,
          [id_Party, start]
        ),
        db.queryOne(
          `SELECT COALESCE(SUM(Amount_PayDoc),0) AS t
           FROM PayDoc_tbl WHERE id_Amil=? AND Date_PayDoc < ?`,
          [id_Party, start]
        ),
      ]);
      balanceBroughtForward = r2(debts.t - pays.t);
    }

    // ── جمع الحركات خلال الفترة ──────────────────────────
    const transactions = [];

    if (partyType === "CUSTOMER") {
      // فواتير المبيعات
      const sales = await db.query(
        `SELECT
           f.id_NoFOUT AS docNo,
           f.Date_FOUT AS date,
           'فاتورة مبيعات' AS type,
           'debit' AS side,
           SUM(d.AmountOUT * d.PriceOUT) - f.Dis_FOUT AS amount,
           pt.PayTypeName AS note
         FROM FOUT_tbl f
         LEFT JOIN DetailsOUT_tbl d  ON d.id_NoFOUT   = f.id_NoFOUT
         LEFT JOIN PayType_Tbl    pt ON pt.id_PayType  = f.id_PayType_FOUT
         WHERE f.id_Zabon=? AND f.Date_FOUT BETWEEN ? AND ?
         GROUP BY f.id_NoFOUT`,
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
           AND Note_DionZabon NOT LIKE 'مرتجع%'`,
        [id_Party, start, end]
      );

      transactions.push(...sales, ...returns, ...catches, ...debtEntries);
    } else {
      // فواتير الشراء
      const purchases = await db.query(
        `SELECT
           f.id_NoFIN AS docNo,
           f.Date_FIN AS date,
           'فاتورة شراء' AS type,
           'debit' AS side,
           SUM(d.AmountIN * d.PriceIN) + f.Trans + f.Customs + f.Porter - f.Dis_FIN AS amount,
           pt.PayTypeName AS note
         FROM FIN_tbl f
         LEFT JOIN DetailsIN_tbl d ON d.id_NoFIN    = f.id_NoFIN
         LEFT JOIN PayType_Tbl pt ON pt.id_PayType  = f.id_PayType_FIN
         WHERE f.id_Amil=? AND f.Date_FIN BETWEEN ? AND ?
         GROUP BY f.id_NoFIN`,
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

      transactions.push(...purchases, ...returns, ...pays);
    }

    // ── ترتيب بالتاريخ + حساب الرصيد المتراكم ────────────
    transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

    let runningBalance = balanceBroughtForward;
    const ledger = transactions.map((tx) => {
      const amt   = r2(Number(tx.amount));
      const delta = tx.side === "debit" ? amt : -amt;
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
      salesRow, purchasesRow, stockRow,
      customersDebt, suppliersDebt,
      spendingRow, returnsRow,
    ] = await Promise.all([
      // مبيعات الفترة
      db.queryOne(
        `SELECT COUNT(*) AS cnt,
                COALESCE(SUM(d.AmountOUT*d.PriceOUT)-SUM(f.Dis_FOUT),0) AS total
         FROM FOUT_tbl f LEFT JOIN DetailsOUT_tbl d ON d.id_NoFOUT=f.id_NoFOUT
         WHERE f.Date_FOUT BETWEEN ? AND ?`, [start, end]
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
    ]);

    const grossProfit = r2(
      (salesRow.total - purchasesRow.total) - spendingRow.t
    );

    const header = await buildReportHeader("لوحة القيادة", start, end);

    res.json({
      success      : true,
      reportHeader : header,
      cards        : {
        sales      : { label: "إجمالي المبيعات", value: r2(salesRow.total),      count: salesRow.cnt },
        purchases  : { label: "إجمالي المشتريات", value: r2(purchasesRow.total), count: purchasesRow.cnt },
        grossProfit: { label: "هامش الربح (تقريبي)", value: grossProfit,
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
      // مبيعات نقدية (نوع الدفع نقدي)
      db.queryOne(
        `SELECT COALESCE(SUM(d.AmountOUT*d.PriceOUT)-SUM(f.Dis_FOUT),0) AS t
         FROM FOUT_tbl f
         LEFT JOIN DetailsOUT_tbl d ON d.id_NoFOUT=f.id_NoFOUT
         LEFT JOIN PayType_Tbl pt ON pt.id_PayType=f.id_PayType_FOUT
         WHERE pt.PayTypeName='نقدي' AND f.Date_FOUT BETWEEN ? AND ?`,
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
