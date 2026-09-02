// controllers/dionZabon.controller.js  —  جدول ديون الزبائن DionZabon_tbl
const db = require("../db");

const getAll = async (req, res) => {
  try {
    const { id_Zabon } = req.query;
    let sql = `SELECT d.*, z.ZabonName FROM DionZabon_tbl d LEFT JOIN Zabon_tbl z ON z.id_Zabon=d.id_Zabon WHERE 1=1`;
    const p = [];
    if (id_Zabon) { sql += " AND d.id_Zabon=?"; p.push(id_Zabon); }
    sql += " ORDER BY d.Date_DionZabon DESC";
    const rows = await db.query(sql, p);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(`SELECT * FROM DionZabon_tbl WHERE id_DionZabon=?`, [req.params.id]);
    if (!row) return res.status(404).json({ success: false, message: "السجل غير موجود" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const create = async (req, res) => {
  const { Amount_DionZabon = 0, Date_DionZabon, Note_DionZabon, id_Zabon } = req.body;
  if (!id_Zabon || !Note_DionZabon) return res.status(400).json({ success: false, message: "الزبون والملاحظة مطلوبان" });
  try {
    const r = await db.run(
      `INSERT INTO DionZabon_tbl (Amount_DionZabon,Date_DionZabon,Note_DionZabon,id_Zabon) VALUES (?,?,?,?)`,
      [Amount_DionZabon, Date_DionZabon, Note_DionZabon, id_Zabon]);
    res.status(201).json({ success: true, message: "تم الإضافة", id: r.lastID });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const update = async (req, res) => {
  const { Amount_DionZabon, Date_DionZabon, Note_DionZabon } = req.body;
  try {
    const r = await db.run(
      `UPDATE DionZabon_tbl SET Amount_DionZabon=?,Date_DionZabon=?,Note_DionZabon=? WHERE id_DionZabon=?`,
      [Amount_DionZabon, Date_DionZabon, Note_DionZabon, req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "السجل غير موجود" });
    res.json({ success: true, message: "تم التعديل" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const remove = async (req, res) => {
  try {
    const r = await db.run(`DELETE FROM DionZabon_tbl WHERE id_DionZabon=?`, [req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "السجل غير موجود" });
    res.json({ success: true, message: "تم الحذف" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getOne, create, update, remove };
