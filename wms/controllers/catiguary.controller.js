// controllers/catiguary.controller.js  —  جدول الأصناف Catiguary_tbl
const db = require("../db");

const getAll = async (_req, res) => {
  try {
    const rows = await db.query(`SELECT * FROM Catiguary_tbl ORDER BY CatiguaryName`);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(`SELECT * FROM Catiguary_tbl WHERE id_Catiguary=?`, [req.params.id]);
    if (!row) return res.status(404).json({ success: false, message: "الصنف غير موجود" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const create = async (req, res) => {
  const { CatiguaryName } = req.body;
  if (!CatiguaryName) return res.status(400).json({ success: false, message: "الاسم مطلوب" });
  try {
    const r = await db.run(`INSERT INTO Catiguary_tbl (CatiguaryName) VALUES (?)`, [CatiguaryName]);
    res.status(201).json({ success: true, message: "تم الإضافة", id: r.lastID });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const update = async (req, res) => {
  const { CatiguaryName } = req.body;
  try {
    const r = await db.run(`UPDATE Catiguary_tbl SET CatiguaryName=? WHERE id_Catiguary=?`, [CatiguaryName, req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "الصنف غير موجود" });
    res.json({ success: true, message: "تم التعديل" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const remove = async (req, res) => {
  try {
    const r = await db.run(`DELETE FROM Catiguary_tbl WHERE id_Catiguary=?`, [req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "الصنف غير موجود" });
    res.json({ success: true, message: "تم الحذف" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getOne, create, update, remove };
