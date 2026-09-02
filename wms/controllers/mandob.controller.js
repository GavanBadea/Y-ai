// controllers/mandob.controller.js  —  جدول المندوبين Mandob_tbl
const db = require("../db");

const getAll = async (_req, res) => {
  try {
    const rows = await db.query(`SELECT * FROM Mandob_tbl ORDER BY MandobName`);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(`SELECT * FROM Mandob_tbl WHERE id_Mandob=?`, [req.params.id]);
    if (!row) return res.status(404).json({ success: false, message: "المندوب غير موجود" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const create = async (req, res) => {
  const { MandobName } = req.body;
  if (!MandobName) return res.status(400).json({ success: false, message: "الاسم مطلوب" });
  try {
    const r = await db.run(`INSERT INTO Mandob_tbl (MandobName) VALUES (?)`, [MandobName]);
    res.status(201).json({ success: true, message: "تم الإضافة", id: r.lastID });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const update = async (req, res) => {
  const { MandobName } = req.body;
  try {
    const r = await db.run(`UPDATE Mandob_tbl SET MandobName=? WHERE id_Mandob=?`, [MandobName, req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "المندوب غير موجود" });
    res.json({ success: true, message: "تم التعديل" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const remove = async (req, res) => {
  try {
    const r = await db.run(`DELETE FROM Mandob_tbl WHERE id_Mandob=?`, [req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "المندوب غير موجود" });
    res.json({ success: true, message: "تم الحذف" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getOne, create, update, remove };
