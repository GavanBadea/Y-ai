// ============================================================
//  controllers/accounting.controller.js
//  المحاسبة — شجرة الحسابات، قائمة الدخل، الميزانية، الاندثار
// ============================================================
const db = require("../db");
const { ensureChartSeed } = require("../utils/iraqiChartSeed");
const { computeBalances, buildTree, resolveRange, r2, flattenTreeBalances } = require("../utils/accountingBalances");
const { purchaseInvoiceGrandTotalSql } = require("../utils/purchaseLineCost");

async function loadCompany() {
  return db.queryOne(`SELECT * FROM CompanyInformation_tbl LIMIT 1`) || {};
}

/** إزالة حسابات يدوية غير مطلوبة (مُضافة سابقاً ولا تُستخدم) */
async function purgeUnwantedGlAccounts() {
  await db.run(`DELETE FROM GL_Accounts WHERE IsSystem = 0 AND AccountCode = ?`, ["1-55"]);
}

const getChart = async (req, res) => {
  try {
    await ensureChartSeed(db);
    await purgeUnwantedGlAccounts();
    const { from, to, asOf } = req.query;
    const accounts = await db.query(
      `SELECT * FROM GL_Accounts WHERE IsActive = 1 ORDER BY AccountCode`
    );
    const computed = await computeBalances({ from, to, asOf });
    const tree = buildTree(accounts, computed.balanceMap);
    const rolledBalances = flattenTreeBalances(tree);
    const company = await loadCompany();
    res.json({
      success: true,
      company: {
        name: company.CompanyInformation_Name || "",
        taxNo: company.CompanyInformation_TaxNo || "",
      },
      period: computed.range,
      asOf: computed.asOfDate,
      tree,
      accounts: accounts.map((a) => ({
        ...a,
        balance: rolledBalances[a.AccountCode] ?? computed.balanceMap[a.AccountCode] ?? 0,
      })),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const getIncomeStatement = async (req, res) => {
  try {
    await ensureChartSeed(db);
    const range = resolveRange(req.query.from, req.query.to);
    const computed = await computeBalances({ from: range.from, to: range.to });
    const company = await loadCompany();
    const inc = computed.incomeStatement;
    const taxRow = await db.queryOne(
      `SELECT COALESCE(SUM(GeneralTax), 0) AS total
       FROM FIN_tbl
       WHERE Date_FIN BETWEEN ? AND ? AND COALESCE(GeneralTax, 0) > 0`,
      [range.from, range.to]
    );
    const generalTaxTotal = r2(taxRow?.total || 0);
    res.json({
      success: true,
      company: { name: company.CompanyInformation_Name, taxNo: company.CompanyInformation_TaxNo },
      period: range,
      lines: [
        { code: "41", label: "إيراد النشاط الجاري (صافي المبيعات)", amount: inc.netSales, section: "revenue", clickable: true },
        { code: "—", label: "تكلفة البضاعة المباعة", amount: inc.cogs, section: "cogs", clickable: true, detailSection: "cogs" },
        { code: "—", label: "مجمل الربح", amount: inc.grossProfit, section: "subtotal", bold: true },
        { code: "31", label: "الرواتب والأجور", amount: inc.salaries, section: "expense", clickable: true },
        { code: "32", label: "المستلزمات السلعية والتشغيلية", amount: inc.goodsSupplies, section: "expense", clickable: true },
        { code: "33", label: "المستلزمات الخدمية", amount: inc.serviceSupplies, section: "expense", clickable: true },
        { code: "37", label: "مصروف الاندثار (غير نقدي)", amount: inc.depreciation, section: "expense", nonCash: true, clickable: true },
        { code: "—", label: "إجمالي المصروفات", amount: inc.totalOperatingExpenses, section: "subtotal", bold: true },
        { code: "—", label: "خسائر مواد منتهية الصلاحية", amount: inc.expiredStockLoss, section: "expense" },
        { code: "218", label: "صافي الربح / الخسارة", amount: inc.netProfit, section: "net", bold: true, clickable: true },
        {
          code: "39",
          label: "الظريبة العامة (مصروفات أخرى — إعلامي)",
          amount: generalTaxTotal,
          section: "tax",
          bold: true,
          clickable: generalTaxTotal > 0,
          infoOnly: true,
        },
      ],
      summary: { ...inc, generalTaxTotal },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const getGeneralTaxDetails = async (req, res) => {
  try {
    const range = resolveRange(req.query.from, req.query.to);
    const rows = await db.query(
      `SELECT
         f.id_NoFIN,
         f.Date_FIN,
         COALESCE(f.VehicleNumber, '') AS VehicleNumber,
         COALESCE(f.GeneralTax, 0)     AS GeneralTax,
         a.AmilName,
         d.AmountIN,
         m.MaterialName,
         COALESCE(t.TypeName, '')      AS TypeName
       FROM FIN_tbl f
       LEFT JOIN Amil_tbl a ON a.id_Amil = f.id_Amil
       JOIN DetailsIN_tbl d ON d.id_NoFIN = f.id_NoFIN
       JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
       LEFT JOIN Type_tbl t ON t.id_Type = m.id_Type
       WHERE f.Date_FIN BETWEEN ? AND ? AND COALESCE(f.GeneralTax, 0) > 0
       ORDER BY f.Date_FIN, f.id_NoFIN, d.id_Material_NoM`,
      [range.from, range.to]
    );

    const byInvoice = new Map();
    for (const r of rows) {
      if (!byInvoice.has(r.id_NoFIN)) {
        byInvoice.set(r.id_NoFIN, {
          id_NoFIN: r.id_NoFIN,
          Date_FIN: r.Date_FIN,
          VehicleNumber: r.VehicleNumber || "—",
          GeneralTax: r2(r.GeneralTax),
          AmilName: r.AmilName || "—",
          lines: [],
        });
      }
      byInvoice.get(r.id_NoFIN).lines.push({
        MaterialName: r.MaterialName,
        AmountIN: r.AmountIN,
        TypeName: r.TypeName || "—",
      });
    }

    const invoices = [...byInvoice.values()];
    const total = r2(invoices.reduce((s, inv) => s + inv.GeneralTax, 0));

    res.json({
      success: true,
      period: range,
      total,
      invoices,
      note: "مجموع الظريبة العامة من فواتير المشتريات — لا يدخل في حسابات الفاتورة أو صافي الربح",
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const getBalanceSheet = async (req, res) => {
  try {
    await ensureChartSeed(db);
    const range = resolveRange(req.query.from, req.query.to);
    const computed = await computeBalances({ from: range.from, to: range.to, asOf: range.to });
    const bs = computed.balanceSheet;
    const inc = computed.incomeStatement;
    const company = await loadCompany();

    const imbalanceAnalysis = !bs.balanced ? {
      difference: bs.difference,
      totalAssets: bs.totalAssets,
      totalLiabilitiesEquity: bs.totalLiabilitiesEquity,
      assetBreakdown: [
        { label: "صافي الموجودات الثابتة", amount: bs.fixedAssetsNet },
        { label: "المخزون", amount: bs.inventory },
        { label: "المدينون والعملاء", amount: bs.receivables },
        { label: "النقود والصندوق", amount: bs.cash },
      ],
      liabilitiesBreakdown: [
        { label: "رأس المال والاحتياطيات", amount: bs.capital },
        { label: "الدائنون والموردون", amount: bs.payables },
        { label: "أرباح/خسائر السنة الحالية", amount: bs.retainedEarnings },
      ],
      incomeStatement: {
        netSales: inc.netSales,
        grossProfit: inc.grossProfit,
        netProfit: inc.netProfit,
      },
      hints: bs.difference > 0
        ? [
            "الموجودات أكبر من (المطلوبات + حقوق الملكية).",
            "تحقق من: ذمم الموردين، صافي الربح في قائمة الدخل، أو قيود غير مُرحَّلة.",
          ]
        : [
            "المطلوبات وحقوق الملكية أكبر من الموجودات.",
            "تحقق من: ذمم العملاء، قيمة المخزون، أو رصيد الصندوق.",
          ],
    } : null;

    res.json({
      success: true,
      company: { name: company.CompanyInformation_Name, taxNo: company.CompanyInformation_TaxNo },
      period: range,
      asOf: range.to,
      assets: [
        { code: "113", label: "أثاث وأجهزة مكاتب", amount: computed.balanceMap["113"] || 0, clickable: true },
        { code: "114", label: "وسائل نقل وانتقال", amount: computed.balanceMap["114"] || 0, clickable: true },
        { code: "11", label: "إجمالي الموجودات الثابتة", amount: bs.fixedAssetsGross, bold: true, clickable: true },
        { code: "12", label: "مخصص الاندثار المتراكم", amount: -bs.accumulatedDepreciation, clickable: true },
        { code: "—", label: "صافي الموجودات الثابتة", amount: bs.fixedAssetsNet, bold: true },
        { code: "13", label: "المخزون", amount: bs.inventory, clickable: true },
        { code: "16", label: "المدينون والعملاء", amount: bs.receivables, clickable: true },
        { code: "18", label: "النقود والصندوق", amount: bs.cash, clickable: true },
        { code: "1", label: "إجمالي الموجودات", amount: bs.totalAssets, bold: true, clickable: true },
      ],
      liabilitiesEquity: [
        { code: "21", label: "رأس المال والاحتياطيات", amount: bs.capital, clickable: true },
        { code: "26", label: "الدائنون والموردون", amount: bs.payables, clickable: true },
        { code: "218", label: "الأرباح والخسائر المتراكمة (السنة الحالية)", amount: bs.retainedEarnings, clickable: true },
        { code: "2", label: "إجمالي المطلوبات وحقوق الملكية", amount: bs.totalLiabilitiesEquity, bold: true, clickable: true },
      ],
      summary: bs,
      imbalanceAnalysis,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const PARENT_CODES = ["1", "2", "3", "4", "11", "31", "32", "33"];

const listGlParents = async (_req, res) => {
  try {
    await ensureChartSeed(db);
    const rows = await db.query(
      `SELECT AccountCode, AccountName, AccountType
       FROM GL_Accounts
       WHERE IsActive = 1 AND (
         BalanceSource = 'GROUP'
         OR AccountCode IN ('1','2','3','4','11','31','32','33')
       )
       ORDER BY AccountCode`
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

function resolveChildAccountType(parent) {
  const root = { "1": "ASSET", "2": "EQUITY", "3": "EXPENSE", "4": "REVENUE" };
  if (root[parent.AccountCode]) return root[parent.AccountCode];
  return parent.AccountType;
}

const createGlAccount = async (req, res) => {
  const { AccountCode, AccountName, ParentCode } = req.body;
  const code = String(AccountCode || "").trim();
  const name = String(AccountName || "").trim();
  const parentCode = String(ParentCode || "").trim();
  if (!code || !name || !parentCode)
    return res.status(400).json({ success: false, message: "رمز الحساب والاسم والحساب الأب مطلوبان" });
  try {
    await ensureChartSeed(db);
    const parent = await db.queryOne(
      `SELECT * FROM GL_Accounts WHERE AccountCode = ? AND IsActive = 1`,
      [parentCode]
    );
    if (!parent)
      return res.status(400).json({ success: false, message: "الحساب الأب غير موجود" });
    if (parent.BalanceSource !== "GROUP" && !PARENT_CODES.includes(parent.AccountCode))
      return res.status(400).json({ success: false, message: "لا يمكن الإضافة إلا تحت قسم رئيسي أو فرع تجميعي" });
    if (!code.startsWith(parentCode))
      return res.status(400).json({ success: false, message: "رمز الحساب يجب أن يبدأ برمز الحساب الأب" });
    const dup = await db.queryOne(`SELECT id_GL_Account FROM GL_Accounts WHERE AccountCode = ?`, [code]);
    if (dup)
      return res.status(400).json({ success: false, message: "رمز الحساب مستخدم مسبقاً" });

    const r = await db.run(
      `INSERT INTO GL_Accounts (AccountCode, AccountName, AccountType, ParentCode, IsSystem, BalanceSource, IsActive)
       VALUES (?, ?, ?, ?, 0, 'MANUAL', 1)`,
      [code, name, resolveChildAccountType(parent), parentCode]
    );
    res.status(201).json({ success: true, id: r.lastID, message: "تمت إضافة الحساب الفرعي" });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const listGlAccounts = async (_req, res) => {
  try {
    await ensureChartSeed(db);
    const rows = await db.query(
      `SELECT id_GL_Account, AccountCode, AccountName, AccountType, ParentCode
       FROM GL_Accounts WHERE IsActive = 1 AND BalanceSource != 'GROUP'
       ORDER BY AccountCode`
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const listAssets = async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT fa.*, gl.AccountCode, gl.AccountName AS GlAccountName
       FROM Fixed_Assets_tbl fa
       JOIN GL_Accounts gl ON gl.id_GL_Account = fa.id_GL_Account
       ORDER BY fa.id_Asset DESC`
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const createAsset = async (req, res) => {
  const { AssetName, id_GL_Account, AcquisitionCost, AcquisitionDate, UsefulLifeMonths, SalvageValue, Notes } = req.body;
  if (!AssetName || !id_GL_Account)
    return res.status(400).json({ success: false, message: "اسم الأصل والحساب مطلوبان" });
  try {
    const glRow = await db.queryOne(
      `SELECT id_GL_Account FROM GL_Accounts WHERE id_GL_Account = ? AND AccountCode IN ('113','114') AND IsActive = 1`,
      [Number(id_GL_Account)]
    );
    if (!glRow) return res.status(400).json({ success: false, message: "حساب الأصل يجب أن يكون 113 أو 114" });
    const r = await db.run(
      `INSERT INTO Fixed_Assets_tbl (AssetName, id_GL_Account, AcquisitionCost, AcquisitionDate, UsefulLifeMonths, SalvageValue, Notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        AssetName, glRow.id_GL_Account, r2(AcquisitionCost),
        AcquisitionDate || new Date().toISOString().split("T")[0],
        Number(UsefulLifeMonths) || 60, r2(SalvageValue), Notes || null,
      ]
    );
    res.status(201).json({ success: true, id: r.lastID, message: "تم تسجيل الأصل الثابت" });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const updateAsset = async (req, res) => {
  const { AssetName, id_GL_Account, AcquisitionCost, AcquisitionDate, UsefulLifeMonths, SalvageValue, Notes } = req.body;
  if (!AssetName || !id_GL_Account)
    return res.status(400).json({ success: false, message: "اسم الأصل والحساب مطلوبان" });
  try {
    const glRow = await db.queryOne(
      `SELECT id_GL_Account FROM GL_Accounts WHERE id_GL_Account = ? AND AccountCode IN ('113','114') AND IsActive = 1`,
      [Number(id_GL_Account)]
    );
    if (!glRow) return res.status(400).json({ success: false, message: "حساب الأصل يجب أن يكون 113 أو 114" });
    const r = await db.run(
      `UPDATE Fixed_Assets_tbl
       SET AssetName = ?, id_GL_Account = ?, AcquisitionCost = ?, AcquisitionDate = ?,
           UsefulLifeMonths = ?, SalvageValue = ?, Notes = ?
       WHERE id_Asset = ? AND IsActive = 1`,
      [
        AssetName, glRow.id_GL_Account, r2(AcquisitionCost),
        AcquisitionDate || new Date().toISOString().split("T")[0],
        Number(UsefulLifeMonths) || 60, r2(SalvageValue), Notes || null,
        req.params.id,
      ]
    );
    if (!r.changes) return res.status(404).json({ success: false, message: "الأصل غير موجود" });
    res.json({ success: true, message: "تم تعديل الأصل" });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const removeAsset = async (req, res) => {
  try {
    const linked = await db.queryOne(
      `SELECT COUNT(*) AS c FROM Depreciation_Entry_tbl WHERE id_Asset = ?`,
      [req.params.id]
    );
    if (linked?.c > 0)
      return res.status(400).json({ success: false, message: "لا يمكن الحذف — يوجد قيود اندثار مرتبطة بهذا الأصل" });
    const r = await db.run(`DELETE FROM Fixed_Assets_tbl WHERE id_Asset = ?`, [req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "الأصل غير موجود" });
    res.json({ success: true, message: "تم حذف الأصل" });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const listDepreciation = async (req, res) => {
  try {
    const { year } = req.query;
    let sql = `SELECT de.*, fa.AssetName, gl.AccountCode
               FROM Depreciation_Entry_tbl de
               LEFT JOIN Fixed_Assets_tbl fa ON fa.id_Asset = de.id_Asset
               LEFT JOIN GL_Accounts gl ON gl.id_GL_Account = fa.id_GL_Account`;
    const p = [];
    if (year) { sql += ` WHERE de.FiscalYear = ?`; p.push(Number(year)); }
    sql += ` ORDER BY de.EntryDate DESC, de.id_Entry DESC`;
    const rows = await db.query(sql, p);
    const total = r2(rows.reduce((s, r) => s + r.Amount, 0));
    res.json({ success: true, data: rows, total, note: "مصروف دفتري غير نقدي — لا يخصم من الصندوق" });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const createDepreciation = async (req, res) => {
  const { id_Asset, Amount, EntryDate, Note } = req.body;
  if (!Amount || Amount <= 0)
    return res.status(400).json({ success: false, message: "مبلغ الاندثار مطلوب" });
  try {
    const entryDate = EntryDate || new Date().toISOString().split("T")[0];
    const fiscalYear = Number(entryDate.split("-")[0]);
    const r = await db.run(
      `INSERT INTO Depreciation_Entry_tbl (id_Asset, Amount, EntryDate, FiscalYear, Note, IsNonCash)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [id_Asset || null, r2(Amount), entryDate, fiscalYear, Note || "قيد اندثار — غير نقدي"]
    );
    res.status(201).json({
      success: true,
      id: r.lastID,
      message: "تم تسجيل قيد الاندثار (لا يؤثر على حركة الصندوق)",
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const removeDepreciation = async (req, res) => {
  try {
    await db.run(`DELETE FROM Depreciation_Entry_tbl WHERE id_Entry = ?`, [req.params.id]);
    res.json({ success: true, message: "تم الحذف" });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── تفاصيل الحساب (نقر على بند في الشجرة / قائمة الدخل / الميزانية) ──
async function collectLeafAccounts(rootCode) {
  const all = await db.query(
    `SELECT AccountCode, ParentCode, BalanceSource, AccountName FROM GL_Accounts WHERE IsActive = 1`
  );
  return collectLeafAccountsSync(all, rootCode);
}

function collectLeafAccountsSync(all, rootCode) {
  const node = all.find((a) => a.AccountCode === rootCode);
  if (!node) return [];
  if (node.BalanceSource !== "GROUP") return [node];
  const children = all.filter((a) => a.ParentCode === rootCode);
  if (!children.length) return [node];
  return children.flatMap((ch) => collectLeafAccountsSync(all, ch.AccountCode));
}

async function fetchSpendingRows(glCodes, from, to) {
  if (!glCodes.length) return [];
  const ph = glCodes.map(() => "?").join(",");
  return db.query(
    `SELECT
       sd.Date_SpendingDetails AS txDate,
       s.NamePersonFor_Spending AS description,
       sd.Price_SpendingDetails AS amount,
       COALESCE(sd.Note_SpendingDetails, '') AS note,
       gl.AccountCode AS accountCode,
       gl.AccountName AS accountName
     FROM SpendingDetails_tbl sd
     JOIN Spending_tbl s ON s.id_Spending = sd.id_Spending
     LEFT JOIN GL_Accounts gl ON gl.id_GL_Account = s.id_GL_Account
     WHERE sd.Date_SpendingDetails BETWEEN ? AND ?
       AND (gl.AccountCode IN (${ph}) OR gl.ParentCode IN (${ph}))
     ORDER BY sd.Date_SpendingDetails DESC, sd.id_SpendingDetails DESC`,
    [from, to, ...glCodes, ...glCodes]
  );
}

async function fetchPurchaseForSaleRows(from, to) {
  const grandTotalSql = purchaseInvoiceGrandTotalSql("f");
  const purchases = await db.query(
    `SELECT
       f.Date_FIN AS txDate,
       COALESCE(a.AmilName, 'مورد') AS description,
       ${grandTotalSql} AS amount,
       CONCAT('فاتورة مشتريات #', f.id_NoFIN, ' — ', COALESCE(pt.PayTypeName, '')) AS note,
       f.id_NoFIN AS refId
     FROM FIN_tbl f
     LEFT JOIN Amil_tbl a ON a.id_Amil = f.id_Amil
     LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FIN
     WHERE f.Date_FIN BETWEEN ? AND ?
     ORDER BY f.Date_FIN DESC, f.id_NoFIN DESC`,
    [from, to]
  );

  const returns = await db.query(
    `SELECT
       fr.Date_FRetern AS txDate,
       COALESCE(a.AmilName, 'مورد') AS description,
       -(COALESCE(SUM(dr.AmountOUT * dr.PriceOUT), 0)) AS amount,
       CONCAT('مرتجع مورد #', fr.id_NoFRetern) AS note,
       fr.id_NoFRetern AS refId
     FROM FRetern_tbl fr
     LEFT JOIN Amil_tbl a ON a.id_Amil = fr.id_Party
     JOIN DetailsRetern_tbl dr ON dr.id_NoFRetern = fr.id_NoFRetern
     WHERE fr.ReturnType = 'SUPPLIER' AND fr.Date_FRetern BETWEEN ? AND ?
     GROUP BY fr.id_NoFRetern
     ORDER BY fr.Date_FRetern DESC, fr.id_NoFRetern DESC`,
    [from, to]
  );

  return [...purchases, ...returns];
}

async function fetchCogsRows(from, to) {
  const [sold, returned] = await Promise.all([
    db.query(
      `SELECT
         f.Date_FOUT AS txDate,
         m.MaterialName AS description,
         (d.AmountOUT * m."Cost Price") AS amount,
         CONCAT('فاتورة بيع #', f.id_NoFOUT, ' — كمية ', d.AmountOUT) AS note,
         f.id_NoFOUT AS refId
       FROM DetailsOUT_tbl d
       JOIN FOUT_tbl f ON f.id_NoFOUT = d.id_NoFOUT
       JOIN Materials_tbl m ON m.id_Material_NoM = d.id_Material_NoM
       WHERE f.Date_FOUT BETWEEN ? AND ?
       ORDER BY f.Date_FOUT DESC, f.id_NoFOUT DESC, d.id_Material_NoM`,
      [from, to]
    ),
    db.query(
      `SELECT
         fr.Date_FRetern AS txDate,
         m.MaterialName AS description,
         -(dr.AmountOUT * m."Cost Price") AS amount,
         CONCAT('مرتجع زبون #', fr.id_NoFRetern, ' — كمية ', dr.AmountOUT) AS note,
         fr.id_NoFRetern AS refId
       FROM DetailsRetern_tbl dr
       JOIN FRetern_tbl fr ON fr.id_NoFRetern = dr.id_NoFRetern
       JOIN Materials_tbl m ON m.id_Material_NoM = dr.id_Material_NoM
       WHERE fr.ReturnType = 'CUSTOMER' AND fr.Date_FRetern BETWEEN ? AND ?
       ORDER BY fr.Date_FRetern DESC, fr.id_NoFRetern DESC, dr.id_Material_NoM`,
      [from, to]
    ),
  ]);
  return [...sold, ...returned];
}

async function fetchSalesReturnRows(from, to) {
  return db.query(
    `SELECT
       fr.Date_FRetern AS txDate,
       COALESCE(z.ZabonName, 'زبون') AS description,
       -(COALESCE(SUM(dr.AmountOUT * dr.PriceOUT), 0)) AS amount,
       CONCAT('مرتجع #', fr.id_NoFRetern) AS note,
       fr.id_NoFRetern AS refId
     FROM FRetern_tbl fr
     LEFT JOIN Zabon_tbl z ON z.id_Zabon = fr.id_Party
     JOIN DetailsRetern_tbl dr ON dr.id_NoFRetern = fr.id_NoFRetern
     WHERE fr.ReturnType = 'CUSTOMER' AND fr.Date_FRetern BETWEEN ? AND ?
     GROUP BY fr.id_NoFRetern
     ORDER BY fr.Date_FRetern DESC, fr.id_NoFRetern DESC`,
    [from, to]
  );
}

async function fetchSalesRows(from, to) {
  return db.query(
    `SELECT
       f.Date_FOUT AS txDate,
       COALESCE(z.ZabonName, 'زبون عام') AS description,
       COALESCE(SUM(d.AmountOUT * d.PriceOUT), 0) - COALESCE(f.Dis_FOUT, 0) + COALESCE(f.Add_FOUT, 0) AS amount,
       CONCAT('فاتورة #', f.id_NoFOUT, ' — ', COALESCE(pt.PayTypeName, '')) AS note,
       f.id_NoFOUT AS refId
     FROM FOUT_tbl f
     LEFT JOIN Zabon_tbl z ON z.id_Zabon = f.id_Zabon
     LEFT JOIN PayType_Tbl pt ON pt.id_PayType = f.id_PayType_FOUT
     LEFT JOIN DetailsOUT_tbl d ON d.id_NoFOUT = f.id_NoFOUT
     WHERE f.Date_FOUT BETWEEN ? AND ?
     GROUP BY f.id_NoFOUT
     ORDER BY f.Date_FOUT DESC, f.id_NoFOUT DESC`,
    [from, to]
  );
}

async function fetchDepreciationRows(from, to) {
  return db.query(
    `SELECT
       de.EntryDate AS txDate,
       COALESCE(fa.AssetName, 'اندثار عام') AS description,
       de.Amount AS amount,
       COALESCE(de.Note, '') AS note
     FROM Depreciation_Entry_tbl de
     LEFT JOIN Fixed_Assets_tbl fa ON fa.id_Asset = de.id_Asset
     WHERE de.EntryDate BETWEEN ? AND ?
     ORDER BY de.EntryDate DESC, de.id_Entry DESC`,
    [from, to]
  );
}

async function fetchFixedAssetRows(accountCode) {
  return db.query(
    `SELECT
       fa.AcquisitionDate AS txDate,
       fa.AssetName AS description,
       fa.AcquisitionCost AS amount,
       COALESCE(fa.Notes, '') AS note
     FROM Fixed_Assets_tbl fa
     JOIN GL_Accounts gl ON gl.id_GL_Account = fa.id_GL_Account
     WHERE fa.IsActive = 1 AND gl.AccountCode = ?
     ORDER BY fa.AcquisitionDate DESC, fa.id_Asset DESC`,
    [accountCode]
  );
}

async function fetchInventoryRows() {
  return db.query(
    `SELECT
       m.MaterialName AS description,
       COALESCE(s.QuantityOnHand, 0) AS qty,
       m."Cost Price" AS unitCost,
       (COALESCE(s.QuantityOnHand, 0) * m."Cost Price") AS amount,
       COALESCE(m.Band, '') AS note
     FROM Materials_tbl m
     LEFT JOIN Stock_tbl s ON s.id_Material_NoM = m.id_Material_NoM
     WHERE COALESCE(s.QuantityOnHand, 0) > 0
     ORDER BY amount DESC, m.MaterialName`
  );
}

async function fetchReceivableRows() {
  const rows = await db.query(`
    SELECT * FROM (
      SELECT z.ZabonName AS description,
        COALESCE((SELECT SUM(dz.Amount_DionZabon) FROM DionZabon_tbl dz
                  WHERE dz.id_Zabon = z.id_Zabon
                    AND dz.Note_DionZabon NOT LIKE 'تسوية سند قبض رقم%'), 0)
        - COALESCE((SELECT SUM(cd.Amount_CatchDoc) FROM CatchDoc_tbl cd
                    WHERE cd.id_Zabon = z.id_Zabon), 0) AS amount
      FROM Zabon_tbl z
    ) WHERE amount != 0
    ORDER BY amount DESC
  `);
  return rows.map((r) => ({
    txDate: "—",
    description: r.description,
    amount: r2(r.amount),
    note: "لنا عند الزبون",
  }));
}

async function fetchPayableRows() {
  const rows = await db.query(`
    SELECT * FROM (
      SELECT a.AmilName AS description,
        COALESCE((SELECT SUM(da.Amount_DionAmil) FROM DionAmil_tbl da
                  WHERE da.id_Amil = a.id_Amil
                    AND da.Note_DionAmil NOT LIKE 'تسوية سند دفع رقم%'), 0)
        - COALESCE((SELECT SUM(pd.Amount_PayDoc) FROM PayDoc_tbl pd
                    WHERE pd.id_Amil = a.id_Amil), 0) AS amount
      FROM Amil_tbl a
    ) WHERE amount != 0
    ORDER BY amount DESC
  `);
  return rows.map((r) => ({
    txDate: "—",
    description: r.description,
    amount: r2(r.amount),
    note: "للمورد عندنا",
  }));
}

async function fetchCapitalRows(asOf) {
  return db.query(
    `SELECT DepositDate AS txDate, COALESCE(Notes, '') AS description, CapitalAmount AS amount, '' AS note
     FROM ProjectCapital_tbl
     WHERE DepositDate <= ?
     ORDER BY DepositDate DESC, id_Capital DESC`,
    [asOf]
  );
}

function invoiceRefFromNote(note, refId) {
  if (refId != null && refId !== "") return `#${refId}`;
  const s = String(note || "");
  const m =
    s.match(/(?:فاتورة|سند)\s*(?:[^\d#]*?)#?\s*(\d+)/i) ||
    s.match(/#\s*(\d+)/);
  return m ? `#${m[1]}` : "—";
}

const DETAIL_COLS_WITH_INVOICE = ["txDate", "invoiceRef", "description", "amount", "note"];
const DETAIL_LABELS_WITH_INVOICE = ["التاريخ", "الفاتورة", "البيان", "المبلغ", "ملاحظة"];

async function buildSectionForAccount(acct, range, asOfDate) {
  const { from, to } = range;
  const code = acct.AccountCode;
  const source = acct.BalanceSource;
  let rows = [];
  let columns = ["txDate", "description", "amount", "note"];
  let columnLabels = ["التاريخ", "البيان", "المبلغ", "ملاحظة"];
  let sectionTotal = null;

  switch (source) {
    case "SPENDING":
      rows = await fetchSpendingRows([code], from, to);
      break;
    case "PURCHASE_FOR_SALE":
      rows = await fetchPurchaseForSaleRows(from, to);
      break;
    case "SALES": {
      const [sales, returns] = await Promise.all([
        fetchSalesRows(from, to),
        fetchSalesReturnRows(from, to),
      ]);
      rows = [...sales, ...returns];
      break;
    }
    case "DEPRECIATION_EXP":
      rows = await fetchDepreciationRows(from, to);
      break;
    case "DEPRECIATION_ACCUM": {
      rows = await fetchDepreciationRows("2000-01-01", asOfDate);
      rows = rows.map((r) => ({ ...r, amount: -Math.abs(r.amount) }));
      break;
    }
    case "FIXED_ASSET":
      rows = await fetchFixedAssetRows(code);
      break;
    case "INVENTORY":
      rows = await fetchInventoryRows();
      columns = ["description", "qty", "unitCost", "amount"];
      columnLabels = ["المادة", "الكمية", "تكلفة الوحدة", "قيمة المخزون"];
      break;
    case "RECEIVABLES":
      rows = await fetchReceivableRows();
      break;
    case "PAYABLES":
      rows = await fetchPayableRows();
      break;
    case "CAPITAL":
      rows = await fetchCapitalRows(asOfDate);
      break;
    case "CASH": {
      const cash = await computeBalances({ from, to, asOf: asOfDate });
      rows = [
        { txDate: "—", description: "رأس المال المودع", amount: cash.balanceSheet.capital, note: "مكون الصندوق" },
        { txDate: range.from + " → " + range.to, description: "صافي المبيعات النقدية (تقريبي)", amount: cash.incomeStatement?.netSales || 0, note: "" },
        { txDate: "—", description: "إجمالي الرصيد النقدي", amount: cash.balanceSheet.cash, note: "حساب تراكمي" },
      ];
      sectionTotal = cash.balanceSheet.cash;
      break;
    }
    case "RETAINED": {
      const inc = await computeBalances({ from, to, asOf: asOfDate });
      const np = inc.incomeStatement.netProfit;
      rows = [
        { txDate: range.from + " → " + range.to, description: "صافي المبيعات", amount: inc.incomeStatement.netSales, note: "" },
        { txDate: "—", description: "تكلفة البضاعة المباعة", amount: -inc.incomeStatement.cogs, note: "" },
        { txDate: "—", description: "المصروفات التشغيلية", amount: -inc.incomeStatement.totalOperatingExpenses, note: "" },
        { txDate: "—", description: "خسائر مواد منتهية الصلاحية", amount: -inc.incomeStatement.expiredStockLoss, note: "" },
        { txDate: "—", description: "صافي الربح / الخسارة (الفترة)", amount: np, note: "الرصيد المعروض في الشجرة" },
      ];
      sectionTotal = np;
      break;
    }
    default:
      rows = await fetchSpendingRows([code], from, to);
  }

  const mapped = rows.map((r) => ({
    txDate: r.txDate ?? "—",
    invoiceRef: invoiceRefFromNote(r.note, r.refId),
    description: r.description ?? "—",
    amount: r2(r.amount),
    note: r.note ?? "",
    qty: r.qty != null ? r.qty : undefined,
    unitCost: r.unitCost != null ? r2(r.unitCost) : undefined,
  }));

  const noInvoiceSources = new Set([
    "INVENTORY", "RECEIVABLES", "PAYABLES", "CAPITAL", "CASH", "RETAINED", "FIXED_ASSET", "DEPRECIATION_ACCUM",
  ]);
  if (!noInvoiceSources.has(source) && columns[0] === "txDate" && columns.length === 4) {
    columns = DETAIL_COLS_WITH_INVOICE;
    columnLabels = DETAIL_LABELS_WITH_INVOICE;
  }

  return {
    title: `${code} — ${acct.AccountName}`,
    accountCode: code,
    columns,
    columnLabels,
    rows: mapped,
    total: sectionTotal != null
      ? r2(sectionTotal)
      : r2(mapped.reduce((s, r) => s + (+r.amount || 0), 0)),
  };
}

const getAccountDetails = async (req, res) => {
  try {
    await ensureChartSeed(db);
    const { code, from, to, asOf, section } = req.query;
    if (!code) return res.status(400).json({ success: false, message: "code مطلوب" });

    const range = resolveRange(from, to);
    const asOfDate = asOf || range.to;
    const account = await db.queryOne(
      `SELECT * FROM GL_Accounts WHERE AccountCode = ? AND IsActive = 1`,
      [code]
    );

    if (code === "—" && section === "cogs") {
      const rows = (await fetchCogsRows(range.from, range.to)).map((r) => ({
        txDate: r.txDate,
        invoiceRef: invoiceRefFromNote(r.note, r.refId),
        description: r.description,
        amount: r2(r.amount),
        note: r.note,
      }));
      return res.json({
        success: true,
        account: { code: "—", name: "تكلفة البضاعة المباعة" },
        period: range,
        columns: DETAIL_COLS_WITH_INVOICE,
        columnLabels: ["التاريخ", "الفاتورة", "المادة", "التكلفة", "ملاحظة"],
        rows,
        total: r2(rows.reduce((s, r) => s + r.amount, 0)),
      });
    }

    if (!account) {
      return res.status(404).json({ success: false, message: "الحساب غير موجود" });
    }

    const sections = [];

    if (account.BalanceSource === "GROUP") {
      const leaves = await collectLeafAccounts(code);
      for (const leaf of leaves) {
        const sec = await buildSectionForAccount(leaf, range, asOfDate);
        if (sec.rows.length) sections.push(sec);
      }
    } else if (code === "32" && section === "expense") {
      sections.push(await buildSectionForAccount(account, range, asOfDate));
    } else if (code === "32") {
      const spendSec = await buildSectionForAccount(
        { ...account, BalanceSource: "SPENDING", AccountCode: "32" },
        range,
        asOfDate
      );
      spendSec.title = "32 — مصاريف المستلزمات السلعية";
      if (spendSec.rows.length) sections.push(spendSec);

      const cogsRows = (await fetchCogsRows(range.from, range.to)).map((r) => ({
        txDate: r.txDate,
        invoiceRef: invoiceRefFromNote(r.note, r.refId),
        description: r.description,
        amount: r2(r.amount),
        note: r.note,
      }));
      sections.push({
        title: "تكلفة البضاعة المباعة (ضمن حـ/ 32)",
        accountCode: "32",
        columns: DETAIL_COLS_WITH_INVOICE,
        columnLabels: ["التاريخ", "الفاتورة", "المادة", "التكلفة", "ملاحظة"],
        rows: cogsRows,
        total: r2(cogsRows.reduce((s, r) => s + r.amount, 0)),
      });
    } else {
      sections.push(await buildSectionForAccount(account, range, asOfDate));
    }

    const flatRows = sections.flatMap((s) => s.rows);
    const total = r2(sections.reduce((s, sec) => s + sec.total, 0));

    res.json({
      success: true,
      account: { code: account.AccountCode, name: account.AccountName },
      period: range,
      asOf: asOfDate,
      sections,
      rows: flatRows,
      total,
      columns: sections[0]?.columns || ["txDate", "description", "amount", "note"],
      columnLabels: sections[0]?.columnLabels || ["التاريخ", "البيان", "المبلغ", "ملاحظة"],
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = {
  getChart,
  getIncomeStatement,
  getGeneralTaxDetails,
  getBalanceSheet,
  getAccountDetails,
  listGlParents,
  createGlAccount,
  listGlAccounts,
  listAssets,
  createAsset,
  updateAsset,
  removeAsset,
  listDepreciation,
  createDepreciation,
  removeDepreciation,
};
