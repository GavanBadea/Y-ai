// controllers/catchDoc.controller.js  —  جدول سندات القبض من الزبائن CatchDoc_tbl
const db = require("../db");

const getAll = async (req, res) => {
  try {
    const { id_Zabon } = req.query;
    let sql = `SELECT c.*, z.ZabonName FROM CatchDoc_tbl c LEFT JOIN Zabon_tbl z ON z.id_Zabon=c.id_Zabon WHERE 1=1`;
    const p = [];
    if (id_Zabon) { sql += " AND c.id_Zabon=?"; p.push(id_Zabon); }
    sql += " ORDER BY c.Date_CatchDoc DESC";
    const rows = await db.query(sql, p);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(`SELECT * FROM CatchDoc_tbl WHERE id_CatchDoc=?`, [req.params.id]);
    if (!row) return res.status(404).json({ success: false, message: "السند غير موجود" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const create = async (req, res) => {
  const { Amount_CatchDoc = 0, Date_CatchDoc, Note_CatchDoc, id_Zabon } = req.body;
  if (!id_Zabon || !Note_CatchDoc)
    return res.status(400).json({ success: false, message: "الزبون والملاحظة مطلوبان" });
  try {
    const r = await db.run(
      `INSERT INTO CatchDoc_tbl (Amount_CatchDoc,Date_CatchDoc,Note_CatchDoc,id_Zabon) VALUES (?,?,?,?)`,
      [Amount_CatchDoc, Date_CatchDoc, Note_CatchDoc, id_Zabon]);
    res.status(201).json({ success: true, message: "تم إضافة سند القبض", id: r.lastID });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const update = async (req, res) => {
  const { Amount_CatchDoc, Date_CatchDoc, Note_CatchDoc } = req.body;
  try {
    const r = await db.run(
      `UPDATE CatchDoc_tbl SET Amount_CatchDoc=?,Date_CatchDoc=?,Note_CatchDoc=? WHERE id_CatchDoc=?`,
      [Amount_CatchDoc, Date_CatchDoc, Note_CatchDoc, req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "السند غير موجود" });
    res.json({ success: true, message: "تم التعديل" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const remove = async (req, res) => {
  try {
    const r = await db.run(`DELETE FROM CatchDoc_tbl WHERE id_CatchDoc=?`, [req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "السند غير موجود" });
    res.json({ success: true, message: "تم الحذف" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getOne, create, update, remove };
