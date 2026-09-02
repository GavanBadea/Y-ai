// controllers/type.controller.js  —  جدول الأنواع Type_tbl
const db = require("../db");

const getAll = async (_req, res) => {
  try {
    const rows = await db.query(`SELECT * FROM Type_tbl ORDER BY TypeName`);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const getOne = async (req, res) => {
  try {
    const row = await db.queryOne(`SELECT * FROM Type_tbl WHERE id_Type=?`, [req.params.id]);
    if (!row) return res.status(404).json({ success: false, message: "النوع غير موجود" });
    res.json({ success: true, data: row });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const create = async (req, res) => {
  const { TypeName } = req.body;
  if (!TypeName) return res.status(400).json({ success: false, message: "الاسم مطلوب" });
  try {
    const r = await db.run(`INSERT INTO Type_tbl (TypeName) VALUES (?)`, [TypeName]);
    res.status(201).json({ success: true, message: "تم الإضافة", id: r.lastID });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const update = async (req, res) => {
  const { TypeName } = req.body;
  try {
    const r = await db.run(`UPDATE Type_tbl SET TypeName=? WHERE id_Type=?`, [TypeName, req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "النوع غير موجود" });
    res.json({ success: true, message: "تم التعديل" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

const remove = async (req, res) => {
  try {
    const r = await db.run(`DELETE FROM Type_tbl WHERE id_Type=?`, [req.params.id]);
    if (!r.changes) return res.status(404).json({ success: false, message: "النوع غير موجود" });
    res.json({ success: true, message: "تم الحذف" });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

module.exports = { getAll, getOne, create, update, remove };
