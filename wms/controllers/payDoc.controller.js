// controllers/payDoc.controller.js  —  جدول سندات الدفع للموردين PayDoc_tbl
const db = require("../db");

const getAll = async (req, res) => {
  try {
    const { id_Amil } = req.query;
    let sql = `SELECT p.*, a.AmilName FROM PayDoc_tbl p LEFT JOIN Amil_tbl a ON a.id_Amil=p.id_Amil WHERE 1=1`;
    const pr = [];
    if (id_Amil) { sql += " AND p.id_Amil=?"; pr.push(id_Amil); }
    sql += " ORDER BY p.Date_PayDoc DESC";
    const rows = await db.query(sql, pr);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(`SELECT * FROM PayDoc_tbl WHERE id_PayDoc=?`, [req.params.id]);
    if (!row) return res.status(404).json({ success: false, message: "السند غير موجود" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const create = async (req, res) => {
  const { Amount_PayDoc = 0, Date_PayDoc, Note_PayDoc, id_Amil } = req.body;
  if (!id_Amil || !Note_PayDoc) return res.status(400).json({ success: false, message: "المورد والملاحظة مطلوبان" });
  try {
    const r = await db.run(
      `INSERT INTO PayDoc_tbl (Amount_PayDoc,Date_PayDoc,Note_PayDoc,id_Amil) VALUES (?,?,?,?)`,
      [Amount_PayDoc, Date_PayDoc, Note_PayDoc, id_Amil]);
    res.status(201).json({ success: true, message: "تم إضافة سند الدفع", id: r.lastID });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const update = async (req, res) => {
  const { Amount_PayDoc, Date_PayDoc, Note_PayDoc } = req.body;
  try {
    const r = await db.run(
      `UPDATE PayDoc_tbl SET Amount_PayDoc=?,Date_PayDoc=?,Note_PayDoc=? WHERE id_PayDoc=?`,
      [Amount_PayDoc, Date_PayDoc, Note_PayDoc, req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "السند غير موجود" });
    res.json({ success: true, message: "تم التعديل" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const remove = async (req, res) => {
  try {
    const r = await db.run(`DELETE FROM PayDoc_tbl WHERE id_PayDoc=?`, [req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "السند غير موجود" });
    res.json({ success: true, message: "تم الحذف" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getOne, create, update, remove };
