// controllers/spending.controller.js  —  جدول أنواع المصاريف Spending_tbl
const db = require("../db");
const { ensureChartSeed } = require("../utils/iraqiChartSeed");

const SPENDING_GL_CODES = ["31", "32", "33"];

async function resolveGlAccount(id_GL_Account) {
  await ensureChartSeed(db);
  if (id_GL_Account) {
    const row = await db.queryOne(
      `SELECT id_GL_Account FROM GL_Accounts
       WHERE id_GL_Account = ? AND AccountCode IN ('31','32','33') AND IsActive = 1`,
      [Number(id_GL_Account)]
    );
    if (!row) throw new Error("حساب المصروف غير صالح — اختر من الرواتب أو المستلزمات السلعية أو الخدمية");
    return row.id_GL_Account;
  }
  const def = await db.queryOne(
    `SELECT id_GL_Account FROM GL_Accounts WHERE AccountCode = '32' AND IsActive = 1`
  );
  return def?.id_GL_Account ?? null;
}

const getAll = async (_req, res) => {
  try {
    await ensureChartSeed(db);
    const rows = await db.query(`
      SELECT s.*,
        COALESCE((SELECT SUM(sd.Price_SpendingDetails) FROM SpendingDetails_tbl sd WHERE sd.id_Spending=s.id_Spending),0) AS TotalSpent,
        gl.AccountCode AS GlAccountCode,
        gl.AccountName AS GlAccountName
      FROM Spending_tbl s
      LEFT JOIN GL_Accounts gl ON gl.id_GL_Account = s.id_GL_Account
      ORDER BY s.NamePersonFor_Spending`);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(
      `SELECT s.*, gl.AccountCode AS GlAccountCode, gl.AccountName AS GlAccountName
       FROM Spending_tbl s
       LEFT JOIN GL_Accounts gl ON gl.id_GL_Account = s.id_GL_Account
       WHERE s.id_Spending = ?`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ success: false, message: "النوع غير موجود" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const listGlAccounts = async (_req, res) => {
  try {
    await ensureChartSeed(db);
    const rows = await db.query(
      `SELECT id_GL_Account, AccountCode, AccountName
       FROM GL_Accounts
       WHERE AccountCode IN ('31','32','33') AND IsActive = 1
       ORDER BY AccountCode`
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const create = async (req, res) => {
  const { NamePersonFor_Spending, id_GL_Account } = req.body;
  if (!NamePersonFor_Spending) return res.status(400).json({ success: false, message: "الاسم مطلوب" });
  try {
    const glId = await resolveGlAccount(id_GL_Account);
    const r = await db.run(
      `INSERT INTO Spending_tbl (NamePersonFor_Spending, id_GL_Account) VALUES (?, ?)`,
      [NamePersonFor_Spending, glId]
    );
    res.status(201).json({ success: true, message: "تم الإضافة", id: r.lastID });
  } catch (e) {
    const status = e.message.includes("حساب المصروف") ? 400 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

const update = async (req, res) => {
  const { NamePersonFor_Spending, id_GL_Account } = req.body;
  try {
    const glId = await resolveGlAccount(id_GL_Account);
    const r = await db.run(
      `UPDATE Spending_tbl SET NamePersonFor_Spending = ?, id_GL_Account = ? WHERE id_Spending = ?`,
      [NamePersonFor_Spending, glId, req.params.id]
    );
    if (!r.changes) return res.status(404).json({ success: false, message: "النوع غير موجود" });
    res.json({ success: true, message: "تم التعديل" });
  } catch (e) {
    const status = e.message.includes("حساب المصروف") ? 400 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

const remove = async (req, res) => {
  try {
    const r = await db.run(`DELETE FROM Spending_tbl WHERE id_Spending=?`, [req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "النوع غير موجود" });
    res.json({ success: true, message: "تم الحذف" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getOne, create, update, remove, listGlAccounts, SPENDING_GL_CODES };
