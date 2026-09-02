// controllers/spendingDetails.controller.js  —  جدول تفاصيل المصاريف SpendingDetails_tbl
const db = require("../db");

const getAll = async (req, res) => {
  try {
    const { id_Spending, from, to } = req.query;
    let sql = `
      SELECT sd.*, s.NamePersonFor_Spending
      FROM SpendingDetails_tbl sd
      LEFT JOIN Spending_tbl s ON s.id_Spending = sd.id_Spending
      WHERE 1=1`;
    const p = [];
    if (id_Spending) { sql += " AND sd.id_Spending=?";              p.push(id_Spending); }
    if (from)        { sql += " AND sd.Date_SpendingDetails>=?";     p.push(from); }
    if (to)          { sql += " AND sd.Date_SpendingDetails<=?";     p.push(to); }
    sql += " ORDER BY sd.Date_SpendingDetails DESC";
    const rows = await db.query(sql, p);

    // إجمالي المصاريف في نفس الرد
    const total = rows.reduce((s, r) => s + (r.Price_SpendingDetails || 0), 0);
    res.json({ success: true, count: rows.length, total, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(`SELECT * FROM SpendingDetails_tbl WHERE id_SpendingDetails=?`, [req.params.id]);
    if (!row) return res.status(404).json({ success: false, message: "السجل غير موجود" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const create = async (req, res) => {
  const { Price_SpendingDetails = 0, Date_SpendingDetails, Note_SpendingDetails, id_Spending } = req.body;
  if (!id_Spending) return res.status(400).json({ success: false, message: "نوع المصروف مطلوب" });
  try {
    const r = await db.run(
      `INSERT INTO SpendingDetails_tbl (Price_SpendingDetails,Date_SpendingDetails,Note_SpendingDetails,id_Spending)
       VALUES (?,?,?,?)`,
      [Price_SpendingDetails, Date_SpendingDetails, Note_SpendingDetails, id_Spending]);
    res.status(201).json({ success: true, message: "تم إضافة المصروف", id: r.lastID });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const update = async (req, res) => {
  const { Price_SpendingDetails, Date_SpendingDetails, Note_SpendingDetails, id_Spending } = req.body;
  try {
    const r = await db.run(
      `UPDATE SpendingDetails_tbl SET Price_SpendingDetails=?,Date_SpendingDetails=?,Note_SpendingDetails=?,id_Spending=?
       WHERE id_SpendingDetails=?`,
      [Price_SpendingDetails, Date_SpendingDetails, Note_SpendingDetails, id_Spending, req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "السجل غير موجود" });
    res.json({ success: true, message: "تم التعديل" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const remove = async (req, res) => {
  try {
    const r = await db.run(`DELETE FROM SpendingDetails_tbl WHERE id_SpendingDetails=?`, [req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "السجل غير موجود" });
    res.json({ success: true, message: "تم الحذف" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getOne, create, update, remove };
