// controllers/dionAmil.controller.js  —  جدول ديون العملاء (الموردين) DionAmil_tbl
const db = require("../db");

const getAll = async (req, res) => {
  try {
    const { id_Amil } = req.query;
    let sql = `SELECT d.*, a.AmilName FROM DionAmil_tbl d LEFT JOIN Amil_tbl a ON a.id_Amil=d.id_Amil WHERE 1=1`;
    const p = [];
    if (id_Amil) { sql += " AND d.id_Amil=?"; p.push(id_Amil); }
    sql += " ORDER BY d.Date_DionAmil DESC";
    const rows = await db.query(sql, p);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(`SELECT * FROM DionAmil_tbl WHERE id_DionAmil=?`, [req.params.id]);
    if (!row) return res.status(404).json({ success: false, message: "السجل غير موجود" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const create = async (req, res) => {
  const { Amount_DionAmil = 0, Date_DionAmil, Note_DionAmil, id_Amil } = req.body;
  if (!id_Amil || !Note_DionAmil) return res.status(400).json({ success: false, message: "المورد والملاحظة مطلوبان" });
  try {
    const r = await db.run(
      `INSERT INTO DionAmil_tbl (Amount_DionAmil,Date_DionAmil,Note_DionAmil,id_Amil) VALUES (?,?,?,?)`,
      [Amount_DionAmil, Date_DionAmil, Note_DionAmil, id_Amil]);
    res.status(201).json({ success: true, message: "تم الإضافة", id: r.lastID });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const update = async (req, res) => {
  const { Amount_DionAmil, Date_DionAmil, Note_DionAmil } = req.body;
  try {
    const r = await db.run(
      `UPDATE DionAmil_tbl SET Amount_DionAmil=?,Date_DionAmil=?,Note_DionAmil=? WHERE id_DionAmil=?`,
      [Amount_DionAmil, Date_DionAmil, Note_DionAmil, req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "السجل غير موجود" });
    res.json({ success: true, message: "تم التعديل" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const remove = async (req, res) => {
  try {
    const r = await db.run(`DELETE FROM DionAmil_tbl WHERE id_DionAmil=?`, [req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "السجل غير موجود" });
    res.json({ success: true, message: "تم الحذف" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getOne, create, update, remove };
