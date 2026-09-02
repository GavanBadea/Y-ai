// ============================================================
//  utils/accountingBalances.js
//  أرصدة شجرة الحسابات من البيانات التشغيلية الحالية
// ============================================================
const db = require("../db");
const { purchaseInvoiceGrandTotalSql } = require("./purchaseLineCost");

const r2 = (n) => Math.round((+n || 0) * 100) / 100;

function resolveRange(from, to) {
  const y = new Date().getFullYear();
  return {
    from: from || `${y}-01-01`,
    to: to || new Date().toISOString().split("T")[0],
  };
}

async function getNetSales(from, to) {
  const [sales, disc, ret] = await Promise.all([
    db.queryOne(
      `SELECT COALESCE(SUM(d.AmountOUT * d.PriceOUT), 0) AS t
       FROM FOUT_tbl f JOIN DetailsOUT_tbl d ON d.id_NoFOUT = f.id_NoFOUT
       WHERE f.Date_FOUT BETWEEN ? AND ?`,
      [from, to]
    ),
    db.queryOne(`SELECT COALESCE(SUM(Dis_FOUT), 0) AS t FROM FOUT_tbl WHERE Date_FOUT BETWEEN ? AND ?`, [from, to]),
    db.queryOne(
      `SELECT COALESCE(SUM(dr.AmountOUT * dr.PriceOUT), 0) AS t
       FROM DetailsRetern_tbl dr JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
       WHERE fr.ReturnType = 'CUSTOMER' AND fr.Date_FRetern BETWEEN ? AND ?`,
      [from, to]
    ),
  ]);
  const addRow = await db.queryOne(
    `SELECT COALESCE(SUM(Add_FOUT), 0) AS t FROM FOUT_tbl WHERE Date_FOUT BETWEEN ? AND ?`,
    [from, to]
  );
  return r2(sales.t - disc.t + addRow.t - ret.t);
}

async function getCOGS(from, to) {
  const [sold, ret] = await Promise.all([
    db.queryOne(
      `SELECT COALESCE(SUM(d.AmountOUT * m."Cost Price"), 0) AS t
       FROM DetailsOUT_tbl d
       JOIN FOUT_tbl f ON f.id_NoFOUT = d.id_NoFOUT
       JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
       WHERE f.Date_FOUT BETWEEN ? AND ?`,
      [from, to]
    ),
    db.queryOne(
      `SELECT COALESCE(SUM(dr.AmountOUT * m."Cost Price"), 0) AS t
       FROM DetailsRetern_tbl dr
       JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
       JOIN Materials_tbl m ON m.id_Material_NoM = dr.id_Material_NoM
       WHERE fr.ReturnType = 'CUSTOMER' AND fr.Date_FRetern BETWEEN ? AND ?`,
      [from, to]
    ),
  ]);
  return r2((sold?.t || 0) - (ret?.t || 0));
}

async function getExpiredStockLoss(from, to) {
  const row = await db.queryOne(
    `SELECT COALESCE(SUM(TotalLoss), 0) AS t
     FROM ExpiredStock_tbl
     WHERE ProcessedDate BETWEEN ? AND ?`,
    [from, to]
  );
  return r2(row?.t || 0);
}

async function getInventoryValue() {
  const row = await db.queryOne(
    `SELECT COALESCE(SUM(s.QuantityOnHand * m."Cost Price"), 0) AS t
     FROM Materials_tbl m
     LEFT JOIN Stock_tbl s ON s.id_Material_NoM = m.id_Material_NoM`
  );
  return r2(row.t);
}

async function getReceivables() {
  const rows = await db.query(`
    SELECT * FROM (
      SELECT z.id_Zabon,
        COALESCE((SELECT SUM(dz.Amount_DionZabon) FROM DionZabon_tbl dz
                  WHERE dz.id_Zabon = z.id_Zabon
                    AND dz.Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'), 0)
        - COALESCE((SELECT SUM(cd.Amount_CatchDoc) FROM CatchDoc_tbl cd
                    WHERE cd.id_Zabon = z.id_Zabon), 0) AS net
      FROM Zabon_tbl z
    ) WHERE net != 0
  `);
  return r2(rows.reduce((s, r) => s + r.net, 0));
}

async function getPayables() {
  const rows = await db.query(`
    SELECT * FROM (
      SELECT a.id_Amil,
        COALESCE((SELECT SUM(da.Amount_DionAmil) FROM DionAmil_tbl da
                  WHERE da.id_Amil = a.id_Amil
                    AND da.Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'), 0)
        - COALESCE((SELECT SUM(pd.Amount_PayDoc) FROM PayDoc_tbl pd
                    WHERE pd.id_Amil = a.id_Amil), 0) AS net
      FROM Amil_tbl a
    ) WHERE net != 0
  `);
  return r2(rows.reduce((s, r) => s + r.net, 0));
}

