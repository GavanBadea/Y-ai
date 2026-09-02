// ============================================================
//  utils/iraqiChartSeed.js
//  شجرة الحسابات — النظام المحاسبي العراقي الموحد (تأسيس)
// ============================================================

const IRAQI_COA_SEED = [
  { code: "1",   name: "الموجودات",                    type: "ASSET",     parent: null,  system: 1, source: "GROUP" },
  { code: "11",  name: "الموجودات الثابتة",            type: "ASSET",     parent: "1",   system: 1, source: "GROUP" },
  { code: "113", name: "أثاث وأجهزة مكاتب",            type: "ASSET",     parent: "11",  system: 1, source: "FIXED_ASSET" },
  { code: "114", name: "وسائل نقل وانتقال",            type: "ASSET",     parent: "11",  system: 1, source: "FIXED_ASSET" },
  { code: "12",  name: "مخصص الاندثار المتراكم",       type: "CONTRA",    parent: "1",   system: 1, source: "DEPRECIATION_ACCUM" },
  { code: "13",  name: "المخزون",                      type: "ASSET",     parent: "1",   system: 1, source: "INVENTORY" },
  { code: "16",  name: "المدينون والعملاء",            type: "ASSET",     parent: "1",   system: 1, source: "RECEIVABLES" },
  { code: "18",  name: "النقود والصندوق",              type: "ASSET",     parent: "1",   system: 1, source: "CASH" },

  { code: "2",   name: "المطلوبات وحقوق الملكية",      type: "LIABILITY", parent: null,  system: 1, source: "GROUP" },
  { code: "21",  name: "رأس المال والاحتياطيات",       type: "EQUITY",    parent: "2",   system: 1, source: "CAPITAL" },
  { code: "218", name: "الأرباح والخسائر المتراكمة",   type: "EQUITY",    parent: "2",   system: 1, source: "RETAINED" },
  { code: "26",  name: "الدائنون والموردون",           type: "LIABILITY", parent: "2",   system: 1, source: "PAYABLES" },

  { code: "3",   name: "المصروفات",                    type: "EXPENSE",   parent: null,  system: 1, source: "GROUP" },
  { code: "31",  name: "الرواتب والأجور",              type: "EXPENSE",   parent: "3",   system: 1, source: "SPENDING" },
  { code: "32",  name: "المستلزمات السلعية",           type: "EXPENSE",   parent: "3",   system: 1, source: "SPENDING" },
  { code: "33",  name: "المستلزمات الخدمية",           type: "EXPENSE",   parent: "3",   system: 1, source: "SPENDING" },
  { code: "35",  name: "مشتريات لغرض البيع",           type: "EXPENSE",   parent: "3",   system: 1, source: "PURCHASE_FOR_SALE" },
  { code: "37",  name: "مصروف الاندثار",               type: "EXPENSE",   parent: "3",   system: 1, source: "DEPRECIATION_EXP" },

  { code: "4",   name: "الإيرادات",                    type: "REVENUE",   parent: null,  system: 1, source: "GROUP" },
  { code: "41",  name: "إيراد النشاط الجاري (المبيعات)", type: "REVENUE", parent: "4",   system: 1, source: "SALES" },
];

async function insertGlAccount(db, a) {
  await db.run(
    `INSERT INTO GL_Accounts (AccountCode, AccountName, AccountType, ParentCode, IsSystem, BalanceSource, IsActive)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [a.code, a.name, a.type, a.parent, a.system, a.source]
  );
}

/** إضافة حسابات نظامية جديدة لقواعد بيانات قائمة دون إعادة التأسيس */
async function ensureMissingSystemAccounts(db) {
  for (const a of IRAQI_COA_SEED) {
    const exists = await db.queryOne(
      `SELECT id_GL_Account, BalanceSource FROM GL_Accounts WHERE AccountCode = ?`,
      [a.code]
    );
    if (!exists) {
      await insertGlAccount(db, a);
    } else if (a.system && exists.BalanceSource !== a.source) {
      await db.run(
        `UPDATE GL_Accounts
         SET BalanceSource = ?, AccountName = ?, ParentCode = ?, AccountType = ?, IsActive = 1
         WHERE AccountCode = ?`,
        [a.source, a.name, a.parent, a.type, a.code]
      );
    }
  }
}

async function ensureChartSeed(db) {
  const row = await db.queryOne(`SELECT COUNT(*) AS c FROM GL_Accounts`);
  if (row?.c > 0) {
    await ensureMissingSystemAccounts(db);
    return false;
  }

  for (const a of IRAQI_COA_SEED) {
    await insertGlAccount(db, a);
  }
  return true;
}

module.exports = { IRAQI_COA_SEED, ensureChartSeed, ensureMissingSystemAccounts };
