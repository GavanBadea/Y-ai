// ============================================================
//  controllers/taxPackage.controller.js
//  حزمة المحاسب الضريبية — وحدة مستقلة
//
//  GET /api/tax-package?year=2025
// ============================================================
const db = require("../db");

const r2 = (n) => Math.round((+n || 0) * 100) / 100;

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

function resolveYear(year) {
  const y = Number(year) || new Date().getFullYear();
  return { year: y, start: `${y}-01-01`, end: `${y}-12-31` };
}

function monthLabel(m) {
  const idx = Number(m) - 1;
  return MONTHS_AR[idx] || `شهر ${m}`;
}

function fillMonthly(rows, valueKey = "total") {
  const map = Object.fromEntries(
    (rows || []).map((r) => [String(r.month).padStart(2, "0"), r2(r[valueKey])])
  );
  return MONTHS_AR.map((name, i) => {
    const key = String(i + 1).padStart(2, "0");
    return { month: key, monthName: name, total: map[key] || 0 };
  });
}

const getPackage = async (req, res) => {
  const { year: yearParam } = req.query;
  const { year, start, end } = resolveYear(yearParam);

  try {
    const company = await db.queryOne(`SELECT * FROM CompanyInformation_tbl LIMIT 1`);

    const [
      salesMonthlyRaw,
      purchMonthlyRaw,
      salesRetRow,
      purchRetRow,
      salesRow,
      discRow,
      addRow,
      purchGoodsRow,
      purchExtraRow,
      purchDiscRow,
      cogsRow,
      spendRow,
      spendBreakdown,
      expiredRow,
      catchRow,
      payRow,
      cashSalesRow,
      salesInvCount,
      purchInvCount,
      stockRow,
      customers,
      suppliers,
    ] = await Promise.all([
      db.query(`
        SELECT strftime('%m', f.Date_FOUT) AS month,
               COALESCE(SUM(d.AmountOUT * d.PriceOUT), 0) AS total
        FROM FOUT_tbl f
        JOIN DetailsOUT_tbl d ON d.id_NoFOUT = f.id_NoFOUT
        WHERE f.Date_FOUT BETWEEN ? AND ?
        GROUP BY strftime('%m', f.Date_FOUT)
        ORDER BY month
      `, [start, end]),

      db.query(`
        SELECT strftime('%m', fi.Date_FIN) AS month,
               COALESCE(SUM(di.AmountIN * di.PriceIN), 0) AS total
        FROM FIN_tbl fi
        JOIN DetailsIN_tbl di ON di.id_NoFIN = fi.id_NoFIN
        WHERE fi.Date_FIN BETWEEN ? AND ?
        GROUP BY strftime('%m', fi.Date_FIN)
        ORDER BY month
      `, [start, end]),

      db.queryOne(`
        SELECT COALESCE(SUM(dr.AmountOUT * dr.PriceOUT), 0) AS total,
               COUNT(DISTINCT fr.id_NoFRetern) AS cnt
        FROM DetailsRetern_tbl dr
        JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
        WHERE fr.ReturnType = 'CUSTOMER' AND fr.Date_FRetern BETWEEN ? AND ?
      `, [start, end]),

      db.queryOne(`
        SELECT COALESCE(SUM(dr.AmountOUT * dr.PriceOUT), 0) AS total,
               COUNT(DISTINCT fr.id_NoFRetern) AS cnt
        FROM DetailsRetern_tbl dr
        JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
        WHERE fr.ReturnType = 'SUPPLIER' AND fr.Date_FRetern BETWEEN ? AND ?
      `, [start, end]),

      db.queryOne(`
        SELECT COALESCE(SUM(d.AmountOUT * d.PriceOUT), 0) AS total
        FROM FOUT_tbl f
        JOIN DetailsOUT_tbl d ON d.id_NoFOUT = f.id_NoFOUT
        WHERE f.Date_FOUT BETWEEN ? AND ?
      `, [start, end]),

      db.queryOne(`
        SELECT COALESCE(SUM(Dis_FOUT), 0) AS total FROM FOUT_tbl
        WHERE Date_FOUT BETWEEN ? AND ?
      `, [start, end]),

      db.queryOne(`
        SELECT COALESCE(SUM(Add_FOUT), 0) AS total FROM FOUT_tbl
        WHERE Date_FOUT BETWEEN ? AND ?
      `, [start, end]),

      db.queryOne(`
        SELECT COALESCE(SUM(di.AmountIN * di.PriceIN), 0) AS total
        FROM FIN_tbl fi
        JOIN DetailsIN_tbl di ON di.id_NoFIN = fi.id_NoFIN
        WHERE fi.Date_FIN BETWEEN ? AND ?
      `, [start, end]),

      db.queryOne(`
        SELECT COALESCE(SUM(Trans + Customs + Porter), 0) AS total
        FROM FIN_tbl WHERE Date_FIN BETWEEN ? AND ?
      `, [start, end]),

      db.queryOne(`
        SELECT COALESCE(SUM(Dis_FIN), 0) AS total FROM FIN_tbl
        WHERE Date_FIN BETWEEN ? AND ?
      `, [start, end]),

      db.queryOne(`
        SELECT COALESCE(SUM(d.AmountOUT * m."Cost Price"), 0) AS total
        FROM DetailsOUT_tbl d
        JOIN FOUT_tbl f ON f.id_NoFOUT = d.id_NoFOUT
        JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
        WHERE f.Date_FOUT BETWEEN ? AND ?
      `, [start, end]),

      db.queryOne(`
        SELECT COALESCE(SUM(Price_SpendingDetails), 0) AS total
        FROM SpendingDetails_tbl WHERE Date_SpendingDetails BETWEEN ? AND ?
      `, [start, end]),

      db.query(`
        SELECT COALESCE(s.NamePersonFor_Spending, 'عام') AS category,
               COALESCE(SUM(sd.Price_SpendingDetails), 0) AS amount
        FROM SpendingDetails_tbl sd
        LEFT JOIN Spending_tbl s ON s.id_Spending = sd.id_Spending
        WHERE sd.Date_SpendingDetails BETWEEN ? AND ?
        GROUP BY sd.id_Spending ORDER BY amount DESC
      `, [start, end]),

      db.queryOne(`
        SELECT COALESCE(SUM(TotalLoss), 0) AS total
        FROM ExpiredStock_tbl WHERE ProcessedDate BETWEEN ? AND ?
      `, [start, end]),

      db.queryOne(`
        SELECT COALESCE(SUM(Amount_CatchDoc), 0) AS total,
               COUNT(*) AS cnt
        FROM CatchDoc_tbl WHERE Date_CatchDoc BETWEEN ? AND ?
      `, [start, end]),

      db.queryOne(`
        SELECT COALESCE(SUM(Amount_PayDoc), 0) AS total,
               COUNT(*) AS cnt
        FROM PayDoc_tbl WHERE Date_PayDoc BETWEEN ? AND ?
      `, [start, end]),

      db.queryOne(`
        SELECT COALESCE(SUM(d.AmountOUT * d.PriceOUT) - SUM(f.Dis_FOUT) + SUM(COALESCE(f.Add_FOUT, 0)), 0) AS total
        FROM FOUT_tbl f
        LEFT JOIN DetailsOUT_tbl d ON d.id_NoFOUT = f.id_NoFOUT
        LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
        WHERE pt.PayTypeName NOT IN ('اجل', 'آجل', 'credit', 'deferred')
          AND f.Date_FOUT BETWEEN ? AND ?
      `, [start, end]),

      db.queryOne(`
        SELECT COUNT(*) AS cnt FROM FOUT_tbl WHERE Date_FOUT BETWEEN ? AND ?
      `, [start, end]),

      db.queryOne(`
        SELECT COUNT(*) AS cnt FROM FIN_tbl WHERE Date_FIN BETWEEN ? AND ?
      `, [start, end]),

      db.queryOne(`
        SELECT COALESCE(SUM(s.QuantityOnHand * m."Cost Price"), 0) AS value,
               COUNT(CASE WHEN COALESCE(s.QuantityOnHand, 0) > 0 THEN 1 END) AS items
        FROM Materials_tbl m
        LEFT JOIN Stock_tbl s ON s.id_Material_NoM = m.id_Material_NoM
      `),

      db.query(`
        SELECT z.id_Zabon AS id, z.ZabonName AS name, z.Mobail AS mobile,
               COALESCE(SUM(dz.Amount_DionZabon), 0) AS totalDebt,
               COALESCE((SELECT SUM(cd.Amount_CatchDoc) FROM CatchDoc_tbl cd WHERE cd.id_Zabon = z.id_Zabon), 0) AS totalPaid,
               COALESCE((SELECT SUM(dr.AmountOUT * dr.PriceOUT) FROM DetailsRetern_tbl dr
                         JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
                         WHERE fr.ReturnType = 'CUSTOMER' AND fr.id_Party = z.id_Zabon), 0) AS totalReturns
        FROM Zabon_tbl z
        LEFT JOIN DionZabon_tbl dz ON dz.id_Zabon = z.id_Zabon
          AND dz.Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'
        GROUP BY z.id_Zabon
        HAVING (totalDebt - totalPaid - totalReturns) != 0
        ORDER BY (totalDebt - totalPaid - totalReturns) DESC
      `),

      db.query(`
        SELECT a.id_Amil AS id, a.AmilName AS name, a.Mobil AS mobile,
               COALESCE(SUM(da.Amount_DionAmil), 0) AS totalDebt,
               COALESCE((SELECT SUM(pd.Amount_PayDoc) FROM PayDoc_tbl pd WHERE pd.id_Amil = a.id_Amil), 0) AS totalPaid,
               COALESCE((SELECT SUM(dr.AmountOUT * dr.PriceOUT) FROM DetailsRetern_tbl dr
                         JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
                         WHERE fr.ReturnType = 'SUPPLIER' AND fr.id_Party = a.id_Amil), 0) AS totalReturns
        FROM Amil_tbl a
        LEFT JOIN DionAmil_tbl da ON da.id_Amil = a.id_Amil
          AND da.Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'
        GROUP BY a.id_Amil
        HAVING (totalDebt - totalPaid - totalReturns) != 0
        ORDER BY (totalDebt - totalPaid - totalReturns) DESC
      `),
    ]);

    const grossSales     = r2(salesRow.total);
    const salesDiscounts = r2(discRow.total);
    const salesAdditions = r2(addRow.total);
    const netSales       = r2(grossSales - salesDiscounts + salesAdditions - salesRetRow.total);
    const grossPurchases = r2(purchGoodsRow.total);
    const purchExtras    = r2(purchExtraRow.total);
    const purchDiscounts = r2(purchDiscRow.total);
    const netPurchases   = r2(grossPurchases + purchExtras - purchDiscounts - purchRetRow.total);
    const totalCOGS      = r2(cogsRow.total - purchRetRow.total);
    const grossProfit    = r2(netSales - totalCOGS);
    const expenses       = r2(spendRow.total);
    const expiredLoss    = r2(expiredRow.total);
    const netProfit      = r2(grossProfit - expenses - expiredLoss);

    const enrichedCustomers = customers.map((r) => {
      const net = r2(r.totalDebt - r.totalPaid - r.totalReturns);
      return {
        ...r,
        totalDebt: r2(r.totalDebt),
        totalPaid: r2(r.totalPaid),
        totalReturns: r2(r.totalReturns),
        netBalance: net,
      };
    });

    const enrichedSuppliers = suppliers.map((r) => {
      const net = r2(r.totalDebt - r.totalPaid - r.totalReturns);
      return {
        ...r,
        totalDebt: r2(r.totalDebt),
        totalPaid: r2(r.totalPaid),
        totalReturns: r2(r.totalReturns),
        netBalance: net,
      };
    });

    const salesMonthly    = fillMonthly(salesMonthlyRaw);
    const purchasesMonthly = fillMonthly(purchMonthlyRaw);

    res.json({
      success: true,
      meta: {
        year,
        periodFrom: start,
        periodTo: end,
        generatedAt: new Date().toISOString(),
        title: `حزمة المحاسب الضريبية — ${year}`,
      },
      company: {
        name: company?.CompanyInformation_Name || "",
        mobile: company?.CompanyInformation_Mobile || "",
        address: company?.CompanyInformation_Adress || "",
        taxNo: company?.CompanyInformation_TaxNo || "",
        currency: company?.CurrencySymbol || "د.ع",
      },
      sales: {
        invoiceCount: salesInvCount?.cnt || 0,
        grossSales,
        discounts: salesDiscounts,
        additions: salesAdditions,
        returns: r2(salesRetRow.total),
        returnsCount: salesRetRow?.cnt || 0,
        netSales,
        monthly: salesMonthly,
        monthlyTotal: r2(salesMonthly.reduce((s, m) => s + m.total, 0)),
      },
      purchases: {
        invoiceCount: purchInvCount?.cnt || 0,
        grossGoods: grossPurchases,
        transportCustomsPorter: purchExtras,
        discounts: purchDiscounts,
        returns: r2(purchRetRow.total),
        returnsCount: purchRetRow?.cnt || 0,
        netPurchases,
        monthly: purchasesMonthly,
        monthlyTotal: r2(purchasesMonthly.reduce((s, m) => s + m.total, 0)),
      },
      incomeStatement: {
        netSales,
        costOfGoodsSold: totalCOGS,
        grossProfit,
        operatingExpenses: expenses,
        expenseBreakdown: spendBreakdown.map((s) => ({
          category: s.category,
          amount: r2(s.amount),
        })),
        expiredStockLoss: expiredLoss,
        netProfit,
      },
      cashMovement: {
        customerReceipts: r2(catchRow.total),
        receiptCount: catchRow?.cnt || 0,
        supplierPayments: r2(payRow.total),
        paymentCount: payRow?.cnt || 0,
        cashSales: r2(cashSalesRow.total),
        totalIn: r2(catchRow.total + cashSalesRow.total),
        totalOut: r2(payRow.total + expenses),
      },
      receivables: {
        items: enrichedCustomers,
        total: r2(enrichedCustomers.reduce((s, r) => s + r.netBalance, 0)),
        count: enrichedCustomers.length,
      },
      payables: {
        items: enrichedSuppliers,
        total: r2(enrichedSuppliers.reduce((s, r) => s + r.netBalance, 0)),
        count: enrichedSuppliers.length,
      },
      inventory: {
        value: r2(stockRow?.value || 0),
        itemsWithStock: stockRow?.items || 0,
        note: year < new Date().getFullYear()
          ? "قيمة المخزون المعروضة هي الرصيد الحالي في النظام (يُنصح مطابقتها مع الجرد الفعلي لنهاية السنة)"
          : "قيمة المخزون حسب الرصيد الحالي وتكلفة المواد",
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = { getPackage };