async function getCapital() {
  const row = await db.queryOne(`SELECT COALESCE(SUM(CapitalAmount), 0) AS t FROM ProjectCapital_tbl`);
  return r2(row.t);
}

async function getCashBalance(asOf) {
  const [cap, catchB, payB, spendB, cashSales] = await Promise.all([
    db.queryOne(`SELECT COALESCE(SUM(CapitalAmount), 0) AS t FROM ProjectCapital_tbl WHERE DepositDate <= ?`, [asOf]),
    db.queryOne(`SELECT COALESCE(SUM(Amount_CatchDoc), 0) AS t FROM CatchDoc_tbl WHERE Date_CatchDoc <= ?`, [asOf]),
    db.queryOne(`SELECT COALESCE(SUM(Amount_PayDoc), 0) AS t FROM PayDoc_tbl WHERE Date_PayDoc <= ?`, [asOf]),
    db.queryOne(`SELECT COALESCE(SUM(Price_SpendingDetails), 0) AS t FROM SpendingDetails_tbl WHERE Date_SpendingDetails <= ?`, [asOf]),
    db.queryOne(
      `SELECT COALESCE(SUM(inv_net), 0) AS t FROM (
         SELECT
           COALESCE(SUM(d.AmountOUT * d.PriceOUT), 0)
           - COALESCE(MAX(f.Dis_FOUT), 0)
           + COALESCE(MAX(f.Add_FOUT), 0) AS inv_net
         FROM FOUT_tbl f
         LEFT JOIN DetailsOUT_tbl d ON d.id_NoFOUT = f.id_NoFOUT
         LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
         WHERE f.Date_FOUT <= ?
           AND LOWER(COALESCE(pt.PayTypeName, '')) NOT IN ('اجل', 'آجل', 'credit', 'deferred')
         GROUP BY f.id_NoFOUT
       )`,
      [asOf]
    ),
  ]);
  return r2(cap.t + catchB.t + cashSales.t - payB.t - spendB.t);
}

async function getPurchasesForResale(from, to) {
  const grandTotalSql = purchaseInvoiceGrandTotalSql("f");
  const [purchases, returns] = await Promise.all([
    db.queryOne(
      `SELECT COALESCE(SUM(${grandTotalSql}), 0) AS t
       FROM FIN_tbl f
       WHERE f.Date_FIN BETWEEN ? AND ?`,
      [from, to]
    ),
    db.queryOne(
      `SELECT COALESCE(SUM(dr.AmountOUT * dr.PriceOUT), 0) AS t
       FROM DetailsRetern_tbl dr
       JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
       WHERE fr.ReturnType = 'SUPPLIER' AND fr.Date_FRetern BETWEEN ? AND ?`,
      [from, to]
    ),
  ]);
  return r2((purchases?.t || 0) - (returns?.t || 0));
}

async function getSpendingByGlCode(from, to) {
  const rows = await db.query(
    `SELECT COALESCE(gl.AccountCode, '32') AS code,
            COALESCE(SUM(sd.Price_SpendingDetails), 0) AS amount
     FROM SpendingDetails_tbl sd
     LEFT JOIN Spending_tbl s ON s.id_Spending = sd.id_Spending
     LEFT JOIN GL_Accounts gl ON gl.id_GL_Account = s.id_GL_Account
     WHERE sd.Date_SpendingDetails BETWEEN ? AND ?
     GROUP BY COALESCE(gl.AccountCode, '32')`,
    [from, to]
  );
  const map = { "31": 0, "32": 0, "33": 0 };
  for (const r of rows) {
    const c = String(r.code);
    if (map[c] !== undefined) map[c] = r2(r.amount);
    else map["32"] = r2(map["32"] + r.amount);
  }
  return map;
}

async function getDepreciationExpense(from, to) {
  const row = await db.queryOne(
    `SELECT COALESCE(SUM(Amount), 0) AS t FROM Depreciation_Entry_tbl
     WHERE EntryDate BETWEEN ? AND ?`,
    [from, to]
  );
  return r2(row.t);
}

async function getAccumulatedDepreciation(asOf) {
  const row = await db.queryOne(
    `SELECT COALESCE(SUM(Amount), 0) AS t FROM Depreciation_Entry_tbl WHERE EntryDate <= ?`,
    [asOf]
  );
  return r2(row.t);
}

async function getFixedAssetsGross() {
  const row = await db.queryOne(
    `SELECT COALESCE(SUM(AcquisitionCost), 0) AS t FROM Fixed_Assets_tbl WHERE IsActive = 1`
  );
  return r2(row.t);
}

async function getFixedAssetsByCode() {
  const rows = await db.query(
    `SELECT gl.AccountCode AS code, COALESCE(SUM(fa.AcquisitionCost), 0) AS amount
     FROM Fixed_Assets_tbl fa
     JOIN GL_Accounts gl ON gl.id_GL_Account = fa.id_GL_Account
     WHERE fa.IsActive = 1
     GROUP BY gl.AccountCode`
  );
  const map = { "113": 0, "114": 0 };
  for (const r of rows) map[r.code] = r2(r.amount);
  return map;
}

function buildTree(accounts, balanceMap) {
  const byCode = {};
  for (const a of accounts) {
    byCode[a.AccountCode] = {
      ...a,
      balance: balanceMap[a.AccountCode] ?? 0,
      children: [],
    };
  }
  const roots = [];
  for (const a of accounts) {
    const node = byCode[a.AccountCode];
    if (a.ParentCode && byCode[a.ParentCode]) byCode[a.ParentCode].children.push(node);
    else if (!a.ParentCode) roots.push(node);
  }
  const roll = (node) => {
    if (!node.children.length) return node.balance;
    let childSum = 0;
    for (const ch of node.children) childSum += roll(ch);
    // حسابات التجميع GROUP = مجموع الأبناء فقط (لا نُضيف رصيداً مسبقاً لتفادي التضاعف)
    node.balance = node.BalanceSource === "GROUP" ? r2(childSum) : r2(node.balance + childSum);
    return node.balance;
  };
  roots.forEach(roll);
  return roots;
}

function flattenTreeBalances(nodes, out = {}) {
  for (const n of nodes || []) {
    out[n.AccountCode] = n.balance;
    if (n.children?.length) flattenTreeBalances(n.children, out);
  }
  return out;
}

async function computeBalances({ from, to, asOf }) {
  const range = resolveRange(from, to);
  const asOfDate = asOf || range.to;

  const [
    netSales, cogs, inventory, receivables, payables, capital, cash,
    spending, purchasesForResale, deprExp, accumDepr, fixedGross, fixedByCode, expiredLoss,
  ] = await Promise.all([
    getNetSales(range.from, range.to),
    getCOGS(range.from, range.to),
    getInventoryValue(),
    getReceivables(),
    getPayables(),
    getCapital(),
    getCashBalance(asOfDate),
    getSpendingByGlCode(range.from, range.to),
    getPurchasesForResale(range.from, range.to),
    getDepreciationExpense(range.from, range.to),
    getAccumulatedDepreciation(asOfDate),
    getFixedAssetsGross(),
    getFixedAssetsByCode(),
    getExpiredStockLoss(range.from, range.to),
  ]);

  const grossProfit = r2(netSales - cogs);
  const totalExpenses = r2(spending["31"] + spending["32"] + spending["33"] + deprExp);
  const netProfit = r2(grossProfit - totalExpenses - expiredLoss);

  const fixedNet = r2(fixedGross - accumDepr);
  const totalAssets = r2(fixedNet + inventory + receivables + cash);
  const totalLiabEquity = r2(capital + payables + netProfit);

  const balanceMap = {
    "41": netSales,
    "13": inventory,
    "16": receivables,
    "18": cash,
    "21": capital,
    "26": payables,
    "218": netProfit,
    "31": spending["31"],
    "32": spending["32"],
    "33": spending["33"],
    "35": purchasesForResale,
    "37": deprExp,
    "12": -accumDepr,
    "113": fixedByCode["113"] || 0,
    "114": fixedByCode["114"] || 0,
  };

  return {
    range,
    asOfDate,
    balanceMap,
    incomeStatement: {
      netSales,
      cogs,
      grossProfit,
      salaries: spending["31"],
      goodsSupplies: spending["32"],
      serviceSupplies: spending["33"],
      depreciation: deprExp,
      totalOperatingExpenses: r2(spending["31"] + spending["32"] + spending["33"] + deprExp),
      expiredStockLoss: expiredLoss,
      netProfit,
    },
    balanceSheet: {
      fixedAssetsGross: fixedGross,
      accumulatedDepreciation: accumDepr,
      fixedAssetsNet: fixedNet,
      inventory,
      receivables,
      cash,
      totalAssets,
      capital,
      payables,
      retainedEarnings: netProfit,
      totalLiabilitiesEquity: totalLiabEquity,
      balanced: Math.abs(totalAssets - totalLiabEquity) < 1,
      difference: r2(totalAssets - totalLiabEquity),
    },
  };
}

module.exports = {
  r2,
  resolveRange,
  computeBalances,
  buildTree,
  flattenTreeBalances,
};
